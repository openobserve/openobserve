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

const BASE = ["_timestamp", "event_name", "k8s_cluster", "k8s_namespace_name", "k8s_resource_name"];

export const LEVEL3_COLUMNS = [
  ...BASE,
  "body_type",
  "body_object_kind",
  "body_object_type",
  "body_object_reason",
  "body_object_note",
  "body_object_regarding",
  "body_object_reportingcontroller",
  "body_object_reportinginstance",
  "body_object_series",
  "body_object_deprecatedcount",
  "body_object_eventtime",
  "body_object_metadata",
  "body_object_spec",
  "body_object_status",
];

export const LEVEL0_COLUMNS = [
  ...BASE,
  "body_type",
  "body_object_kind",
  "body_object_type",
  "body_object_reason",
  "body_object_note",
  "body_object_regarding_kind",
  "body_object_regarding_name",
  "body_object_regarding_namespace",
  "body_object_regarding_uid",
  "body_object_reportingcontroller",
  "body_object_reportinginstance",
  "body_object_series_count",
  "body_object_series_lastobservedtime",
  "body_object_deprecatedcount",
  "body_object_eventtime",
  "body_object_metadata_uid",
  "body_object_metadata_name",
  "body_object_metadata_creationtimestamp",
  "body_object_status_conditions",
  "body_object_status_containerstatuses",
  "body_object_status_qosclass",
  "body_object_spec_unschedulable",
];

export const LEVEL2_COLUMNS = [...BASE, "body_type", "body_object"];

export const LEVEL1_COLUMNS = [...BASE, "body"];

export const MIXED_3_2_COLUMNS = [...LEVEL3_COLUMNS, "body_object"];

export const MIXED_3_0_COLUMNS = [...new Set([...LEVEL3_COLUMNS, ...LEVEL0_COLUMNS])];

export const SCHEMAS: Record<string, string[]> = {
  "level 3": LEVEL3_COLUMNS,
  "level 0": LEVEL0_COLUMNS,
  "level 2": LEVEL2_COLUMNS,
  "level 1": LEVEL1_COLUMNS,
  "mixed 3+2": MIXED_3_2_COLUMNS,
  "mixed 3+0": MIXED_3_0_COLUMNS,
};

// Stream columns a query reads that the schema lacks; aliases it defines itself are not stream columns.
export function missingColumns(sql: string, schema: string[]): string[] {
  const aliases = new Set([...sql.matchAll(/ AS (\w+)/g)].map((m) => m[1]));
  const refs = new Set(sql.match(/\bbody(?:_object\w*|_type)?\b(?!')/g) ?? []);
  return [...refs].filter((r) => !schema.includes(r) && !aliases.has(r));
}
