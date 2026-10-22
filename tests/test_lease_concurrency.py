"""Broker lease invariants that need real asyncio overlap, without Android hardware."""

import asyncio

import httpx
import pytest
from fastapi import HTTPException

from strowger_env.adapters import Android
from strowger_env.async_client import AsyncRuntime
from strowger_env.server import Acquire, create_app


KEYS = {"alice": "a" * 32, "bob": "b" * 32}
AUTH = {owner: "Bearer " + key for owner, key in KEYS.items()}


def route(app, path, method):
    return next(r.endpoint for r in app.routes
                if getattr(r, "path", None) == path and method in getattr(r, "methods", set()))


async def acquire(app, owner="alice", device_id=None):
    body = Acquire(kind="phone", device_id=device_id)
    return await route(app, "/v1/leases", "POST")(body, authorization=AUTH[owner])


async def release(app, lease, owner="alice"):
    return await route(app, "/v1/leases/{lid}", "DELETE")(
        lease["id"], authorization=AUTH[owner], x_lease_token=lease["lease_token"])


def devices(*identifiers):
    return [{"id": ident, "serial": "SERIAL-" + ident, "owners": ["alice"]}
            for ident in identifiers]


class FakePhone:
    actions = Android.actions

    def __init__(self, serial, events=None, before_start=None):
        self.serial = serial
        self.events = events if events is not None else []
        self.before_start = before_start
        self.uncertain = False

    async def start(self):
        self.events.append("start:" + self.serial)
        if self.before_start is not None:
            await self.before_start(self.serial)

    async def act(self, action, args):
        return {"ok": True}

    async def close(self):
        self.events.append("close:" + self.serial)


def test_distinct_phone_startups_overlap_outside_allocation_lock(tmp_path):
    async def run():
        count = 0
        both_starting = asyncio.Event()

        async def barrier(_serial):
            nonlocal count
            count += 1
            if count == 2:
                both_starting.set()
            await asyncio.wait_for(both_starting.wait(), timeout=1)

        app = create_app(KEYS, audit_path=tmp_path / "audit.jsonl", capacity=2,
                         devices=devices("phone-a", "phone-b"),
                         android_factory=lambda serial: FakePhone(serial, before_start=barrier))
        left = asyncio.create_task(acquire(app, device_id="phone-a"))
        right = asyncio.create_task(acquire(app, device_id="phone-b"))
        leases = await asyncio.gather(left, right)
        assert count == 2
        assert {lease["device_id"] for lease in leases} == {"phone-a", "phone-b"}
        await asyncio.gather(*(release(app, lease) for lease in leases))

    asyncio.run(run())


def test_same_device_pending_start_is_exclusive_and_counted_against_capacity(tmp_path):
    async def run():
        starting = asyncio.Event()
        finish_start = asyncio.Event()

        async def barrier(_serial):
            starting.set()
            await finish_start.wait()

        app = create_app(KEYS, audit_path=tmp_path / "audit.jsonl", capacity=1,
                         devices=devices("phone-a", "phone-b"),
                         android_factory=lambda serial: FakePhone(serial, before_start=barrier))
        first = asyncio.create_task(acquire(app, device_id="phone-a"))
        await asyncio.wait_for(starting.wait(), timeout=1)
        with pytest.raises(HTTPException) as same_device:
            await acquire(app, device_id="phone-a")
        assert same_device.value.status_code == 409
        with pytest.raises(HTTPException) as capacity_full:
            await acquire(app, device_id="phone-b")
        assert capacity_full.value.status_code == 409
        finish_start.set()
        lease = await first
        await release(app, lease)

    asyncio.run(run())


def test_factory_error_releases_pending_slot_for_retry(tmp_path):
    calls = 0

    def factory(serial):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("factory unavailable")
        return FakePhone(serial)

    async def run():
        app = create_app(KEYS, audit_path=tmp_path / "audit.jsonl", capacity=1,
                         devices=devices("phone-a"), android_factory=factory)
        with pytest.raises(HTTPException) as failed:
            await acquire(app, device_id="phone-a")
        assert failed.value.status_code == 503
        assert app.state.leases == {}
        lease = await acquire(app, device_id="phone-a")
        assert lease["device_id"] == "phone-a"
        await release(app, lease)

    asyncio.run(run())


