"""Same-origin operator console. API keys stay in the broker's memory."""
import hmac
from pathlib import Path
import secrets
import time

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field


class Login(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str = Field(default='', max_length=256)
    api_key: str = Field(default='', max_length=4096)


def install_console(app, keys, bootstrap=None):
    sessions = {}
    bootstrap = dict(bootstrap or {})
    root = Path(__file__).parent / 'web'

    def same_origin(request):
        origin = request.headers.get('origin')
        return origin is None or origin == str(request.base_url).rstrip('/')

    @app.middleware('http')
    async def console_session(request: Request, call_next):
        protected = request.url.path.startswith('/v1/') or request.url.path in ('/console/login', '/console/session')
        sid = request.cookies.get('strowger_console')
        session = sessions.get(sid)
        if session and session['expires'] <= time.monotonic():
            sessions.pop(sid, None)
            session = None
        if protected and not same_origin(request):
            return JSONResponse({'detail': 'Same-origin requests required'}, status_code=403)
        if protected and request.url.path != '/console/login' and sid and not request.headers.get('authorization'):
            if not session:
                return JSONResponse({'detail': 'Console session expired; reconnect'}, status_code=401)
            if request.headers.get('x-strowger-console') != '1':
                return JSONResponse({'detail': 'Console request header required'}, status_code=403)
            request.scope['headers'] = list(request.scope['headers']) + [
                (b'authorization', ('Bearer ' + keys[session['owner']]).encode())]
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        if request.url.path == '/' or request.url.path.startswith('/console/assets/'):
            response.headers['Content-Security-Policy'] = (
                "default-src 'self'; script-src 'self'; style-src 'self'; "
                "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        return response

    @app.get('/', include_in_schema=False)
    async def index():
        return FileResponse(root / 'index.html')

    @app.get('/console/assets/{name}', include_in_schema=False)
    async def asset(name: str):
        if name not in ('console.js', 'console.css'):
            raise HTTPException(404)
        return FileResponse(root / name)

    @app.post('/console/login', include_in_schema=False)
    async def login(body: Login):
        who = None
        if body.code:
            expected = bootstrap.get('code', '')
            if (expected and bootstrap.get('expires', 0) > time.monotonic()
                and hmac.compare_digest(body.code.encode(), expected.encode())):
                who = bootstrap.get('owner')
                bootstrap.clear()  # One-time launch code; never the API key.
        elif body.api_key:
            who = next((owner for owner, key in keys.items()
                        if hmac.compare_digest(body.api_key.encode(), key.encode())), None)
        if who not in keys:
            raise HTTPException(401, 'Invalid or expired connection code')
        # Keep the in-memory session registry bounded across repeated logins.
        for sid, session in list(sessions.items()):
            if session['expires'] <= time.monotonic():
                sessions.pop(sid, None)
        if len(sessions) >= 64:
            raise HTTPException(429, 'Too many console sessions')
        sid = secrets.token_urlsafe(32)
        sessions[sid] = {'owner': who, 'expires': time.monotonic() + 12*3600}
        response = JSONResponse({'owner': who})
        response.set_cookie('strowger_console', sid, httponly=True, samesite='strict',
                            secure=False, max_age=12*3600, path='/')  # Loopback HTTP only.
        return response

    @app.get('/console/session', include_in_schema=False)
    async def session(request: Request):
        session = sessions.get(request.cookies.get('strowger_console'))
        if not session:
            raise HTTPException(401, 'Connect to the local console')
        return {'owner': session['owner']}

    @app.delete('/console/session', include_in_schema=False)
    async def logout(request: Request):
        sessions.pop(request.cookies.get('strowger_console'), None)
        response = JSONResponse({'ok': True})
        response.delete_cookie('strowger_console', path='/')
        return response
