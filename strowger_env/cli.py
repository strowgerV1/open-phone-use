"""Local operator tools. Discovery is read-only; smoke is an explicit device test."""
import argparse
import base64
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile

from .config import load_env, load_inventory, read_capacity


def private_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as f:
        tmp = Path(f.name)
        json.dump(value, f, indent=2)
        f.write('\n')
    try:
        os.replace(tmp, path)
        path.chmod(0o600)
    finally:
        tmp.unlink(missing_ok=True)


def keys():
    try:
        result = json.loads(os.environ.get('ENV_API_KEYS', '{}'))
    except ValueError:
        raise RuntimeError('Invalid ENV_API_KEYS; run strowger init') from None
    if (not isinstance(result, dict) or not result
        or any(not isinstance(k, str) or not isinstance(v, str) or len(v) < 24 for k, v in result.items())
        or len(set(result.values())) != len(result)):
        raise RuntimeError('Valid distinct API keys required; run strowger init')
    return result


def inventory_path():
    return Path(os.environ.get('ENV_ANDROID_DEVICES_FILE', 'data/fleet.json'))


def adb_devices():
    exe = shutil.which('adb')
    if not exe:
        raise RuntimeError('ADB absent. Install Android SDK Platform Tools, then retry.')
    try:
        r = subprocess.run([exe, 'devices', '-l'], capture_output=True, text=True, timeout=12)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('ADB did not respond within 12 seconds') from None
    if r.returncode:
        raise RuntimeError('ADB device discovery failed')
    devices = []
    for raw in r.stdout.splitlines():
        words = raw.strip().split()
        if len(words) < 2 or raw.startswith(('List of devices', '*')):
            continue
        serial, state = words[:2]
        model = next((w[6:] for w in words[2:] if w.startswith('model:')), None)
        if state not in ('device', 'offline', 'unauthorized', 'recovery', 'sideload', 'bootloader', 'no'):
            continue
        devices.append({'serial': serial, 'state': state, 'model': model})
    return devices


def initialize(args):
    read_capacity(args.capacity)
    env_path = Path(args.env_file)
    env_path.parent.mkdir(parents=True, exist_ok=True)
    if not env_path.exists():
        key = secrets.token_urlsafe(32)
        content = ("ENV_API_KEYS='" + json.dumps({'alice': key}) + "'\n"
                   + "ENV_CLIENT_KEY='" + key + "'\n"
                   + f"ENV_CAPACITY='{args.capacity}'\n"
                   + "ENV_ANDROID_DEVICES_FILE='data/fleet.json'\n")
        fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(content)
    else:
        # Preserve all existing keys and operator configuration.
        existing = env_path.read_text()
        additions = []
        if not any(line.startswith('ENV_CAPACITY=') for line in existing.splitlines()):
            additions.append(f"ENV_CAPACITY='{args.capacity}'")
        if not any(line.startswith(('ENV_ANDROID_DEVICES=', 'ENV_ANDROID_DEVICES_FILE=', 'ENV_ANDROID_SERIAL=')) for line in existing.splitlines()):
            additions.append("ENV_ANDROID_DEVICES_FILE='data/fleet.json'")
        if additions:
            with env_path.open('a') as f:
                f.write('\n' + '\n'.join(additions) + '\n')
        env_path.chmod(0o600)
    load_env(env_path)
    path = inventory_path()
    if not path.exists():
        private_json(path, [])
    print(f'Configuration locale prête : {env_path}, capacité {read_capacity()}, inventaire {path}.')
    print('Clés conservées privées. Aucun téléphone enregistré ou piloté automatiquement.')
    return 0


