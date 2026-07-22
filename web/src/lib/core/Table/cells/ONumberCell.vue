<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// ONumberCell — consistent numeric rendering for tables:
// tabular-nums so digits stack, one set of shared formatters, muted dash for
// empty. Pair the column with `meta.align: "right"` for proper alignment.
//
//   <ONumberCell :value="row.doc_num" format="number" />
//   <ONumberCell :value="row.storage_size" format="bytesFromMB" />
//   <ONumberCell :value="row.p99_latency_ns" format="durationNs" />

import { computed } from "vue";
import {
  addCommasToNumber,
  formatLargeNumber,
  formatSizeFromMB,
  durationFormatter,
  formatDuration,
  formatTimeWithSuffix,
} from "@/utils/formatters";

type NumberFormat =
  | "number" // 1,240,000
  | "compact" // 1.2M
  | "bytesFromMB" // formatSizeFromMB
  | "durationSec" // seconds → "2h 30m"
  | "durationMs" // milliseconds → "1.20 s"
  | "durationUs" // microseconds → "340.00 ms"
  | "durationNs" // nanoseconds → "..."
  | "percent"; // 42.5%

const props = withDefaults(
  defineProps<{
    value: unknown;
    format?: NumberFormat;
    /** Decimal places for the "percent" format. Default 1. */
    digits?: number;
    /** Optional suffix appended after the formatted value (muted). */
    suffix?: string;
    emptyLabel?: string;
  }>(),
  { format: "number", digits: 1, emptyLabel: "—" },
);

const num = computed<number | null>(() => {
  const v = props.value;
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
});

const formatted = computed<string | null>(() => {
  if (num.value === null) return null;
  const n = num.value;
  switch (props.format) {
    case "compact":
      return formatLargeNumber(n);
    case "bytesFromMB":
      return formatSizeFromMB(String(n));
    case "durationSec":
      return durationFormatter(Math.round(n));
    case "durationMs":
      return formatDuration(n);
    case "durationUs":
      return formatTimeWithSuffix(n);
    case "durationNs":
      return formatTimeWithSuffix(n / 1e3);
    case "percent":
      return `${n.toFixed(props.digits)}%`;
    case "number":
    default:
      return addCommasToNumber(n);
  }
});
</script>

<template>
  <span v-if="formatted === null" class="text-text-muted text-xs tabular-nums">{{
    emptyLabel
  }}</span>
  <span v-else class="tabular-nums whitespace-nowrap">
    {{ formatted }}<span v-if="suffix" class="text-text-muted ml-0.5">{{ suffix }}</span>
  </span>
</template>
