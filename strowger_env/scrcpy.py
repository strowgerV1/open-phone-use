"""Lease-scoped, read-only scrcpy process management."""

from __future__ import annotations

import asyncio
import shutil
from typing import Any, Callable


class ScrcpyUnavailableError(RuntimeError):
    pass


class ScrcpyStartError(RuntimeError):
    pass


class ScrcpyViewer:
    """Own exactly one fixed-argument scrcpy viewer for an inventoried serial."""

    def __init__(self, serial: str, device_id: str | None = None, *,
                 executable: str | None = None,
                 process_factory: Callable[..., Any] | None = None,
                 startup_grace: float = 0.08, stop_timeout: float = 3.0):
        if not isinstance(serial, str) or not serial or len(serial) > 256:
            raise ValueError("Invalid Android serial")
        self.serial = serial
        self.device_id = device_id
        self.executable = executable
        self._process_factory = process_factory or asyncio.create_subprocess_exec
        self.startup_grace = startup_grace
        self.stop_timeout = stop_timeout
        self.process = None
        self.pid: int | None = None
        self._closed = False

    @property
    def command(self) -> list[str]:
        executable = self.executable or shutil.which("scrcpy")
        if not executable:
            raise ScrcpyUnavailableError("scrcpy executable was not found on the broker host")
        return [executable, "--serial", self.serial, "--no-control", "--no-audio",
                "--no-clipboard-autosync", "--max-size", "1280", "--max-fps", "20"]

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    async def start(self) -> dict[str, Any]:
        if self.process is not None:
            if self.running:
                return {"pid": self.pid, "running": True}
            raise ScrcpyStartError("scrcpy viewer has already exited")
        self._closed = False
        argv = self.command
        try:
            self.process = await self._process_factory(
                *argv,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            self.pid = getattr(self.process, "pid", None)
            if self.startup_grace:
                await asyncio.sleep(self.startup_grace)
            if self.process.returncode is not None:
                code = self.process.returncode
                await self._reap()
                raise ScrcpyStartError(f"scrcpy exited during startup (status {code})")
            return {"pid": self.pid, "running": True}
        except asyncio.CancelledError:
            await self._close_shielded()
            raise
        except ScrcpyUnavailableError:
            raise
        except ScrcpyStartError:
            raise
        except (FileNotFoundError, OSError) as exc:
            await self._close_shielded()
            if isinstance(exc, FileNotFoundError):
                raise ScrcpyUnavailableError("scrcpy executable was not found on the broker host") from exc
            raise ScrcpyStartError("scrcpy could not be started") from exc
        except BaseException:
            await self._close_shielded()
            raise

    async def _reap(self):
        proc, self.process = self.process, None
        if proc is None:
            self.pid = None
            return
        try:
            await asyncio.wait_for(proc.wait(), timeout=self.stop_timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
        self.pid = None

    async def _close_impl(self):
        proc = self.process
        if proc is None:
            self._closed = True
            self.pid = None
            return
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=self.stop_timeout)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
        else:
            await proc.wait()
        self.process = None
        self.pid = None
        self._closed = True

    async def _close_shielded(self):
        cleanup = asyncio.create_task(self._close_impl())
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                continue
        await cleanup

    async def close(self):
        cleanup = asyncio.create_task(self._close_impl())
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        await cleanup
        if cancelled:
            raise asyncio.CancelledError
