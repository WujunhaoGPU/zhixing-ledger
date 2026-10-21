import asyncio
import json
import time
from pathlib import Path
from dataclasses import replace
import httpx
import pytest
from codex_auth.service import CodexService
from codex_auth.contracts import CodexCredentials, CodexAuthError, CatalogSnapshot, CodexModel
from codex_auth.oauth import generate_pkce
from provider import response_events
from server import create_app, PORT

ORIGIN = 'chrome-extension://'+'a'*32

def credential(expires=None, generation=0, account='account-a'):
    return CodexCredentials(1,'access-secret','refresh-secret','id-secret',account,expires or int(time.time())+3600,generation)

def model():
    return CodexModel('test-model','Test Model',0,'list','medium',('medium','high'),False,False,False)

async def ready(tmp_path, handler):
    service = CodexService(tmp_path, http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    committed = service.store.commit_credentials(credential(), 0)
    import hashlib
    snapshot = CatalogSnapshot(models=(model(),),source='live',fetched_at=int(time.time()),etag=None,
        generation=committed.generation,account_hash=hashlib.sha256(b'account-a').hexdigest(), client_version='0.153.4')
    service.store.commit_catalog_cache(snapshot)
    return service

@pytest.mark.asyncio
async def test_pairing_origin_host_and_no_secret_status(tmp_path):
    service = await ready(tmp_path, lambda request: httpx.Response(200,json={}))
    app = create_app(service, tmp_path)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url=f'http://127.0.0.1:{PORT}') as client:
        assert (await client.get('/health')).status_code == 200
        assert (await client.post('/pair',headers={'Origin':'https://evil.test'},json={'code':app.state.pairing['code']})).status_code == 403
        assert (await client.get('/codex/status',headers={'Origin':ORIGIN})).status_code == 401
        paired = await client.post('/pair',headers={'Origin':ORIGIN},json={'code':app.state.pairing['code']})
        assert paired.status_code == 200
        headers = {'Origin':ORIGIN,'Authorization':'Bearer '+paired.json()['token']}
        status = await client.get('/codex/status',headers=headers)
        assert status.status_code == 200
        assert 'access-secret' not in status.text and 'refresh-secret' not in status.text
        assert (await client.get('/codex/status',headers={**headers,'Origin':'chrome-extension://'+'b'*32})).status_code == 401
        assert (await client.get('/health',headers={'Host': 'evil.test'})).status_code == 403
        assert (await client.post('/pair',headers={'Origin':ORIGIN},json={'code':app.state.pairing['code']})).status_code == 403
    await service.close()

@pytest.mark.asyncio
async def test_stream_requires_completion_and_exact_request(tmp_path):
    def handler(request):
        body=json.loads(request.content)
        assert body['store'] is False and body['stream'] is True
        assert request.headers['chatgpt-account-id']=='account-a'
        assert body['input'][0]['content'][0]['type']=='input_text'
        events=[{'type':'response.output_text.delta','delta':'你好'}, {'type':'response.completed','response':{'status':'completed','usage':{'input_tokens':3}}}]
        return httpx.Response(200,text=''.join('data: '+json.dumps(e)+'\n\n' for e in events))
    service=await ready(tmp_path,handler)
    events=[e async for e in response_events(service,{'model':'test-model','reasoning_effort':'medium','messages':[{'role':'system','content':'coach'},{'role':'user','content':'hi'}]})]
    assert events[-1]['type']=='completed' and events[-1]['text']=='你好'
    assert service.active==0 and service.last_test['model']=='test-model'
    await service.close()

