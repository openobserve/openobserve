// Copyright 2026 OpenObserve Inc.
//
// statusVariant — the single source of truth that maps a raw status/state
// string (from any table, any feature) onto a semantic OBadge variant + a
// human label. One map so that "active"/"paused"/"failed" look identical
// everywhere instead of every table inventing its own colours.
//
// Usage:
//   const { variant, label, dot } = statusVariant("paused", "pipeline");
//   <OBadge :variant="variant" :dot="dot">{{ label }}</OBadge>

import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

/** Semantic tone — the calm, low-chroma "soft" badge family reads best at
 *  table density. Each tone maps to one variant. */
export type StatusTone = "success" | "warning" | "error" | "info" | "neutral";

const TONE_VARIANT: Record<StatusTone, BadgeVariant> = {
  success: "success-soft",
  warning: "warning-soft",
  error: "error-soft",
  info: "blue-soft",
  neutral: "default-soft",
};

/**
 * Base keyword → tone map. Keys are matched against the lower-cased,
 * trimmed status string (exact match first, then word-contains). Ordering of
 * the contains-pass favours the most specific tokens, so e.g. "degraded"
 * resolves before a generic fallback.
 */
const BASE_TONE: Record<string, StatusTone> = {
  // success / healthy / on
  active: "success",
  enabled: "success",
  enable: "success",
  healthy: "success",
  ok: "success",
  up: "success",
  online: "success",
  ready: "success",
  paid: "success",
  success: "success",
  succeeded: "success",
  completed: "success",
  complete: "success",
  finished: "success",
  passed: "success",
  pass: "success",
  resolved: "success",
  done: "success",
  live: "success",
  "true": "success",

  // warning / transient / attention
  paused: "warning",
  pause: "warning",
  pending: "warning",
  degraded: "warning",
  warning: "warning",
  warn: "warning",
  training: "warning",
  queued: "warning",
  waiting: "warning",
  open: "warning",
  partial: "warning",
  stale: "warning",
  retrying: "warning",
  throttled: "warning",
  suspended: "warning",

  // error / down / off
  failed: "error",
  fail: "error",
  error: "error",
  errored: "error",
  overdue: "error",
  critical: "error",
  down: "error",
  offline: "error",
  unhealthy: "error",
  cancelled: "error",
  canceled: "error",
  void: "error",
  rejected: "error",
  expired: "error",
  blocked: "error",
  "false": "error",

  // info / running / scheduled
  running: "info",
  processing: "info",
  scheduled: "info",
  realtime: "info",
  "real-time": "info",
  new: "info",
  info: "info",
  started: "info",
  inprogress: "info",
  "in-progress": "info",

  // neutral / draft / inactive
  draft: "neutral",
  disabled: "neutral",
  disable: "neutral",
  inactive: "neutral",
  archived: "neutral",
  unknown: "neutral",
  none: "neutral",
  default: "neutral",
  idle: "neutral",
  na: "neutral",
};

/**
 * Per-domain overrides — same word can mean different things in different
 * features. Domain wins over the base map. Keep these intentionally small;
 * most statuses should resolve from BASE_TONE.
 */
const DOMAIN_TONE: Record<string, Record<string, StatusTone>> = {
  // Invoices: an "open" invoice is normal/info, not a warning.
  invoice: { open: "info", uncollectible: "error", "void": "neutral" },
  // Services / nodes catalog: "warning" sits between degraded and critical.
  service: { warning: "warning", degraded: "warning", critical: "error" },
  node: { warning: "warning" },
  // Eval jobs: "archived" is a deliberate end-state, keep neutral; "degraded"
  // means the job is firing but unhealthy → warning.
  eval: { archived: "neutral", degraded: "warning" },
};

export interface StatusVariantResult {
  variant: BadgeVariant;
  tone: StatusTone;
  label: string;
  dot: boolean;
}

/** Title-case a raw status token: "in_progress" → "In Progress". */
export function humanizeStatus(value: string): string {
  return String(value)
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve a raw status value to a badge variant + label.
 * @param value  raw status string (case-insensitive) — also accepts booleans.
 * @param domain optional feature key for overrides ("invoice"|"eval"|"service"|"node"|…).
 */
export function statusVariant(
  value: unknown,
  domain?: string,
): StatusVariantResult {
  const raw =
    typeof value === "boolean" ? String(value) : String(value ?? "").trim();
  const key = raw.toLowerCase();

  let tone: StatusTone | undefined;

  if (domain && DOMAIN_TONE[domain]?.[key]) {
    tone = DOMAIN_TONE[domain][key];
  } else if (BASE_TONE[key]) {
    tone = BASE_TONE[key];
  } else {
    // word-contains fallback: scan tokens so "auth_failed" → error, etc.
    for (const token of key.split(/[^a-z0-9]+/).filter(Boolean)) {
      if (BASE_TONE[token]) {
        tone = BASE_TONE[token];
        break;
      }
    }
  }

  tone = tone ?? "neutral";

  return {
    variant: TONE_VARIANT[tone],
    tone,
    label: raw ? humanizeStatus(raw) : "—",
    dot: true,
  };
}
