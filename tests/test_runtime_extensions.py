import json
import time
import asyncio

from fastapi.testclient import TestClient
from strowger_env.server import create_app
from strowger_env.adapters import Android

KEYS = {'alice':'a'*32, 'bob':'b'*32}
AUTH = {'Authorization':'Bearer '+KEYS['alice']}
DEVICE_LIST = [
    {'id':'a','serial':'SERIAL-A','owners':['alice']},
    {'id':'b','serial':'SERIAL-B','owners':['alice']},
]


def auth(data): return {**AUTH, 'X-Lease-Token':data['lease_token']}


class SimplePhone:
    actions = Android.actions
    def __init__(self, serial): self.serial=serial
    async def start(self): pass
    async def act(self, action, args): return {'ok':True}
    async def close(self): pass


def test_jobs_overlap_on_distinct_devices_and_auth_is_private(tmp_path):
    class BarrierPhone(SimplePhone):
        started=0
        both=None
        def __init__(self, serial):
            super().__init__(serial)
            if type(self).both is None: type(self).both=asyncio.Event()
        async def act(self, action, args):
            type(self).started += 1
            if type(self).started == 2: type(self).both.set()
            await asyncio.wait_for(type(self).both.wait(), 2)
            return {'png_base64':'private-result'}
    with TestClient(create_app(KEYS, audit_path=tmp_path/'audit', android_factory=BarrierPhone, devices=DEVICE_LIST)) as c:
        a=c.post('/v1/jobs',headers=AUTH,json={'device_id':'a','steps':[{'action':'observe','args':{}}]}).json()
        b=c.post('/v1/jobs',headers=AUTH,json={'device_id':'b','steps':[{'action':'observe','args':{}}]}).json()
        assert c.post('/v1/jobs',headers=AUTH,json={'steps':[{'action':'shell','args':{}}]}).status_code==422
        assert c.get('/v1/jobs/'+a['id'],headers=AUTH).status_code==404
        stolen={'Authorization':'Bearer '+KEYS['bob'],'X-Job-Token':a['job_token']}
        assert c.get('/v1/jobs/'+a['id'],headers=stolen).status_code==404
        def wait(job):
            end=time.monotonic()+4
            while time.monotonic()<end:
                status=c.get('/v1/jobs/'+job['id'],headers={**AUTH,'X-Job-Token':job['job_token']}).json()
                if status['state'] in ('succeeded','failed','cancelled'): return status
                time.sleep(.03)
            raise AssertionError('job did not finish')
        sa,sb=wait(a),wait(b)
        assert sa['state']==sb['state']=='succeeded'
        assert sa['cleanup']==sb['cleanup']=='released'
        assert 'png_base64' not in json.dumps(sa)
        assert c.post('/v1/leases',headers=AUTH,json={'kind':'phone','device_id':'a'}).status_code==201


def test_job_running_cancel_waits_for_cleanup_and_is_idempotent(tmp_path):
    entered=asyncio.Event()
    class SlowPhone(SimplePhone):
        async def act(self, action, args):
            entered.set()
            await asyncio.sleep(20)
            return {'ok':True}
    with TestClient(create_app(KEYS, audit_path=tmp_path/'audit', android_factory=SlowPhone, devices=DEVICE_LIST)) as c:
        submitted=c.post('/v1/jobs',headers=AUTH,json={'device_id':'a','steps':[{'action':'observe','args':{}}]}).json()
        token={'X-Job-Token':submitted['job_token']}
        end=time.monotonic()+3
        while time.monotonic()<end:
            state=c.get('/v1/jobs/'+submitted['id'],headers={**AUTH,**token}).json()
            if state['state']=='running': break
            time.sleep(.02)
        first=c.post('/v1/jobs/'+submitted['id']+'/cancel',headers={**AUTH,**token}).json()
        second=c.post('/v1/jobs/'+submitted['id']+'/cancel',headers={**AUTH,**token}).json()
        assert first['state'] in ('cancelling','cancelled')
        assert second['state'] in ('cancelling','cancelled')
        end=time.monotonic()+3
        while time.monotonic()<end:
            final=c.get('/v1/jobs/'+submitted['id'],headers={**AUTH,**token}).json()
            if final['state']=='cancelled': break
            time.sleep(.02)
        assert final['state']=='cancelled'
        assert final['cleanup']=='released'


def test_cancel_while_startup_is_pending_releases_reservation(tmp_path):
    class SlowStart(SimplePhone):
        entered=None
        block=True
        def __init__(self, serial):
            super().__init__(serial)
            if type(self).entered is None: type(self).entered=asyncio.Event()
        async def start(self):
            if type(self).block:
                type(self).entered.set()
                try: await asyncio.Event().wait()
                except asyncio.CancelledError:
                    type(self).block=False
                    raise
    SlowStart.entered=None; SlowStart.block=True
    with TestClient(create_app(KEYS,audit_path=tmp_path/'audit',android_factory=SlowStart,devices=DEVICE_LIST)) as c:
        submitted=c.post('/v1/jobs',headers=AUTH,json={'device_id':'a','steps':[{'action':'observe','args':{}}]}).json()
        time.sleep(.05)
        result=c.post('/v1/jobs/'+submitted['id']+'/cancel',headers={**AUTH,'X-Job-Token':submitted['job_token']})
        assert result.status_code==200
        end=time.monotonic()+3
        while time.monotonic()<end:
            status=c.get('/v1/jobs/'+submitted['id'],headers={**AUTH,'X-Job-Token':submitted['job_token']}).json()
            if status['state']=='cancelled': break
            time.sleep(.02)
        assert status['state']=='cancelled' and status['cleanup']=='released'
        lease=c.post('/v1/leases',headers=AUTH,json={'kind':'phone','device_id':'a'})
        assert lease.status_code==201


