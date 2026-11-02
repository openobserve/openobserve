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
import { compileLabelFilters, type LabelMatchOp } from "@/components/promql/labelBoolean";

/** PromQL matcher operator -> SQL predicate over a label column. */
const PREDICATE: Record<string, (column: string, literal: string) => string> = {
  "=": (column, literal) => `${column} = ${literal}`,
  "!=": (column, literal) => `${column} != ${literal}`,
  // The regexp UDFs (src/search/src/datafusion/udf/regexp_udf.rs).
  "=~": (column, literal) => `re_match(${column}, ${literal})`,
  "!~": (column, literal) => `re_not_match(${column}, ${literal})`,
};

const predicateOf = (filter: { label: string; operator: string; value: string }): string => {
  const predicate = PREDICATE[filter.operator] ?? PREDICATE["="];
  let value = String(filter.value ?? "");
  // PromQL regex matchers are fully anchored; re_match is a find, so anchor it.
  if (filter.operator === "=~" || filter.operator === "!~") value = `^(?:${value})$`;
  const literal = `'${value.replace(/'/g, "''")}'`;
  return predicate(`"${filter.label}"`, literal);
};

/** A full SELECT, not a bare clause: the field-values endpoint picks the WHERE out of a statement. */
export function labelFiltersToSql(stream: string, filters: LabelFilter[]): string {
  const base = `SELECT * FROM "${stream}"`;
  const compiled = compileLabelFilters(
    filters.map((f) => ({ ...f, label: String(f.label), op: (f.operator ?? "=") as LabelMatchOp })),
  );
  // Past the branch cap the PromQL side does not run either, so the values go unfiltered.
  if (!compiled.ok || compiled.branches.some((branch) => !branch.length)) return base;
  const branches = compiled.branches.map((branch) =>
    branch.map((m) => predicateOf({ label: m.label, operator: m.op, value: m.value })),
  );
  if (branches.length === 1) return `${base} WHERE ${branches[0].join(" AND ")}`;
  return `${base} WHERE ${branches.map((b) => `(${b.join(" AND ")})`).join(" OR ")}`;
}
