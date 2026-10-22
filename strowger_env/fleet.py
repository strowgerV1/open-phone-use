"""Validation and normalization for the operator supplied Android fleet."""
import re

_ID = re.compile(r'[A-Za-z0-9_-]{1,64}')
_SERIAL = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}')
_OWNERS = {'id', 'serial', 'owners'}
_OPTIONAL = {'provider', 'automation', 'tenant', 'cuttlefish'}


def normalize_inventory(devices, keys):
    """Return a validated fleet while accepting the original 3-key format."""
    if not isinstance(devices, list):
        raise RuntimeError('Android inventory must be a list')
    result, ids, serials = [], set(), set()
    for source in devices:
        if not isinstance(source, dict) or set(source) - (_OWNERS | _OPTIONAL) or not _OWNERS <= set(source):
            raise RuntimeError('Invalid Android inventory entry')
        d = dict(source)
        ident, serial, owners = d['id'], d['serial'], d['owners']
        if (not isinstance(ident, str) or not _ID.fullmatch(ident)
            or not isinstance(serial, str) or not _SERIAL.fullmatch(serial)
            or not isinstance(owners, list) or not owners
            or any(not isinstance(o, str) or o not in keys for o in owners)
            or len(set(owners)) != len(owners) or ident in ids or serial in serials):
            raise RuntimeError('Invalid or duplicate Android inventory entry')
        provider = d.get('provider', 'physical')
        automation = d.get('automation', 'adb')
        if provider not in ('physical', 'cuttlefish') or automation not in ('adb', 'uiautomator2'):
            raise RuntimeError('Invalid Android provider or automation backend')
        tenant = d.get('tenant')
        if tenant is not None and (not isinstance(tenant, str) or tenant not in keys or tenant not in owners):
            raise RuntimeError('Invalid Android tenant')
        if tenant is not None and owners != [tenant]:
            raise RuntimeError('Tenant devices must be dedicated to that owner')
        cf = d.get('cuttlefish')
        if provider == 'cuttlefish':
            if cf is not None:
                if (not isinstance(cf, dict) or not set(cf) <= {'host', 'group', 'instance'}
                    or not cf or any(not isinstance(v, str) or not 1 <= len(v) <= 128 for v in cf.values())):
                    raise RuntimeError('Invalid Cuttlefish metadata')
            elif 'cuttlefish' in d:
                raise RuntimeError('Invalid Cuttlefish metadata')
        elif cf is not None or 'cuttlefish' in d:
            raise RuntimeError('Cuttlefish metadata requires provider=cuttlefish')
        d.update(provider=provider, automation=automation)
        ids.add(ident); serials.add(serial); result.append(d)
    return result
