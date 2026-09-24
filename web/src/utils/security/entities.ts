// Copyright 2026 OpenObserve Inc.
//
// entities.ts — who and what appears across the security streams.
//
// An entity is a user, a source IP or a host. Each stream names them
// differently (CloudTrail's `useridentity_username`, an auth log's `user`), so
// every stream gets a plan first: which of its columns holds each kind of
// entity, and how a failed event is recognised. The detected source's field
// map wins; a short list of common column names is the fallback, because
// generic sources (syslog, application logs) map no actor at all.
//
// All counting is a server-side GROUP BY per stream; streams are merged here by
// entity value. Nothing is sampled from the rows on screen.

import type { SourceType } from "./sourceTypes";
import { FieldIndex } from "./fields";
import { failurePredicate, outcomeInterpretable } from "./outcome";

export type EntityKind = "user" | "ip" | "host";
export const ENTITY_KINDS: EntityKind[] = ["user", "ip", "host"];

/** Normalized-column name each kind is read from in a source's field map. */
const MAP_KEY: Record<EntityKind, "actor" | "srcIp" | "host"> = {
  user: "actor",
  ip: "srcIp",
  host: "host",
};

/** Common spellings, tried when the source's map has no column for the kind. */
export const ENTITY_FALLBACKS: Record<EntityKind, string[]> = {
  user: [
    "user",
    "username",
    "user_name",
    "actor_user_name",
    "useridentity_username",
    "principal",
    "account",
  ],
  ip: [
    "src_ip",
    "source_ip",
    "client_ip",
    "src_endpoint_ip",
    "sourceipaddress",
    "remote_addr",
    "ip",
  ],
  host: ["host", "hostname", "device_hostname", "computer", "computer_name", "host_name"],
};

// Outcome columns tried when the source maps none; each is only trusted after
// sampling shows its values are readable (words or HTTP-style codes).
const OUTCOME_FALLBACKS = ["outcome", "status", "result", "event_outcome", "action_result"];

export interface StreamPlan {
  stream: string;
  sourceLabel: string | null;
  columns: Partial<Record<EntityKind, string>>;
  /** Candidate outcome column awaiting sampling; cleared once accepted or rejected. */
  outcomeColumn: string | null;
  /** SQL boolean expression for a failed event, or null when the stream says nothing readable. */
  failure: string | null;
}

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;

function resolveFirst(index: FieldIndex, paths: string[] | undefined): string | null {
  for (const path of paths ?? []) {
    for (const option of path.split("|")) {
      const column = index.resolve(option);
      if (column) return column;
    }
  }
  return null;
}

// Which columns hold entities and outcome. A presence-style failure (errorCode) is
// final; a value-style outcome column waits for `acceptOutcome` to see its values.
export function planStream(
  stream: string,
  fields: string[],
  source: SourceType | null,
): StreamPlan {
  const index = new FieldIndex(fields);
  const columns: Partial<Record<EntityKind, string>> = {};
  for (const kind of ENTITY_KINDS) {
    const column =
      resolveFirst(index, source?.map?.[MAP_KEY[kind]] as string[] | undefined) ??
      resolveFirst(index, ENTITY_FALLBACKS[kind]);
    if (column) columns[kind] = column;
  }

  const presence = (source?.failureWhenPresent ?? [])
    .map((path) => index.resolve(path))
    .filter((c): c is string => !!c);
  if (presence.length) {
    return {
      stream,
      sourceLabel: source?.label ?? null,
      columns,
      outcomeColumn: null,
      // An error field exists only on a failed call.
      failure: presence
        .map((c) => `(${quoteIdent(c)} IS NOT NULL AND CAST(${quoteIdent(c)} AS VARCHAR) != '')`)
        .join(" OR "),
    };
  }
  const outcomeColumn =
    resolveFirst(index, source?.map?.statusId as string[] | undefined) ??
    resolveFirst(index, OUTCOME_FALLBACKS);
  return { stream, sourceLabel: source?.label ?? null, columns, outcomeColumn, failure: null };
}

