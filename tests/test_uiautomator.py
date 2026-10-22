import asyncio
import io
import json
import sys

import pytest

from strowger_env.uiautomator import AndroidUIAutomator, UIElementNotFound, UncertainActionError
from strowger_env.uiautomator_worker import (
    MAX_HIERARCHY_BYTES, DependencyMissing, dispatch, serve, validate_selector,
)


class FakeTarget:
    def __init__(self, device, selector):
        self.device, self.selector = device, selector

    def wait(self, timeout=None):
        self.device.calls.append(("wait", self.selector, timeout))
        return self.device.found

    def click(self, timeout=None):
        self.device.calls.append(("click", self.selector, timeout))
        if not self.device.found:
            from uiautomator2.exceptions import UiObjectNotFoundError
            raise UiObjectNotFoundError({"code": -32002, "method": "wait"})

    def set_text(self, text, timeout=None):
        self.device.calls.append(("set_text", self.selector, text, timeout))
        if not self.device.found:
            from uiautomator2.exceptions import UiObjectNotFoundError
            raise UiObjectNotFoundError({"code": -32002, "method": "wait"})


class FakeDevice:
    def __init__(self):
        self.calls = []
        self.found = True
        self.xml = "<hierarchy/>"

    def __call__(self, **selector):
        self.calls.append(("selector", selector))
        return FakeTarget(self, selector)

    def dump_hierarchy(self):
        return self.xml

    def stop_uiautomator(self, wait=True):
        self.calls.append(("stop_uiautomator", wait))


class FakeProc:
    """Small subprocess-shaped JSON-lines endpoint with controllable hangs."""

    def __init__(self, *, block_mutation=False, mismatch=False):
        self.stdout = asyncio.StreamReader(limit=12 * 1024 * 1024)
        self.stdin = _FakeWriter(self)
        self.returncode = None
        self.pid = 4242
        self.device = FakeDevice()
        self.block_mutation = block_mutation
        self.mismatch = mismatch
        self.requests = []

    def respond(self, raw):
        request = json.loads(raw)
        self.requests.append(request)
        op, rid = request["op"], request["id"]
        if self.block_mutation and op in ("ui_click", "ui_set_text"):
            return
        if op == "connect":
            result = {"connected": True}
        elif op == "hierarchy":
            result = dispatch(self.device, request)
        elif op == "ui_exists":
            result = dispatch(self.device, request)
        elif op in ("ui_click", "ui_set_text"):
            try:
                result = dispatch(self.device, request)
            except Exception as error:
                from uiautomator2.exceptions import UiObjectNotFoundError
                if isinstance(error, UiObjectNotFoundError):
                    self.stdout.feed_data((json.dumps({"id": rid, "error": "element_not_found"}) + "\n").encode())
                    return
                raise
        elif op == "close":
            result = {"closed": True}
        else:
            result = {"png_base64": "cG5n"}
        response = {"id": "wrong" if self.mismatch else rid, "result": result}
        self.stdout.feed_data((json.dumps(response) + "\n").encode())
        if op == "close":
            self.returncode = 0
            self.stdout.feed_eof()

    async def wait(self):
        if self.returncode is None:
            await self.stdout.read()
        return self.returncode

    def kill(self):
        self.returncode = -9
        self.stdout.feed_eof()


class SlowReapProc(FakeProc):
    def __init__(self):
        super().__init__(block_mutation=True)
        self.killed_event = asyncio.Event()

    def kill(self):
        self.returncode = -9
        self.killed_event.set()
        self.stdout.feed_eof()

    async def wait(self):
        await asyncio.sleep(0.03)
        return self.returncode


class _FakeWriter:
    def __init__(self, proc):
        self.proc = proc
        self.buffer = bytearray()

    def write(self, value):
        self.buffer.extend(value)
        if self.buffer.endswith(b"\n"):
            line = bytes(self.buffer[:-1])
            self.buffer.clear()
            self.proc.respond(line)

    async def drain(self):
        return None


class AdapterUnderTest(AndroidUIAutomator):
    async def command(self, *args):
        if args == ("get-state",):
            return b"device"
        return b"adb-ok"


def test_selector_validation_is_strict_and_bounded():
    assert validate_selector({"resourceId": "com.example:id/title", "enabled": True}) == {
        "resourceId": "com.example:id/title", "enabled": True
    }
    for selector in (
        {"xpath": "//button"}, {"text": "ok", "wait": 5},
        {"clickable": True}, {"text": ""}, {"instance": True},
        {"enabled": 1}, {"description": "x" * 501},
    ):
        with pytest.raises(ValueError):
            validate_selector(selector)


