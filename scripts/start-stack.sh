#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# ensure clean ports
for port in 3100 3101; do
  pids=$(ss -ltnp 2>/dev/null | awk -v p=":${port}" '$4 ~ p {print $NF}' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)
  if [[ -n "${pids}" ]]; then
    for pid in $pids; do kill "$pid" || true; done
  fi
done
sleep 0.5

nohup env PORT=3101 ALLOWED_ORIGIN=http://46.225.214.194:3100 node server/index.js > backend.log 2>&1 &
echo $! > .pid_backend
nohup node gateway.js > gateway.log 2>&1 &
echo $! > .pid_gateway

sleep 0.7
curl -fsS --max-time 5 http://127.0.0.1:3100/api/health >/dev/null
