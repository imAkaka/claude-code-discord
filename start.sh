#!/bin/bash

LOG_DIR="$(dirname "$0")/logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/app-$(date +%Y%m%d-%H%M%S).log"

cd "$(dirname "$0")"
nohup npx deno run --allow-all index.ts > "$LOG_FILE" 2>&1 &

PID=$!
echo "$PID" > "$LOG_DIR/app.pid"
echo "Started with PID $PID, log: $LOG_FILE"
