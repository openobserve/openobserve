// Copyright 2026 OpenObserve Inc.

/** Humanizes an epoch-microseconds timestamp as "5s ago" / "2h ago". */
export function formatTimeAgoUs(us: number): string {
  const s = Math.max(0, Math.floor((Date.now() - us / 1000) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Renders a check interval in seconds as a compact label ("30s", "5m", "1h"). */
export function formatIntervalSecs(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

/** "Name (region)", omitting the region when it's blank or a mechanical
 *  duplicate of the name — private locations without an explicit region
 *  default to a slug of their own name server-side, which reads as
 *  pointless noise ("private-location-5660 (private-location-5660)"). */
export function locationDisplayLabel(name: string, region: string | undefined | null): string {
  const r = region?.trim();
  if (!r || r.toLowerCase() === name.trim().toLowerCase()) return name;
  return `${name} (${r})`;
}
