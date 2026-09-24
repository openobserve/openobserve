// Copyright 2026 OpenObserve Inc.
//
// streams.ts — which log streams the SIEM treats as security sources, and
// whether each one is still reporting.
//
// A stream is a security source if its name looks like one or an analyst added
// it by hand. The hand-added list is kept per org in localStorage; it is a
// viewing preference, not configuration, so it does not need a backend store.

export const SECURITY_STREAM_RE =
  /security|audit|siem|event|login|auth|access|cloudtrail|okta|firewall|vpc|cdc/i;

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

/** Auto-detected names first, then hand-added ones, never duplicated. */
export function securityStreamNames(all: string[], tagged: string[]): string[] {
  const auto = all.filter((name) => SECURITY_STREAM_RE.test(name));
  const extra = tagged.filter((name) => all.includes(name) && !auto.includes(name));
  return [...auto, ...extra];
}

/**
 * live  — reported within the quiet threshold.
 * quiet — reported before, has since gone silent (the case worth a look).
 * never — no data at all; usually a stream that was just created.
 */
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
