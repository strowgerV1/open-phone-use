"""Cuttlefish pool adapter and bounded wrappers around Google's cvdr CLI.

The broker treats a Cuttlefish instance as an already provisioned Android
transport. A lease never creates, stops, resets, or deletes a CVD.
"""
import asyncio
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time

from .adapters import Android

CVDR_TIMEOUT_SECONDS = 180
CVDR_CREATE_MAX_COUNT = 64
BOOT_TIMEOUT_SECONDS = 120.0
BOOT_POLL_INTERVAL_SECONDS = 1.0

_CVDR_VALUE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,254}\Z")
_BUILD_ID = re.compile(r"[0-9]{1,32}\Z")


async def ensure_cuttlefish_booted(command, timeout=BOOT_TIMEOUT_SECONDS,
                                  poll_interval=BOOT_POLL_INTERVAL_SECONDS):
    """Wait for an explicit ADB transport to finish booting.

    ``command`` is an async callable with the same argv-only contract as
    ``Android.command``. Startup is bounded, retries transient ADB errors, and
    propagates task cancellation promptly.
    """
    if (not callable(command) or type(timeout) not in (int, float) or timeout <= 0
            or type(poll_interval) not in (int, float) or poll_interval <= 0):
        raise ValueError('Invalid Cuttlefish boot wait configuration')
    deadline = time.monotonic() + timeout
    while True:
        try:
            remaining = max(0.001, deadline - time.monotonic())
            state = await asyncio.wait_for(command('get-state'), timeout=remaining)
            if isinstance(state, str):
                state = state.encode()
            if state.strip() == b'device':
                remaining = max(0.001, deadline - time.monotonic())
                booted = await asyncio.wait_for(
                    command('shell', 'getprop', 'sys.boot_completed'), timeout=remaining)
                if isinstance(booted, str):
                    booted = booted.encode()
                if booted.strip() == b'1':
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            # ADB transports can appear before the guest is ready. The deadline
            # below bounds these retries and presents a stable operator error.
            pass
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('Cuttlefish ADB transport did not reach boot-complete before timeout')
        await asyncio.sleep(min(poll_interval, remaining))


class Cuttlefish(Android):
    """An already enrolled Cuttlefish transport, controlled through ADB."""

    def __init__(self, serial, boot_timeout=BOOT_TIMEOUT_SECONDS):
        super().__init__(serial)
        self.boot_timeout = boot_timeout

    async def start(self):
        await ensure_cuttlefish_booted(self.command, timeout=self.boot_timeout)


def _config_file(path):
    if not isinstance(path, (str, os.PathLike)):
        raise RuntimeError('A cvdr config file path is required')
    config = Path(path).expanduser()
    if not config.is_file():
        raise RuntimeError('The supplied cvdr config file must already exist')
    if stat.S_IMODE(config.stat().st_mode) & 0o077:
        raise RuntimeError('The cvdr config file must be private to its owner (mode 0600 or stricter)')
    return config.resolve()


def _cvdr_environment(config_path):
    config = _config_file(config_path)
    env = os.environ.copy()
    env['CVDR_USER_CONFIG_PATH'] = str(config)
    return env


