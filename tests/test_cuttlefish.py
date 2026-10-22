import asyncio
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from strowger_env import cuttlefish


def private_config(path):
    path.write_text('')
    path.chmod(0o600)
    return path


def test_boot_wait_checks_adb_and_guest_boot_without_provisioning():
    calls = []
    states = iter([b'offline', b'device', b'device'])
    boots = iter([b'0', b'1'])

    async def command(*args):
        calls.append(args)
        if args == ('get-state',):
            return next(states)
        assert args == ('shell', 'getprop', 'sys.boot_completed')
        return next(boots)

    asyncio.run(cuttlefish.ensure_cuttlefish_booted(command, timeout=1, poll_interval=.001))
    assert calls == [
        ('get-state',), ('get-state',),
        ('shell', 'getprop', 'sys.boot_completed'),
        ('get-state',), ('shell', 'getprop', 'sys.boot_completed'),
    ]


def test_boot_wait_has_hard_timeout_even_if_transport_hangs():
    calls = []

    async def command(*args):
        calls.append(args)
        await asyncio.Event().wait()

    with pytest.raises(RuntimeError, match='boot-complete before timeout'):
        asyncio.run(cuttlefish.ensure_cuttlefish_booted(command, timeout=.02, poll_interval=.001))
    assert calls == [('get-state',)]


def test_boot_wait_preserves_cancellation():
    async def command(*args):
        await asyncio.Event().wait()

    async def run():
        task = asyncio.create_task(cuttlefish.ensure_cuttlefish_booted(command, timeout=10))
        await asyncio.sleep(.001)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())


def test_cuttlefish_close_only_uses_adb_and_homes():
    async def run():
        device = cuttlefish.Cuttlefish('127.0.0.1:4567', boot_timeout=1)
        calls = []

        async def command(*args):
            calls.append(args)
            if args == ('get-state',):
                return b'device'
            if args == ('shell', 'getprop', 'sys.boot_completed'):
                return b'1'
            return b''

        device.command = command
        await device.start()
        await device.close()
        assert calls.count(('get-state',)) == 2
        assert calls.count(('shell', 'getprop', 'sys.boot_completed')) == 1
        assert calls[-1] == ('shell', 'input', 'keyevent', 'KEYCODE_HOME')
        assert not any('create' in arg or 'delete' in arg for call in calls for arg in call)

    asyncio.run(run())


def test_cvdr_list_uses_config_file_and_real_cli_argv(tmp_path, monkeypatch):
    config = private_config(tmp_path / 'cvdr.toml')
    monkeypatch.setattr(cuttlefish.shutil, 'which', lambda name: '/usr/bin/cvdr' if name == 'cvdr' else None)
    calls = []

    def runner(argv, **kwargs):
        calls.append((argv, kwargs))
        return SimpleNamespace(returncode=0, stdout='Host: lab\n', stderr='')

    assert cuttlefish.cvdr_list(config, runner=runner) == 'Host: lab\n'
    argv, kwargs = calls[0]
    assert argv == ['/usr/bin/cvdr', 'list']
    assert kwargs['env']['CVDR_USER_CONFIG_PATH'] == str(config.resolve())
    assert kwargs['timeout'] == cuttlefish.CVDR_TIMEOUT_SECONDS
    assert kwargs['capture_output'] is True
    assert kwargs['text'] is True


def test_cvdr_create_uses_explicit_official_flags_and_bounded_count(tmp_path, monkeypatch):
    config = private_config(tmp_path / 'cvdr.toml')
    monkeypatch.setattr(cuttlefish.shutil, 'which', lambda _: '/usr/bin/cvdr')
    calls = []

    def runner(argv, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0, stdout='created by cvdr', stderr='')

    assert cuttlefish.cvdr_create(config, 'farm-1', '12345678',
                                  'aosp_cf_x86_64_phone-userdebug', 3,
                                  runner=runner) == 'created by cvdr'
    assert calls == [[
        '/usr/bin/cvdr', 'create', '--host=farm-1', '--build_id=12345678',
        '--build_target=aosp_cf_x86_64_phone-userdebug', '--num_instances=3',
        '--auto_connect=true',
    ]]
    for count in (0, 65, True):
        with pytest.raises(RuntimeError, match='count must be'):
            cuttlefish.cvdr_create(config, 'farm-1', '12345678', 'target', count,
                                   runner=runner)
    assert len(calls) == 1


