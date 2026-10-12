// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/** Every stream name O2 writes itself; the const of the same name in src/config/src/meta/self_reporting/usage.rs must hold the same names. */
export const INTERNAL_STREAM_NAMES = [
  "usage",
  "audit",
  "stats",
  "triggers",
  "errors",
  "data_retention_usage",
  "cloud_events",
  "_agent_signals",
  "_redaction_evidence",
  "_evaluator",
  "_llm_scores",
  "_llm_experiment",
  "_anomalies",
] as const;

export const INTERNAL_STREAM_PREFIXES = ["_o2_"] as const;

/** RUM streams (_rumdata, _rumlog, _sessionreplay) are logs, so they count as user data. */
export const USER_DATA_STREAM_TYPES = ["logs", "metrics", "traces"] as const;

export type UserDataStreamType = (typeof USER_DATA_STREAM_TYPES)[number];

const INTERNAL_NAMES: ReadonlySet<string> = new Set(INTERNAL_STREAM_NAMES);

export function isInternalStreamName(name: string): boolean {
  return INTERNAL_NAMES.has(name) || INTERNAL_STREAM_PREFIXES.some((p) => name.startsWith(p));
}

export function isUserDataStreamType(streamType: string): streamType is UserDataStreamType {
  return (USER_DATA_STREAM_TYPES as readonly string[]).includes(streamType);
}

/** True only for a logs, metrics or traces stream that O2 does not write itself. */
export function isUserDataStream(name: string, streamType: string): boolean {
  return isUserDataStreamType(streamType) && !isInternalStreamName(name);
}

/** The rows of a stream list that hold user data. */
export function userDataStreams<T extends { name?: string; stream_type?: string }>(
  list: readonly T[] | undefined | null,
): T[] {
  return (list ?? []).filter((s) => isUserDataStream(s?.name ?? "", s?.stream_type ?? ""));
}
