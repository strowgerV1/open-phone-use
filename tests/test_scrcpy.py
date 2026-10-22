import asyncio

import pytest

from strowger_env.scrcpy import ScrcpyStartError, ScrcpyUnavailableError, ScrcpyViewer


class FakeProcess:
    def __init__(self, *, exit_after=None, wait_forever=False):
        self.pid = 8721
        self.returncode = exit_after
        self.terminated = False
        self.killed = False
        self.wait_forever = wait_forever
        self._done = asyncio.Event()
        self.waiting = asyncio.Event()
        if exit_after is not None:
            self._done.set()

    def terminate(self):
        self.terminated = True
        if not self.wait_forever:
            self.returncode = -15
            self._done.set()

    def kill(self):
        self.killed = True
        self.returncode = -9
        self._done.set()

    async def wait(self):
        self.waiting.set()
        await self._done.wait()
        return self.returncode


class SlowReapProcess(FakeProcess):
    async def wait(self):
        self.waiting.set()
        await asyncio.sleep(0.03)
        if self.returncode is None:
            await self._done.wait()
        return self.returncode


def test_fixed_read_only_command_and_idempotent_close():
    calls = []
    proc = FakeProcess()
    async def factory(*args, **kwargs):
        calls.append((args, kwargs))
        return proc
    viewer = ScrcpyViewer("adb:serial-1", "phone-public-id", executable="/usr/bin/scrcpy",
                          process_factory=factory, startup_grace=0)
    async def run():
        started = await viewer.start()
        assert started == {"pid": 8721, "running": True}
        assert calls[0][0] == (
            "/usr/bin/scrcpy", "--serial", "adb:serial-1", "--no-control", "--no-audio",
            "--no-clipboard-autosync", "--max-size", "1280", "--max-fps", "20",
        )
        assert calls[0][1]["stdin"] is asyncio.subprocess.DEVNULL
        await viewer.close()
        await viewer.close()
        assert proc.terminated is True
        assert viewer.pid is None and not viewer.running
    asyncio.run(run())


def test_missing_binary_fails_before_spawn(monkeypatch):
    monkeypatch.setattr("strowger_env.scrcpy.shutil.which", lambda _: None)
    spawned = []
    async def factory(*args, **kwargs):
        spawned.append(args)
    viewer = ScrcpyViewer("serial", process_factory=factory)
    with pytest.raises(ScrcpyUnavailableError):
        asyncio.run(viewer.start())
    assert spawned == []


def test_immediate_exit_is_reported_and_reaped():
    proc = FakeProcess(exit_after=7)
    async def factory(*args, **kwargs):
        return proc
    viewer = ScrcpyViewer("serial", executable="scrcpy", process_factory=factory,
                          startup_grace=0.01)
    with pytest.raises(ScrcpyStartError, match="status 7"):
        asyncio.run(viewer.start())
    assert proc.returncode == 7
    assert viewer.process is None
    assert viewer.pid is None


def test_start_cancellation_terminates_viewer():
    launched = asyncio.Event()
    proc = FakeProcess()
    async def factory(*args, **kwargs):
        launched.set()
        return proc
    viewer = ScrcpyViewer("serial", executable="scrcpy", process_factory=factory,
                          startup_grace=10)
    async def run():
        task = asyncio.create_task(viewer.start())
        await launched.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert proc.terminated is True
        assert viewer.process is None and viewer.pid is None
    asyncio.run(run())


def test_startup_failure_and_kill_fallback():
    async def failing_factory(*args, **kwargs):
        raise FileNotFoundError("scrcpy")
    viewer = ScrcpyViewer("serial", executable="scrcpy", process_factory=failing_factory)
    with pytest.raises(ScrcpyUnavailableError):
        asyncio.run(viewer.start())

    proc = FakeProcess(wait_forever=True)
    async def factory(*args, **kwargs):
        return proc
    viewer = ScrcpyViewer("serial", executable="scrcpy", process_factory=factory,
                          startup_grace=0, stop_timeout=0.001)
    async def run():
        await viewer.start()
        await viewer.close()
        assert proc.terminated and proc.killed
        assert viewer.process is None
    asyncio.run(run())


def test_repeated_cancellation_of_close_still_reaps_process():
    proc = SlowReapProcess(wait_forever=True)
    async def factory(*args, **kwargs):
        return proc
    viewer = ScrcpyViewer("serial", executable="scrcpy", process_factory=factory,
                          startup_grace=0, stop_timeout=0.001)
    async def run():
        await viewer.start()
        closing = asyncio.create_task(viewer.close())
        await proc.waiting.wait()
        closing.cancel()
        await asyncio.sleep(0)
        closing.cancel()
        with pytest.raises(asyncio.CancelledError):
            await closing
        assert proc.killed is True
        assert viewer.process is None
        assert viewer.pid is None
    asyncio.run(run())
