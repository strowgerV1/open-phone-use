from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from strowger_env.server import create_app
from strowger_env.adapters import Android

KEYS = {'alice': 'a'*32, 'bob': 'b'*32}
A = {'Authorization': 'Bearer '+KEYS['alice']}
B = {'Authorization': 'Bearer '+KEYS['bob']}
DEVICES = [{'id':'phone-01','serial':'USB001','owners':['alice']},
           {'id':'phone-02','serial':'USB002','owners':['alice']},
           {'id':'private','serial':'USB003','owners':['bob']}]

class Phone:
    actions = Android.actions
    online = {'USB001':True,'USB002':True,'USB003':True}
    def __init__(self, serial): self.serial = serial
    async def start(self):
        if not self.online[self.serial]: raise RuntimeError('offline')
    async def act(self, action, args):
        await self.start()
        if action not in self.actions: raise ValueError()
        return {'ok':True}
    async def close(self): await self.start()

@pytest.fixture
def client(tmp_path):
    Phone.online = dict.fromkeys(Phone.online, True)
    with TestClient(create_app(KEYS, audit_path=tmp_path/'a', android_factory=Phone, devices=DEVICES)) as c:
        yield c

def acquire(c, device=None):
    return c.post('/v1/leases', headers=A, json={'kind':'phone', **({'device_id':device} if device else {})})

def test_two_devices_and_atomic_exclusivity(client):
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: acquire(client), range(4)))
    assert sorted(r.status_code for r in responses) == [201,201,409,409]
    assert {r.json()['device_id'] for r in responses if r.status_code == 201} == {'phone-01','phone-02'}

def test_selected_device_and_listing_privacy(client):
    assert client.get('/v1/devices').status_code == 401
    assert [d['id'] for d in client.get('/v1/devices', headers=A).json()['devices']] == ['phone-01','phone-02']
    assert acquire(client,'private').status_code == 404
    assert acquire(client,'UNREGISTERED_SERIAL').status_code == 404
    d=acquire(client,'phone-02').json()
    assert d['device_id'] == 'phone-02'
    assert acquire(client,'phone-02').status_code == 409
    listing=client.get('/v1/devices',headers=B).text
    for forbidden in ['USB00','phone-02',d['id'],d['lease_token'],'alice']:
        assert forbidden not in listing

def test_disconnect_quarantines_and_recovers(client):
    d=acquire(client,'phone-01').json()
    headers={**A,'X-Lease-Token':d['lease_token']}
    url='/v1/leases/'+d['id']
    Phone.online['USB001']=False
    assert client.post(url+'/actions',headers=headers,json={'action':'observe'}).status_code == 502
    assert client.get(url,headers=headers).json()['state'] == 'cleanup_failed'
    assert acquire(client,'phone-01').status_code == 409
    assert client.delete(url,headers=headers).status_code == 503
    Phone.online['USB001']=True
    assert client.delete(url,headers=headers).json()['state'] == 'released'
    assert acquire(client,'phone-01').status_code == 201

def test_offline_fallback_and_refusal(client):
    Phone.online['USB001']=False
    assert acquire(client,'phone-01').status_code == 503
    assert acquire(client).json()['device_id'] == 'phone-02'
    assert client.post('/v1/leases',headers=A,json={'kind':'browser','device_id':'phone-01'}).status_code == 422

@pytest.mark.parametrize('devices', [DEVICES+[DEVICES[0]], [{'id':'x','serial':'-bad','owners':['alice']}], [{'id':'x','serial':'ok','owners':[]}], [{'id':'x','serial':'ok','owners':['unknown']}], {}])
def test_invalid_inventory(tmp_path,devices):
    with pytest.raises(RuntimeError):
        create_app(KEYS,audit_path=tmp_path/'a',devices=devices)

def test_legacy_serial(tmp_path,monkeypatch):
    Phone.online['USB001']=True
    monkeypatch.setenv('ENV_ANDROID_SERIAL','USB001')
    monkeypatch.delenv('ENV_ANDROID_DEVICES',raising=False)
    with TestClient(create_app(KEYS,audit_path=tmp_path/'a',android_factory=Phone)) as c:
        assert acquire(c).json()['device_id'] == 'android-01'

