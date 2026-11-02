#!/usr/bin/env bash
# Logs runner speed for a UI test shard: fixed CPU and disk work at the start, CPU steal over the test step at the end.
set -u
state="${RUNNER_TEMP:-/tmp}/ui-diag-steal"
steal_total() { awk '/^cpu /{t=0; for(i=2;i<=NF;i++) t+=$i; print $9, t}' /proc/stat; }

case "${1:-}" in
start)
  steal_total > "$state"
  c0=$(date +%s%N)
  node -e 'let x=0;for(let i=0;i<3e8;i++)x+=i%7;process.stdout.write(String(x))' > /dev/null
  c1=$(date +%s%N)
  d0=$(date +%s%N)
  bytes=$(find node_modules/monaco-editor node_modules/echarts -type f -print0 2> /dev/null | xargs -0 cat 2> /dev/null | wc -c)
  d1=$(date +%s%N)
  cpu=$(lscpu | awk -F: '/Model name/{gsub(/^ +/,"",$2); print $2; exit}')
  echo "ui-diag shard=${SHARD:-?} nproc=$(nproc) cpu=\"${cpu}\" mem_gb=$(awk '/MemTotal/{printf "%d",$2/1048576}' /proc/meminfo) load=$(cut -d' ' -f1 /proc/loadavg) cpu_bench_ms=$(((c1 - c0) / 1000000)) disk_read_ms=$(((d1 - d0) / 1000000)) disk_read_mb=$((bytes / 1048576))"
  ;;
end)
  [ -f "$state" ] || exit 0
  read -r s0 t0 < "$state"
  read -r s1 t1 < <(steal_total)
  echo "ui-diag shard=${SHARD:-?} steal_pct=$(awk -v a=$((s1 - s0)) -v b=$((t1 - t0)) 'BEGIN{printf "%.1f", (b>0 ? 100*a/b : 0)}') load_end=$(cut -d' ' -f1 /proc/loadavg)"
  ;;
esac
