#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
VENV=.cache/zhixing-venv
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/python" -c 'import sys; assert sys.version_info >= (3,11), "需要 Python 3.11 或更新版本"'
if ! "$VENV/bin/python" -c 'import fastapi, uvicorn, httpx' 2>/dev/null; then
  "$VENV/bin/python" -m pip install -r services/zhixing/requirements.txt
fi
exec "$VENV/bin/python" services/zhixing/server.py
