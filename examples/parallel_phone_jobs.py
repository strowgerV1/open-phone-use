"""Run one declarative job per tenant/device using the async SDK.

Provision ENV_API_KEYS as a private JSON map, e.g. {'client-a': '...',
'client-b': '...'}, and set ENV_BROKER_URL. This example never prints keys or
job tokens. Jobs use server-side leases and the broker's configured fleet.
"""
import asyncio
import json
import os

from strowger_env.async_client import AsyncRuntime


async def run(owner, api_key, device_id):
    async with AsyncRuntime(os.environ.get('ENV_BROKER_URL', 'http://127.0.0.1:8876'), api_key) as runtime:
        job = await runtime.submit_job([
            {'action': 'key', 'args': {'key': 'HOME'}},
            {'action': 'screenshot', 'args': {}},
        ], device_id=device_id, ttl=180, name='home-capture')
        try:
            while True:
                status = await job.status()
                print(f"{owner}: {status['state']} {status['step']}/{status['steps']} ({status['cleanup']})")
                if status['state'] in ('succeeded', 'failed', 'cancelled'):
                    return status
                await asyncio.sleep(.5)
        except asyncio.CancelledError:
            await job.cancel()
            raise
        finally:
            if job.data.get('state') not in ('succeeded', 'failed', 'cancelled'):
                await job.cancel()


async def main():
    keys = json.loads(os.environ['ENV_API_KEYS'])
    # IDs must be enrolled to their matching owner in data/fleet.json.
    results = await asyncio.gather(
        run('client-a', keys['client-a'], 'phone-a-01'),
        run('client-b', keys['client-b'], 'phone-b-01'),
    )
    print([r['state'] for r in results])


if __name__ == '__main__':
    asyncio.run(main())
