"""Installed command, packaged assets and lab lock from outside the checkout."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import httpx


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def test_installed_broker_console_and_single_process_lock(tmp_path):
    env = {k:v for k,v in os.environ.items() if not k.startswith('ENV_')}
    key = 'test-command-key-' + 'x'*32
    (tmp_path/'.env').write_text("ENV_API_KEYS='" + json.dumps({'alice':key}) + "'\nENV_ANDROID_DEVICES='[]'\n")
    port = free_port()
    argv = [sys.executable, '-m', 'strowger_env.cli', 'serve', '--port', str(port)]
    with (tmp_path/'server.log').open('w') as log:
        broker = subprocess.Popen(argv, cwd=tmp_path, env=env, stdout=log, stderr=log)
        try:
            with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=2) as client:
                for _ in range(40):
                    assert broker.poll() is None, (tmp_path/'server.log').read_text()
                    try:
                        if client.get('/health').status_code == 200: break
                    except httpx.TransportError: pass
                    time.sleep(.1)
                else: raise AssertionError('Broker did not start')
                assert client.get('/').status_code == 200
                assert client.post('/console/login', json={'api_key':key}).json() == {'owner':'alice'}
                assert client.get('/console/assets/console.js').status_code == 200
                assert client.get('/v1/devices', headers={'X-Strowger-Console':'1'}).json() == {'devices':[]}
                second = subprocess.run([*argv[:-1],str(free_port())],cwd=tmp_path,env=env,capture_output=True,text=True,timeout=10)
                assert second.returncode == 2
                assert 'déjà' in second.stderr
                assert key not in second.stdout + second.stderr + (tmp_path/'server.log').read_text()
        finally:
            broker.terminate()
            try: broker.wait(timeout=10)
            except subprocess.TimeoutExpired:
                broker.kill(); broker.wait()
