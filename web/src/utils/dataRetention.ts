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

export const RETENTION_STREAM_TYPES = ["logs", "metrics", "traces", "profiles"] as const;

export type RetentionStreamType = (typeof RETENTION_STREAM_TYPES)[number];

export type RetentionKey = "default" | RetentionStreamType;

export type ResolvedDataRetention = Record<RetentionKey, number>;

interface RetentionState {
  organizationData?: {
    organizationSettings?: { resolved_data_retention?: ResolvedDataRetention };
  };
  zoConfig?: { data_retention_defaults?: ResolvedDataRetention };
}

const metadataSourceType = (streamName: string): RetentionStreamType | undefined => {
  if (streamName.startsWith("trace_time_index_")) return "traces";
  if (!streamName.startsWith("distinct_values_")) return undefined;
  const typedName = streamName.slice("distinct_values_".length);
  return RETENTION_STREAM_TYPES.find((type) => typedName.startsWith(`${type}_`));
};

export const retentionKeyFor = (streamType: string, streamName = ""): RetentionKey => {
  if (streamType === "metadata") return metadataSourceType(streamName) ?? "default";
  return (RETENTION_STREAM_TYPES as readonly string[]).includes(streamType)
    ? (streamType as RetentionStreamType)
    : "default";
};

/** Days a stream with no value of its own keeps data, 0 for forever; the backend owns the ordering. */
export const inheritedRetentionDays = (
  state: RetentionState,
  streamType: string,
  streamName = "",
): number => {
  const resolved =
    state.organizationData?.organizationSettings?.resolved_data_retention ??
    state.zoConfig?.data_retention_defaults;
  return Number(resolved?.[retentionKeyFor(streamType, streamName)] ?? 0);
};
