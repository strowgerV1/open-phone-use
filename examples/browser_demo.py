"""Start the server first. Runs entirely against a local fixture."""
import base64
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from strowger_env.client import Runtime

fixture = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler,
                                  directory=str(Path(__file__).parent)))
Thread(target=fixture.serve_forever, daemon=True).start()
try:
    with Runtime(os.environ.get('ENV_URL', 'http://127.0.0.1:8765'), os.environ['ENV_CLIENT_KEY']) as runtime:
        with runtime.browser.acquire(ttl=60) as lease:
            print('Lease:', lease.id)
            lease.act('navigate', url=f'http://127.0.0.1:{fixture.server_port}/fixture.html')
            lease.act('fill', selector='#name', text='STROWGER')
            result = lease.act('click', selector='button')
            assert 'Bonjour STROWGER' in result['text']
            shot = lease.act('screenshot')
            Path('demo.png').write_bytes(base64.b64decode(shot['png_base64']))
            print(result['text'])
            print('Screenshot: demo.png; lease will be released automatically.')
finally:
    fixture.shutdown()
