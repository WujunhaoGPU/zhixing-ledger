"""Test-only upstream. Never imported by the production launcher."""
import sys
import json
import time
import hashlib
import tempfile
from pathlib import Path
import httpx
import uvicorn
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from codex_auth.service import CodexService
from codex_auth.contracts import CodexCredentials, CatalogSnapshot, CodexModel
from server import create_app, PORT

root=Path(tempfile.mkdtemp(prefix='zhixing-browser-fixture-'))

def handler(req):
    if req.method=='GET':
        if req.url.host=='registry.npmjs.org': return httpx.Response(503)
        return httpx.Response(200,json={'models':[{'slug':'fixture-coach','display_name':'测试教练（模拟上游）','visibility':'list','supported_reasoning_levels':[{'effort':'medium','description':'medium'}],'default_reasoning_level':'medium'}]})
    if req.url.path=='/oauth/revoke': return httpx.Response(200)
    body=json.loads(req.content)
    items=body['input']
    instruction=items[-1]['content'][0]['text']
    name=json.loads(body.get('instructions','{}').split('卡片参考：',1)[1])['name'] if '卡片参考：' in body.get('instructions','') else '反向思维'
    if '只回答：连接成功' in instruction:
        text='连接成功'
    elif '训练已完成两次' in instruction:
        answers=[m['content'][0]['text'] for m in items if m['role']=='user']
        payload={'schemaVersion':3,'session':{'topic':name,'kind':'recall','recallScore':2,'status':'完成两次回答','exposedIssue':'需要把失败路径转成检查项','nextReview':{'prompt':'如何把失败路径变成行动？'}},'cards':[{'name':name,'oneLine':'先找失败路径，再反推行动。','contentBlocks':[{'type':'progress','title':'本轮进步','text':'从列举失败转向行动检查项。'}],'levelEvents':[{'type':'application' if '用户明确选择真实应用复盘' in instruction else 'recall','targetLevel':'L3' if '用户明确选择真实应用复盘' in instruction else 'L2','recallScore':2,'userEvidence':answers[0]}]}]}
        text='本轮完成。\n```knowledge_ledger_update\n'+json.dumps(payload,ensure_ascii=False)+'\n```'
    elif '第一次回答' in instruction:
        text='你抓住了失败路径。关键缺口是还没有转成行动检查项。请再用自己的话说一次，加入具体检查项。'
    else:
        text=f'请用自己的话说明：{name}是什么，怎样帮助你准备面试？最低标准：说清从失败到行动的关系。'
    chunks=[{'type':'response.output_text.delta','delta':text[:20]},{'type':'response.output_text.delta','delta':text[20:]},{'type':'response.completed','response':{'status':'completed','usage':{'input_tokens':10,'output_tokens':20}}}]
    return httpx.Response(200,text=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in chunks))

service=CodexService(root,http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
credentials=service.store.commit_credentials(CodexCredentials(1,'fixture-access-secret','fixture-refresh-secret','fixture-id','fixture-account',int(time.time())+3600,0),0)
m=CodexModel('fixture-coach','测试教练（模拟上游）',0,'list','medium',('medium',),False,False,False)
service.store.commit_catalog_cache(CatalogSnapshot(models=(m,),source='live',fetched_at=int(time.time()),etag=None,generation=credentials.generation,account_hash=hashlib.sha256(b'fixture-account').hexdigest(),client_version='0.153.4'))
app=create_app(service,root)
Path(sys.argv[1]).write_text(app.state.pairing['code'])
try:
    uvicorn.run(app,host='127.0.0.1',port=PORT,access_log=False,log_level='warning')
finally:
    import shutil
    shutil.rmtree(root,ignore_errors=True)