@pytest.mark.parametrize('field,value', [
    ('host', '-flag'), ('host', 'bad host'), ('build_id', 'latest'),
    ('build_target', ''),
])
def test_cvdr_create_refuses_invalid_or_non_reproducible_inputs(tmp_path, monkeypatch, field, value):
    config = private_config(tmp_path / 'cvdr.toml')
    monkeypatch.setattr(cuttlefish.shutil, 'which', lambda _: '/usr/bin/cvdr')
    kwargs = {'host': 'farm-1', 'build_id': '12345678', 'build_target': 'target'}
    kwargs[field] = value
    with pytest.raises(RuntimeError):
        cuttlefish.cvdr_create(config, **kwargs, count=1,
                               runner=lambda *a, **k: pytest.fail('cvdr must not run'))


def test_cvdr_requires_existing_config_and_does_not_guess_default(tmp_path, monkeypatch):
    monkeypatch.setattr(cuttlefish.shutil, 'which', lambda _: '/usr/bin/cvdr')
    with pytest.raises(RuntimeError, match='must already exist'):
        cuttlefish.cvdr_list(tmp_path / 'missing.toml', runner=lambda *a, **k: None)
    with pytest.raises(RuntimeError, match='path is required'):
        cuttlefish.cvdr_list(None, runner=lambda *a, **k: None)
    unsafe = tmp_path / 'public.toml'
    unsafe.write_text('')
    unsafe.chmod(0o644)
    with pytest.raises(RuntimeError, match='mode 0600 or stricter'):
        cuttlefish.cvdr_list(unsafe, runner=lambda *a, **k: None)


@pytest.mark.parametrize('failure,expected', [
    ('timeout', 'provisioning state is unknown'),
    ('returncode', 'provisioning state may be unknown'),
])
def test_cvdr_create_errors_do_not_claim_failure_cleanup_or_retry(tmp_path, monkeypatch, failure, expected):
    config = private_config(tmp_path / 'cvdr.toml')
    monkeypatch.setattr(cuttlefish.shutil, 'which', lambda _: '/usr/bin/cvdr')
    calls = []

    def runner(*args, **kwargs):
        calls.append(args[0])
        if failure == 'timeout':
            raise subprocess.TimeoutExpired(args[0], kwargs['timeout'])
        return SimpleNamespace(returncode=1, stdout='', stderr='secret details')

    with pytest.raises(RuntimeError, match=expected) as error:
        cuttlefish.cvdr_create(config, 'farm-1', '12345678', 'target', 1, runner=runner)
    assert 'secret details' not in str(error.value)
    assert len(calls) == 1


def test_cvdr_missing_executable_is_clear(tmp_path, monkeypatch):
    config = private_config(tmp_path / 'cvdr.toml')
    monkeypatch.setattr(cuttlefish.shutil, 'which', lambda _: None)
    with pytest.raises(RuntimeError, match='cvdr is not installed'):
        cuttlefish.cvdr_list(config)


def test_doctor_distinguishes_mac_client_from_linux_kvm_host():
    result = cuttlefish.doctor_report(platform_name='Darwin', which=lambda _: None)
    assert result['role'] == 'client_only'
    assert result['kvm_device'] is False
    assert result['host_status'].startswith('Client possible')
    assert result['adb']['status'] == 'not_installed'
    assert result['cvdr']['version'] == 'not_installed'


def test_doctor_reports_linux_kvm_access_and_actual_adb_state():
    def which(name):
        return {'adb': '/usr/bin/adb', 'cvdr': '/usr/bin/cvdr'}.get(name)

    def runner(argv, **kwargs):
        if argv[-1] == 'version':
            return SimpleNamespace(returncode=0, stdout='Android Debug Bridge version 1.0.41\n', stderr='')
        if argv[-2:] == ['devices', '-l']:
            return SimpleNamespace(returncode=0, stdout='List of devices attached\nserial device model:Pixel\n', stderr='')
        return SimpleNamespace(returncode=0, stdout='go version -m /usr/bin/cvdr\n\tdep\tgoogle/...\tv0.0.0\n', stderr='')

    report = cuttlefish.doctor_report(runner=runner, platform_name='Linux',
                                      exists=lambda path: str(path) == '/dev/kvm',
                                      access=lambda path, mode: True, which=which)
    assert report['role'] == 'linux_kvm_host'
    assert report['kvm_read_write'] is True
    assert report['adb']['connected'] == 1
    assert report['adb']['version'].startswith('Android Debug Bridge')
    assert report['cvdr']['version'][0].startswith('go version')
    assert report['host_status'] == 'KVM host access is available.'
