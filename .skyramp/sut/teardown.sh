#!/bin/bash
# Stop OpenObserve binary started by setup.sh.
if [ -f /tmp/o2.pid ]; then
  PID=$(cat /tmp/o2.pid)
  echo "Stopping OpenObserve (PID $PID)"
  kill "$PID" 2>/dev/null || true
  rm -f /tmp/o2.pid
else
  # Fallback: kill by process name in case PID file was lost
  pkill -f "release-ci-binary/openobserve" 2>/dev/null || true
fi
docker system prune -f --volumes 2>/dev/null || true
echo "Teardown complete."
