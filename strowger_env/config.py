"""Operator-side local configuration; never executed as shell code."""
import json
import os
from pathlib import Path
import shlex


def load_env(path='.env'):
    path = Path(path)
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:]
        if '=' not in line:
            raise RuntimeError('Invalid local .env assignment')
        name, raw = line.split('=', 1)
        if not name.startswith('ENV_') or not name.replace('_', '').isalnum():
            raise RuntimeError('Only ENV_ variables are accepted in the local .env')
        try:
            words = shlex.split(raw, comments=True)
        except ValueError:
            raise RuntimeError('Invalid quoting in local .env') from None
        if len(words) > 1:
            raise RuntimeError('Quote values containing spaces in the local .env')
        os.environ.setdefault(name, words[0] if words else '')


def load_inventory(keys):
    if 'ENV_ANDROID_DEVICES' in os.environ:
        try:
            return json.loads(os.environ['ENV_ANDROID_DEVICES'])
        except (ValueError, TypeError):
            raise RuntimeError('Invalid ENV_ANDROID_DEVICES JSON') from None
    if 'ENV_ANDROID_DEVICES_FILE' in os.environ:
        try:
            return json.loads(Path(os.environ['ENV_ANDROID_DEVICES_FILE']).read_text())
        except (OSError, ValueError, TypeError):
            raise RuntimeError('Cannot read a valid ENV_ANDROID_DEVICES_FILE JSON inventory') from None
    serial = os.environ.get('ENV_ANDROID_SERIAL')
    return [{'id': 'android-01', 'serial': serial, 'owners': list(keys)}] if serial else []


def read_capacity(capacity=None):
    if capacity is None:
        try:
            capacity = int(os.environ.get('ENV_CAPACITY', '4'))
        except (ValueError, TypeError):
            raise RuntimeError('ENV_CAPACITY must be an integer between 1 and 64') from None
    if type(capacity) is not int or not 1 <= capacity <= 64:
        raise RuntimeError('Capacity must be an integer between 1 and 64')
    return capacity
