"""Synchronous SDK for an existing GETA/STROWGER orchestrator."""
import httpx


class Lease:
    def __init__(self, client, data):
        self.client, self.data = client, data
        self.id, self.token = data['id'], data['lease_token']

    def request(self, method, suffix='', **kwargs):
        response = self.client.http.request(method, '/v1/leases/' + self.id + suffix,
                    headers={'X-Lease-Token': self.token}, **kwargs)
        response.raise_for_status()
        return response.json()

    def act(self, action, **args):
        return self.request('POST', '/actions', json={'action': action, 'args': args})

    def renew(self, ttl=300):
        return self.request('POST', '/renew', json={'ttl': ttl})

    def release(self):
        return self.request('DELETE')

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.release()


class Resource:
    def __init__(self, client, kind):
        self.client, self.kind = client, kind

    def acquire(self, ttl=300, device_id=None):
        body = {'kind': self.kind, 'ttl': ttl}
        if device_id is not None:
            body['device_id'] = device_id
        r = self.client.http.post('/v1/leases', json=body)
        r.raise_for_status()
        return Lease(self.client, r.json())


class Runtime:
    def __init__(self, url, api_key):
        self.http = httpx.Client(base_url=url, headers={'Authorization': 'Bearer ' + api_key}, timeout=60)
        self.browser, self.desktop, self.phone = (Resource(self, k) for k in ('browser', 'desktop', 'phone'))

    def devices(self):
        response = self.http.get('/v1/devices')
        response.raise_for_status()
        return response.json()['devices']

    def close(self):
        self.http.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
