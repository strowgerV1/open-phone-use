"""Private JSON-lines worker for the optional uiautomator2 SDK.

This module is deliberately a narrow protocol endpoint. It never accepts a
Python method name, XPath expression, shell command, or arbitrary SDK kwargs.
"""

from __future__ import annotations

import base64
import json
import logging
import sys
from typing import Any, Callable, TextIO

MAX_LINE_BYTES = 12 * 1024 * 1024
MAX_HIERARCHY_BYTES = 256 * 1024
MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
SELECTOR_FIELDS = {
    "resourceId", "text", "description", "className", "packageName",
    "clickable", "enabled", "instance",
}
MEANINGFUL_SELECTOR_FIELDS = SELECTOR_FIELDS - {"clickable", "enabled"}
SELECTOR_TIMEOUT_SECONDS = 2.0


class InvalidRequest(ValueError):
    pass


class ElementNotFound(ValueError):
    pass


class DependencyMissing(RuntimeError):
    pass


def validate_selector(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not value:
        raise InvalidRequest("selector must be a non-empty object")
    if set(value) - SELECTOR_FIELDS:
        raise InvalidRequest("selector contains unsupported fields")
    if not (set(value) & MEANINGFUL_SELECTOR_FIELDS):
        raise InvalidRequest("selector needs a text, id, description, class, package, or instance")
    result: dict[str, Any] = {}
    for key, item in value.items():
        if key in ("clickable", "enabled"):
            if type(item) is not bool:
                raise InvalidRequest(f"selector {key} must be boolean")
        elif key == "instance":
            if type(item) is not int or not 0 <= item <= 1000:
                raise InvalidRequest("selector instance must be an integer from 0 to 1000")
        elif not isinstance(item, str) or not item or len(item) > 500:
            raise InvalidRequest(f"selector {key} must be a non-empty string of at most 500 characters")
        result[key] = item
    return result


def _png_bytes(image: Any) -> bytes:
    """Encode the Pillow image returned by uiautomator2 without a temp file."""
    import io

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def dispatch(device: Any, request: dict[str, Any]) -> dict[str, Any]:
    """Execute one allowlisted request against a device-like SDK double."""
    op = request.get("op")
    if op == "hierarchy":
        xml = device.dump_hierarchy()
        if not isinstance(xml, str):
            raise RuntimeError("SDK returned invalid hierarchy")
        raw = xml.encode("utf-8")
        truncated = len(raw) > MAX_HIERARCHY_BYTES
        if truncated:
            raw = raw[:MAX_HIERARCHY_BYTES]
            xml = raw.decode("utf-8", errors="ignore")
        return {"xml": xml, "truncated": truncated}
    if op == "screenshot":
        image = device.screenshot()
        png = _png_bytes(image)
        if len(png) > MAX_SCREENSHOT_BYTES:
            raise ValueError("screenshot exceeds size limit")
        return {"png_base64": base64.b64encode(png).decode("ascii")}
    if op == "ui_exists":
        selector = validate_selector(request.get("selector"))
        found = bool(device(**selector).wait(timeout=SELECTOR_TIMEOUT_SECONDS))
        return {"exists": found}
    if op in ("ui_click", "ui_set_text"):
        selector = validate_selector(request.get("selector"))
        target = device(**selector)
        if op == "ui_click":
            target.click(timeout=SELECTOR_TIMEOUT_SECONDS)
            return {"ok": True}
        text = request.get("text")
        if not isinstance(text, str) or not 1 <= len(text) <= 2000:
            raise InvalidRequest("text must contain 1 to 2000 characters")
        target.set_text(text, timeout=SELECTOR_TIMEOUT_SECONDS)
        return {"ok": True}
    raise InvalidRequest("unsupported UIAutomator operation")


def _is_missing_element(error: BaseException) -> bool:
    # Import lazily so importing strowger_env remains possible without the extra.
    try:
        from uiautomator2.exceptions import UiObjectNotFoundError

        return isinstance(error, UiObjectNotFoundError)
    except ImportError:
        return False


def _sdk_connect(serial: str):
    try:
        import uiautomator2 as u2
    except ImportError as exc:
        raise DependencyMissing from exc
    return u2.connect(serial)


def _write(output: TextIO, message: dict[str, Any]) -> None:
    encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_LINE_BYTES:
        encoded = json.dumps({"id": message.get("id"), "error": "response_too_large"})
    output.write(encoded + "\n")
    output.flush()


def serve(input_stream: TextIO | None = None, output_stream: TextIO | None = None,
          connect: Callable[[str], Any] | None = None) -> None:
    """Run one connection until EOF or an explicit close request."""
    input_stream = input_stream or sys.stdin
    output_stream = output_stream or sys.stdout
    # Keep all SDK/library output away from the machine-readable protocol pipe.
    if output_stream is sys.stdout:
        sys.stdout = sys.stderr
    logging.disable(logging.CRITICAL)
    if connect is None:
        connect = _sdk_connect

    device = None
    for raw_line in input_stream:
        request_id = None
        if len(raw_line.encode("utf-8")) > MAX_LINE_BYTES:
            _write(output_stream, {"id": None, "error": "request_too_large"})
            continue
        try:
            request = json.loads(raw_line)
            if not isinstance(request, dict) or not isinstance(request.get("id"), (str, int)):
                raise InvalidRequest("invalid request envelope")
            request_id = request["id"]
            if request.get("op") == "connect":
                serial = request.get("serial")
                if not isinstance(serial, str) or not serial or len(serial) > 256:
                    raise InvalidRequest("invalid serial")
                try:
                    device = connect(serial)
                except DependencyMissing:
                    _write(output_stream, {"id": request_id, "error": "dependency_missing"})
                    break
                _write(output_stream, {"id": request_id, "result": {"connected": True}})
                continue
            if request.get("op") == "close":
                if device is not None:
                    # The SDK's stop method kills its owned local adb process and
                    # waits up to ten seconds for the device service to exit.
                    device.stop_uiautomator(wait=True)
                    device = None
                _write(output_stream, {"id": request_id, "result": {"closed": True}})
                break
            if device is None:
                raise InvalidRequest("worker is not connected")
            result = dispatch(device, request)
            _write(output_stream, {"id": request_id, "result": result})
        except InvalidRequest as error:
            _write(output_stream, {"id": request_id, "error": "invalid_request", "message": str(error)[:200]})
        except DependencyMissing:
            _write(output_stream, {"id": request_id, "error": "dependency_missing"})
            break
        except BaseException as error:
            if _is_missing_element(error):
                _write(output_stream, {"id": request_id, "error": "element_not_found"})
            else:
                # SDK messages can include selectors/device details; only expose
                # a generic code to the parent process.
                _write(output_stream, {"id": request_id, "error": "sdk_error"})


if __name__ == "__main__":
    serve()