def test_cancel_during_uncertain_uia_startup_reports_quarantined_cleanup(tmp_path, monkeypatch):
    import threading
    import strowger_env.uiautomator as uia
    entered=threading.Event()
    class UncertainStartup:
        actions=Android.actions
        def __init__(self, serial, **kwargs): self.serial=serial; self.uncertain=False
        async def start(self):
            self.uncertain=True
            entered.set()
            await asyncio.Event().wait()
        async def close(self): raise RuntimeError('worker could not be reaped')
    monkeypatch.setattr(uia, 'AndroidUIAutomator', UncertainStartup)
    monkeypatch.setenv('ENV_QUARANTINE_PATH', str(tmp_path/'uncertain.json'))
    devices=[{'id':'u2','serial':'SERIAL-U2','owners':['alice'],'automation':'uiautomator2'}]
    with TestClient(create_app(KEYS,audit_path=tmp_path/'audit',devices=devices)) as c:
        submitted=c.post('/v1/jobs',headers=AUTH,json={'device_id':'u2','steps':[{'action':'observe','args':{}}]}).json()
        assert entered.wait(3), 'UIAutomator startup did not begin'
        token={'Authorization':AUTH['Authorization'],'X-Job-Token':submitted['job_token']}
        c.post('/v1/jobs/'+submitted['id']+'/cancel',headers=token)
        end=time.monotonic()+3
        while time.monotonic()<end:
            status=c.get('/v1/jobs/'+submitted['id'],headers=token).json()
            if status['state']=='cancelled': break
            time.sleep(.02)
        assert status['state']=='cancelled'
        assert status['cleanup']=='quarantined'
        assert c.get('/v1/devices',headers=AUTH).json()['devices'][0]['state']=='quarantined'
        assert json.loads((tmp_path/'uncertain.json').read_text())=={'u2':'SERIAL-U2'}


def test_uncertain_mutation_quarantine_survives_broker_restart(tmp_path, monkeypatch):
    from strowger_env.uiautomator import UncertainActionError
    class UncertainPhone(SimplePhone):
        actions=['tap']
        async def act(self, action, args):
            self.uncertain=True
            raise UncertainActionError('hidden from client')
    registry=tmp_path/'quarantine.json'
    monkeypatch.setenv('ENV_QUARANTINE_PATH', str(registry))
    with TestClient(create_app(KEYS,audit_path=tmp_path/'audit',android_factory=UncertainPhone,
                               devices=DEVICE_LIST)) as c:
        lease=c.post('/v1/leases',headers=AUTH,json={'kind':'phone','device_id':'a'}).json()
        response=c.post('/v1/leases/'+lease['id']+'/actions',headers=auth(lease),json={'action':'tap','args':{'x':1,'y':2}})
        assert response.status_code==502 and 'hidden from client' not in response.text
        assert c.get('/v1/leases/'+lease['id'],headers=auth(lease)).json()['state']=='quarantined_uncertain'
        assert json.loads(registry.read_text()) == {'a':'SERIAL-A'}
    with TestClient(create_app(KEYS,audit_path=tmp_path/'audit2',android_factory=SimplePhone,devices=DEVICE_LIST)) as c:
        assert c.post('/v1/leases',headers=AUTH,json={'kind':'phone','device_id':'a'}).status_code==409
        assert c.get('/v1/devices',headers=AUTH).json()['devices'][0]['state']=='quarantined'


def test_viewer_cleanup_failure_still_closes_adapter_and_keeps_viewer_for_retry(tmp_path):
    class CountedPhone(SimplePhone):
        def __init__(self, serial):
            super().__init__(serial); self.close_calls=0
        async def close(self): self.close_calls += 1
    class FlakyViewer:
        running=True
        def __init__(self): self.close_calls=0
        async def close(self):
            self.close_calls += 1
            if self.close_calls == 1: raise RuntimeError('viewer could not be reaped')
    app=create_app(KEYS,audit_path=tmp_path/'audit',android_factory=CountedPhone,devices=DEVICE_LIST)
    with TestClient(app) as c:
        lease=c.post('/v1/leases',headers=AUTH,json={'kind':'phone','device_id':'a'}).json()
        resource=app.state.leases[lease['id']]
        viewer=FlakyViewer(); resource.viewer=viewer
        response=c.delete('/v1/leases/'+lease['id'],headers=auth(lease))
        assert response.status_code==503
        assert resource.adapter.close_calls == 1
        assert resource.viewer is viewer and resource.state=='cleanup_failed'
        response=c.delete('/v1/leases/'+lease['id'],headers=auth(lease))
        assert response.status_code==200
        assert viewer.close_calls == 2 and resource.adapter.close_calls == 2
