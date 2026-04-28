#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
PID_FILE="$LOG_DIR/app.pid"

mkdir -p "$LOG_DIR"

do_start() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Already running (PID $(cat "$PID_FILE")). Use '$0 restart' to restart."
    return 1
  fi

  LOG_FILE="$LOG_DIR/app-$(date +%Y%m%d-%H%M%S).log"
  cd "$SCRIPT_DIR"
  nohup npx deno run --allow-all index.ts > "$LOG_FILE" 2>&1 &

  PID=$!
  echo "$PID" > "$PID_FILE"
  echo "Started with PID $PID, log: $LOG_FILE"
}

do_stop() {
  if [ ! -f "$PID_FILE" ]; then
    echo "PID file not found, nothing to stop."
    return 1
  fi

  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Stopped PID $PID"
  else
    echo "Process $PID not running."
  fi
  rm -f "$PID_FILE"
}

case "${1:-start}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; sleep 1; do_start ;;
  *)       echo "Usage: $0 {start|stop|restart}" ;;
esac
