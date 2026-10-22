"""Create local credentials once, without printing them."""
import json
import os
from pathlib import Path
import secrets
p = Path('.env')
key = secrets.token_urlsafe(32)
try:
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    raise SystemExit('.env already exists; preserved unchanged')
with os.fdopen(fd, 'w') as f:
    f.write('ENV_API_KEYS=\'' + json.dumps({'alice': key}) + "'\n")
    f.write("ENV_CLIENT_KEY='" + key + "'\n")
print('Created .env with local credentials. Never commit this file.')
