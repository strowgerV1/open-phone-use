import asyncio
import hmac
import json
import os
import secrets
import tempfile
import time
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .adapters import Browser, Android, Desktop
from .config import load_inventory, read_capacity
from .fleet import normalize_inventory


class Acquire(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['browser', 'desktop', 'phone'] = 'browser'
    ttl: int = Field(default=300, ge=1, le=3600)
    device_id: str | None = Field(default=None, max_length=64)


class Renew(BaseModel):
    ttl: int = Field(default=300, ge=1, le=3600)


class Action(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: str = Field(max_length=64)
    args: dict = Field(default_factory=dict)


class JobSubmission(BaseModel):
    model_config = ConfigDict(extra='forbid')
    device_id: str | None = Field(default=None, max_length=64)
    ttl: int = Field(default=300, ge=1, le=3600)
    name: str | None = Field(default=None, max_length=80)
    steps: list[Action] = Field(min_length=1, max_length=100)


class AcquisitionError(HTTPException):
    def __init__(self, status_code, detail, *, cleanup_state='released'):
        super().__init__(status_code, detail)
        self.cleanup_state = cleanup_state


class AcquisitionCancelled(asyncio.CancelledError):
    def __init__(self, cleanup_state='released'):
        super().__init__()
        self.cleanup_state = cleanup_state


@dataclass
class Lease:
    id: str
    owner: str
    token: str
    kind: str
    adapter: object
    expires: float
    deadline: float
    device_id: str | None = None
    state: str = 'active'
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    viewer: object | None = None

    def public(self):
        result = {'id': self.id, 'kind': self.kind, 'state': self.state,
                  'expires_at': self.expires, 'actions': self.adapter.actions, 'device_id': self.device_id}
        if self.viewer is not None:
            result['viewer'] = 'running' if getattr(self.viewer, 'running', getattr(self.viewer, 'process_running', False)) else 'stopped'
        return result


def create_app(keys=None, browser_factory=Browser, capacity=None, audit_path=None, android_factory=Android, devices=None, console_bootstrap=None):
    keys = keys if keys is not None else json.loads(os.environ.get('ENV_API_KEYS', '{}'))
    if not keys or not all(isinstance(k, str) and isinstance(v, str) and len(v) >= 24 for k, v in keys.items()):
        raise RuntimeError('ENV_API_KEYS must map owners to distinct API keys of at least 24 characters')
    if len(set(keys.values())) != len(keys):
        raise RuntimeError('API keys must be distinct')
    capacity = read_capacity(capacity)
    leases, pending = {}, {}
    allocation = asyncio.Lock()
    audit = Path(audit_path or os.environ.get('ENV_AUDIT_PATH', 'data/audit.jsonl'))
    audit.parent.mkdir(parents=True, exist_ok=True)
    quarantine_path = Path(os.environ.get('ENV_QUARANTINE_PATH', str(audit.with_name('uncertain-devices.json'))))
    try:
        uncertain = json.loads(quarantine_path.read_text()) if quarantine_path.exists() else {}
        if not isinstance(uncertain, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in uncertain.items()):
            raise ValueError()
    except (OSError, ValueError, TypeError):
        raise RuntimeError('Invalid uncertain device quarantine registry') from None
    try:
        inventory = {d['id']: d for d in normalize_inventory(devices if devices is not None else load_inventory(keys), keys)}
    except RuntimeError:
        raise
    scrcpy_enabled = os.environ.get('ENV_SCRCPY_ENABLED') == '1'
    desktop_enabled = os.environ.get('ENV_DESKTOP_ENABLED') == '1'

    def save_uncertain():
        quarantine_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix='.uncertain-', dir=quarantine_path.parent)
        try:
            with os.fdopen(fd, 'w') as f:
                json.dump(uncertain, f, sort_keys=True); f.write('\n'); f.flush(); os.fsync(f.fileno())
            os.chmod(tmp, 0o600); os.replace(tmp, quarantine_path)
        finally:
            Path(tmp).unlink(missing_ok=True)

    def event(l, operation, outcome='ok'):
        with audit.open('a') as f:
            f.write(json.dumps({'time': time.time(), 'lease': l.id, 'owner': l.owner,
                               'kind': l.kind, 'operation': operation, 'outcome': outcome}) + '\n')

    async def finish_cleanup(task):
        """Wait until shielded teardown is finished, even after repeated cancellation."""
        while not task.done():
            try: await asyncio.shield(task)
            except asyncio.CancelledError: continue
            except BaseException: break
        try: task.result()
        except BaseException: return False
        return True

    def quarantined(l):
        if l.kind == 'phone' and l.device_id:
            uncertain[l.device_id] = inventory[l.device_id]['serial']
            save_uncertain()
        l.state = 'quarantined_uncertain'
        event(l, 'uncertain_action', 'quarantined')

    async def close(l, state):
        if l.state in ('released', 'expired'):
            return
        l.state = 'closing'
        was_uncertain = bool(getattr(l.adapter, 'uncertain', False)) or l.device_id in uncertain
        failure = None
        cancelled = False
        if l.viewer is not None:
            try:
                await asyncio.wait_for(l.viewer.close(), timeout=15)
                l.viewer = None
            except BaseException as exc:
                failure = exc
                cancelled = isinstance(exc, asyncio.CancelledError)
        try:
            await asyncio.wait_for(l.adapter.close(), timeout=15)
        except BaseException as exc:
            failure = failure or exc
            cancelled = cancelled or isinstance(exc, asyncio.CancelledError)
        if failure is not None:
            if getattr(l.adapter, 'uncertain', False):
                quarantined(l)
            else:
                l.state = 'cleanup_failed'
                event(l, 'cleanup', 'failed')
            if cancelled:
                raise asyncio.CancelledError()
            return
        if was_uncertain or l.device_id in uncertain:
            if l.device_id and l.device_id not in uncertain:
                uncertain[l.device_id] = inventory[l.device_id]['serial']; save_uncertain()
            l.state = 'quarantined_uncertain'
        else:
            l.state = state
        event(l, l.state)

    def make_phone(d):
        if d['automation'] == 'uiautomator2':
            from .uiautomator import AndroidUIAutomator
            options = {}
            if d['provider'] == 'cuttlefish':
                from .cuttlefish import ensure_cuttlefish_booted
                boot_probe = Android(d['serial'])
                async def before_start():
                    await ensure_cuttlefish_booted(boot_probe.command)
                options['before_start'] = before_start
            return AndroidUIAutomator(d['serial'], **options)
        if d['provider'] == 'cuttlefish':
            from .cuttlefish import Cuttlefish
            return Cuttlefish(d['serial'])
        return android_factory(d['serial'])

    async def acquire_resource(who, kind, ttl, device_id=None):
        if (kind == 'desktop' and not desktop_enabled) or (kind == 'phone' and not inventory):
            raise HTTPException(501, 'Provider not configured')
        if device_id is not None and kind != 'phone':
            raise HTTPException(422, 'device_id only applies to phone leases')
        async with allocation:
            occupied_count = sum(l.state not in ('released', 'expired') for l in leases.values()) + len(pending)
            if occupied_count >= capacity:
                raise HTTPException(409, 'Capacity exhausted')
            if kind == 'phone':
                allowed = {i: d for i, d in inventory.items() if who in d['owners']}
                if device_id is not None:
                    if device_id not in allowed:
                        raise HTTPException(404, 'Device not found')
                    allowed = {device_id: allowed[device_id]}
                candidates = [(i, d) for i, d in allowed.items()
                              if not any(l.device_id == i and l.state not in ('released', 'expired') for l in leases.values())
                              and i not in pending.values() and i not in uncertain]
                if not candidates:
                    raise HTTPException(409, 'No available phone')
                candidate, entry = candidates[0]
            else:
                candidate = None
                adapter = browser_factory() if kind == 'browser' else Desktop()
            pid = secrets.token_urlsafe(18)
            pending[pid] = candidate
        if kind != 'phone': candidates = [(None, None)]
        attempted = []
        startup_cleanup_state = 'released'
        while True:
            if kind == 'phone':
                if candidate in attempted:
                    async with allocation:
                        remaining = [(i,d) for i,d in candidates if i not in attempted
                                     and i not in pending.values() and i not in uncertain
                                     and not any(l.device_id == i and l.state not in ('released','expired') for l in leases.values())]
                        if not remaining:
                            pending.pop(pid, None)
                            if device_id is None and len(attempted) < len(candidates):
                                raise AcquisitionError(409, 'No available phone',
                                                       cleanup_state=startup_cleanup_state)
                            raise AcquisitionError(503, 'Configured phones offline or unauthorized',
                                                   cleanup_state=startup_cleanup_state)
                        candidate, entry = remaining[0]
                        pending[pid] = candidate
                attempted.append(candidate)
            adapter = None if kind == 'phone' else adapter
            started = False
            try:
                adapter = make_phone(entry) if kind == 'phone' else adapter
                start_timeout = (150 if entry['provider'] == 'cuttlefish' else 65 if entry['automation'] == 'uiautomator2' else 20) if kind == 'phone' else 20
                await asyncio.wait_for(adapter.start(), timeout=start_timeout)
                started = True
                break
            except BaseException as exc:
                cleanup_ok = adapter is None or (kind == 'phone' and entry['automation'] == 'adb' and not started)
                if not cleanup_ok:
                    cleanup_ok = await finish_cleanup(asyncio.create_task(asyncio.wait_for(adapter.close(), timeout=15)))
                is_uncertain = candidate is not None and (getattr(adapter, 'uncertain', False)
                    or isinstance(exc, asyncio.CancelledError) and entry['automation'] == 'uiautomator2')
                if not cleanup_ok and adapter is not None:
                    async with allocation:
                        failed_id = secrets.token_urlsafe(18)
                        leases[failed_id] = Lease(failed_id, who, '', kind, adapter, time.time(),
                                                  time.monotonic(), candidate, state='cleanup_failed')
                        pending.pop(pid, None)
                if is_uncertain:
                    uncertain[candidate] = inventory[candidate]['serial']; save_uncertain()
                if not cleanup_ok or is_uncertain:
                    startup_cleanup_state = 'quarantined'
                async with allocation:
                    pending.pop(pid, None)
                if isinstance(exc, asyncio.CancelledError):
                    if startup_cleanup_state == 'quarantined':
                        raise AcquisitionCancelled('quarantined') from exc
                    raise
                if not cleanup_ok:
                    raise AcquisitionError(503, 'Provider startup cleanup failed; resource quarantined',
                                           cleanup_state='quarantined') from None
                if kind != 'phone' or device_id is not None:
                    raise AcquisitionError(503, 'Provider startup failed; check local installation',
                                           cleanup_state=startup_cleanup_state) from None
                if attempted and len(attempted) == len(candidates):
                    raise AcquisitionError(503, 'Configured phones offline or unauthorized',
                                           cleanup_state=startup_cleanup_state) from None
                async with allocation:
                    remaining = [(i,d) for i,d in candidates if i not in attempted
                                 and i not in pending.values() and i not in uncertain
                                 and not any(l.device_id == i and l.state not in ('released','expired') for l in leases.values())]
                    if not remaining:
                        raise AcquisitionError(503, 'Configured phones offline or unauthorized',
                                               cleanup_state=startup_cleanup_state) from None
                    candidate, entry = remaining[0]; pending[pid] = candidate
        try:
            async with allocation:
                pending.pop(pid, None)
                l = Lease(secrets.token_urlsafe(18), who, secrets.token_urlsafe(32), kind, adapter,
                          time.time() + ttl, time.monotonic() + ttl, device_id=candidate)
                leases[l.id] = l
        except BaseException:
            cleanup_ok = await finish_cleanup(asyncio.create_task(adapter.close()))
            async with allocation:
                pending.pop(pid, None)
                if not cleanup_ok and adapter is not None:
                    failed_id = secrets.token_urlsafe(18)
                    leases[failed_id] = Lease(failed_id, who, '', kind, adapter, time.time(),
                                              time.monotonic(), candidate, state='cleanup_failed')
            if candidate is not None and getattr(adapter, 'uncertain', False):
                uncertain[candidate] = inventory[candidate]['serial']; save_uncertain()
            raise
        event(l, 'acquire'); return l

    async def job_acquire(who, device_id, ttl):
        lease = await acquire_resource(who, 'phone', ttl, device_id)
        async def job_act(action, args):
            async with lease.lock:
                return await perform_action(lease, action, args)
        lease._job_act = job_act
        lease._release_internal = lambda: release_internal(lease)
        return lease

    from .jobs import JobQueue
    jobs = JobQueue(job_acquire, lambda job, op: None,
                    total_limit=int(os.environ.get('ENV_JOB_LIMIT', '64')),
                    owner_limit=int(os.environ.get('ENV_JOB_OWNER_LIMIT', '16')))

    async def sweep():
        while True:
            await asyncio.sleep(.5)
            for lease in list(leases.values()):
                if lease.state not in ('active', 'cleanup_failed') or lease.deadline > time.monotonic():
                    continue
                async with lease.lock:
                    if lease.state == 'cleanup_failed' or lease.deadline <= time.monotonic():
                        await close(lease, 'expired')
            for lid, lease in list(leases.items()):
                if lease.state in ('released', 'expired') and time.time() - lease.expires > 3600:
                    del leases[lid]

    @asynccontextmanager
    async def lifespan(app):
        worker = asyncio.create_task(sweep())
        yield
        await jobs.shutdown()
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker
        for lease in list(leases.values()):
            if lease.state not in ('released', 'expired'):
                with suppress(BaseException):
                    async with lease.lock:
                        await close(lease, 'released')

    app = FastAPI(title='STROWGER Environment Lease', version='0.4.0', lifespan=lifespan)
    from .console import install_console
    install_console(app, keys, console_bootstrap)
    from fastapi.responses import FileResponse, HTMLResponse
    from html import escape

    @app.get('/demo', include_in_schema=False)
    async def demo():
        return FileResponse(Path(__file__).parent / 'web' / 'demo.html')

    @app.get('/demo/greet', response_class=HTMLResponse, include_in_schema=False)
    async def greet(name: str = ''):
        return '<html lang=fr><meta charset=utf-8><title>Mission terminée</title><body style="font:32px system-ui;background:#e9efdf;padding:80px"><h1>Bonjour ' + escape(name[:120]) + '</h1><p>Mission STROWGER réussie.</p><a href=/demo>Recommencer</a></body></html>'

    def owner(authorization):
        if not authorization or not authorization.startswith('Bearer '):
            raise HTTPException(401, 'Bearer API key required')
        key = authorization[7:]
        for name, expected in keys.items():
            if hmac.compare_digest(key.encode(), expected.encode()):
                return name
        raise HTTPException(401, 'Invalid API key')

    def lookup(lid, who, token):
        l = leases.get(lid)
        if l is None or l.owner != who or not hmac.compare_digest((token or '').encode(), l.token.encode()):
            raise HTTPException(404, 'Lease not found')
        return l

    async def active(l):
        if l.state == 'active' and l.deadline <= time.monotonic():
            await close(l, 'expired')
        if l.state != 'active':
            raise HTTPException(410, 'Lease is no longer active')

    async def probe_adb(serial):
        proc = await asyncio.create_subprocess_exec('adb', '-s', serial, 'get-state',
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), 3)
            return proc.returncode == 0 and out.strip() == b'device'
        except BaseException:
            if proc.returncode is None:
                proc.kill()
            with suppress(BaseException): await asyncio.shield(proc.wait())
            raise

    async def perform_action(l, action, args):
        await active(l)
        try:
            result = await asyncio.wait_for(l.adapter.act(action, args), timeout=min(20, max(.001, l.deadline-time.monotonic())))
        except (ValueError, KeyError, TypeError):
            event(l, 'action', 'invalid'); raise HTTPException(422, 'Invalid action or arguments')
        except BaseException as exc:
            uncertain_result = bool(getattr(exc, 'uncertain', False) or getattr(l.adapter, 'uncertain', False))
            if l.kind == 'phone' and uncertain_result:
                quarantined(l)
            cleanup = asyncio.create_task(close(l, 'released'))
            await finish_cleanup(cleanup)
            event(l, 'action', 'failed')
            if isinstance(exc, asyncio.CancelledError): raise
            raise HTTPException(502, 'Provider action failed or timed out') from None
        event(l, 'action'); return result

    async def release_internal(l):
        async with l.lock:
            if l.state not in ('released', 'expired'):
                await close(l, 'released')
            if l.state in ('cleanup_failed', 'quarantined_uncertain'):
                raise RuntimeError('Resource quarantined')
        return l.public()

    @app.get('/health')
    async def health(): return {'status': 'ok', 'version': '0.4.0'}

    @app.get('/v1/capabilities')
    async def capabilities(authorization: str | None = Header(default=None)):
        owner(authorization)
        return {'browser': {'enabled': True, 'isolation': 'dedicated Chromium process; host network'},
                'phone': {'enabled': bool(inventory), 'isolation': 'exclusive registered Android; no wipe',
                          'actions': sorted({a for d in inventory.values() if d['automation'] == 'uiautomator2'
                                             for a in ['hierarchy','ui_click','ui_exists','ui_set_text']} | set(Android.actions)),
                          'viewer': scrcpy_enabled},
                'jobs': {'enabled': bool(inventory), 'max_steps': 100},
                'desktop': {'enabled': desktop_enabled, 'isolation': 'Linux container; no network or host mounts'}, 'ios': {'enabled': False}}

    @app.get('/v1/devices')
    async def list_devices(details: bool = False, authorization: str | None = Header(default=None)):
        who, result = owner(authorization), []
        for device_id, d in inventory.items():
            if who not in d['owners']: continue
            occupied = next((l for l in leases.values() if l.device_id == device_id and l.state not in ('released', 'expired')), None)
            if device_id in uncertain: state = 'quarantined'
            elif occupied:
                state = ('quarantined' if occupied.state in ('cleanup_failed','quarantined_uncertain') else 'leased') if occupied.owner == who else 'unavailable'
            elif any(v == device_id for v in pending.values()): state = 'leased'
            else:
                try:
                    # Bounded ADB liveness probe; never initializes UIAutomator2.
                    if not await probe_adb(d['serial']): raise RuntimeError()
                    state = 'available'
                except Exception: state = 'offline_or_unauthorized'
            item = {'id': device_id, 'kind': 'phone', 'state': state}
            if details:
                item.update({'provider':d['provider'], 'automation':d['automation'],
                             'actions': sorted(set(Android.actions) | ({'hierarchy','ui_click','ui_exists','ui_set_text'} if d['automation']=='uiautomator2' else set())),
                             'viewer': scrcpy_enabled})
            result.append(item)
        return {'devices': result}

    @app.post('/v1/leases', status_code=201)
    async def acquire(body: Acquire, authorization: str | None = Header(default=None)):
        l = await acquire_resource(owner(authorization), body.kind, body.ttl, body.device_id)
        return {**l.public(), 'lease_token': l.token}

    @app.get('/v1/leases/{lid}')
    async def inspect(lid: str, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            if l.state == 'active' and l.deadline <= time.monotonic(): await close(l, 'expired')
            return l.public()

    @app.post('/v1/leases/{lid}/renew')
    async def renew(lid: str, body: Renew, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            await active(l); l.expires, l.deadline = time.time() + body.ttl, time.monotonic() + body.ttl
            event(l, 'renew'); return l.public()

    @app.post('/v1/leases/{lid}/actions')
    async def act(lid: str, body: Action, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            return await perform_action(l, body.action, body.args)

    @app.delete('/v1/leases/{lid}')
    async def release(lid: str, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            if l.state not in ('released', 'expired'): await close(l, 'released')
            if l.state in ('cleanup_failed', 'quarantined_uncertain'): raise HTTPException(503, 'Cleanup failed; resource quarantined')
            return l.public()

    @app.post('/v1/leases/{lid}/viewer', status_code=201)
    async def start_viewer(lid: str, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        if not scrcpy_enabled: raise HTTPException(501, 'scrcpy viewer is disabled by operator')
        if l.kind != 'phone': raise HTTPException(422, 'Viewer only applies to phone leases')
        async with l.lock:
            await active(l)
            if l.viewer is not None: raise HTTPException(409, 'Viewer already allocated')
            from .scrcpy import ScrcpyViewer
            viewer = ScrcpyViewer(inventory[l.device_id]['serial'], device_id=l.device_id)
            try: await viewer.start()
            except Exception: raise HTTPException(503, 'scrcpy is unavailable or failed to start') from None
            l.viewer = viewer; event(l, 'viewer_start'); return {'state':'running'}

    @app.delete('/v1/leases/{lid}/viewer')
    async def stop_viewer(lid: str, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            if l.viewer is not None:
                try: await l.viewer.close()
                except Exception: raise HTTPException(503, 'scrcpy viewer cleanup failed') from None
                l.viewer = None
            return {'state':'stopped'}

    @app.post('/v1/jobs', status_code=202)
    async def submit_job(body: JobSubmission, authorization: str | None = Header(default=None)):
        who = owner(authorization)
        if not inventory: raise HTTPException(501, 'Phone provider not configured')
        allowed = set(Android.actions) | {'hierarchy','ui_click','ui_exists','ui_set_text'}
        for step in body.steps:
            if step.action not in allowed: raise HTTPException(422, 'Invalid job action')
        try:
            return await jobs.submit(who, body.device_id, body.ttl,
                                     [{'action':s.action,'args':s.args} for s in body.steps], body.name)
        except RuntimeError: raise HTTPException(429, 'Job queue is full') from None

    def job_lookup(jid, authorization, token):
        j = jobs.get(jid, owner(authorization), token)
        if j is None: raise HTTPException(404, 'Job not found')
        return j

    @app.get('/v1/jobs/{jid}')
    async def get_job(jid: str, authorization: str | None = Header(default=None), x_job_token: str | None = Header(default=None)):
        return jobs.public(job_lookup(jid, authorization, x_job_token))

    @app.post('/v1/jobs/{jid}/cancel')
    async def cancel_job(jid: str, authorization: str | None = Header(default=None), x_job_token: str | None = Header(default=None)):
        j = job_lookup(jid, authorization, x_job_token); await jobs.cancel(j)
        return jobs.public(j)

    app.state.leases, app.state.jobs = leases, jobs
    return app