/** Accepts the candidate outcome column only if its real values can be read. */
export function acceptOutcome(
  plan: StreamPlan,
  sample: { value: unknown; n: number }[],
): StreamPlan {
  if (!plan.outcomeColumn) return plan;
  return {
    ...plan,
    failure: outcomeInterpretable(sample) ? failurePredicate(plan.outcomeColumn) : null,
    outcomeColumn: null,
  };
}

const failSum = (plan: StreamPlan) =>
  plan.failure ? `SUM(CASE WHEN ${plan.failure} THEN 1 ELSE 0 END)` : "0";

const present = (column: string) =>
  `${quoteIdent(column)} IS NOT NULL AND CAST(${quoteIdent(column)} AS VARCHAR) != ''`;

/** The kind whose distinct count says how widely an entity spreads. */
export const PEER_KIND: Record<EntityKind, EntityKind> = { user: "ip", ip: "user", host: "user" };

/** Per-entity totals for one stream and kind. Null when the stream has no such column. */
export function entityAggSql(plan: StreamPlan, kind: EntityKind, limit: number): string | null {
  const column = plan.columns[kind];
  if (!column) return null;
  const peer = plan.columns[PEER_KIND[kind]];
  // Empty strings are not a peer; COUNT(DISTINCT) would count "" as one.
  const peers = peer
    ? `COUNT(DISTINCT CASE WHEN ${present(peer)} THEN CAST(${quoteIdent(peer)} AS VARCHAR) END)`
    : "0";
  return (
    `SELECT CAST(${quoteIdent(column)} AS VARCHAR) AS zo_entity, COUNT(*) AS zo_n, ` +
    `${failSum(plan)} AS zo_fail, MIN(_timestamp) AS zo_first, MAX(_timestamp) AS zo_last, ` +
    `${peers} AS zo_peers FROM ${quoteIdent(plan.stream)} WHERE ${present(column)} ` +
    `GROUP BY zo_entity ORDER BY zo_n DESC LIMIT ${limit}`
  );
}

/** Events over time for one entity in one stream, split into ok and failed. */
export function entityTimelineSql(
  plan: StreamPlan,
  kind: EntityKind,
  value: string,
  interval: string,
): string | null {
  const column = plan.columns[kind];
  if (!column) return null;
  return (
    `SELECT histogram(_timestamp, '${interval}') AS zo_ts, COUNT(*) AS zo_n, ${failSum(plan)} AS zo_fail ` +
    `FROM ${quoteIdent(plan.stream)} WHERE CAST(${quoteIdent(column)} AS VARCHAR) = ${quoteString(value)} ` +
    `GROUP BY zo_ts ORDER BY zo_ts`
  );
}

/** Top counterpart values of another kind for one entity in one stream. */
export function relatedSql(
  plan: StreamPlan,
  kind: EntityKind,
  value: string,
  other: EntityKind,
  limit: number,
): string | null {
  const column = plan.columns[kind];
  const otherColumn = plan.columns[other];
  if (!column || !otherColumn || otherColumn === column) return null;
  return (
    `SELECT CAST(${quoteIdent(otherColumn)} AS VARCHAR) AS zo_value, COUNT(*) AS zo_n, ${failSum(plan)} AS zo_fail ` +
    `FROM ${quoteIdent(plan.stream)} WHERE CAST(${quoteIdent(column)} AS VARCHAR) = ${quoteString(value)} ` +
    `AND ${present(otherColumn)} GROUP BY zo_value ORDER BY zo_n DESC LIMIT ${limit}`
  );
}

export interface EntityRow {
  value: string;
  events: number;
  failures: number;
  /** Events from streams that can report failures — the failure rate's denominator. */
  failureEvents: number;
  /** Microseconds. */
  firstSeen: number;
  lastSeen: number;
  streams: string[];
  /** Distinct counterparts, as the largest count in any one stream (a lower bound). */
  peers: number;
  /** Whether any contributing stream can report failures at all. */
  failureKnown: boolean;
}

