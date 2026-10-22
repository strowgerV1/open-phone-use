"""Async Android adapter backed by a private, persistent UIAutomator2 worker."""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any, Awaitable, Callable

from .adapters import Android
from .uiautomator_worker import MAX_LINE_BYTES, validate_selector


class UncertainActionError(RuntimeError):
    """The worker lost contact while a device mutation may still have run."""

    uncertain = True


class UIElementNotFound(ValueError):
    """A valid UI selector did not match an element on the current screen."""


class UIAutomatorProtocolError(RuntimeError):
    pass


class AndroidUIAutomator(Android):
    """Registered Android controlled through uiautomator2 plus inherited ADB."""

    actions = Android.actions + ["hierarchy", "ui_click", "ui_exists", "ui_set_text"]
    worker_connect_timeout = 45.0
    read_timeout = 8.0
    mutation_timeout = 15.0
    close_timeout = 15.0

    def __init__(self, serial: str, *, process_factory: Callable[..., Any] | None = None,
                 before_start: Callable[[], Awaitable[None]] | None = None):
        super().__init__(serial)
        self.uncertain = False
        self._process_factory = process_factory or asyncio.create_subprocess_exec
        self._before_start = before_start
        self._worker = None
        self._request_id = 0
        self._rpc_lock = asyncio.Lock()

    async def _spawn(self):
        return await self._process_factory(
            sys.executable, "-m", "strowger_env.uiautomator_worker",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            limit=MAX_LINE_BYTES + 1,
        )

    @staticmethod
    def _mutating(op: str) -> bool:
        return op in {"ui_click", "ui_set_text"}

    async def _stop_worker(self):
        proc, self._worker = self._worker, None
        if proc is None:
            return
        if proc.returncode is None:
            proc.kill()
        try:
            await asyncio.wait_for(proc.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    async def _stop_worker_shielded(self):
        cleanup = asyncio.create_task(self._stop_worker())
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                continue
        await cleanup

    async def _request(self, op: str, *, payload: dict[str, Any] | None = None,
                       timeout: float | None = None, mutating: bool | None = None):
        proc = self._worker
        if proc is None or proc.returncode is not None:
            raise RuntimeError("UIAutomator worker is not running")
        is_mutating = self._mutating(op) if mutating is None else mutating
        timeout = timeout or (self.mutation_timeout if is_mutating else self.read_timeout)
        request_id = str(self._request_id)
        self._request_id += 1
        request = {"id": request_id, "op": op, **(payload or {})}
        frame = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(frame) > MAX_LINE_BYTES:
            raise ValueError("UIAutomator request is too large")
        try:
            async with self._rpc_lock:
                proc.stdin.write(frame)
                await proc.stdin.drain()
                try:
                    raw = await asyncio.wait_for(proc.stdout.readline(), timeout=timeout)
                except ValueError as exc:
                    raise UIAutomatorProtocolError("UIAutomator worker response exceeded the stream limit") from exc
                if not raw:
                    raise UIAutomatorProtocolError("UIAutomator worker exited without a response")
                if len(raw) > MAX_LINE_BYTES:
                    raise UIAutomatorProtocolError("UIAutomator worker response is too large")
                response = json.loads(raw)
                if not isinstance(response, dict) or response.get("id") != request_id:
                    raise UIAutomatorProtocolError("UIAutomator worker response id mismatch")
                if "result" in response:
                    return response["result"]
                error = response.get("error")
                if error == "invalid_request":
                    raise ValueError(response.get("message", "Invalid UIAutomator request"))
                if error == "element_not_found":
                    raise UIElementNotFound("No UI element matched the selector")
                if error == "dependency_missing":
                    raise RuntimeError("Install the optional android extra to use UIAutomator2")
                if error == "response_too_large":
                    raise RuntimeError("UIAutomator response exceeded its size limit")
                if error == "sdk_error":
                    if is_mutating:
                        self.uncertain = True
                        raise UncertainActionError("UIAutomator action outcome is unknown")
                    raise RuntimeError("UIAutomator SDK operation failed")
                raise UIAutomatorProtocolError("Invalid UIAutomator worker response")
        except asyncio.CancelledError:
            if is_mutating:
                self.uncertain = True
            await self._stop_worker_shielded()
            if is_mutating:
                raise UncertainActionError("UIAutomator action was cancelled; device outcome is unknown")
            raise
        except (asyncio.TimeoutError, UIAutomatorProtocolError, json.JSONDecodeError,
                asyncio.LimitOverrunError, BrokenPipeError, ConnectionError) as exc:
            if is_mutating:
                self.uncertain = True
                await self._stop_worker_shielded()
                raise UncertainActionError("UIAutomator action outcome is unknown") from exc
            await self._stop_worker_shielded()
            raise RuntimeError("UIAutomator worker failed") from exc

    async def start(self):
        if self._before_start is not None:
            await self._before_start()
        # ADB's short get-state check runs before UIAutomator2 can start its device service.
        await super().start()
        try:
            self._worker = await self._spawn()
            await self._request("connect", payload={"serial": self.serial},
                                timeout=self.worker_connect_timeout, mutating=False)
        except BaseException:
            await self._stop_worker_shielded()
            raise

    async def act(self, action, args):
        if action == "hierarchy":
            selectorless = {}
            return await self._request("hierarchy", payload=selectorless)
        if action == "ui_exists":
            selector = validate_selector(args.get("selector"))
            return await self._request("ui_exists", payload={"selector": selector})
        if action == "ui_click":
            selector = validate_selector(args.get("selector"))
            return await self._request("ui_click", payload={"selector": selector})
        if action == "ui_set_text":
            selector = validate_selector(args.get("selector"))
            text = args.get("text")
            if not isinstance(text, str) or not 1 <= len(text) <= 2000:
                raise ValueError("Text must contain 1 to 2000 characters")
            return await self._request("ui_set_text", payload={"selector": selector, "text": text})
        if action == "observe":
            screenshot = await self._request("screenshot")
            hierarchy = await self._request("hierarchy")
            return {**screenshot, "hierarchy_xml": hierarchy["xml"],
                    "hierarchy_truncated": hierarchy["truncated"]}
        if action == "screenshot":
            return await self._request("screenshot")
        return await super().act(action, args)

    async def close(self):
        if self._worker is not None:
            try:
                await self._request("close", timeout=self.close_timeout, mutating=False)
                proc = self._worker
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3.0)
                    self._worker = None
                except asyncio.TimeoutError:
                    await self._stop_worker()
            finally:
                if self._worker is not None:
                    await self._stop_worker_shielded()
        # Android.close() calls self.start() polymorphically; use its small
        # cleanup sequence directly so releasing cannot launch another worker.
        await Android.start(self)
        await self.command("shell", "input", "keyevent", "KEYCODE_HOME")


# Both names are convenient to fleet factories and preserve a concise import.
UIAutomator = AndroidUIAutomator
