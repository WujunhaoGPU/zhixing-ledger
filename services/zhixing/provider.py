"""Text-only Codex Responses adapter, request shape adapted from DeepTutor."""
import asyncio
import json
import time
import httpx
from codex_auth.constants import CODEX_RESPONSES_URL
from codex_auth.contracts import CodexAuthError


async def response_events(service, body):
    if service.logging_out:
        raise CodexAuthError('logout_in_progress', '正在退出，请稍后重试。', 409)
    service.active += 1
    try:
        credentials = await service.token()
        snapshot = await service.catalog.get(credentials, force=False)
        model = next((m for m in snapshot.models if m.slug == body['model']), None)
        if not model:
            raise CodexAuthError('unknown_model', '当前账号目录中没有这个模型，请刷新模型。', 400)
        effort = body.get('reasoning_effort')
        if effort and effort not in model.supported_reasoning_levels:
            raise CodexAuthError('invalid_effort', '模型不支持该推理强度。', 400)
        messages = body['messages']
        instructions = '\n\n'.join(m['content'] for m in messages if m['role'] == 'system')
        inputs = [{'type': 'message', 'role': m['role'], 'content': [
            {'type': 'output_text' if m['role'] == 'assistant' else 'input_text', 'text': m['content']}
        ]} for m in messages if m['role'] != 'system']
        payload = {'model': model.slug, 'store': False, 'stream': True,
                   'instructions': instructions, 'input': inputs, 'text': {'verbosity': 'medium'}}
        if effort:
            payload['reasoning'] = {'effort': effort}
        headers = {'Authorization': f'Bearer {credentials.access_token}',
                   'chatgpt-account-id': credentials.account_id, 'OpenAI-Beta': 'responses=experimental',
                   'originator': 'ZhixingLedger', 'User-Agent': 'ZhixingLedger (python)',
                   'accept': 'text/event-stream', 'content-type': 'application/json'}
        total = 0
        text = ''
        async with asyncio.timeout(180):
            async with service.http.stream('POST', CODEX_RESPONSES_URL, headers=headers, json=payload, timeout=60) as response:
                if response.status_code == 401:
                    await service.recover(credentials.generation)
                    raise CodexAuthError('request_unauthorized', '登录已刷新；请重试本轮，尚未自动重发。', 401)
                if response.status_code != 200:
                    code = response.status_code
                    message = {403: '当前账号无权调用该模型。', 429: '触发限流或套餐额度限制，请稍后重试。'}.get(code, f'Codex 返回 HTTP {code}，请稍后重试。')
                    raise CodexAuthError('upstream_rejected', message, code)
                data_lines = []
                async for line in response.aiter_lines():
                    total += len(line)
                    if total > 2_000_000:
                        raise CodexAuthError('response_too_large', '输出过长，本轮未结算。', 502)
                    if line.startswith('data:'):
                        data_lines.append(line[5:].lstrip())
                        continue
                    if line or not data_lines:
                        continue
                    raw = '\n'.join(data_lines)
                    data_lines = []
                    if raw == '[DONE]':
                        continue
                    try:
                        event = json.loads(raw)
                    except ValueError:
                        raise CodexAuthError('invalid_stream', '模型返回了无效数据，本轮未结算。', 502) from None
                    kind = event.get('type')
                    if kind == 'response.output_text.delta':
                        delta = event.get('delta', '')
                        if not isinstance(delta, str):
                            raise CodexAuthError('invalid_stream', '模型文本无效。', 502)
                        text += delta
                        yield {'type': 'delta', 'text': delta}
                    elif kind == 'response.completed':
                        result = event.get('response', {})
                        if result.get('status', 'completed') != 'completed':
                            raise CodexAuthError('incomplete', '本轮生成未完成，请重试。', 502)
                        if not text:
                            text = ''.join(c.get('text', '') for item in result.get('output', []) if item.get('type') == 'message' for c in item.get('content', []) if c.get('type') == 'output_text')
                        if not text.strip():
                            raise CodexAuthError('empty_response', '模型未返回文本，请重试。', 502)
                        current = service.store.load_credentials()
                        if not current or current.account_id != credentials.account_id:
                            raise CodexAuthError('account_changed', '账号已变更，本轮结果未采用。', 409)
                        service.last_test = {'model': model.slug, 'completed_at': int(time.time())}
                        yield {'type': 'completed', 'text': text, 'usage': result.get('usage')}
                        return
                    elif kind in {'response.failed', 'response.incomplete', 'error'}:
                        raise CodexAuthError('incomplete', '模型生成失败或未完成，请重试。', 502)
        raise CodexAuthError('stream_interrupted', '连接提前结束，本轮未结算，可以重试。', 502)
    except (httpx.HTTPError, TimeoutError):
        raise CodexAuthError('transport_error', '网络中断或请求超时，本轮未结算。', 502) from None
    finally:
        service.active -= 1