def doctor(args):
    checks = {}
    try:
        configured = keys()
        checks['credentials'] = 'ok'
        entries = load_inventory(configured)
        # Validate through the same broker configuration without starting providers.
        from .server import create_app
        create_app(keys=configured, devices=entries)
        checks['inventory'] = {'configured': len(entries), 'path': str(inventory_path())}
    except (RuntimeError, ValueError, OSError):
        checks['credentials_or_inventory'] = 'invalid_or_missing'
        entries = []
    checks['capacity'] = read_capacity()
    checks['adb_installed'] = bool(shutil.which('adb'))
    try:
        from importlib.metadata import version
        checks['uiautomator2'] = version('uiautomator2')
    except Exception:
        checks['uiautomator2'] = None
    scrcpy = shutil.which('scrcpy')
    checks['scrcpy'] = None
    if scrcpy:
        try:
            result = subprocess.run([scrcpy, '--version'], capture_output=True, text=True, timeout=5)
            checks['scrcpy'] = result.stdout.strip().splitlines()[0][:120] if result.returncode == 0 else 'installed_version_unknown'
        except (OSError, subprocess.TimeoutExpired): checks['scrcpy'] = 'installed_version_unknown'
    try:
        connected = adb_devices()
        checks['adb'] = 'ok'
    except RuntimeError as e:
        connected = []
        checks['adb'] = str(e)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            checks['chromium_installed'] = Path(p.chromium.executable_path).exists()
    except Exception:
        checks['chromium_installed'] = False
    authorized = {d['serial'] for d in connected if d['state'] == 'device'}
    checks['connected'] = connected  # Local operator only; never returned by the public API.
    checks['registered_online'] = [d['id'] for d in entries if d['serial'] in authorized]
    checks['software_ready'] = ('credentials_or_inventory' not in checks and checks['adb'] == 'ok' and checks['chromium_installed'])
    checks['hardware_ready'] = bool(checks['registered_online'])
    print(json.dumps(checks, indent=2, ensure_ascii=False))
    if not checks['software_ready'] or (args.require_devices and not checks['hardware_ready']):
        return 2
    return 0


def enroll(args):
    configured = keys()
    if args.owner not in configured:
        raise RuntimeError('Owner is not present in ENV_API_KEYS')
    if 'ENV_ANDROID_DEVICES' in os.environ or 'ENV_ANDROID_SERIAL' in os.environ:
        raise RuntimeError('Use file inventory for enrollment; remove legacy/inline inventory from the local configuration first')
    current = load_inventory(configured) if 'ENV_ANDROID_DEVICES_FILE' in os.environ else []
    from .server import create_app
    create_app(keys=configured, devices=current)
    connected = [d for d in adb_devices() if d['state'] == 'device']
    if args.serial:
        wanted = set(args.serial)
        if not wanted.issubset({d['serial'] for d in connected}):
            raise RuntimeError('A selected serial is not authorized and connected in ADB')
        connected = [d for d in connected if d['serial'] in wanted]
    limit = read_capacity() if args.limit is None else args.limit
    read_capacity(limit)
    serials = {d['serial'] for d in current}
    ids = {d['id'] for d in current}
    added, updated = [], []
    if args.provider == 'cuttlefish' and not args.serial:
        raise RuntimeError('Cuttlefish enrollment requires an explicit --serial')
    for d in sorted(connected, key=lambda x: x['serial']):
        existing = next((item for item in current if item['serial'] == d['serial']), None)
        if existing:
            if not args.update:
                continue
            if existing['owners'] != [args.owner]:
                raise RuntimeError('Updating automation requires a device dedicated to the selected owner')
            existing['provider'], existing['automation'] = args.provider, args.automation
            if args.provider == 'cuttlefish':
                meta = {key:value for key,value in [('host',args.host),('group',args.group),('instance',args.instance)] if value}
                if meta: existing['cuttlefish'] = meta
                else: existing.pop('cuttlefish', None)
            else:
                existing.pop('cuttlefish', None)
            updated.append(existing['id'])
            continue
        if len(current) >= limit:
            continue
        n = 1
        while f'phone-{n:02}' in ids:
            n += 1
        entry = {'id': f'phone-{n:02}', 'serial': d['serial'], 'owners': [args.owner]}
        if args.provider != 'physical' or args.automation != 'adb':
            entry.update(provider=args.provider, automation=args.automation)
        if args.provider == 'cuttlefish':
            meta = {key:value for key,value in [('host',args.host),('group',args.group),('instance',args.instance)] if value}
            if meta: entry['cuttlefish'] = meta
        current.append(entry)
        serials.add(entry['serial']); ids.add(entry['id']); added.append(entry['id'])
    create_app(keys=configured, devices=current)
    private_json(inventory_path(), current)
    print(json.dumps({'added': added, 'updated': updated, 'registered': len(current), 'authorized_connected': len(connected),
                      'note': 'Existing IDs and ACL preserved. Restart the broker after enrollment.'}, indent=2))
    return 0 if connected else 2


