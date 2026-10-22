"""Opt-in recipe for two explicitly named, dedicated Cuttlefish devices."""
import asyncio
import base64
import os
import shutil

import pytest

from strowger_env.cuttlefish import Cuttlefish


@pytest.mark.skipif(os.environ.get('ENV_CUTTLEFISH_TEST') != '1',
                    reason='Set ENV_CUTTLEFISH_TEST=1 to run the real Cuttlefish recipe')
def test_two_explicit_cuttlefish_transports_boot_home_and_capture():
    raw = os.environ.get('ENV_CUTTLEFISH_SERIALS', '')
    serials = [item.strip() for item in raw.split(',') if item.strip()]
    if len(serials) != 2 or len(set(serials)) != 2:
        pytest.fail('Set ENV_CUTTLEFISH_SERIALS to exactly two dedicated ADB serials')
    if not shutil.which('adb'):
        pytest.fail('ADB is missing; install Android SDK Platform Tools on the Cuttlefish test client')

    async def run():
        phones = [Cuttlefish(serial, boot_timeout=180) for serial in serials]
        started = []
        try:
            await asyncio.gather(*(phone.start() for phone in phones))
            started.extend(phones)
            captures = []
            for phone in phones:
                await phone.act('key', {'key': 'HOME'})
                response = await phone.act('screenshot', {})
                image = base64.b64decode(response['png_base64'], validate=True)
                if not image.startswith(b'\x89PNG\r\n\x1a\n'):
                    raise AssertionError('Cuttlefish returned a non-PNG screenshot')
                captures.append(len(image))
            assert len(captures) == 2 and all(size > 8 for size in captures)
        finally:
            # close() sends HOME over ADB and never stops or deletes a CVD.
            await asyncio.gather(*(phone.close() for phone in started), return_exceptions=False)

    asyncio.run(run())
