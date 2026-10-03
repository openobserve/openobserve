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

import type { LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

/** PromQL matcher operator -> SQL predicate over a label column. */
const PREDICATE: Record<string, (column: string, literal: string) => string> = {
  "=": (column, literal) => `${column} = ${literal}`,
  "!=": (column, literal) => `${column} != ${literal}`,
  // The regexp UDFs (src/search/src/datafusion/udf/regexp_udf.rs).
  "=~": (column, literal) => `re_match(${column}, ${literal})`,
  "!~": (column, literal) => `re_not_match(${column}, ${literal})`,
};

/**
 * The Explorer's label filters as a complete SQL statement over one stream.
 *
 * Handed to the field-values endpoint as `query_context`, so the value counts
 * reflect the filters. A complete `SELECT … WHERE …` and not a bare clause: the
 * server parses a full statement to pick the WHERE out of it.
 */
export function labelFiltersToSql(stream: string, filters: LabelFilter[]): string {
  const where = filters.map((filter) => {
    const predicate = PREDICATE[filter.operator ?? "="] ?? PREDICATE["="];
    const literal = `'${String(filter.value ?? "").replace(/'/g, "''")}'`;
    return predicate(`"${filter.label}"`, literal);
  });
  const base = `SELECT * FROM "${stream}"`;
  return where.length ? `${base} WHERE ${where.join(" AND ")}` : base;
}
