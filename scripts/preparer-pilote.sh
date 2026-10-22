#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install .
.venv/bin/playwright install chromium
.venv/bin/strowger init --capacity 6
.venv/bin/strowger doctor