def reconcile(args):
    """Operator attestation that a quarantined device was physically checked."""
    if not args.confirm_inspected:
        raise RuntimeError('Add --confirm-inspected only after physically checking this device and its broker')
    import fcntl
    lock_path = Path('data/broker.lock')
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        try: fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Stop the broker before reconciling its quarantine registry') from None
        audit_path = Path(os.environ.get('ENV_AUDIT_PATH', 'data/audit.jsonl'))
        path = Path(os.environ.get('ENV_QUARANTINE_PATH', str(audit_path.with_name('uncertain-devices.json'))))
        try: entries = json.loads(path.read_text()) if path.exists() else {}
        except (OSError, ValueError): raise RuntimeError('Cannot read quarantine registry') from None
        if args.device_id not in entries:
            raise RuntimeError('Device is not present in the uncertain-action quarantine')
        entries.pop(args.device_id)
        private_json(path, entries)
        print(json.dumps({'device_id': args.device_id, 'status': 'operator_reconciled',
                          'note': 'Quarantine cleared after operator inspection; this does not undo a past action.'}, indent=2))
    return 0


def cuttlefish(args):
    from .cuttlefish import cvdr_list, cvdr_create, doctor_report
    if args.cuttlefish_command == 'doctor':
        report = doctor_report()
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if report.get('kvm_read_write') else 2
    if args.cuttlefish_command == 'list':
        result = cvdr_list(args.config)
    else:
        result = cvdr_create(args.config, args.host, args.build_id, args.build_target, args.count)
    print(result if isinstance(result, str) else json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def serve(args):
    if args.capacity is not None:
        os.environ['ENV_CAPACITY'] = str(read_capacity(args.capacity))
    import fcntl
    import time
    import threading
    import webbrowser
    lock_path = Path('data/broker.lock')
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Un broker utilise déjà ce banc. Arrêtez-le avant de relancer.') from None
        from .server import create_app
        bootstrap = None
        if args.open:
            configured = keys()
            selected = args.owner or ('alice' if 'alice' in configured else next(iter(configured)))
            if selected not in configured:
                raise RuntimeError('Owner is not present in ENV_API_KEYS')
            bootstrap = {'code': secrets.token_urlsafe(32), 'owner': selected, 'expires': time.monotonic()+120}
        app = create_app(console_bootstrap=bootstrap)
        url = f'http://127.0.0.1:{args.port}'
        print(f'Console locale : {url}/ · API : {url}/docs · capacité {read_capacity()}')
        if bootstrap:
            # Fragment never enters HTTP requests or access logs; cleared by the browser.
            launch_url = url + '/#connect=' + bootstrap['code']
            threading.Timer(1.5, lambda: webbrowser.open(launch_url)).start()
        import uvicorn
        uvicorn.run(app, host='127.0.0.1', port=args.port)
    return 0


def smoke(args):
    from .client import Runtime
    read_capacity(args.limit)
    configured = keys()
    if args.owner not in configured:
        raise RuntimeError('Owner is not present in ENV_API_KEYS')
    # The configured local key authenticates this intentional operator test.
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'limit': args.limit,
              'device_tests': [], 'cleanup': [], 'status': 'failed'}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + secrets.token_hex(3)
    directory = Path(args.output) / stamp
    directory.mkdir(parents=True, mode=0o700)
    leases = []
    try:
        with Runtime(args.url, configured[args.owner]) as runtime:
            available = [d for d in runtime.devices() if d['state'] == 'available'][:args.limit]
            if not available:
                raise RuntimeError('No registered Android is available; no hardware action performed')
            try:
                # Hold all leases together: this tests the allocation of up to six devices.
                for d in available:
                    l = runtime.phone.acquire(device_id=d['id'], ttl=180)
                    leases.append((d['id'], l))
                for device_id, l in leases:
                    l.act('key', key='HOME')
                    data = base64.b64decode(l.act('screenshot')['png_base64'], validate=True)
                    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
                        raise RuntimeError('A provider returned an invalid screenshot')
                    path = directory / (device_id + '.png')
                    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, 'wb') as f:
                        f.write(data)
                    report['device_tests'].append({'device_id': device_id, 'home': True,
                        'capture': path.name, 'png_bytes': len(data), 'status': 'passed'})
                report['status'] = 'passed'
            finally:
                for device_id, l in reversed(leases):
                    try:
                        result = l.release()
                        state = result.get('state', 'unknown')
                        report['cleanup'].append({'device_id': device_id, 'state': state})
                        if state not in ('released', 'expired'):
                            report['status'] = 'failed'
                    except Exception:
                        report['cleanup'].append({'device_id': device_id, 'state': 'failed_or_quarantined'})
                        report['status'] = 'failed'
    except Exception as e:
        # Do not stringify HTTP/provider exceptions: they may contain returned content.
        report['status'] = 'failed'
        report['error'] = str(e) if isinstance(e, RuntimeError) else type(e).__name__
    private_json(directory / 'report.json', report)
    print(json.dumps({'status': report['status'], 'tested': len(report['device_tests']),
                      'report': str(directory / 'report.json')}, indent=2))
    return 0 if report['status'] == 'passed' else 2


