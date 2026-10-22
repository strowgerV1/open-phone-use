import time
from fastapi.testclient import TestClient
from strowger_env.server import create_app
KEYS={'alice':'a'*32,'bob':'b'*32}
CONSOLE={'X-Strowger-Console':'1'}
class Browser:
    actions=['observe','screenshot']
    async def start(self): pass
    async def act(self,action,args): return {'ok':True}
    async def close(self): pass

def make(tmp_path,**kwargs):
    return TestClient(create_app(KEYS,browser_factory=Browser,devices=[],audit_path=tmp_path/'audit',**kwargs))

def test_console_assets_packaged_and_key_not_embedded(tmp_path):
    with make(tmp_path) as c:
        for path in ['/','/console/assets/console.js','/console/assets/console.css','/demo']:
            r=c.get(path)
            assert r.status_code==200
            assert KEYS['alice'] not in r.text
            assert r.headers['cache-control']=='no-store'
        assert "frame-ancestors 'none'" in c.get('/').headers['content-security-policy']
        assert c.get('/console/assets/unknown').status_code==404
        assert '&lt;script&gt;' in c.get('/demo/greet',params={'name':'<script>'}).text

def test_one_time_console_login_cookie_is_private_and_scoped(tmp_path):
    code='launch-once'
    with make(tmp_path,console_bootstrap={'code':code,'owner':'alice','expires':time.monotonic()+60}) as c:
        assert c.get('/console/session',headers=CONSOLE).status_code==401
        r=c.post('/console/login',json={'code':code})
        assert r.json()=={'owner':'alice'}
        assert 'httponly' in r.headers['set-cookie'].lower()
        assert 'samesite=strict' in r.headers['set-cookie'].lower()
        assert KEYS['alice'] not in r.text
        assert c.post('/console/login',json={'code':code}).status_code==401
        assert c.get('/console/session',headers=CONSOLE).json()=={'owner':'alice'}
        # Regression: normal asset requests include the cookie but no custom header.
        for asset in ['/','/console/assets/console.js','/console/assets/console.css']:
            assert c.get(asset).status_code==200
        assert c.get('/v1/capabilities').status_code==403
        assert c.get('/v1/capabilities',headers=CONSOLE).status_code==200
        d=c.post('/v1/leases',headers=CONSOLE,json={'kind':'browser'}).json()
        headers={**CONSOLE,'X-Lease-Token':d['lease_token']}
        assert c.get('/v1/leases/'+d['id'],headers=CONSOLE).status_code==404
        assert c.get('/v1/leases/'+d['id'],headers={**headers,'Authorization':'Bearer '+KEYS['bob']}).status_code==404
        assert c.delete('/v1/leases/'+d['id'],headers=headers).json()['state']=='released'
        assert c.delete('/console/session',headers=CONSOLE).status_code==200
        assert c.get('/v1/capabilities',headers=CONSOLE).status_code==401

def test_console_origin_checks_and_relogin_after_stale_cookie(tmp_path):
    with make(tmp_path) as c:
        assert c.post('/console/login',headers={'Origin':'https://other.example'},json={'api_key':KEYS['alice']}).status_code==403
        assert c.post('/console/login',json={'api_key':'wrong'}).status_code==401
        c.cookies.set('strowger_console','stale')
        assert c.post('/console/login',headers={'Origin':'http://testserver'},json={'api_key':KEYS['alice']}).status_code==200
        assert c.get('/v1/capabilities',headers={**CONSOLE,'Origin':'https://other.example'}).status_code==403
        assert c.get('/v1/capabilities',headers={**CONSOLE,'Origin':'http://testserver'}).status_code==200
        assert c.get('/v1/capabilities',headers={'Authorization':'Bearer '+KEYS['bob']}).status_code==200

def test_expired_launch_code_refused(tmp_path):
    with make(tmp_path,console_bootstrap={'code':'expired','owner':'alice','expires':time.monotonic()-1}) as c:
        assert c.post('/console/login',json={'code':'expired'}).status_code==401