def test_dispatch_maps_selector_and_unicode_and_bounds_hierarchy():
    device = FakeDevice()
    selector = {"text": "Continue", "clickable": True}
    assert dispatch(device, {"op": "ui_exists", "selector": selector}) == {"exists": True}
    assert dispatch(device, {"op": "ui_click", "selector": selector}) == {"ok": True}
    assert dispatch(device, {"op": "ui_set_text", "selector": {"resourceId": "app:id/name"},
                            "text": "Élodie 東京"}) == {"ok": True}
    assert ("set_text", {"resourceId": "app:id/name"}, "Élodie 東京", 2.0) in device.calls
    device.xml = "<x>" + "é" * MAX_HIERARCHY_BYTES
    result = dispatch(device, {"op": "hierarchy"})
    assert result["truncated"] is True
    assert len(result["xml"].encode("utf-8")) <= MAX_HIERARCHY_BYTES


def test_worker_protocol_connects_exact_serial_and_rejects_arbitrary_operation():
    seen = []
    input_stream = io.StringIO(
        '{"id":"a","op":"connect","serial":"adb-exact"}\n'
        '{"id":"b","op":"call","method":"shell"}\n'
        '{"id":"c","op":"close"}\n'
    )
    output = io.StringIO()
    serve(input_stream, output, connect=lambda serial: seen.append(serial) or FakeDevice())
    assert seen == ["adb-exact"]
    rows = [json.loads(line) for line in output.getvalue().splitlines()]
    assert rows[0]["result"] == {"connected": True}
    assert rows[1]["error"] == "invalid_request"
    assert rows[2]["result"] == {"closed": True}


def test_missing_optional_sdk_reports_matching_connect_id():
    def no_sdk(_serial):
        raise DependencyMissing
    output = io.StringIO()
    serve(io.StringIO('{"id":"connect-7","op":"connect","serial":"s"}\n'),
          output, connect=no_sdk)
    response = json.loads(output.getvalue())
    assert response == {"id": "connect-7", "error": "dependency_missing"}


def test_adapter_uses_serial_and_validates_before_worker_or_device(monkeypatch):
    async def run():
        proc = FakeProc()
        spawn_args = []
        async def factory(*args, **kwargs):
            spawn_args.append((args, kwargs))
            return proc
        adapter = AdapterUnderTest("device-serial", process_factory=factory)
        await adapter.start()
        assert proc.requests[0]["serial"] == "device-serial"
        assert spawn_args[0][0][1:3] == ("-m", "strowger_env.uiautomator_worker")
        assert spawn_args[0][1]["limit"] > 64 * 1024
        before = len(proc.requests)
        with pytest.raises(ValueError):
            await adapter.act("ui_click", {"selector": {"xpath": "//*"}})
        assert len(proc.requests) == before
        adapter._worker = None
    asyncio.run(run())


async def _immediate(proc):
    return proc


def test_missing_element_is_controlled_and_does_not_close_worker():
    async def run():
        proc = FakeProc()
        proc.device.found = False
        adapter = AdapterUnderTest("serial", process_factory=lambda *a, **kw: _immediate(proc))
        await adapter.start()
        with pytest.raises(UIElementNotFound):
            await adapter.act("ui_click", {"selector": {"text": "Missing"}})
        assert adapter._worker is proc
        assert adapter.uncertain is False
    asyncio.run(run())


def test_observe_returns_png_and_bounded_hierarchy_together():
    async def run():
        proc = FakeProc()
        proc.device.xml = "<hierarchy><node text='visible'/></hierarchy>"
        adapter = AdapterUnderTest("serial", process_factory=lambda *a, **kw: _immediate(proc))
        await adapter.start()
        result = await adapter.act("observe", {})
        assert result == {"png_base64": "cG5n", "hierarchy_xml": proc.device.xml,
                          "hierarchy_truncated": False}
        assert [row["op"] for row in proc.requests[-2:]] == ["screenshot", "hierarchy"]
    asyncio.run(run())


def test_hierarchy_response_larger_than_default_stream_limit_is_read():
    async def run():
        proc = FakeProc()
        proc.device.xml = "x" * (100 * 1024)
        adapter = AdapterUnderTest("serial", process_factory=lambda *a, **kw: _immediate(proc))
        await adapter.start()
        response = await adapter.act("hierarchy", {})
        assert len(response["xml"]) == 100 * 1024
        assert response["truncated"] is False
    asyncio.run(run())


def test_close_stops_worker_without_starting_a_second_one():
    async def run():
        proc = FakeProc()
        spawn_count = 0
        async def factory(*args, **kwargs):
            nonlocal spawn_count
            spawn_count += 1
            return proc
        adapter = AdapterUnderTest("serial", process_factory=factory)
        await adapter.start()
        await adapter.close()
        assert spawn_count == 1
        assert adapter._worker is None
        assert proc.requests[-1]["op"] == "close"
        assert adapter.uncertain is False
    asyncio.run(run())


