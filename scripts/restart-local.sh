#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

kill_port() {
  local port="$1"
  local pids
  pids=$(ss -ltnp 2>/dev/null | awk -v p=":${port}" '$4 ~ p {print $NF}' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)
  if [[ -n "${pids}" ]]; then
    echo "[restart] killing pids on :${port} -> ${pids}"
    for pid in $pids; do
      kill "$pid" || true
    done
    sleep 0.5
  fi
}

kill_port 3100
kill_port 3101

nohup env PORT=3101 ALLOWED_ORIGIN=http://46.225.214.194:3100 node server/index.js > backend.log 2>&1 &
B_PID=$!
nohup node gateway.js > gateway.log 2>&1 &
G_PID=$!

sleep 1

echo "[restart] backend pid=${B_PID} gateway pid=${G_PID}"
ss -ltnp | grep -E ':3100|:3101' || true

echo "[restart] health:"
curl -sS --max-time 5 http://127.0.0.1:3100/api/health || true
echo
