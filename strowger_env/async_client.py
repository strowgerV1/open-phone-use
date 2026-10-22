"""Async SDK for leases, viewers and declarative jobs."""
import asyncio
import httpx


class AsyncLease:
    def __init__(self, runtime, data):
        self.runtime, self.data = runtime, data
        self.id, self.token = data['id'], data['lease_token']

    async def request(self, method, suffix='', **kwargs):
        response = await self.runtime.http.request(method, '/v1/leases/' + self.id + suffix,
            headers={'X-Lease-Token': self.token}, **kwargs)
        response.raise_for_status(); result = response.json()
        if method == 'GET' and suffix == '' or suffix == '/renew': self.data.update(result)
        return result

    async def act(self, action, **args): return await self.request('POST', '/actions', json={'action': action, 'args': args})
    async def renew(self, ttl=300): return await self.request('POST', '/renew', json={'ttl': ttl})
    async def start_viewer(self): return await self.request('POST', '/viewer')
    async def stop_viewer(self): return await self.request('DELETE', '/viewer')
    async def release(self): return await self.request('DELETE')
    async def __aenter__(self): return self
    async def __aexit__(self, *exc):
        cleanup = asyncio.create_task(self.release())
        cancelled = False
        while not cleanup.done():
            try: await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
                continue
        await cleanup
        if cancelled: raise asyncio.CancelledError


class AsyncJob:
    def __init__(self, runtime, data):
        self.runtime, self.data = runtime, data
        self.id, self.token = data['id'], data['job_token']

    async def request(self, suffix='', method='GET'):
        response = await self.runtime.http.request(method, '/v1/jobs/' + self.id + suffix,
                                                   headers={'X-Job-Token': self.token})
        response.raise_for_status(); self.data.update(response.json()); return self.data
    async def status(self): return await self.request()
    async def cancel(self): return await self.request('/cancel', 'POST')


class AsyncResource:
    def __init__(self, runtime, kind): self.runtime, self.kind = runtime, kind
    async def acquire(self, ttl=300, device_id=None):
        body={'kind':self.kind,'ttl':ttl}
        if device_id is not None: body['device_id']=device_id
        response=await self.runtime.http.post('/v1/leases',json=body); response.raise_for_status()
        return AsyncLease(self.runtime,response.json())


class AsyncRuntime:
    def __init__(self, url, api_key):
        self.http=httpx.AsyncClient(base_url=url,headers={'Authorization':'Bearer '+api_key},timeout=180)
        self.browser,self.desktop,self.phone=(AsyncResource(self,k) for k in ('browser','desktop','phone'))
    async def devices(self):
        response=await self.http.get('/v1/devices'); response.raise_for_status(); return response.json()['devices']
    async def submit_job(self, steps, ttl=300, device_id=None, name=None):
        body={'steps':steps,'ttl':ttl}
        if device_id is not None: body['device_id']=device_id
        if name is not None: body['name']=name
        response=await self.http.post('/v1/jobs',json=body); response.raise_for_status(); return AsyncJob(self,response.json())
    async def aclose(self): await self.http.aclose()
    async def __aenter__(self): return self
    async def __aexit__(self,*exc): await self.aclose()
