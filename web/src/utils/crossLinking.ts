// Copyright 2023 OpenObserve Inc.
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

// Stream types for which the cross-linking feature (and its `result_schema`
// API call) is supported. Cross-linking is only meaningful for logs streams;
// the `result_schema` endpoint errors for other stream types (metrics, traces,
// enrichment_tables), so the call must be skipped for them.
export const CROSS_LINKING_SUPPORTED_STREAM_TYPES = ["logs"] as const;

/**
 * Returns true when cross-linking should be active for the given stream type.
 * Requires the `enable_cross_linking` config flag to be on AND the stream type
 * to be one of the supported types.
 */
export const isCrossLinkingEnabledForStream = (
  zoConfig: any,
  streamType: string | undefined,
): boolean =>
  !!zoConfig?.enable_cross_linking &&
  CROSS_LINKING_SUPPORTED_STREAM_TYPES.includes(streamType as any);
