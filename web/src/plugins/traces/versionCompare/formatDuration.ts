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