@pytest.mark.asyncio
@pytest.mark.parametrize('text', ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n', 'data: {"type":"response.incomplete"}\n\n','data: {"type":"response.failed"}\n\n'])
async def test_partial_or_failed_stream_never_completes(tmp_path,text):
    service=await ready(tmp_path,lambda req:httpx.Response(200,text=text))
    with pytest.raises(CodexAuthError):
        [e async for e in response_events(service,{'model':'test-model','messages':[{'role':'user','content':'hi'}]})]
    assert service.last_test is None and service.active==0
    await service.close()

@pytest.mark.asyncio
@pytest.mark.parametrize('code',[403,429])
async def test_denial_never_falls_back_or_replays(tmp_path,code):
    calls=[]
    def handler(req):
        calls.append(req)
        return httpx.Response(code,text='private server details')
    service=await ready(tmp_path,handler)
    with pytest.raises(CodexAuthError) as error:
        [e async for e in response_events(service,{'model':'test-model','messages':[{'role':'user','content':'hi'}]})]
    assert 'private server' not in str(error.value) and len(calls)==1
    await service.close()

@pytest.mark.asyncio
async def test_401_refreshes_without_replaying(tmp_path):
    calls=[]
    def handler(req):
        calls.append(req.url.path)
        if req.url.path=='/oauth/token':
            return httpx.Response(200,json={'access_token':'renewed','expires_in':3600})
        return httpx.Response(401)
    service=await ready(tmp_path,handler)
    with pytest.raises(CodexAuthError,match='登录已刷新'):
        [e async for e in response_events(service,{'model':'test-model','messages':[{'role':'user','content':'hi'}]})]
    assert calls.count('/backend-api/codex/responses')==1
    assert service.store.load_credentials().access_token=='renewed'
    await service.close()

@pytest.mark.asyncio
async def test_logout_cannot_be_undone_by_refresh(tmp_path):
    service=await ready(tmp_path,lambda req:httpx.Response(200))
    old=service.store.load_credentials()
    service.active=1
    with pytest.raises(CodexAuthError,match='停止'):
        await service.logout()
    service.active=0
    await service.logout()
    with pytest.raises(CodexAuthError):
        service.store.commit_credentials(old, old.generation)
    assert service.store.load_credentials() is None
    assert service.store.load_catalog_cache() is None
    await service.close()

@pytest.mark.asyncio
async def test_expiring_token_single_refresh_and_rejected_cooldown(tmp_path):
    calls=[]
    async def handler(req):
        calls.append(req)
        await asyncio.sleep(0.01)
        return httpx.Response(200,json={'access_token':'new','expires_in':3600})
    service=CodexService(tmp_path,http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    service.store.commit_credentials(credential(expires=int(time.time())+10),0)
    tokens=await asyncio.gather(service.token(),service.token())
    assert len(calls)==1 and tokens[0].generation==tokens[1].generation
    await service.close()

@pytest.mark.asyncio
async def test_manual_callback_rejects_other_login(tmp_path):
    service=CodexService(tmp_path)
    service.operation={'state':'waiting','redirect_uri':'http://localhost:1455/auth/callback','secret':'expected'}
    for url in ['http://evil.test:1455/auth/callback?state=expected&code=a','http://localhost:1455/auth/callback?state=wrong&code=a']:
        with pytest.raises(CodexAuthError): await service.complete(url)
    service.operation=None
    await service.close()

@pytest.mark.asyncio
async def test_stream_cancellation_releases_active_inference(tmp_path):
    class SlowStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"type":"response.output_text.delta","delta":"first"}\n\n'
            await asyncio.Event().wait()
    service=await ready(tmp_path,lambda req:httpx.Response(200) if req.url.path=='/oauth/revoke' else httpx.Response(200,stream=SlowStream()))
    stream=response_events(service,{'model':'test-model','messages':[{'role':'user','content':'hi'}]})
    assert (await anext(stream))['type']=='delta'
    assert service.active==1
    next_event=asyncio.create_task(anext(stream))
    await asyncio.sleep(0)
    next_event.cancel()
    with pytest.raises(asyncio.CancelledError): await next_event
    assert service.active==0
    await service.logout()
    await service.close()

@pytest.mark.asyncio
async def test_cancel_login_before_task_runs_closes_callback(tmp_path, monkeypatch):
    from codex_auth import service as service_module
    class Callback:
        port=1455
        closed=False
        async def wait(self, timeout): await asyncio.Event().wait()
        async def cancel(self): self.closed=True
    cb=Callback()
    async def start(**kwargs): return cb
    monkeypatch.setattr(service_module.LoopbackCallback,'start',start)
    service=CodexService(tmp_path)
    await service.start()
    result=await service.cancel()
    assert result['operation']['state']=='cancelled' and cb.closed
    await service.close()

@pytest.mark.asyncio
async def test_extension_host_permission_origin_header_and_web_spoof_rejection(tmp_path):
    service=await ready(tmp_path,lambda req:httpx.Response(200))
    app=create_app(service,tmp_path)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url=f'http://127.0.0.1:{PORT}') as client:
        # Chromium host-permission requests may omit Origin. Pair code + token remain required.
        headers={'X-Zhixing-Extension':ORIGIN}
        assert (await client.get('/codex/status',headers=headers)).status_code==401
        response=await client.post('/pair',headers=headers,json={'code':app.state.pairing['code']})
        token=response.json()['token']
        assert (await client.get('/codex/status',headers={**headers,'Authorization':'Bearer '+token})).status_code==200
        assert (await client.get('/codex/status',headers={**headers,'Authorization':'Bearer '+token,'Origin':'https://evil.test'})).status_code==403
    await service.close()

