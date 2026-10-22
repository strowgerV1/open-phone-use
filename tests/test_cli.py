import base64
import json
import os
from pathlib import Path
from types import SimpleNamespace
import pytest
from strowger_env import cli
from strowger_env.config import load_env


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(os, 'environ', {k:v for k,v in os.environ.items() if not k.startswith('ENV_')})


def test_init_private_repeatable_and_no_tokens_in_output(capsys):
    assert cli.main(['init','--capacity','6']) == 0
    before = Path('.env').read_bytes()
    assert cli.main(['init','--capacity','6']) == 0
    assert Path('.env').read_bytes() == before
    assert os.environ['ENV_CAPACITY'] == '6'
    assert json.loads(Path('data/fleet.json').read_text()) == []
    for value in json.loads(os.environ['ENV_API_KEYS']).values():
        assert value not in capsys.readouterr().out
    assert Path('.env').stat().st_mode & 0o777 == 0o600
    assert Path('data/fleet.json').stat().st_mode & 0o777 == 0o600


def test_env_is_data_not_shell_and_respects_existing(tmp_path):
    os.environ['ENV_CAPACITY']='6'
    Path('.env').write_text("ENV_CAPACITY='4'\nENV_COMMENT='$(touch SHOULD_NOT_EXIST)'\n")
    load_env()
    assert os.environ['ENV_CAPACITY']=='6'
    assert not Path('SHOULD_NOT_EXIST').exists()
    assert os.environ['ENV_COMMENT']=='$(touch SHOULD_NOT_EXIST)'


def test_adb_discovery_parsing_and_missing(monkeypatch):
    monkeypatch.setattr(cli.shutil,'which',lambda _:None)
    with pytest.raises(RuntimeError):cli.adb_devices()
    monkeypatch.setattr(cli.shutil,'which',lambda _:'/test/adb')
    calls=[]
    def run(argv,**kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0,stdout='List of devices attached\nA device product:lab model:Pixel_7\nB unauthorized\nC offline\n\n')
    monkeypatch.setattr(cli.subprocess,'run',run)
    assert cli.adb_devices()==[{'serial':'A','state':'device','model':'Pixel_7'},
                              {'serial':'B','state':'unauthorized','model':None},
                              {'serial':'C','state':'offline','model':None}]
    assert calls==[['/test/adb','devices','-l']]


def test_enrollment_authorized_only_stable_ids_and_acls(monkeypatch):
    cli.main(['init','--capacity','6'])
    connected=[{'serial':'B','state':'unauthorized','model':None},
               {'serial':'A','state':'device','model':'lab'}]
    monkeypatch.setattr(cli,'adb_devices',lambda:connected)
    assert cli.main(['enroll','--owner','alice'])==0
    first=json.loads(Path('data/fleet.json').read_text())
    assert first==[{'id':'phone-01','serial':'A','owners':['alice']}]
    assert cli.main(['enroll','--owner','unknown'])==2
    assert cli.main(['enroll','--serial','B'])==2
    connected.append({'serial':'C','state':'device','model':'lab'})
    assert cli.main(['enroll'])==0
    after=json.loads(Path('data/fleet.json').read_text())
    assert after[0]==first[0]
    assert after[1]['id']=='phone-02'


def test_enrollment_does_not_replace_inline_config(monkeypatch):
    cli.main(['init'])
    os.environ['ENV_ANDROID_DEVICES']='[]'
    assert cli.main(['enroll'])==2


def fake_runtime(monkeypatch, fail_at=None, cleanup_fail=False):
    from strowger_env import client
    events=[]
    class Lease:
        def __init__(self,i):self.i=i
        def act(self,action,**args):
            events.append((self.i,action))
            if self.i==fail_at:raise RuntimeError('Simulated hardware failure')
            return {'png_base64':base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()}
        def release(self):
            events.append((self.i,'release'))
            if cleanup_fail:raise RuntimeError('offline')
            return {'state':'released'}
    class Runtime:
        def __init__(self,*args):self.phone=self
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def devices(self):return [{'id':f'phone-{i:02}','state':'available'} for i in range(1,7)]
        def acquire(self,device_id,ttl):
            events.append((device_id,'acquire'));return Lease(device_id)
    monkeypatch.setattr(client,'Runtime',Runtime)
    return events


def test_smoke_holds_six_and_releases_everyone(monkeypatch,capsys):
    cli.main(['init'])
    events=fake_runtime(monkeypatch)
    assert cli.main(['smoke','--limit','6'])==0
    assert [e[1] for e in events[:6]]==['acquire']*6
    assert len([e for e in events if e[1]=='release'])==6
    reports=list(Path('data/runs').glob('*/report.json'))
    report=json.loads(reports[0].read_text())
    assert report['status']=='passed'
    assert len(report['device_tests'])==6
    assert all(item['state']=='released' for item in report['cleanup'])
    output=capsys.readouterr().out+reports[0].read_text()
    assert all(k not in output for k in json.loads(os.environ['ENV_API_KEYS']).values())


def test_smoke_failure_and_cleanup_failures_are_reported(monkeypatch):
    cli.main(['init'])
    events=fake_runtime(monkeypatch,fail_at='phone-02',cleanup_fail=True)
    assert cli.main(['smoke','--limit','6'])==2
    assert len([e for e in events if e[1]=='release'])==6
    report=json.loads(next(Path('data/runs').glob('*/report.json')).read_text())
    assert report['status']=='failed'
    assert all(x['state']=='failed_or_quarantined' for x in report['cleanup'])


def test_smoke_without_devices_cannot_claim_success(monkeypatch):
    cli.main(['init'])
    from strowger_env import client
    class Empty:
        def __init__(self,*args):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def devices(self):return []
    monkeypatch.setattr(client,'Runtime',Empty)
    assert cli.main(['smoke'])==2
    report=json.loads(next(Path('data/runs').glob('*/report.json')).read_text())
    assert report['device_tests']==[]
    assert report['status']=='failed'


def test_desktop_preparation_preserves_keys_and_replaces_disabled_config(monkeypatch):
    cli.main(['init'])
    before = json.loads(os.environ['ENV_API_KEYS'])
    with Path('.env').open('a') as f: f.write("ENV_DESKTOP_ENABLED='0'\n")
    Path('docker/desktop').mkdir(parents=True)
    Path('docker/desktop/Dockerfile').write_text('FROM debian:bookworm-slim')
    monkeypatch.setattr(cli.shutil, 'which', lambda _: '/test/docker')
    monkeypatch.setattr(cli.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0))
    assert cli.main(['desktop']) == 0
    os.environ.pop('ENV_DESKTOP_ENABLED', None)
    load_env()
    assert os.environ['ENV_DESKTOP_ENABLED'] == '1'
    assert json.loads(os.environ['ENV_API_KEYS']) == before
    assert Path('.env').stat().st_mode & 0o777 == 0o600
