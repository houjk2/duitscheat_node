#!/usr/bin/env bash
# ============================================================
#  start.sh  —  Run the interpreter in the background
#  Usage:  bash start.sh [start|stop|status|log|list]
# ============================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$DIR/interpreter.pid"
LOG_FILE="$DIR/interpreter.log"

case "${1:-fg}" in

  fg)
    echo "Starting interpreter (foreground — Ctrl+C to stop) ..."
    node "$DIR/interpreter.js"
    ;;

  start)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Already running (PID $(cat "$PID_FILE"))"
      exit 0
    fi
    nohup node "$DIR/interpreter.js" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Started. PID=$(cat "$PID_FILE")  Log=$LOG_FILE"
    echo "Watch: bash start.sh log"
    ;;

  stop)
    [[ -f "$PID_FILE" ]] || { echo "Not running."; exit 1; }
    kill "$(cat "$PID_FILE")" && echo "Stopped." || echo "Process already gone."
    rm -f "$PID_FILE"
    ;;

  status)
    [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null \
      && echo "Running (PID $(cat "$PID_FILE"))" \
      || echo "Not running."
    ;;

  log)
    tail -f "$LOG_FILE"
    ;;

  list)
    node "$DIR/interpreter.js" --list
    ;;

  *)
    echo "Usage: $0 {fg|start|stop|status|log|list}"
    ;;
esac
