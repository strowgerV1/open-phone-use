import base64
import os
import pytest
from fastapi.testclient import TestClient
from strowger_env.server import create_app

@pytest.mark.skipif(os.environ.get('ENV_DESKTOP_TEST') != '1', reason='Build desktop image and set ENV_DESKTOP_TEST=1')
def test_real_desktop(tmp_path, monkeypatch):
    monkeypatch.setenv('ENV_DESKTOP_ENABLED','1')
    h={'Authorization':'Bearer '+'a'*32}
    with TestClient(create_app({'agent':'a'*32}, audit_path=tmp_path/'audit')) as c:
        r=c.post('/v1/leases',headers=h,json={'kind':'desktop','ttl':60})
        assert r.status_code==201, r.text
        l=r.json(); h['X-Lease-Token']=l['lease_token']; url='/v1/leases/'+l['id']
        r=c.post(url+'/actions',headers=h,json={'action':'screenshot'})
        assert r.status_code==200, r.text
        assert base64.b64decode(r.json()['png_base64']).startswith(b'\x89PNG')
        assert c.post(url+'/actions',headers=h,json={'action':'type','args':{'text':'hello'}}).status_code==200
        assert c.delete(url,headers=h).json()['state']=='released'
