// Copyright 2026 OpenObserve Inc.
//
// Human-readable duration from a fractional-hours value. A raw float like
// "0.00994h" (a 36-second window) is unreadable in the version-compare window
// cards; render sub-minute as seconds, sub-hour as minutes, sub-day as hours,
// else days — always rounded.
export function formatDuration(hours: number): string {
  const h = Math.max(0, hours);
  if (h === 0) return "0s";
  const seconds = h * 3600;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

// Human-readable latency from a MICROSECOND value. Span `duration` (and the
// p50/p95/p99 the compare endpoint derives from it) is in µs, so a raw p95 of
// 263_772_189 must render as "263.8s", not "263772189ms". Pick the largest unit
// that keeps the number small: <1ms → µs, <1s → ms, <60s → s, else m + s.
export function formatMicros(micros: number): string {
  const us = Math.max(0, micros);
  if (us < 1) return "0µs";
  if (us < 1_000) return `${Math.round(us)}µs`;
  const ms = us / 1_000;
  if (ms < 1_000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s < 10 ? s.toFixed(2) : s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return rem ? `${m}m ${rem}s` : `${m}m`;
}
