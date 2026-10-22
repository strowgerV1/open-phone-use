from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import base64
from fastapi.testclient import TestClient
from strowger_env.server import create_app


def test_real_browser_mission_and_isolation(tmp_path):
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler,
                         directory=str(Path(__file__).parents[1]/'examples')))
    Thread(target=server.serve_forever, daemon=True).start()
    auth = {'Authorization': 'Bearer ' + 'a'*32}
    try:
        with TestClient(create_app({'agent': 'a'*32}, audit_path=tmp_path/'audit')) as c:
            a = c.post('/v1/leases', headers=auth, json={'kind':'browser'}).json()
            b = c.post('/v1/leases', headers=auth, json={'kind':'browser'}).json()
            def act(l, action, **args):
                r = c.post('/v1/leases/'+l['id']+'/actions', headers={**auth,'X-Lease-Token':l['lease_token']}, json={'action':action,'args':args})
                assert r.status_code == 200, r.text
                return r.json()
            url=f'http://127.0.0.1:{server.server_port}/fixture.html'
            act(a, 'navigate', url=url)
            act(a, 'fill', selector='#name', text='STROWGER')
            assert 'Bonjour STROWGER' in act(a, 'click', selector='button')['text']
            png=base64.b64decode(act(a, 'screenshot')['png_base64'])
            assert png.startswith(b'\x89PNG')
            assert 'Bonjour STROWGER' not in act(b, 'navigate', url=url)['text']
            assert c.delete('/v1/leases/'+a['id'], headers={**auth,'X-Lease-Token':a['lease_token']}).json()['state']=='released'
    finally:
        server.shutdown()
