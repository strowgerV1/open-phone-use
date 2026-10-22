import asyncio
import hmac
import json
import os
import re
import secrets
import time
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .adapters import Browser, Android, Desktop
from .config import load_inventory, read_capacity


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

    def public(self):
        return {'id': self.id, 'kind': self.kind, 'state': self.state,
                'expires_at': self.expires, 'actions': self.adapter.actions, 'device_id': self.device_id}


def create_app(keys=None, browser_factory=Browser, capacity=None, audit_path=None, android_factory=Android, devices=None):
    # Keys are provisioned by the operator, never supplied as an owner label by an agent.
    keys = keys if keys is not None else json.loads(os.environ.get('ENV_API_KEYS', '{}'))
    if not keys or not all(isinstance(k, str) and isinstance(v, str) and len(v) >= 24 for k, v in keys.items()):
        raise RuntimeError('ENV_API_KEYS must map owners to distinct API keys of at least 24 characters')
    if len(set(keys.values())) != len(keys):
        raise RuntimeError('API keys must be distinct')
    capacity = read_capacity(capacity)
    leases = {}
    allocation = asyncio.Lock()
    audit = Path(audit_path or os.environ.get('ENV_AUDIT_PATH', 'data/audit.jsonl'))
    audit.parent.mkdir(parents=True, exist_ok=True)
    devices = devices if devices is not None else load_inventory(keys)
    if not isinstance(devices, list):
        raise RuntimeError('Android inventory must be a list')
    inventory = {}
    serials = set()
    for d in devices:
        if (not isinstance(d, dict) or set(d) != {'id', 'serial', 'owners'}
            or not isinstance(d['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', d['id'])
            or not isinstance(d['serial'], str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', d['serial'])
            or not isinstance(d['owners'], list) or not d['owners']
            or any(not isinstance(o, str) or o not in keys for o in d['owners'])
            or d['id'] in inventory or d['serial'] in serials):
            raise RuntimeError('Invalid or duplicate Android inventory entry')
        inventory[d['id']] = dict(d)
        serials.add(d['serial'])
    desktop_enabled = os.environ.get('ENV_DESKTOP_ENABLED') == '1'

    def event(l, operation, outcome='ok'):
        # No API keys, lease tokens, URLs, selectors, screenshots or user text.
        with audit.open('a') as f:
            f.write(json.dumps({'time': time.time(), 'lease': l.id, 'owner': l.owner,
                               'kind': l.kind, 'operation': operation, 'outcome': outcome}) + '\n')

    async def close(l, state):
        l.state = 'closing'
        try:
            await l.adapter.close()
        except Exception:
            l.state = 'cleanup_failed'
            event(l, 'cleanup', 'failed')
            return
        l.state = state
        event(l, state)

    async def sweep():
        while True:
            await asyncio.sleep(.5)
            for l in list(leases.values()):
                async with l.lock:
                    if l.state == 'cleanup_failed':
                        await close(l, 'expired')
                    elif l.state == 'active' and l.deadline <= time.monotonic():
                        await close(l, 'expired')
            # Bound in-memory tombstones. Tokens of pruned leases remain invalid.
            for lid, l in list(leases.items()):
                if l.state in ('released', 'expired') and time.time() - l.expires > 3600:
                    del leases[lid]

    @asynccontextmanager
    async def lifespan(app):
        worker = asyncio.create_task(sweep())
        yield
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker
        for l in leases.values():
            if l.state not in ('released', 'expired'):
                await close(l, 'released')

    app = FastAPI(title='STROWGER Environment Lease', version='0.2.0', lifespan=lifespan)

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

    @app.get('/health')
    async def health():
        return {'status': 'ok', 'version': '0.2.0'}

    @app.get('/v1/capabilities')
    async def capabilities(authorization: str | None = Header(default=None)):
        owner(authorization)
        return {'browser': {'enabled': True, 'isolation': 'dedicated Chromium process; host network'},
                'phone': {'enabled': bool(inventory), 'isolation': 'exclusive registered Android; no wipe'},
                'desktop': {'enabled': desktop_enabled, 'isolation': 'Linux container; no network or host mounts'}, 'ios': {'enabled': False}}

    @app.get('/v1/devices')
    async def list_devices(authorization: str | None = Header(default=None)):
        who = owner(authorization)
        result = []
        async with allocation:
            for device_id, d in inventory.items():
                if who not in d['owners']:
                    continue
                occupied = next((l for l in leases.values() if l.device_id == device_id
                                 and l.state not in ('released', 'expired')), None)
                if occupied:
                    # No lease IDs, owner labels or occupancy of other tenants.
                    state = ('quarantined' if occupied.state == 'cleanup_failed' else 'leased') if occupied.owner == who else 'unavailable'
                else:
                    try:
                        await android_factory(d['serial']).start()
                        state = 'available'
                    except Exception:
                        state = 'offline_or_unauthorized'
                result.append({'id': device_id, 'kind': 'phone', 'state': state})
        return {'devices': result}

    @app.post('/v1/leases', status_code=201)
    async def acquire(body: Acquire, authorization: str | None = Header(default=None)):
        who = owner(authorization)
        if (body.kind == 'desktop' and not desktop_enabled) or (body.kind == 'phone' and not inventory):
            raise HTTPException(501, 'Provider not configured')
        if body.device_id is not None and body.kind != 'phone':
            raise HTTPException(422, 'device_id only applies to phone leases')
        async with allocation:
            occupied = [l for l in leases.values() if l.state not in ('released', 'expired')]
            if len(occupied) >= capacity:
                raise HTTPException(409, 'Capacity exhausted')
            device_id = None
            if body.kind == 'phone':
                allowed = {i: d for i, d in inventory.items() if who in d['owners']}
                if body.device_id is not None:
                    if body.device_id not in allowed:
                        raise HTTPException(404, 'Device not found')
                    allowed = {body.device_id: allowed[body.device_id]}
                available = [(i, d) for i, d in allowed.items() if not any(l.device_id == i for l in occupied)]
                if not available:
                    raise HTTPException(409, 'No available phone')
                adapter = None
                for candidate, d in available:
                    candidate_adapter = android_factory(d['serial'])
                    try:
                        await candidate_adapter.start()
                    except Exception:
                        continue
                    device_id, adapter = candidate, candidate_adapter
                    break
                if adapter is None:
                    raise HTTPException(503, 'Configured phones offline or unauthorized')
            else:
                adapter = browser_factory() if body.kind == 'browser' else Desktop()
                try:
                    await adapter.start()
                except Exception:
                    raise HTTPException(503, 'Provider startup failed; check local installation')
            l = Lease(secrets.token_urlsafe(18), who, secrets.token_urlsafe(32), body.kind,
                      adapter, time.time() + body.ttl, time.monotonic() + body.ttl, device_id=device_id)
            leases[l.id] = l
            event(l, 'acquire')
            return {**l.public(), 'lease_token': l.token}

    @app.get('/v1/leases/{lid}')
    async def inspect(lid: str, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            if l.state == 'active' and l.deadline <= time.monotonic():
                await close(l, 'expired')
            return l.public()

    @app.post('/v1/leases/{lid}/renew')
    async def renew(lid: str, body: Renew, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            await active(l)
            l.expires, l.deadline = time.time() + body.ttl, time.monotonic() + body.ttl
            event(l, 'renew')
            return l.public()

    @app.post('/v1/leases/{lid}/actions')
    async def act(lid: str, body: Action, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            await active(l)
            try:
                result = await asyncio.wait_for(l.adapter.act(body.action, body.args),
                                               timeout=min(20, max(.001, l.deadline - time.monotonic())))
            except (ValueError, KeyError, TypeError):
                event(l, 'action', 'invalid')
                raise HTTPException(422, 'Invalid action or arguments')
            except Exception:
                event(l, 'action', 'failed')
                if l.kind == 'phone':
                    await close(l, 'released')
                raise HTTPException(502, 'Provider action failed or timed out')
            event(l, 'action')
            return result

    @app.delete('/v1/leases/{lid}')
    async def release(lid: str, authorization: str | None = Header(default=None), x_lease_token: str | None = Header(default=None)):
        l = lookup(lid, owner(authorization), x_lease_token)
        async with l.lock:
            if l.state not in ('released', 'expired'):
                await close(l, 'released')
            if l.state == 'cleanup_failed':
                raise HTTPException(503, 'Cleanup failed; resource quarantined')
            return l.public()

    return app
