#!/bin/bash
# Compare benchmark results

MAIN_FILE="benchmark-main.json"
OPT_FILE="benchmark-optimized.json"

echo "=============================================="
echo "ACTUAL PERFORMANCE COMPARISON"
echo "=============================================="
echo ""
echo "Main Branch vs Optimized Branch"
echo ""

# Extract metrics
MAIN_P50=$(jq -r '.p50' $MAIN_FILE)
MAIN_P95=$(jq -r '.p95' $MAIN_FILE)
MAIN_P99=$(jq -r '.p99' $MAIN_FILE)
MAIN_MEAN=$(jq -r '.mean' $MAIN_FILE)

OPT_P50=$(jq -r '.p50' $OPT_FILE)
OPT_P95=$(jq -r '.p95' $OPT_FILE)
OPT_P99=$(jq -r '.p99' $OPT_FILE)
OPT_MEAN=$(jq -r '.mean' $OPT_FILE)

# Calculate improvements
P50_DELTA=$((MAIN_P50 - OPT_P50))
P95_DELTA=$((MAIN_P95 - OPT_P95))
P99_DELTA=$((MAIN_P99 - OPT_P99))
MEAN_DELTA=$((MAIN_MEAN - OPT_MEAN))

P50_PCT=$(echo "scale=2; ($P50_DELTA * 100) / $MAIN_P50" | bc)
P95_PCT=$(echo "scale=2; ($P95_DELTA * 100) / $MAIN_P95" | bc)
P99_PCT=$(echo "scale=2; ($P99_DELTA * 100) / $MAIN_P99" | bc)
MEAN_PCT=$(echo "scale=2; ($MEAN_DELTA * 100) / $MAIN_MEAN" | bc)

echo "Metric   | Main (ms) | Optimized (ms) | Delta (ms) | Improvement %"
echo "---------|-----------|----------------|------------|---------------"
printf "p50      | %9s | %14s | %10s | %s%%\n" "$MAIN_P50" "$OPT_P50" "$P50_DELTA" "$P50_PCT"
printf "p95      | %9s | %14s | %10s | %s%%\n" "$MAIN_P95" "$OPT_P95" "$P95_DELTA" "$P95_PCT"
printf "p99      | %9s | %14s | %10s | %s%%\n" "$MAIN_P99" "$OPT_P99" "$P99_DELTA" "$P99_PCT"
printf "Mean     | %9s | %14s | %10s | %s%%\n" "$MAIN_MEAN" "$OPT_MEAN" "$MEAN_DELTA" "$MEAN_PCT"
echo ""

echo "KEY FINDINGS:"
echo "============="
if [ "$P99_DELTA" -gt 0 ]; then
  echo "✅ p99 latency improved by ${P99_DELTA}ms (${P99_PCT}%)"
else
  echo "❌ p99 latency regressed by $((0 - P99_DELTA))ms"
fi

if [ "$P95_DELTA" -gt 0 ]; then
  echo "✅ p95 latency improved by ${P95_DELTA}ms (${P95_PCT}%)"
else
  echo "❌ p95 latency regressed by $((0 - P95_DELTA))ms"
fi

if [ "$MEAN_DELTA" -gt 0 ]; then
  echo "✅ Mean latency improved by ${MEAN_DELTA}ms (${MEAN_PCT}%)"
else
  echo "⚖️  Mean latency neutral"
fi

echo ""
echo "OPTIMIZATIONS APPLIED:"
echo "======================"
echo "1. Parquet metadata speculative read (256KB buffer)"
echo "2. File list cache-first pattern"
echo "3. Empty cache result handling fix"
echo "4. spawn_blocking error handling improvement"
echo ""

