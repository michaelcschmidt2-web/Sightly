#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

HOST="127.0.0.1"
PORT="5173"
URL="http://${HOST}:${PORT}"
LOG_DIR="$PROJECT_DIR/.launcher"
LOG_FILE="$LOG_DIR/sightly-desktop.log"
PID_FILE="$LOG_DIR/sightly-desktop.pid"
mkdir -p "$LOG_DIR"

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

wait_for_app() {
  for _ in {1..60}; do
    if curl -fsS "$URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

open_app_window() {
  if command -v google-chrome >/dev/null 2>&1; then
    nohup google-chrome --app="$URL" >/dev/null 2>&1 &
  elif command -v google-chrome-stable >/dev/null 2>&1; then
    nohup google-chrome-stable --app="$URL" >/dev/null 2>&1 &
  elif command -v chromium >/dev/null 2>&1; then
    nohup chromium --app="$URL" >/dev/null 2>&1 &
  elif command -v chromium-browser >/dev/null 2>&1; then
    nohup chromium-browser --app="$URL" >/dev/null 2>&1 &
  elif command -v microsoft-edge >/dev/null 2>&1; then
    nohup microsoft-edge --app="$URL" >/dev/null 2>&1 &
  elif command -v wslview >/dev/null 2>&1; then
    wslview "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  else
    printf 'Sightly is running at %s\n' "$URL"
    printf 'Open that URL in your browser.\n'
  fi
}

if ! command -v npm >/dev/null 2>&1; then
  printf 'npm is required to run Sightly. Install Node.js/npm, then run this launcher again.\n' >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  printf 'Installing Sightly dependencies...\n'
  npm install
fi

if is_running; then
  printf 'Sightly dev server is already running at %s\n' "$URL"
else
  printf 'Starting Sightly desktop app at %s\n' "$URL"
  nohup npm run dev -- --host "$HOST" --port "$PORT" >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
fi

if wait_for_app; then
  open_app_window
  printf 'Sightly desktop app is ready: %s\n' "$URL"
  printf 'Server log: %s\n' "$LOG_FILE"
else
  printf 'Sightly did not become ready. Check the log: %s\n' "$LOG_FILE" >&2
  exit 1
fi