def test_before_start_hook_runs_before_adb_and_worker_start():
    async def run():
        events = []
        proc = FakeProc()
        async def before_start():
            events.append("boot-check")
        async def factory(*args, **kwargs):
            events.append("worker")
            return proc
        class OrderedAdapter(AdapterUnderTest):
            async def command(self, *args):
                events.append("adb")
                return b"device"
        adapter = OrderedAdapter("serial", process_factory=factory, before_start=before_start)
        await adapter.start()
        assert events == ["boot-check", "adb", "worker"]
    asyncio.run(run())


def test_real_python_worker_large_pipe_and_blocked_mutation_is_reaped(tmp_path):
    marker = tmp_path / "worker-actions.txt"
    child_code = r'''
import json, sys, time
marker = sys.argv[1]
for line in sys.stdin:
    request = json.loads(line)
    op = request.get("op")
    if op == "connect":
        result = {"connected": True}
    elif op == "hierarchy":
        result = {"xml": "x" * (100 * 1024), "truncated": False}
    elif op == "ui_click":
        with open(marker, "a", encoding="utf-8") as f:
            f.write("click-started\n")
        while True:
            time.sleep(0.05)
    elif op == "close":
        result = {"closed": True}
    else:
        result = {"ok": True}
    sys.stdout.write(json.dumps({"id": request["id"], "result": result}) + "\n")
    sys.stdout.flush()
'''
    spawned = {}
    async def factory(*_args, **kwargs):
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-u", "-c", child_code, str(marker), **kwargs,
        )
        spawned["proc"] = proc
        return proc

    async def run():
        adapter = AdapterUnderTest("real-subprocess", process_factory=factory)
        await adapter.start()
        hierarchy = await adapter.act("hierarchy", {})
        assert len(hierarchy["xml"]) == 100 * 1024
        assert hierarchy["truncated"] is False
        adapter.mutation_timeout = 0.1
        with pytest.raises(UncertainActionError):
            await adapter.act("ui_click", {"selector": {"text": "Blocked"}})
        proc = spawned["proc"]
        assert proc.returncode is not None
        assert adapter.uncertain is True
        with pytest.raises(RuntimeError, match="worker is not running"):
            await adapter.act("ui_click", {"selector": {"text": "After timeout"}})
        assert marker.read_text(encoding="utf-8").splitlines() == ["click-started"]
    asyncio.run(run())


def test_mutation_timeout_kills_and_marks_uncertain():
    async def run():
        proc = FakeProc(block_mutation=True)
        adapter = AdapterUnderTest("serial", process_factory=lambda *a, **kw: _immediate(proc))
        adapter.mutation_timeout = 0.01
        await adapter.start()
        with pytest.raises(UncertainActionError):
            await adapter.act("ui_click", {"selector": {"text": "Continue"}})
        assert adapter.uncertain is True
        assert proc.returncode == -9
        assert proc not in (adapter._worker,)
    asyncio.run(run())


def test_worker_response_id_mismatch_is_detected():
    async def run():
        proc = FakeProc(mismatch=True)
        adapter = AdapterUnderTest("serial", process_factory=lambda *a, **kw: _immediate(proc))
        await adapter.start()
        # The invalid connect response must fail startup and reap the worker.
        assert adapter._worker is None
    with pytest.raises(RuntimeError):
        asyncio.run(run())


def test_cancelled_mutation_kills_worker_and_marks_uncertain():
    async def run():
        proc = FakeProc(block_mutation=True)
        adapter = AdapterUnderTest("serial", process_factory=lambda *a, **kw: _immediate(proc))
        await adapter.start()
        task = asyncio.create_task(adapter.act("ui_set_text", {
            "selector": {"text": "Name"}, "text": "Élodie",
        }))
        while not proc.requests or proc.requests[-1]["op"] != "ui_set_text":
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(UncertainActionError):
            await task
        assert proc.returncode == -9
        assert adapter._worker is None
        assert adapter.uncertain is True
    asyncio.run(run())


def test_repeated_cancellation_still_waits_for_worker_reap():
    async def run():
        proc = SlowReapProc()
        adapter = AdapterUnderTest("serial", process_factory=lambda *a, **kw: _immediate(proc))
        await adapter.start()
        task = asyncio.create_task(adapter.act("ui_click", {"selector": {"text": "Continue"}}))
        while not proc.requests or proc.requests[-1]["op"] != "ui_click":
            await asyncio.sleep(0)
        task.cancel()
        await proc.killed_event.wait()
        task.cancel()
        with pytest.raises(UncertainActionError):
            await task
        assert proc.returncode == -9
        assert adapter._worker is None
        assert adapter.uncertain is True
    asyncio.run(run())
