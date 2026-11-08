// Copyright 2026 OpenObserve Inc.

// Normalized on fetched rows, not in SQL, so a request never bakes in one source's field names.

import type { NormalizedEvent } from "./ocsf";
import { fromOcsfStatusId, ocsfClass, toOcsfSeverity, toOcsfStatus } from "./ocsf";
import type { SourceType } from "./sourceTypes";
import { readPath } from "./classify";
import { FieldIndex } from "./fields";

const isPresent = (value: unknown) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);

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

/** Mapped sources may return ISO strings or seconds, so everything is brought to milliseconds. */
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

/** Derived only where the source is silent; it never overrides a real severity. */
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
  // Sources that attach an error on failure say nothing on success, so absence is the success signal.
  const failureFields = source?.failureWhenPresent;
  const ocsfStatus = firstOf(raw, source?.ocsfStatusFields);
  const statusId = failureFields
    ? isPresent(firstOf(raw, failureFields))
      ? 2
      : 1
    : isPresent(ocsfStatus)
      ? fromOcsfStatusId(ocsfStatus)
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

/** Confirmed against the rows in hand, so a mapped-but-always-empty field earns no column. */
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

/** The stored column behind a value so a click filters on the real field; null when constant or derived. */
export function sourceColumnFor(
  raw: Record<string, unknown>,
  source: SourceType | null,
  column: keyof NormalizedEvent,
): string | null {
  const paths = column === "time" ? ["_timestamp"] : ((source?.map?.[column] as string[]) ?? []);
  const index = new FieldIndex(Object.keys(raw));
  for (const path of paths) {
    for (const option of path.split("|")) {
      if (isPresent(readPath(raw, option))) return index.resolve(option);
    }
  }
  return null;
}

/** Computed over the rows on screen, which is what the analyst is actually looking at. */
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
