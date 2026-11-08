// Copyright 2026 OpenObserve Inc.

// The hand-added list lives in localStorage: it is a viewing preference, not configuration.

export const SECURITY_STREAM_RE =
  /security|audit|siem|event|login|auth|access|cloudtrail|okta|firewall|vpc|cdc|ocsf|sysmon|edr|waf|guardduty/i;

const taggedKey = (orgId: string) => `oo_sec_streams_${orgId}`;

export function loadTaggedStreams(orgId: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(taggedKey(orgId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function saveTaggedStreams(orgId: string, names: string[]) {
  try {
    localStorage.setItem(taggedKey(orgId), JSON.stringify(names));
  } catch {
    /* private mode / quota — the list is a convenience, not state */
  }
}

/** `quiet` reported before but has gone silent; `never` has no data, usually a just-created stream. */
export type SourceHealth = "live" | "quiet" | "never";

/** A day of silence from a security source is the point it deserves attention. */
export const QUIET_AFTER_US = 24 * 3_600_000_000;

export function sourceHealth(
  stats: { doc_num?: number; doc_time_max?: number } | null | undefined,
  nowUs: number = Date.now() * 1000,
): SourceHealth {
  const docs = Number(stats?.doc_num ?? 0);
  const last = Number(stats?.doc_time_max ?? 0);
  if (!docs || !last) return "never";
  return nowUs - last > QUIET_AFTER_US ? "quiet" : "live";
}

/** Relative windows the Events page offers when the current one is empty. */
const WIDER_PERIODS: [string, number][] = [
  ["1h", 3_600_000_000],
  ["24h", 24 * 3_600_000_000],
  ["7d", 7 * 24 * 3_600_000_000],
  ["30d", 30 * 24 * 3_600_000_000],
];

/** Smallest relative window reaching the last event, so an empty page offers a one-click way there. */
export function widerPeriodFor(
  lastUs: number | null | undefined,
  windowStartUs: number,
  nowUs: number = Date.now() * 1000,
): string | null {
  const last = Number(lastUs ?? 0);
  if (!last || last >= windowStartUs) return null;
  return WIDER_PERIODS.find(([, span]) => nowUs - span <= last)?.[0] ?? null;
}
