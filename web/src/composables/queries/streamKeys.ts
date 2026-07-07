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

// Centralised query keys for the streams module. Keys are hierarchical so a
// broad invalidation (`streamKeys.all(org)`) refreshes every streams query for
// an org, while a specific list combo stays independently cached.
//
// The org identifier is part of every key — switching org is a natural cache
// miss and never leaks another org's data.

export interface StreamListParamsShape {
  type: string;
  offset: number;
  limit: number;
  keyword: string;
  sort: string;
  asc: boolean;
}

export const streamKeys = {
  all: (org: string) => ["streams", org] as const,

  // Paginated list used by the streams list page (LogStream.vue). One cache
  // entry per page / filter / sort combination.
  list: (org: string, params: StreamListParamsShape) =>
    ["streams", org, "list", params] as const,

  // Full, un-paginated fetch of a single stream type (cache-based path).
  byType: (org: string, type: string) =>
    ["streams", org, "type", type] as const,

  // Single stream schema.
  schema: (org: string, type: string, name: string) =>
    ["streams", org, "type", type, "schema", name] as const,
};
