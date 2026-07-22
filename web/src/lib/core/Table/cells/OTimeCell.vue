<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OTimeCell — the ONE timestamp renderer for every table.
// Default display is relative ("2m ago"); set mode="absolute" to show the full
// timezone-aware datetime instead. Relative cells get a hover tooltip (OTooltip,
// not the native browser title) revealing the full absolute datetime; absolute/
// date cells already show the full datetime, so they have NO tooltip. Empty/zero
// values render a muted label instead of a blank cell.
//
//   <OTimeCell :value="row.last_triggered_at" unit="iso" empty-label="Never" />
//   <OTimeCell :value="row.timestamp" unit="ms" :timezone="store.state.timezone" />

import { computed } from "vue";
import { formatDistanceToNowStrict } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

type TimeUnit = "auto" | "iso" | "s" | "ms" | "us" | "ns";

const props = withDefaults(
  defineProps<{
    /** Raw timestamp: ISO/parseable string, epoch number, or Date. */
    value: unknown;
    /** How to interpret a numeric/string value. Default "auto". */
    unit?: TimeUnit;
    /**
     * "relative" (default) shows "2m ago"; "absolute" shows the full datetime;
     * "date" shows date-only (no time) — ideal for billing periods etc.
     */
    mode?: "relative" | "absolute" | "date";
    /** IANA timezone for the absolute rendering. Defaults to the browser zone. */
    timezone?: string;
    /** Text shown when the value is empty/zero/invalid. Default "—". */
    emptyLabel?: string;
    /**
     * In "relative" mode, only show "x ago" for timestamps within this many
     * days; older ones fall back to an absolute date (e.g. "Jun 24, 2024").
     * This is the GitHub/Linear pattern — "2 years ago" is uselessly vague, so
     * past the cutoff we show the real date. Default 30.
     */
    relativeCutoffDays?: number;
  }>(),
  { unit: "auto", mode: "relative", emptyLabel: "—", relativeCutoffDays: 30 },
);

/** Normalise any supported input to epoch milliseconds, or null if invalid. */
const epochMs = computed<number | null>(() => {
  const v = props.value;
  if (v === null || v === undefined || v === "") return null;

  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();

  // Numeric (or all-digit string) epoch → scale by unit.
  const asNum =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())
        ? Number(v.trim())
        : NaN;

  if (!isNaN(asNum)) {
    if (asNum === 0) return null;
    return numberToMs(asNum, props.unit);
  }

  // Otherwise treat as a parseable date string.
  const parsed = Date.parse(String(v));
  return isNaN(parsed) ? null : parsed;
});

function numberToMs(n: number, unit: TimeUnit): number {
  switch (unit) {
    case "s":
      return n * 1000;
    case "ms":
      return n;
    case "us":
      return n / 1e3;
    case "ns":
      return n / 1e6;
    case "iso":
    case "auto":
    default: {
      // Magnitude heuristic for current-era epochs.
      const abs = Math.abs(n);
      if (abs >= 1e17) return n / 1e6; // nanoseconds
      if (abs >= 1e14) return n / 1e3; // microseconds
      if (abs >= 1e11) return n; // milliseconds
      return n * 1000; // seconds
    }
  }
}

const zone = computed(
  () => props.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
);

/** Pretty absolute date used as the relative-mode fallback for old timestamps. */
const prettyDate = computed(() => {
  if (epochMs.value === null) return null;
  try {
    return formatInTimeZone(new Date(epochMs.value), zone.value, "MMM d, yyyy");
  } catch {
    return new Date(epochMs.value).toISOString().slice(0, 10);
  }
});

/**
 * Relative within the cutoff ("2 days ago"), absolute date beyond it
 * ("Jun 24, 2024"). Avoids the meaningless "2 years ago".
 */
const relative = computed(() => {
  if (epochMs.value === null) return null;
  const ageMs = Math.abs(Date.now() - epochMs.value);
  if (ageMs <= props.relativeCutoffDays * 86_400_000) {
    return formatDistanceToNowStrict(new Date(epochMs.value), {
      addSuffix: true,
    });
  }
  return prettyDate.value;
});

const absolute = computed(() => {
  if (epochMs.value === null) return null;
  try {
    return formatInTimeZone(new Date(epochMs.value), zone.value, "yyyy-MM-dd HH:mm:ss");
  } catch {
    return new Date(epochMs.value).toISOString();
  }
});

const dateOnly = computed(() => {
  if (epochMs.value === null) return null;
  try {
    return formatInTimeZone(new Date(epochMs.value), zone.value, "yyyy-MM-dd");
  } catch {
    return new Date(epochMs.value).toISOString().slice(0, 10);
  }
});

const display = computed(() => {
  if (props.mode === "absolute") return absolute.value;
  if (props.mode === "date") return dateOnly.value;
  return relative.value;
});

/**
 * Hover tooltip — shown for RELATIVE mode only, revealing the full absolute
 * datetime. Absolute/date cells already show the full datetime, so they get no
 * tooltip. Suppressed when it would duplicate the cell text.
 */
const tooltip = computed(() => {
  if (props.mode !== "relative") return null;
  const text = absolute.value;
  return text && text !== display.value ? text : null;
});
</script>

<template>
  <span v-if="display === null" class="text-text-body text-xs">{{ emptyLabel }}</span>
  <template v-else>
    <span class="tabular-nums whitespace-nowrap">{{ display }}</span>
    <OTooltip v-if="tooltip" :content="tooltip" />
  </template>
</template>
