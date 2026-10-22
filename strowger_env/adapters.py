import asyncio
import base64
import os
import re
from urllib.parse import urlparse


class Browser:
    """A fresh Chromium process per lease; no direct endpoint exposed."""
    actions = ['navigate', 'observe', 'click', 'fill', 'screenshot']

    async def start(self):
        from playwright.async_api import async_playwright
        self.pw = await async_playwright().start()
        try:
            self.browser = await self.pw.chromium.launch(headless=True)
            self.context = await self.browser.new_context(accept_downloads=False)
            self.page = await self.context.new_page()
            self.page.set_default_timeout(10000)
        except BaseException:
            await self.close()
            raise

    async def act(self, action, args):
        if action == 'navigate':
            url = args.get('url', '')
            if urlparse(url).scheme not in ('http', 'https'):
                raise ValueError('Only http/https URLs are supported')
            await self.page.goto(url, wait_until='domcontentloaded', timeout=15000)
        elif action == 'click':
            await self.page.locator(args['selector']).click()
        elif action == 'fill':
            await self.page.locator(args['selector']).fill(args['text'])
        elif action == 'screenshot':
            return {'png_base64': base64.b64encode(await self.page.screenshot()).decode()}
        elif action != 'observe':
            raise ValueError('Unsupported browser action')
        return {'url': self.page.url, 'title': await self.page.title(),
                'text': (await self.page.locator('body').inner_text())[:20000]}

    async def close(self):
        try:
            if hasattr(self, 'browser'):
                await self.browser.close()
        finally:
            if hasattr(self, 'pw'):
                await self.pw.stop()


class Android:
    """Exclusive registered device. Release does NOT wipe user data."""
    actions = ['observe', 'screenshot', 'tap', 'key']

    def __init__(self, serial):
        self.serial = serial

    async def command(self, *args):
        proc = await asyncio.create_subprocess_exec('adb', '-s', self.serial, *args,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), 15)
        except BaseException:
            proc.kill()
            await proc.wait()
            raise
        if proc.returncode:
            raise RuntimeError('ADB command failed')
        return out

    async def start(self):
        if (await self.command('get-state')).strip() != b'device':
            raise RuntimeError('Device not available')

    async def act(self, action, args):
        if action in ('observe', 'screenshot'):
            return {'png_base64': base64.b64encode(await self.command('exec-out', 'screencap', '-p')).decode()}
        if action == 'tap':
            x, y = args['x'], args['y']
            if type(x) is not int or type(y) is not int or not (0 <= x <= 10000 and 0 <= y <= 10000):
                raise ValueError('Invalid coordinates')
            await self.command('shell', 'input', 'tap', str(x), str(y))
        elif action == 'key':
            key = args.get('key')
            if key not in ('HOME', 'BACK', 'ENTER'):
                raise ValueError('Allowed keys: HOME, BACK, ENTER')
            await self.command('shell', 'input', 'keyevent', 'KEYCODE_' + key)
        else:
            raise ValueError('Unsupported phone action')
        return {'ok': True}

    async def close(self):
        # Return to HOME only; this does not clear applications or user data.
        await self.start()
        await self.command('shell', 'input', 'keyevent', 'KEYCODE_HOME')


class Desktop:
    """Disposable Linux X11 container, no network and no host mounts."""
    actions = ['observe', 'screenshot', 'tap', 'type', 'key']

    def __init__(self):
        import secrets
        self.name = 'strowger-lease-' + secrets.token_hex(12)

    async def command(self, *args):
        proc = await asyncio.create_subprocess_exec('docker', *args,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), 25)
        except BaseException:
            proc.kill()
            await proc.wait()
            raise
        if proc.returncode:
            raise RuntimeError('Docker operation failed')
        return out

    async def start(self):
        try:
            await self.command('run', '-d', '--rm', '--name', self.name,
                '--label', 'strowger.managed=true', '--network', 'none',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
                os.environ.get('ENV_DESKTOP_IMAGE', 'strowger-desktop:0.1.0'))
            for _ in range(15):
                try:
                    await self.command('exec', self.name, 'xdpyinfo')
                    return
                except RuntimeError:
                    await asyncio.sleep(.5)
            raise RuntimeError('Desktop not ready')
        except BaseException:
            await self.close()
            raise

    async def act(self, action, args):
        if action in ('observe', 'screenshot'):
            png = await self.command('exec', self.name, 'import', '-window', 'root', 'png:-')
            return {'png_base64': base64.b64encode(png).decode()}
        if action == 'tap':
            x, y = args['x'], args['y']
            if type(x) is not int or type(y) is not int or not (0 <= x < 1280 and 0 <= y < 800):
                raise ValueError('Invalid coordinates')
            await self.command('exec', self.name, 'xdotool', 'mousemove', str(x), str(y), 'click', '1')
        elif action == 'type':
            text = args['text']
            if not isinstance(text, str) or len(text) > 2000:
                raise ValueError('Text too long')
            await self.command('exec', self.name, 'xdotool', 'type', '--clearmodifiers', '--', text)
        elif action == 'key':
            key = args.get('key')
            if key not in ('Return', 'Tab', 'Escape', 'BackSpace'):
                raise ValueError('Unsupported key')
            await self.command('exec', self.name, 'xdotool', 'key', key)
        else:
            raise ValueError('Unsupported desktop action')
        return {'ok': True}

    async def close(self):
        # Removing an already absent container is idempotent. Other errors propagate.
        names = (await self.command('ps', '-a', '--filter', 'name=^/' + self.name + '$', '--format', '{{.Names}}')).decode().splitlines()
        if self.name in names:
            await self.command('rm', '-f', self.name)