export interface AggHit {
  zo_entity: unknown;
  zo_n: unknown;
  zo_fail: unknown;
  zo_first: unknown;
  zo_last: unknown;
  zo_peers: unknown;
}

/** Folds per-stream aggregates into one row per entity value. */
export function mergeEntities(perStream: { plan: StreamPlan; hits: AggHit[] }[]): EntityRow[] {
  const byValue = new Map<string, EntityRow>();
  for (const { plan, hits } of perStream) {
    for (const hit of hits) {
      const value = String(hit.zo_entity ?? "");
      if (!value) continue;
      const row = byValue.get(value) ?? {
        value,
        events: 0,
        failures: 0,
        failureEvents: 0,
        firstSeen: Number.POSITIVE_INFINITY,
        lastSeen: 0,
        streams: [],
        peers: 0,
        failureKnown: false,
      };
      const n = Number(hit.zo_n ?? 0) || 0;
      row.events += n;
      if (plan.failure) {
        row.failures += Number(hit.zo_fail ?? 0) || 0;
        row.failureEvents += n;
        row.failureKnown = true;
      }
      row.firstSeen = Math.min(row.firstSeen, Number(hit.zo_first ?? Infinity));
      row.lastSeen = Math.max(row.lastSeen, Number(hit.zo_last ?? 0));
      row.peers = Math.max(row.peers, Number(hit.zo_peers ?? 0) || 0);
      if (!row.streams.includes(plan.stream)) row.streams.push(plan.stream);
      byValue.set(value, row);
    }
  }
  return [...byValue.values()]
    .map((r) => ({ ...r, firstSeen: Number.isFinite(r.firstSeen) ? r.firstSeen : 0 }))
    .sort((a, b) => b.events - a.events);
}

/** Failure share over the events that could have reported a failure. */
export const failureRate = (row: EntityRow) =>
  row.failureEvents ? row.failures / row.failureEvents : 0;

export type EntitySignal = "failures" | "spread" | "external";

/** Thresholds for the table's signal chips. Deliberately few and explainable. */
export const SIGNAL_THRESHOLDS = {
  /** A failure share at or above this, with at least `minFailures`, is flagged. */
  failureRate: 0.2,
  minFailures: 5,
  /** A user from this many IPs, or an IP/host used by this many users. */
  spread: 5,
};

/** Non-public IPv4: private, loopback, link-local, CGNAT, benchmarking, documentation, multicast. */
function isNonPublicV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && ip.split(".")[2] === "2") ||
    (a === 198 && b === 51 && ip.split(".")[2] === "100") ||
    (a === 203 && b === 0 && ip.split(".")[2] === "113") ||
    a >= 224
  );
}

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** A routable public address; anything not a well-formed IP (host:port, name) is not. */
export function isExternalIp(value: string): boolean {
  const v = value.trim().toLowerCase();
  const v4 = v.match(V4);
  if (v4) {
    if (v4.slice(1).some((o) => Number(o) > 255)) return false;
    return !isNonPublicV4(v);
  }
  // IPv6: must look like one (hex groups and colons only, at least two colons).
  if (!/^[0-9a-f:.]+$/.test(v) || (v.match(/:/g) ?? []).length < 2) return false;
  const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isExternalIp(mapped[1]);
  if (v === "::" || v === "::1") return false;
  // Unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8, documentation 2001:db8::/32.
  return !/^(f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|ff[0-9a-f]{2}:|2001:0?db8:)/.test(v);
}

export function entitySignals(kind: EntityKind, row: EntityRow): EntitySignal[] {
  const signals: EntitySignal[] = [];
  if (
    row.failureKnown &&
    row.failures >= SIGNAL_THRESHOLDS.minFailures &&
    failureRate(row) >= SIGNAL_THRESHOLDS.failureRate
  ) {
    signals.push("failures");
  }
  if (row.peers >= SIGNAL_THRESHOLDS.spread) signals.push("spread");
  if (kind === "ip" && isExternalIp(row.value)) signals.push("external");
  return signals;
}
