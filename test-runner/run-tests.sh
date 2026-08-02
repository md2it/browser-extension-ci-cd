#!/bin/sh

set -u

RUNNER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PYTHON_BIN=$(command -v python3 2>/dev/null || true)

if [ -z "$PYTHON_BIN" ]; then
  printf '%s\n' '{"passed":false,"status":"infrastructure-error","summary":"python3 was not found","failedTests":[],"infrastructureError":"python3 was not found"}'
  exit 2
fi

if [ "$#" -ne 1 ]; then
  printf '%s\n' '{"passed":false,"status":"infrastructure-error","summary":"Project directory argument is required","failedTests":[],"infrastructureError":"Project directory argument is required"}'
  exit 2
fi

exec "$PYTHON_BIN" "$RUNNER_DIR/browser-test-runner.py" "$1"
