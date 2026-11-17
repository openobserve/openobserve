// Copyright 2026 OpenObserve Inc.
//
// huntLink.ts — the cross-source hunt as the Events URL carries it.

import type { EntityKind } from "./streamPlan";

export type HuntKind = "any" | EntityKind;
export const HUNT_KINDS: HuntKind[] = ["any", "user", "ip", "host"];
/** The Events stream value that means "every included security source". */
export const ALL_SOURCES = "__all__";

/** Common columns, in display order; `source` is the stream that produced the row. */
export const HUNT_COLUMNS = [
  "time",
  "source",
  "user",
  "ip",
  "host",
  "action",
  "outcome",
  "message",
] as const;
export type HuntColumn = (typeof HUNT_COLUMNS)[number];

export interface HuntQuery {
  kind: HuntKind;
  value: string;
  /** Raw spellings of a user (from Entities); each one matches exactly. */
  aliases?: string[];
}

export interface HuntSort {
  column: HuntColumn;
  order: "asc" | "desc";
}

/** URL query that opens Events on a cross-source hunt; aliases ride along as JSON. */
export function huntLinkQuery(q: HuntQuery): Record<string, string> {
  const query: Record<string, string> = { stream: ALL_SOURCES, hunt_kind: q.kind, hunt: q.value };
  const aliases = (q.aliases ?? []).filter((a) => a && a !== q.value);
  if (aliases.length) query.hunt_aliases = JSON.stringify(aliases);
  return query;
}

/** Reads a hunt back from the URL; unknown kinds fall back to "any". */
export function huntFromQuery(query: Record<string, unknown>): HuntQuery {
  const kind = HUNT_KINDS.includes(query.hunt_kind as HuntKind)
    ? (query.hunt_kind as HuntKind)
    : "any";
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(String(query.hunt_aliases ?? "[]"));
    if (Array.isArray(parsed)) aliases = parsed.map(String).slice(0, 50);
  } catch {
    aliases = [];
  }
  return { kind, value: String(query.hunt ?? ""), aliases };
}
