#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
VENV=.cache/zhixing-venv
if [ ! -x "$VENV/bin/python" ]; then python3 -m venv "$VENV"; fi
if ! "$VENV/bin/python" -c 'import pytest, pytest_asyncio, fastapi, httpx, uvicorn' 2>/dev/null; then
  "$VENV/bin/python" -m pip install -r services/zhixing/requirements-dev.txt
fi
exec "$VENV/bin/python" -m pytest services/zhixing/tests -q
