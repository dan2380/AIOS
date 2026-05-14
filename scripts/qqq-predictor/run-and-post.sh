#!/usr/bin/env bash
# Wrapper for the QQQ predictor. Loads env, runs the script, logs output.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOG_DIR="$ROOT/_work/qqq-predictor"
mkdir -p "$LOG_DIR"

if [ -f "$ROOT/.env" ]; then
  set -a
  set +u
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set -u
  set +a
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"

"$PYTHON_BIN" "$HERE/predict.py" 2>&1 | tee -a "$LOG_FILE"
