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

/** Streams the server marks is_internal that hold the customer's own data; USER_SOURCED_STREAM_NAMES in usage.rs must hold the same names. */
export const USER_SOURCED_STREAM_NAMES = [
  "_o2_dbm_server",
  "_rumdata",
  "_rumlog",
  "_sessionreplay",
  "synthetics_results",
  "synthetics_step_results",
] as const;

export const USER_DATA_STREAM_TYPES = ["logs", "metrics", "traces", "profiles"] as const;

export type UserDataStreamType = (typeof USER_DATA_STREAM_TYPES)[number];

/** The stream-list row fields that decide whether a stream holds user data. */
export interface StreamOwnership {
  name?: string;
  stream_type?: string;
  is_internal?: boolean;
}

const USER_SOURCED_NAMES: ReadonlySet<string> = new Set(USER_SOURCED_STREAM_NAMES);

// the service graph derives traces_service_graph_* metrics from any traces, sample ones included
const DERIVED_STREAM_PREFIX = "traces_service_graph_";

export function isUserDataStreamType(streamType: string): streamType is UserDataStreamType {
  return (USER_DATA_STREAM_TYPES as readonly string[]).includes(streamType);
}

/** Mirrors is_user_data_stream in usage.rs: the server's is_internal already depends on the org, so meta-only names stay user data elsewhere. */
export function isUserDataStream(
  stream: StreamOwnership | null | undefined,
  fallbackType = "",
): boolean {
  return (
    isUserDataStreamType(stream?.stream_type ?? fallbackType) &&
    (stream?.is_internal !== true || USER_SOURCED_NAMES.has(stream?.name ?? "")) &&
    !(stream?.name ?? "").startsWith(DERIVED_STREAM_PREFIX)
  );
}

/** The rows of a stream list that hold user data. */
export function userDataStreams<T extends StreamOwnership>(
  list: readonly T[] | undefined | null,
): T[] {
  return (list ?? []).filter((s) => isUserDataStream(s));
}

interface OrgSummaryStreams {
  num_streams?: number | null;
  num_user_streams?: number | null;
}

/** Whether an org summary reports a user data stream; a summary without num_user_streams counts every stream. */
export function summaryHasUserData(
  summary: { streams?: OrgSummaryStreams | null } | null | undefined,
): boolean {
  const streams = summary?.streams;
  return !!(streams?.num_user_streams ?? streams?.num_streams);
}