def _cvdr_command(argv, config_path, runner=subprocess.run,
                  timeout=CVDR_TIMEOUT_SECONDS):
    if type(timeout) not in (int, float) or timeout <= 0:
        raise RuntimeError('cvdr timeout must be positive')
    executable = shutil.which('cvdr')
    if executable is None:
        raise RuntimeError('cvdr is not installed; see docs/CUTTLEFISH.md')
    try:
        result = runner([executable, *argv], env=_cvdr_environment(config_path),
                        capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise RuntimeError('cvdr timed out; provisioning state is unknown. Verify with strowger cuttlefish list before retrying.') from None
    except OSError:
        raise RuntimeError('cvdr could not be started; provisioning state is unknown. Verify with strowger cuttlefish list before retrying.') from None
    if result.returncode:
        # cvdr output can contain host configuration details. Keep it on the
        # operator's local terminal only when the CLI chooses to display it.
        raise RuntimeError('cvdr failed; provisioning state may be unknown. Verify with strowger cuttlefish list before retrying.')
    return result.stdout


def cvdr_list(config_path, runner=subprocess.run, timeout=CVDR_TIMEOUT_SECONDS):
    """Run the actual read-only ``cvdr list`` command for an operator."""
    return _cvdr_command(['list'], config_path, runner=runner, timeout=timeout)


def cvdr_create(config_path, host, build_id, build_target, count,
                runner=subprocess.run, timeout=CVDR_TIMEOUT_SECONDS):
    """Create a requested CVD group on an existing named host via cvdr."""
    for label, value in (('host', host), ('build target', build_target)):
        if not isinstance(value, str) or not _CVDR_VALUE.fullmatch(value):
            raise RuntimeError(f'Invalid Cuttlefish {label}')
    if not isinstance(build_id, str) or not _BUILD_ID.fullmatch(build_id):
        raise RuntimeError('A numeric, reproducible Cuttlefish build ID is required; latest is not accepted')
    if type(count) is not int or not 1 <= count <= CVDR_CREATE_MAX_COUNT:
        raise RuntimeError(f'Cuttlefish count must be between 1 and {CVDR_CREATE_MAX_COUNT}')
    argv = [
        'create',
        f'--host={host}',
        f'--build_id={build_id}',
        f'--build_target={build_target}',
        f'--num_instances={count}',
        '--auto_connect=true',
    ]
    return _cvdr_command(argv, config_path, runner=runner, timeout=timeout)


def doctor_report(runner=subprocess.run, platform_name=None, exists=Path.exists,
                  access=os.access, which=shutil.which):
    """Return local host/client diagnostics without changing the machine."""
    import platform

    name = platform_name or platform.system()
    kvm_path = Path('/dev/kvm')
    on_linux = name == 'Linux'
    kvm_exists = bool(exists(kvm_path)) if on_linux else False
    kvm_access = bool(kvm_exists and access(kvm_path, os.R_OK | os.W_OK))
    report = {
        'os': name,
        'role': 'linux_kvm_host' if on_linux else 'client_only',
        'kvm_device': kvm_exists,
        'kvm_read_write': kvm_access,
        'cvdr': {'installed': bool(which('cvdr'))},
        'adb': {'installed': bool(which('adb'))},
    }
    if not on_linux:
        report['host_status'] = 'Client possible; KVM host unavailable on this operating system.'
    elif not kvm_exists:
        report['host_status'] = 'Linux KVM device /dev/kvm is absent; this machine cannot host Cuttlefish.'
    elif not kvm_access:
        report['host_status'] = 'KVM exists but the current user lacks read/write access.'
    else:
        report['host_status'] = 'KVM host access is available.'

    adb = which('adb')
    if adb:
        try:
            version = runner([adb, 'version'], capture_output=True, text=True,
                             timeout=12, check=False)
            report['adb']['version'] = version.stdout.splitlines()[0] if version.returncode == 0 and version.stdout.splitlines() else 'unknown'
            result = runner([adb, 'devices', '-l'], capture_output=True, text=True,
                            timeout=12, check=False)
            report['adb']['status'] = 'ok' if result.returncode == 0 else 'failed'
            report['adb']['connected'] = sum(
                1 for line in result.stdout.splitlines()
                if len(line.strip().split()) >= 2
                and not line.startswith(('List of devices', '*'))
                and line.strip().split()[1] == 'device'
            ) if result.returncode == 0 else 0
        except (OSError, subprocess.TimeoutExpired):
            report['adb']['status'] = 'unavailable'
            report['adb']['connected'] = 0
            report['adb']['version'] = 'unknown'
    else:
        report['adb']['status'] = 'not_installed'
        report['adb']['connected'] = 0
        report['adb']['version'] = 'not_installed'

    cvdr = which('cvdr')
    if cvdr:
        try:
            # The pinned cvdr build is a Go executable. This asks the Go tool
            # to read its embedded module metadata and avoids guessing a cvdr
            # subcommand that might make a remote request.
            result = runner(['go', 'version', '-m', cvdr], capture_output=True,
                            text=True, timeout=12, check=False)
            report['cvdr']['version'] = result.stdout.strip().splitlines()[:2] if result.returncode == 0 else 'unknown'
        except (OSError, subprocess.TimeoutExpired):
            report['cvdr']['version'] = 'unknown'
    else:
        report['cvdr']['version'] = 'not_installed'
    return report
