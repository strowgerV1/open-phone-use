import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from strowger_env.server import create_app

KEYS = {'alice': 'a' * 32, 'bob': 'b' * 32}
AUTH = {'Authorization': 'Bearer ' + KEYS['alice']}

class Fake:
    actions = ['observe']
    closed = 0
    async def start(self): pass
    async def act(self, action, args):
        if action != 'observe': raise ValueError()
        return {'ok': True}
    async def close(self): self.closed += 1

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(KEYS, Fake, capacity=2, audit_path=tmp_path/'audit')) as c:
        yield c

def acquire(c, **kwargs):
    return c.post('/v1/leases', headers=AUTH, json=kwargs or {'kind': 'browser'})

def headers(data): return {**AUTH, 'X-Lease-Token': data['lease_token']}

def test_auth_and_owner(client):
    assert client.post('/v1/leases', json={}).status_code == 401
    d = acquire(client).json()
    url = '/v1/leases/' + d['id']
    assert client.get(url, headers=AUTH).status_code == 404
    stolen = {**headers(d), 'Authorization': 'Bearer ' + KEYS['bob']}
    for verb, suffix, body in [('GET','',None),('DELETE','',None),('POST','/renew',{}),('POST','/actions',{'action':'observe'})]:
        assert client.request(verb, url+suffix, headers=stolen, json=body).status_code == 404
    assert client.get(url, headers=headers(d)).status_code == 200

def test_lifecycle(client):
    d = acquire(client).json(); h = headers(d); url = '/v1/leases/' + d['id']
    assert client.post(url+'/actions', headers=h, json={'action':'observe'}).json() == {'ok':True}
    assert client.post(url+'/renew', headers=h, json={'ttl':30}).status_code == 200
    assert client.delete(url, headers=h).json()['state'] == 'released'
    assert client.delete(url, headers=h).status_code == 200
    assert client.post(url+'/actions', headers=h, json={'action':'observe'}).status_code == 410
    assert client.post(url+'/renew', headers=h, json={'ttl':30}).status_code == 410

def test_expiry_reclaims_capacity(client):
    d = acquire(client, ttl=1).json()
    time.sleep(1.7)
    assert client.get('/v1/leases/'+d['id'], headers=headers(d)).json()['state'] == 'expired'
    assert acquire(client).status_code == 201
    assert acquire(client).status_code == 201
    assert acquire(client).status_code == 409

def test_capacity_atomic(client):
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda _: acquire(client).status_code, range(5)))
    assert sorted(results) == [201,201,409,409,409]

def test_validation_and_unavailable(client):
    assert acquire(client, kind='desktop').status_code == 501
    assert acquire(client, ttl=0).status_code == 422
    assert acquire(client, ttl=3601).status_code == 422
    assert acquire(client, owner='bob').status_code == 422
    d=acquire(client).json()
    assert client.post('/v1/leases/'+d['id']+'/actions', headers=headers(d), json={'action':'shell'}).status_code == 422

def test_failed_start_no_slot(tmp_path):
    class Broken(Fake):
        async def start(self): raise RuntimeError()
    with TestClient(create_app(KEYS, Broken, 1, tmp_path/'audit')) as c:
        assert acquire(c).status_code == 503
        assert acquire(c).status_code == 503

def test_failed_cleanup_quarantines(tmp_path):
    class Broken(Fake):
        async def close(self): raise RuntimeError()
    with TestClient(create_app(KEYS, Broken, 1, tmp_path/'audit')) as c:
        d=acquire(c).json()
        assert c.delete('/v1/leases/'+d['id'], headers=headers(d)).status_code == 503
        assert acquire(c).status_code == 409

def test_audit_redaction(client, tmp_path):
    d=acquire(client).json()
    client.post('/v1/leases/'+d['id']+'/actions', headers=headers(d), json={'action':'observe', 'args':{'text':'SECRET'}})
    # Fixture has its own tmp_path directory.
    logs = (tmp_path/'audit').read_text()
    for secret in [KEYS['alice'], d['lease_token'], 'SECRET']:
        assert secret not in logs

def test_keys_required(tmp_path):
    with pytest.raises(RuntimeError): create_app({}, audit_path=tmp_path/'a')