def test_android_commands_are_scoped_and_restricted():
    import asyncio
    calls=[]
    class Recording(Android):
        async def command(self,*args):
            calls.append((self.serial,args))
            return b'device' if args == ('get-state',) else b'png'
    async def check():
        phone=Recording('USB001')
        await phone.start()
        await phone.act('tap',{'x':10,'y':20})
        await phone.close()
        for action,args in [('shell',{}),('key',{'key':'POWER'}),('tap',{'x':'1;rm','y':0})]:
            with pytest.raises(ValueError): await phone.act(action,args)
    asyncio.run(check())
    assert all(serial=='USB001' for serial,_ in calls)
    assert calls[-1][1] == ('shell','input','keyevent','KEYCODE_HOME')


def test_shared_device_hides_other_tenant_lease(tmp_path):
    Phone.online['USB001']=True
    devices=[{'id':'shared','serial':'USB001','owners':['alice','bob']}]
    with TestClient(create_app(KEYS,audit_path=tmp_path/'a',android_factory=Phone,devices=devices)) as c:
        d=acquire(c,'shared').json()
        assert c.get('/v1/devices',headers=B).json() == {'devices':[{'id':'shared','kind':'phone','state':'unavailable'}]}
        assert c.post('/v1/leases',headers=B,json={'kind':'phone','device_id':'shared'}).status_code == 409
        stolen={**B,'X-Lease-Token':d['lease_token']}
        assert c.get('/v1/leases/'+d['id'],headers=stolen).status_code == 404


def test_six_phone_fleet_atomic_leases_and_reacquisition(tmp_path, monkeypatch):
    monkeypatch.setenv('ENV_CAPACITY', '6')
    devices = [{'id': f'phone-{i:02}', 'serial': f'FLEET{i:02}', 'owners': ['alice']}
               for i in range(1, 7)]

    class SixPhones(Phone):
        online = {d['serial']: True for d in devices}

    with TestClient(create_app(KEYS, audit_path=tmp_path/'a', android_factory=SixPhones,
                               devices=devices)) as c:
        with ThreadPoolExecutor(max_workers=7) as pool:
            responses = list(pool.map(lambda _: acquire(c), range(7)))
        assert sorted(r.status_code for r in responses) == [201]*6 + [409]
        leases = [r.json() for r in responses if r.status_code == 201]
        assert {d['device_id'] for d in leases} == {d['id'] for d in devices}
        assert c.get('/v1/devices', headers=B).json() == {'devices': []}
        target = leases[2]
        url = '/v1/leases/' + target['id']
        assert c.delete(url, headers={**B, 'X-Lease-Token': target['lease_token']}).status_code == 404
        assert c.post('/v1/leases', headers=B,
                      json={'kind': 'phone', 'device_id': target['device_id']}).status_code in (404, 409)
        assert c.delete(url, headers={**A, 'X-Lease-Token': target['lease_token']}).json()['state'] == 'released'
        assert c.post('/v1/leases', headers=B, json={'kind':'phone', 'device_id':target['device_id']}).status_code == 404
        replacement = acquire(c, target['device_id'])
        assert replacement.status_code == 201
        assert replacement.json()['device_id'] == target['device_id']
        assert replacement.json()['id'] != target['id']
        assert acquire(c).status_code == 409


def test_inventory_file_and_json_priority(tmp_path, monkeypatch):
    import json
    inventory = tmp_path/'devices.json'
    inventory.write_text(json.dumps(DEVICES))
    monkeypatch.setenv('ENV_ANDROID_DEVICES_FILE', str(inventory))
    monkeypatch.delenv('ENV_ANDROID_DEVICES', raising=False)
    monkeypatch.delenv('ENV_ANDROID_SERIAL', raising=False)
    Phone.online['USB001'] = True
    with TestClient(create_app(KEYS, audit_path=tmp_path/'a', android_factory=Phone)) as c:
        assert acquire(c, 'phone-01').status_code == 201
    monkeypatch.setenv('ENV_ANDROID_DEVICES', '[]')
    with TestClient(create_app(KEYS, audit_path=tmp_path/'b', android_factory=Phone)) as c:
        assert c.get('/v1/devices', headers=A).json() == {'devices': []}
        assert acquire(c).status_code == 501


