"""Opt-in Android integration recipe. Never discovers and drives arbitrary USB devices."""
import json
import os
import pytest

pytestmark = pytest.mark.skipif(os.environ.get('ENV_ANDROID_TEST') != '1',
                                reason='set ENV_ANDROID_TEST=1 to run the explicit Android hardware recipe')


def test_two_explicit_android_devices():
    raw_ids = os.environ.get('ENV_ANDROID_TEST_DEVICE_IDS', '')
    if not raw_ids:
        pytest.fail('ENV_ANDROID_TEST=1 requires ENV_ANDROID_TEST_DEVICE_IDS with exactly two enrolled device IDs')
    try: device_ids = json.loads(raw_ids)
    except ValueError: pytest.fail('ENV_ANDROID_TEST_DEVICE_IDS must be a JSON array')
    if not isinstance(device_ids, list) or len(device_ids) != 2 or any(not isinstance(x, str) for x in device_ids):
        pytest.fail('Configure exactly two explicit device IDs; discovery is not used by this recipe')
    owner = os.environ.get('ENV_ANDROID_TEST_OWNER')
    api_key = os.environ.get('ENV_ANDROID_TEST_API_KEY')
    base_url = os.environ.get('ENV_ANDROID_TEST_URL', 'http://127.0.0.1:8876')
    if not owner or not api_key:
        pytest.fail('Configure ENV_ANDROID_TEST_OWNER and ENV_ANDROID_TEST_API_KEY in the private test environment')
    from strowger_env.async_client import AsyncRuntime
    import asyncio

    async def run():
        async with AsyncRuntime(base_url, api_key) as runtime:
            leases=[]
            try:
                for device_id in device_ids:
                    leases.append(await runtime.phone.acquire(device_id=device_id, ttl=180))
                for lease in leases:
                    await lease.act('key', key='HOME')
                    result=await lease.act('screenshot')
                    if not result.get('png_base64','').startswith('iVBORw0KGgo'):
                        pytest.fail('Android screenshot did not return a PNG')
                    # A physical tester may opt into the UIAutomator2 check only
                    # when the lease advertises it; no settings are changed.
                    if 'hierarchy' in lease.data.get('actions',[]):
                        tree=await lease.act('hierarchy')
                        if 'xml' not in tree or not isinstance(tree['truncated'],bool):
                            pytest.fail('UIAutomator2 hierarchy response is invalid')
            finally:
                errors=[]
                for lease in reversed(leases):
                    try: await lease.release()
                    except Exception as exc: errors.append(exc)
                if errors:
                    pytest.fail(f'Cleanup failed for {len(errors)} explicit test lease(s)')
    asyncio.run(run())
