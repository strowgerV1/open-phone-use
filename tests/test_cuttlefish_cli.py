import json
import os
from pathlib import Path

import pytest

from strowger_env import cli, cuttlefish


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    for name in tuple(os.environ):
        if name.startswith('ENV_'):
            monkeypatch.delenv(name, raising=False)


def test_cuttlefish_doctor_exit_and_report_match_mac_client_and_linux_host(monkeypatch, capsys):
    actual_doctor = cuttlefish.doctor_report
    mac = actual_doctor(platform_name='Darwin', which=lambda _: None)
    monkeypatch.setattr(cuttlefish, 'doctor_report', lambda: mac)
    assert cli.main(['cuttlefish', 'doctor']) == 2
    report = json.loads(capsys.readouterr().out)
    assert report['role'] == 'client_only'
    assert report['kvm_read_write'] is False
    assert report['host_status'].startswith('Client possible')

    linux = actual_doctor(platform_name='Linux',
                          exists=lambda path: path == Path('/dev/kvm'),
                          access=lambda _path, _mode: True,
                          which=lambda _: None)
    monkeypatch.setattr(cuttlefish, 'doctor_report', lambda: linux)
    assert cli.main(['cuttlefish', 'doctor']) == 0
    report = json.loads(capsys.readouterr().out)
    assert report['role'] == 'linux_kvm_host'
    assert report['kvm_read_write'] is True
    assert report['host_status'] == 'KVM host access is available.'


def test_cuttlefish_cli_forwards_list_and_create_arguments(monkeypatch, capsys):
    calls = []

    def list_pool(config):
        calls.append(('list', config))
        return 'Host: existing-host'

    def create_pool(config, host, build_id, build_target, count):
        calls.append(('create', config, host, build_id, build_target, count))
        return 'created group from cvdr'

    monkeypatch.setattr(cuttlefish, 'cvdr_list', list_pool)
    monkeypatch.setattr(cuttlefish, 'cvdr_create', create_pool)
    config = '/private/cvdr.toml'
    assert cli.main(['cuttlefish', 'list', '--config', config]) == 0
    assert capsys.readouterr().out == 'Host: existing-host\n'
    assert cli.main(['cuttlefish', 'create', '--config', config,
                     '--host', 'existing-host', '--build-id', '12345678',
                     '--build-target', 'aosp_cf_x86_64_phone-userdebug',
                     '--count', '3']) == 0
    assert capsys.readouterr().out == 'created group from cvdr\n'
    assert calls == [
        ('list', config),
        ('create', config, 'existing-host', '12345678',
         'aosp_cf_x86_64_phone-userdebug', 3),
    ]


def test_cuttlefish_cli_reports_helper_errors_as_operator_failure(monkeypatch, capsys):
    monkeypatch.setattr(cuttlefish, 'cvdr_list',
                        lambda _config: (_ for _ in ()).throw(RuntimeError('cvdr error')))
    assert cli.main(['cuttlefish', 'list', '--config', '/private/cvdr.toml']) == 2
    output = capsys.readouterr()
    assert 'Erreur : cvdr error' in output.err
    assert output.out == ''


def test_enroll_cuttlefish_writes_explicit_provider_metadata_and_uia_backend(monkeypatch, capsys):
    keys = {'client-a': 'a' * 32}
    monkeypatch.setenv('ENV_API_KEYS', json.dumps(keys))
    monkeypatch.setenv('ENV_CAPACITY', '6')
    inventory = Path('data/fleet.json')
    inventory.parent.mkdir()
    inventory.write_text('[]')
    monkeypatch.setenv('ENV_ANDROID_DEVICES_FILE', str(inventory))
    monkeypatch.setattr(cli, 'adb_devices', lambda: [
        {'serial': '127.0.0.1:33975', 'state': 'device', 'model': None},
        {'serial': '127.0.0.1:33976', 'state': 'device', 'model': None},
    ])
    app_calls = []
    monkeypatch.setattr('strowger_env.server.create_app',
                        lambda **kwargs: app_calls.append(kwargs))

    assert cli.main(['enroll', '--provider', 'cuttlefish',
                     '--automation', 'uiautomator2', '--owner', 'client-a',
                     '--serial', '127.0.0.1:33975', '--host', 'cvd-host-01',
                     '--group', 'test-group', '--instance', 'cvd-1']) == 0
    registered = json.loads(inventory.read_text())
    assert registered == [{
        'id': 'phone-01', 'serial': '127.0.0.1:33975', 'owners': ['client-a'],
        'provider': 'cuttlefish', 'automation': 'uiautomator2',
        'cuttlefish': {'host': 'cvd-host-01', 'group': 'test-group', 'instance': 'cvd-1'},
    }]
    assert inventory.stat().st_mode & 0o777 == 0o600
    assert len(app_calls) == 2
    assert app_calls[-1]['devices'] == registered
    assert 'phone-02' not in capsys.readouterr().out


def test_enroll_requires_explicit_connected_serial_for_cuttlefish(monkeypatch, capsys):
    monkeypatch.setenv('ENV_API_KEYS', json.dumps({'client-a': 'a' * 32}))
    monkeypatch.setenv('ENV_CAPACITY', '6')
    inventory = Path('data/fleet.json')
    inventory.parent.mkdir()
    inventory.write_text('[]')
    monkeypatch.setenv('ENV_ANDROID_DEVICES_FILE', str(inventory))
    monkeypatch.setattr(cli, 'adb_devices', lambda: [
        {'serial': '127.0.0.1:33975', 'state': 'device', 'model': None},
    ])
    app_calls = []
    monkeypatch.setattr('strowger_env.server.create_app',
                        lambda **kwargs: app_calls.append(kwargs))

    assert cli.main(['enroll', '--provider', 'cuttlefish', '--owner', 'client-a']) == 2
    output = capsys.readouterr()
    assert 'explicit --serial' in output.err
    assert json.loads(inventory.read_text()) == []
    assert len(app_calls) == 1


def test_enroll_rejects_invalid_automation_and_unknown_serial(monkeypatch, capsys):
    with pytest.raises(SystemExit) as error:
        cli.main(['enroll', '--automation', 'unsupported'])
    assert error.value.code == 2

    monkeypatch.setenv('ENV_API_KEYS', json.dumps({'client-a': 'a' * 32}))
    monkeypatch.setenv('ENV_CAPACITY', '6')
    inventory = Path('data/fleet.json')
    inventory.parent.mkdir()
    inventory.write_text('[]')
    monkeypatch.setenv('ENV_ANDROID_DEVICES_FILE', str(inventory))
    monkeypatch.setattr(cli, 'adb_devices', lambda: [
        {'serial': '127.0.0.1:33975', 'state': 'offline', 'model': None},
    ])
    assert cli.main(['enroll', '--provider', 'cuttlefish', '--owner', 'client-a',
                     '--serial', '127.0.0.1:33975']) == 2
    assert 'not authorized and connected' in capsys.readouterr().err
    assert json.loads(inventory.read_text()) == []


def test_prepare_script_resolves_relative_build_paths_before_changing_directory():
    script = (Path(__file__).resolve().parents[1] / 'scripts' /
              'prepare-cuttlefish-host.sh').read_text()
    canonicalize = script.index('invocation_dir="$(pwd -P)"')
    change_directory = script.index('cd "$source_dir"')
    assert canonicalize < change_directory
    assert 'source_dir="$invocation_dir/$source_dir"' in script
    assert 'go_dir="$invocation_dir/$go_dir"' in script
    assert 'bin_dir="$invocation_dir/$bin_dir"' in script