def test_empty_inventory_file_is_valid_not_ready(tmp_path, monkeypatch):
    inventory = tmp_path/'devices.json'
    inventory.write_text('[]')
    monkeypatch.setenv('ENV_ANDROID_DEVICES_FILE', str(inventory))
    monkeypatch.delenv('ENV_ANDROID_DEVICES', raising=False)
    monkeypatch.delenv('ENV_ANDROID_SERIAL', raising=False)
    with TestClient(create_app(KEYS, audit_path=tmp_path/'a', android_factory=Phone)) as c:
        assert c.get('/v1/capabilities', headers=A).json()['phone']['enabled'] is False
        assert c.get('/v1/devices', headers=A).json() == {'devices': []}
        assert acquire(c).status_code == 501


@pytest.mark.parametrize('contents', [None, '{broken', '{}', '[{"id":"bad"}]'])
def test_inventory_file_errors(tmp_path, monkeypatch, contents):
    inventory = tmp_path/'devices.json'
    if contents is not None:
        inventory.write_text(contents)
    monkeypatch.setenv('ENV_ANDROID_DEVICES_FILE', str(inventory))
    monkeypatch.delenv('ENV_ANDROID_DEVICES', raising=False)
    monkeypatch.delenv('ENV_ANDROID_SERIAL', raising=False)
    with pytest.raises(RuntimeError):
        create_app(KEYS, audit_path=tmp_path/'a')


@pytest.mark.parametrize('value', ['0', '-1', '65', 'abc', '1.5', ''])
def test_invalid_environment_capacity(tmp_path, monkeypatch, value):
    monkeypatch.setenv('ENV_CAPACITY', value)
    with pytest.raises(RuntimeError):
        create_app(KEYS, audit_path=tmp_path/'a', devices=[])


def test_explicit_empty_inventory_overrides_legacy_serial(tmp_path, monkeypatch):
    monkeypatch.setenv('ENV_ANDROID_SERIAL', 'USB001')
    monkeypatch.setenv('ENV_ANDROID_DEVICES', '[]')
    with TestClient(create_app(KEYS, audit_path=tmp_path/'a', android_factory=Phone)) as c:
        assert c.get('/v1/devices', headers=A).json() == {'devices': []}
    monkeypatch.delenv('ENV_ANDROID_DEVICES')
    inventory = tmp_path/'empty.json'
    inventory.write_text('[]')
    monkeypatch.setenv('ENV_ANDROID_DEVICES_FILE', str(inventory))
    with TestClient(create_app(KEYS, audit_path=tmp_path/'b', android_factory=Phone)) as c:
        assert c.get('/v1/devices', headers=A).json() == {'devices': []}
    with TestClient(create_app(KEYS, audit_path=tmp_path/'c', android_factory=Phone, devices=[])) as c:
        assert c.get('/v1/devices', headers=A).json() == {'devices': []}


def test_android_swipe_text_and_package_shell_boundary():
    import asyncio
    import shlex
    calls=[]
    class Recording(Android):
        async def command(self,*args):
            calls.append(args)
            return b''
    async def check():
        phone=Recording('USB001')
        await phone.act('swipe',{'x1':100,'y1':800,'x2':100,'y2':200,'duration_ms':350})
        payload="hello; $(touch /tmp/not-created) `id` ' &"
        await phone.act('type',{'text':payload})
        await phone.act('open_app',{'package':'com.android.settings'})
        for action,args in [('swipe',{'x1':True,'y1':1,'x2':1,'y2':2}),
                            ('swipe',{'x1':1,'y1':1,'x2':1,'y2':2,'duration_ms':5000}),
                            ('type',{'text':'é'}),('type',{'text':'%s'}),
                            ('open_app',{'package':'com.android;reboot'})]:
            with pytest.raises(ValueError):await phone.act(action,args)
        return payload
    payload=asyncio.run(check())
    assert calls[0]==('shell','input','swipe','100','800','100','200','350')
    assert shlex.split(' '.join(calls[1][1:]))==['input','text',payload.replace(' ','%s')]
    assert calls[2]==('shell','monkey','-p','com.android.settings','-c','android.intent.category.LAUNCHER','1')