@pytest.mark.asyncio
async def test_login_models_restart_and_invalid_callback_are_isolated(tmp_path,monkeypatch):
    from codex_auth import service as service_module
    from codex_auth.oauth import OAuthCallbackResult
    future=asyncio.get_running_loop().create_future()
    class Callback:
        port=1455
        async def wait(self, timeout): return await future
        async def cancel(self):
            if not future.done(): future.cancel()
    async def start(**kwargs): return Callback()
    monkeypatch.setattr(service_module.LoopbackCallback,'start',start)
    def handler(req):
        if req.url.path=='/oauth/token':
            return httpx.Response(200,json={'access_token':'login-access','refresh_token':'login-refresh','id_token':'login-id','account_id':'account-a','expires_in':3600})
        if req.url.host=='registry.npmjs.org': return httpx.Response(503)
        return httpx.Response(200,json={'models':[{'slug':'test-model','display_name':'Test','visibility':'list'}]})
    service=CodexService(tmp_path,http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    service.catalog._version_http=service.http
    started=await service.start()
    assert started['operation']['state']=='waiting'
    assert 'access_token' not in json.dumps(started)
    future.set_result(OAuthCallbackResult('code',service.operation['secret'],None))
    await service.operation['task']
    assert service.status()['connection']=='connected'
    assert len(service.status()['models'])==1
    await service.close()
    restarted=CodexService(tmp_path,http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    assert restarted.status()['connection']=='connected' and len(restarted.status()['models'])==1
    assert restarted.status()['operation']=={}
    await restarted.close()

@pytest.mark.asyncio
async def test_model_fetch_failure_keeps_login_without_fake_success(tmp_path,monkeypatch):
    service=await ready(tmp_path,lambda req:httpx.Response(403))
    service.catalog._version_http=service.http
    with pytest.raises(CodexAuthError): await service.refresh_models()
    assert service.status()['connection']=='connected'
    assert service.status()['models']==[]
    assert service.status()['last_test'] is None
    await service.close()

@pytest.mark.asyncio
async def test_corrupt_catalog_does_not_hide_connection_controls(tmp_path):
    service=await ready(tmp_path,lambda req:httpx.Response(200))
    service.store.catalog_cache_path.write_text('{broken')
    status=service.status()
    assert status['connection']=='connected' and status['models']==[]
    assert status['catalog_error']=='catalog_corrupt'
    await service.logout()
    await service.close()
