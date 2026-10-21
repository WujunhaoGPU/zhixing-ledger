"""Loopback-only bridge; pairing credentials are separate from Codex credentials."""
import asyncio
import json
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from codex_auth.service import CodexService
from codex_auth.contracts import CodexAuthError
from codex_auth.storage import _atomic_write_json
from provider import response_events

PORT = 17643
EXTENSION_ORIGIN = re.compile(r'^chrome-extension://[a-p]{32}$')


def default_root():
    return Path(os.environ.get('ZHIXING_DATA_DIR', str(Path.home() / 'Library/Application Support/ZhixingLedger')))


def create_app(service=None, root=None):
    root = Path(root or default_root())
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    service = service or CodexService(root)
    pairing = {'code': secrets.token_urlsafe(9), 'expires': time.time()+600, 'attempts': 0}
    pair_file = root / 'paired-extension.json'
    tasks = {}

    @asynccontextmanager
    async def lifespan(app):
        print(f'知行簿本地服务：http://127.0.0.1:{PORT}\n配对码（10 分钟有效）：{pairing["code"]}', flush=True)
        yield
        for task in list(tasks.values()):
            task.cancel()
        await service.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service = service
    app.state.pairing = pairing

    @app.middleware('http')
    async def guard(request, call_next):
        host = request.headers.get('host', '')
        origin = request.headers.get('origin') or request.headers.get('x-zhixing-extension', '')
        if host != f'127.0.0.1:{PORT}':
            return JSONResponse({'error': 'invalid_host'}, 403)
        if not EXTENSION_ORIGIN.fullmatch(origin):
            # Health is deliberately unauthenticated, contains no user data and allows no writes.
            if request.url.path != '/health' or request.method != 'GET':
                return JSONResponse({'error': 'invalid_origin'}, 403)
        if request.method == 'OPTIONS':
            response = JSONResponse({})
        else:
            if request.url.path not in {'/health', '/pair'}:
                try:
                    saved = json.loads(pair_file.read_text())
                except (OSError, ValueError):
                    saved = {}
                if saved.get('origin') != origin or not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer '+saved.get('token', secrets.token_urlsafe())):
                    return JSONResponse({'error': 'pairing_required', 'message': '请先使用启动窗口中的配对码连接本地服务。'}, 401)
            response = await call_next(request)
        if EXTENSION_ORIGIN.fullmatch(origin):
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
            response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Zhixing-Extension'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
            response.headers['Access-Control-Allow-Private-Network'] = 'true'
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(CodexAuthError)
    async def auth_error(request, error):
        return JSONResponse({'error': error.code, 'message': error.public_message}, error.http_status)

    async def read_body(request):
        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > 600_000:
                raise CodexAuthError('input_too_large', '输入过长，请缩短材料。', 413)
        raw = bytes(chunks)
        try:
            body = json.loads(raw)
            if not isinstance(body, dict):
                raise ValueError
            return body
        except (ValueError, UnicodeError):
            raise CodexAuthError('invalid_input', '请求格式无效。') from None

    @app.get('/health')
    async def health():
        return {'service': 'zhixing-ledger', 'protocol': 1}

    @app.post('/pair')
    async def pair(request: Request):
        body = await read_body(request)
        pairing['attempts'] += 1
        if pairing['attempts'] > 10 or time.time() > pairing['expires'] or not secrets.compare_digest(str(body.get('code','')), pairing['code']):
            raise CodexAuthError('pairing_failed', '配对码无效或已过期，请重启本地服务后重试。', 403)
        token = secrets.token_urlsafe(32)
        _atomic_write_json(pair_file, {'origin': request.headers.get('origin') or request.headers.get('x-zhixing-extension'), 'token': token})
        pairing['expires'] = 0
        return {'token': token}

    @app.get('/codex/status')
    async def status():
        return service.status()

    @app.post('/codex/oauth/start')
    async def start():
        return await service.start()

    @app.post('/codex/oauth/cancel')
    async def cancel():
        return await service.cancel()

    @app.post('/codex/oauth/complete')
    async def complete(request: Request):
        body = await read_body(request)
        return await service.complete(str(body.get('callback_url','')))

    @app.post('/codex/logout')
    async def logout():
        return await service.logout()

    @app.post('/codex/models/refresh')
    async def models():
        return await service.refresh_models()

    @app.post('/tasks')
    async def task(request: Request):
        body = await read_body(request)
        task_id = body.get('id')
        messages = body.get('messages')
        if not isinstance(task_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{8,80}',task_id) or task_id in tasks:
            raise CodexAuthError('invalid_id', '任务编号无效或任务正在进行。', 409)
        if not isinstance(body.get('model'),str) or not isinstance(messages,list) or not 1 <= len(messages) <= 30:
            raise CodexAuthError('invalid_input', '模型或对话无效。')
        if any(not isinstance(m,dict) or m.get('role') not in {'system','user','assistant'} or not isinstance(m.get('content'),str) or not m['content'].strip() for m in messages):
            raise CodexAuthError('invalid_input', '对话消息无效。')
        async def stream():
            current = asyncio.current_task()
            tasks[task_id] = current
            try:
                async for event in response_events(service, body):
                    if await request.is_disconnected():
                        return
                    yield json.dumps(event, ensure_ascii=False)+'\n'
            except CodexAuthError as exc:
                yield json.dumps({'type':'error', 'code':exc.code, 'message':exc.public_message},ensure_ascii=False)+'\n'
            except asyncio.CancelledError:
                return
            except Exception:
                yield json.dumps({'type':'error','message':'本地服务发生错误，本轮未结算。'},ensure_ascii=False)+'\n'
            finally:
                if tasks.get(task_id) is current:
                    tasks.pop(task_id, None)
        return StreamingResponse(stream(),media_type='application/x-ndjson')

    @app.post('/tasks/{task_id}/cancel')
    async def cancel_task(task_id: str):
        running = tasks.get(task_id)
        if running:
            running.cancel()
        return {'cancelled': bool(running)}

    return app


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(create_app(), host='127.0.0.1', port=PORT, access_log=False)
