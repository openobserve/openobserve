// Copyright 2026 OpenObserve Inc.
//
// streamPlan.ts — which columns of a security stream hold users, IPs and hosts,
// and how a failed event is recognised. The server builds every query from these
// plans; the detected source's field map wins, common column names are the fallback.

import type { SourceType } from "@/services/securitySources";
import { FieldIndex } from "./fields";
import { outcomeInterpretable } from "./outcome";

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

// Tried when the source maps none; trusted only after sampling shows readable values.
const OUTCOME_FALLBACKS = ["outcome", "status", "result", "event_outcome", "action_result"];

/** How a stream says an event failed; the server turns it into SQL. */
export type FailureSpec =
  | { kind: "present"; columns: string[] }
  | { kind: "ocsf_status"; column: string }
  | { kind: "outcome"; column: string }
  | {
      kind: "event_code";
      column: string;
      codes: number[];
      statusCodes?: number[];
      status?: string;
      keywords?: string;
    };

export interface StreamPlan {
  stream: string;
  sourceLabel: string | null;
  columns: Partial<Record<EntityKind, string>>;
  /** Candidate outcome column awaiting sampling; cleared once accepted or rejected. */
  outcomeColumn: string | null;
  /** How a failed event is recognised, or null when the stream says nothing readable. */
  failure: FailureSpec | null;
  /** Row count and time span from the stream's stats; absent when unknown. */
  volume?: StreamVolume | null;
  /** Columns the cross-source hunt shows as action and message; absent when unmapped. */
  actionColumn?: string | null;
  messageColumn?: string | null;
}

export interface StreamVolume {
  docNum: number;
  /** Microseconds. */
  timeMinUs: number;
  timeMaxUs: number;
}

/** Above this many estimated rows in the window, a stream defaults to its last hour. */
export const LARGE_STREAM_ROWS = 50_000_000;

function resolveFirst(index: FieldIndex, paths: string[] | undefined): string | null {
  for (const path of paths ?? []) {
    for (const option of path.split("|")) {
      const column = index.resolve(option);
      if (column) return column;
    }
  }
  return null;
}

// The source names its failure event codes, e.g. Windows 4625; a code needing a status drops without one.
function eventCodeFailure(index: FieldIndex, when: SourceType["failureWhen"]): FailureSpec | null {
  if (!when) return null;
  const column = resolveFirst(index, [when.field]);
  if (!column) return null;
  const status = when.status ? resolveFirst(index, [when.status]) : null;
  const keywords = when.keywords ? resolveFirst(index, [when.keywords]) : null;
  const statusCodes = status ? (when.statusCodes ?? []) : [];
  if (!when.codes.length && !statusCodes.length && !keywords) return null;
  return {
    kind: "event_code",
    column,
    codes: when.codes,
    ...(status && statusCodes.length ? { statusCodes, status } : {}),
    ...(keywords ? { keywords } : {}),
  };
}

// A presence-style failure is final; a value-style column waits for `acceptOutcome`.
export function planStream(
  stream: string,
  fields: string[],
  source: SourceType | null,
): StreamPlan {
  const index = new FieldIndex(fields);
  const display = {
    actionColumn: resolveFirst(index, source?.map?.activity as string[] | undefined),
    messageColumn:
      resolveFirst(index, source?.map?.message as string[] | undefined) ??
      resolveFirst(index, ["message", "msg", "log"]),
  };
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
      ...display,
      columns,
      outcomeColumn: null,
      // An error field exists only on a failed call.
      failure: { kind: "present", columns: presence },
    };
  }
  // An OCSF status_id is an enum, so it needs no sampling: 2 is Failure.
  const ocsfStatus = resolveFirst(index, source?.ocsfStatusFields);
  if (ocsfStatus) {
    return {
      stream,
      sourceLabel: source?.label ?? null,
      ...display,
      columns,
      outcomeColumn: null,
      failure: { kind: "ocsf_status", column: ocsfStatus },
    };
  }
  const eventCode = eventCodeFailure(index, source?.failureWhen);
  if (eventCode) {
    return {
      stream,
      sourceLabel: source?.label ?? null,
      ...display,
      columns,
      outcomeColumn: null,
      failure: eventCode,
    };
  }
  const outcomeColumn =
    resolveFirst(index, source?.map?.statusId as string[] | undefined) ??
    resolveFirst(index, OUTCOME_FALLBACKS);
  return {
    stream,
    sourceLabel: source?.label ?? null,
    ...display,
    columns,
    outcomeColumn,
    failure: null,
  };
}

/** Accepts the candidate outcome column only if its real values can be read. */
export function acceptOutcome(
  plan: StreamPlan,
  sample: { value: unknown; n: number }[],
): StreamPlan {
  if (!plan.outcomeColumn) return plan;
  return {
    ...plan,
    failure: outcomeInterpretable(sample) ? { kind: "outcome", column: plan.outcomeColumn } : null,
    outcomeColumn: null,
  };
}

/** Reads the `/streams` stats block; null when it lacks a row count or time span. */
export function volumeFromStats(stats: unknown): StreamVolume | null {
  const s = (stats ?? {}) as Record<string, unknown>;
  const docNum = Number(s.doc_num);
  const timeMinUs = Number(s.doc_time_min);
  const timeMaxUs = Number(s.doc_time_max);
  // A missing time reads as 0 (1970), which would spread the rows over decades.
  if (!(docNum > 0) || !(timeMinUs > 0) || !(timeMaxUs >= timeMinUs)) return null;
  return { docNum, timeMinUs, timeMaxUs };
}

/** Rows expected in [startUs, endUs], from the overlap with the stream's history at an even rate. */
export function estimateRowsInWindow(
  volume: StreamVolume | null | undefined,
  startUs: number,
  endUs: number,
): number | null {
  if (!volume || !(volume.docNum > 0) || !(endUs > startUs)) return null;
  const overlap = Math.min(endUs, volume.timeMaxUs) - Math.max(startUs, volume.timeMinUs);
  const span = volume.timeMaxUs - volume.timeMinUs;
  if (!(span > 0)) return overlap >= 0 ? volume.docNum : 0;
  if (overlap <= 0) return 0;
  return (volume.docNum * overlap) / span;
}
