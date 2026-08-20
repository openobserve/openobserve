// Copyright 2026 OpenObserve Inc.
//
// normalize.ts — maps a raw event onto the OCSF columns the Events page shows.
//
// Normalization happens on the rows that were fetched, not in the query. That is
// a deliberate trade: projecting in SQL would bake one source's field names into
// every request and break the moment a stream carries two shapes, while mapping
// after the fact costs nothing on the server, works identically in filter mode
// and raw SQL mode, and leaves the original row intact for the detail view.
//
// Nothing is invented here. A column with no source field stays empty rather
// than being filled with a plausible-looking value, because a SIEM that guesses
// at an actor or a source IP is worse than one that admits it does not know.

import type { NormalizedEvent } from "./ocsf";
import { ocsfClass, toOcsfSeverity, toOcsfStatus } from "./ocsf";
import type { SourceType } from "./sourceTypes";
import { readPath } from "./classify";

const isPresent = (value: unknown) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);

/** First present value among the candidate paths. */
function firstOf(row: Record<string, unknown>, paths: string[] | undefined): unknown {
  if (!paths) return undefined;
  for (const path of paths) {
    for (const option of path.split("|")) {
      const value = readPath(row, option);
      if (isPresent(value)) return value;
    }
  }
  return undefined;
}

function asText(value: unknown): string {
  if (!isPresent(value)) return "";
  if (Array.isArray(value)) return value.filter(isPresent).map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * OpenObserve stores `_timestamp` in microseconds, but a mapped source may hand
 * back an ISO string or seconds. Everything is brought to milliseconds so the
 * column can be formatted once.
 */
function asMillis(value: unknown): number | null {
  if (!isPresent(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e17) return value / 1e6; // nanoseconds
    if (value > 1e14) return value / 1e3; // microseconds
    if (value > 1e11) return value; // milliseconds
    return value * 1000; // seconds
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Severity when the source carries none of its own.
 *
 * A failed authentication is not the same as a successful one, and a 5xx is not
 * a 200, so outcome informs severity where the log itself is silent. This is the
 * only derived value in the file, and it never overrides a real one.
 */
function severityFromOutcome(statusId: number, classUid: number | null): number {
  if (statusId !== 2) return 1;
  return classUid === 3002 ? 3 : 2;
}

/** Maps one raw row onto the normalized columns using its source's field map. */
export function normalizeEvent(
  raw: Record<string, unknown>,
  source: SourceType | null,
): NormalizedEvent {
  const map = source?.map ?? {};
  const constants = source?.constants ?? {};

  const classUid = source
    ? source.ocsfClass || Number(firstOf(raw, map.classUid as string[]) ?? 0) || null
    : null;
  const known = ocsfClass(classUid ?? undefined);

  const rawSeverity = firstOf(raw, map.severityId as string[]);
  // A source that reports failure by attaching an error says nothing at all on
  // the happy path, so absence is the success signal.
  const failureFields = source?.failureWhenPresent;
  const statusId = failureFields
    ? isPresent(firstOf(raw, failureFields))
      ? 2
      : 1
    : toOcsfStatus(firstOf(raw, map.statusId as string[]));
  const severityId = isPresent(rawSeverity)
    ? toOcsfSeverity(rawSeverity)
    : severityFromOutcome(statusId, classUid);

  return {
    time: asMillis(firstOf(raw, map.time as string[]) ?? raw._timestamp),
    classUid,
    className: asText(firstOf(raw, map.className as string[])) || known?.name || "",
    activity: asText(firstOf(raw, map.activity as string[])),
    severityId,
    statusId,
    actor: asText(firstOf(raw, map.actor as string[])),
    actorId: asText(firstOf(raw, map.actorId as string[])),
    srcIp: asText(firstOf(raw, map.srcIp as string[])),
    srcPort: asText(firstOf(raw, map.srcPort as string[])),
    dstIp: asText(firstOf(raw, map.dstIp as string[])),
    dstPort: asText(firstOf(raw, map.dstPort as string[])),
    host: asText(firstOf(raw, map.host as string[])),
    process: asText(firstOf(raw, map.process as string[])),
    product: asText(firstOf(raw, map.product as string[])) || constants.product || "",
    vendor: asText(firstOf(raw, map.vendor as string[])) || constants.vendor || "",
    operation: asText(firstOf(raw, map.operation as string[])),
    resource: asText(firstOf(raw, map.resource as string[])),
    message: asText(firstOf(raw, map.message as string[])),
    raw,
  };
}

export function normalizeEvents(
  rows: Record<string, unknown>[],
  source: SourceType | null,
): NormalizedEvent[] {
  return rows.map((row) => normalizeEvent(row, source));
}

/**
 * Which normalized columns this source can actually fill.
 *
 * The Events page shows these and hides the rest: a column of empty cells is
 * worse than no column, and it is what made the page look like it had nothing
 * in it. Computed from the mapping and confirmed against the rows in hand, so a
 * mapped-but-always-empty field does not earn a column either.
 */
export function populatedColumns(
  events: NormalizedEvent[],
  columns: readonly (keyof NormalizedEvent)[],
): (keyof NormalizedEvent)[] {
  return columns.filter((column) => {
    if (column === "time" || column === "severityId") return true; // always meaningful
    return events.some((event) => {
      const value = event[column];
      return typeof value === "number" ? value > 0 : isPresent(value);
    });
  });
}

/**
 * Counts by category for the facet strip: severity, outcome, and the busiest
 * actors, hosts and source IPs. Computed over the rows on screen, which is what
 * the analyst is actually looking at.
 */
export interface EventFacets {
  severity: { id: number; count: number }[];
  status: { id: number; count: number }[];
  topActors: { value: string; count: number }[];
  topHosts: { value: string; count: number }[];
  topSourceIps: { value: string; count: number }[];
}

function topValues(events: NormalizedEvent[], key: keyof NormalizedEvent, limit = 5) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const value = asText(event[key]);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function buildFacets(events: NormalizedEvent[]): EventFacets {
  const severity = new Map<number, number>();
  const status = new Map<number, number>();
  for (const event of events) {
    severity.set(event.severityId, (severity.get(event.severityId) ?? 0) + 1);
    status.set(event.statusId, (status.get(event.statusId) ?? 0) + 1);
  }
  return {
    severity: [...severity.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.id - a.id),
    status: [...status.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
    topActors: topValues(events, "actor"),
    topHosts: topValues(events, "host"),
    topSourceIps: topValues(events, "srcIp"),
  };
}
