#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

for f in .pid_gateway .pid_backend; do
  if [[ -f "$f" ]]; then
    pid=$(cat "$f" 2>/dev/null || true)
    [[ -n "${pid:-}" ]] && kill "$pid" 2>/dev/null || true
    rm -f "$f"
  fi
done

for port in 3100 3101; do
  pids=$(ss -ltnp 2>/dev/null | awk -v p=":${port}" '$4 ~ p {print $NF}' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)
  if [[ -n "${pids}" ]]; then
    for pid in $pids; do kill "$pid" || true; done
  fi
done