def prepare_desktop(args):
    if not shutil.which('docker'):
        raise RuntimeError('Docker absent. Installer et démarrer Docker Desktop, puis réessayer.')
    context = Path('docker/desktop')
    if not (context / 'Dockerfile').is_file():
        raise RuntimeError('Lancer cette commande depuis le dossier du projet contenant docker/desktop.')
    result = subprocess.run(['docker','build','-t','strowger-desktop:0.1.0',str(context)])
    if result.returncode:
        raise RuntimeError('Construction Docker échouée ; configuration conservée.')
    env_path = Path(args.env_file)
    if not env_path.is_file():
        raise RuntimeError('Lancer strowger init avant de préparer le desktop.')
    lines=[line for line in env_path.read_text().splitlines()
           if not re.match(r'(?:export\s+)?ENV_DESKTOP_(?:ENABLED|IMAGE)\s*=',line.strip())]
    env_path.write_text('\n'.join(lines)+"\nENV_DESKTOP_ENABLED='1'\nENV_DESKTOP_IMAGE='strowger-desktop:0.1.0'\n")
    env_path.chmod(0o600)
    print('Desktop Linux prêt. Redémarrer le broker pour activer la réservation dans la console.')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description='STROWGER local pilot tools')
    parser.add_argument('--env-file', default='.env')
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('init', help='Create local credentials and an empty fleet once')
    p.add_argument('--capacity', type=int, default=6)
    p = sub.add_parser('doctor', help='Read-only software/USB inventory diagnostic')
    p.add_argument('--require-devices', action='store_true')
    p = sub.add_parser('enroll', help='Register authorized connected Androids, without controlling them')
    p.add_argument('--owner', default='alice'); p.add_argument('--serial', action='append')
    p.add_argument('--limit', type=int)
    p.add_argument('--provider', choices=('physical','cuttlefish'), default='physical')
    p.add_argument('--automation', choices=('adb','uiautomator2'), default='adb')
    p.add_argument('--host'); p.add_argument('--group'); p.add_argument('--instance')
    p.add_argument('--update', action='store_true', help='Explicitly update backend metadata of an enrolled dedicated phone')
    p = sub.add_parser('serve', help='Start one local broker')
    p.add_argument('--capacity', type=int); p.add_argument('--port', type=int, default=8876)
    p.add_argument('--open', action='store_true', help='Open console with a one-time local connection code')
    p.add_argument('--owner', help='Console owner (default alice, otherwise first configured owner)')
    sub.add_parser('desktop', help='Build and enable the Linux desktop locally')
    p = sub.add_parser('reconcile', help='Operator-only: clear a device quarantine after physical inspection')
    p.add_argument('--device-id', required=True); p.add_argument('--confirm-inspected', action='store_true', required=True)
    p = sub.add_parser('cuttlefish', help='Operate a pre-provisioned Cuttlefish pool')
    cf = p.add_subparsers(dest='cuttlefish_command', required=True)
    cf.add_parser('doctor', help='Check Linux KVM host prerequisites')
    p2 = cf.add_parser('list', help='Run cvdr list using an existing config')
    p2.add_argument('--config', required=True)
    p2 = cf.add_parser('create', help='Create a CVD group with an explicit build')
    p2.add_argument('--config', required=True); p2.add_argument('--host', required=True)
    p2.add_argument('--build-id', required=True); p2.add_argument('--build-target', required=True)
    p2.add_argument('--count', type=int, default=1)
    p = sub.add_parser('smoke', help='Explicit hardware test: reserve, HOME, capture, release')
    p.add_argument('--owner', default='alice'); p.add_argument('--limit', type=int, default=6)
    p.add_argument('--url', default='http://127.0.0.1:8876')
    p.add_argument('--output', default='data/runs')
    args = parser.parse_args(argv)
    try:
        if args.command != 'init':
            load_env(args.env_file)
        return {'init': initialize, 'doctor': doctor, 'enroll': enroll,
                'serve': serve, 'smoke': smoke, 'desktop': prepare_desktop,
                'reconcile':reconcile, 'cuttlefish':cuttlefish}[args.command](args)
    except (RuntimeError, OSError) as e:
        print('Erreur : ' + str(e), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