def test_viewer_credentials_and_release_close_viewer_before_reacquire(tmp_path, monkeypatch):
    monkeypatch.setenv("ENV_SCRCPY_ENABLED", "1")
    events = []

    class FakeViewer:
        def __init__(self, serial, device_id=None):
            self.serial, self.device_id, self.running = serial, device_id, False

        async def start(self):
            self.running = True
            events.append("viewer-start")

        async def close(self):
            events.append("viewer-close")
            self.running = False

    monkeypatch.setattr("strowger_env.scrcpy.ScrcpyViewer", FakeViewer)
    app = create_app(KEYS, audit_path=tmp_path / "audit.jsonl", capacity=1,
                     devices=devices("phone-a"),
                     android_factory=lambda serial: FakePhone(serial, events=events))

    async def run():
        lease = await acquire(app, device_id="phone-a")
        start = route(app, "/v1/leases/{lid}/viewer", "POST")
        stop = route(app, "/v1/leases/{lid}/viewer", "DELETE")
        for owner, token in (("bob", lease["lease_token"]),
                             ("alice", "incorrect-token")):
            with pytest.raises(HTTPException) as denied:
                await start(lease["id"], authorization=AUTH[owner], x_lease_token=token)
            assert denied.value.status_code == 404
            with pytest.raises(HTTPException) as denied_stop:
                await stop(lease["id"], authorization=AUTH[owner], x_lease_token=token)
            assert denied_stop.value.status_code == 404

        assert await start(lease["id"], authorization=AUTH["alice"],
                           x_lease_token=lease["lease_token"]) == {"state": "running"}
        await release(app, lease)
        assert events.index("viewer-close") < events.index("close:SERIAL-phone-a")
        assert (await acquire(app, device_id="phone-a"))["device_id"] == "phone-a"
        assert events.index("viewer-close") < max(i for i, event in enumerate(events)
                                                    if event == "start:SERIAL-phone-a")

    asyncio.run(run())


def test_async_context_releases_lease_when_body_is_cancelled(tmp_path):
    events = []
    app = create_app(KEYS, audit_path=tmp_path / "audit.jsonl", capacity=1,
                     devices=devices("phone-a"),
                     android_factory=lambda serial: FakePhone(serial, events=events))

    async def run():
        runtime = AsyncRuntime("http://test", KEYS["alice"])
        await runtime.aclose()
        runtime.http = httpx.AsyncClient(
            base_url="http://test", headers={"Authorization": AUTH["alice"]},
            transport=httpx.ASGITransport(app=app),
        )
        entered = asyncio.Event()

        async def mission():
            async with await runtime.phone.acquire(device_id="phone-a"):
                entered.set()
                await asyncio.Future()

        task = asyncio.create_task(mission())
        await asyncio.wait_for(entered.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert "close:SERIAL-phone-a" in events
        replacement = await runtime.phone.acquire(device_id="phone-a")
        await replacement.release()
        await runtime.aclose()

    asyncio.run(run())


def test_async_context_propagates_cancellation_during_release_after_cleanup(tmp_path):
    events = []
    close_started = asyncio.Event()
    allow_close = asyncio.Event()

    class SlowClosePhone(FakePhone):
        async def close(self):
            close_started.set()
            await allow_close.wait()
            await super().close()

    app = create_app(KEYS, audit_path=tmp_path / "audit.jsonl", capacity=1,
                     devices=devices("phone-a"),
                     android_factory=lambda serial: SlowClosePhone(serial, events=events))

    async def run():
        runtime = AsyncRuntime("http://test", KEYS["alice"])
        await runtime.aclose()
        runtime.http = httpx.AsyncClient(
            base_url="http://test", headers={"Authorization": AUTH["alice"]},
            transport=httpx.ASGITransport(app=app),
        )
        entered = asyncio.Event()
        leave_body = asyncio.Event()

        async def mission():
            async with await runtime.phone.acquire(device_id="phone-a"):
                entered.set()
                await leave_body.wait()

        task = asyncio.create_task(mission())
        await asyncio.wait_for(entered.wait(), timeout=1)
        leave_body.set()
        await asyncio.wait_for(close_started.wait(), timeout=1)
        task.cancel()
        await asyncio.sleep(0)
        allow_close.set()
        # Cancellation during __aexit__ must be delivered after release finishes.
        with pytest.raises(asyncio.CancelledError):
            await task
        assert "close:SERIAL-phone-a" in events
        replacement = await runtime.phone.acquire(device_id="phone-a")
        await replacement.release()
        await runtime.aclose()

    asyncio.run(run())
