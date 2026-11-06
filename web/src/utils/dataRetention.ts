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

export const RETENTION_STREAM_TYPES = [
  "logs",
  "metrics",
  "traces",
  "profiles",
  "metadata",
] as const;

export type RetentionStreamType = (typeof RETENTION_STREAM_TYPES)[number];

export type RetentionKey = "default" | RetentionStreamType;

export type ResolvedDataRetention = Record<RetentionKey, number>;

interface RetentionState {
  organizationData?: {
    organizationSettings?: { resolved_data_retention?: ResolvedDataRetention };
  };
  zoConfig?: { data_retention_days?: number };
}

interface RetentionStream {
  stream_type?: string;
  settings?: { data_retention?: number } | null;
}

export const retentionKeyFor = (streamType: string): RetentionKey =>
  (RETENTION_STREAM_TYPES as readonly string[]).includes(streamType)
    ? (streamType as RetentionStreamType)
    : "default";

/** Days a stream with no value of its own keeps data, 0 for forever; the backend owns the ordering. */
export const inheritedRetentionDays = (state: RetentionState, streamType: string): number => {
  const resolved = state.organizationData?.organizationSettings?.resolved_data_retention;
  return Number(
    resolved ? resolved[retentionKeyFor(streamType)] : (state.zoConfig?.data_retention_days ?? 0),
  );
};

export const isShorterRetention = (before: number, after: number): boolean =>
  after > 0 && (before <= 0 || after < before);

export const loweredRetentionKeys = (
  before: ResolvedDataRetention,
  after: ResolvedDataRetention,
): RetentionKey[] =>
  (Object.keys(after) as RetentionKey[]).filter((key) =>
    isShorterRetention(before[key], after[key]),
  );

/** Streams that lose data when these defaults shrink: no value of their own, and subject to retention. */
export const countInheritingStreams = (streams: RetentionStream[], keys: RetentionKey[]): number =>
  streams.filter((stream) => {
    const type = stream.stream_type ?? "logs";
    if (["enrichment_tables", "file_list", "index"].includes(type)) return false;
    if (Number(stream.settings?.data_retention ?? 0) > 0) return false;
    return keys.includes(retentionKeyFor(type));
  }).length;
