#!/bin/bash
# Auto-restart wrapper — keeps the service alive no matter what
cd "$(dirname "$0")"
while true; do
  echo "[$(date)] === starting theoldllm-browser ==="
  bun index.ts 2>&1 || true
  EXIT_CODE=$?
  echo "[$(date)] === service exited (code $EXIT_CODE), restarting in 2s ==="
  sleep 2
done
