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

/**
 * RUM internal-namespace fields, readable under BOTH spellings.
 *
 * The SDKs emit a reserved namespace for fields the product owns rather than the
 * instrumented app: trace linkage, action targets, tags. Ingestion flattens it, so
 * `_oo.trace_id` lands as the column `_oo_trace_id`.
 *
 * That namespace is migrating from `_oo_` to `_o2_`, and the two will coexist
 * indefinitely:
 *
 *   - data already ingested keeps `_oo_*` forever — renaming a field does not rewrite
 *     history, and a stream ends up carrying both column sets;
 *   - the SDKs cut over on their own schedules (mobile first, browser in a later
 *     release), so at any moment a single org can be receiving both.
 *
 * So this is the steady state, not a transition shim. Reading only one spelling makes
 * data from the other SDK silently invisible — no error, just an empty trace tab or a
 * missing "View Trace" link, which reads as the SDK being broken.
 */

/** Field names as they appear WITHOUT the namespace prefix. */
export type RumInternalField =
  | "trace_id"
  | "span_id"
  | "action_target_text"
  | "action_target_selector"
  | "tags"
  | "query_param"
  | "header";

/** Preferred spelling first — new data wins when a row somehow carries both. */
export const rumFieldNames = (field: string): [string, string] => [
  `_o2_${field}`,
  `_oo_${field}`,
];

/**
 * Read an internal field off an ingested row under either spelling.
 * `??` rather than `||` so a legitimately falsy value (0, "") is not skipped in favour
 * of the legacy column.
 */
export function rumField<T = any>(row: any, field: RumInternalField | string): T {
  const [next, legacy] = rumFieldNames(field);
  return row?.[next] ?? row?.[legacy];
}

/** True when a row carries the field under either spelling. */
export function hasRumField(row: any, field: RumInternalField | string): boolean {
  return rumField(row, field) != null;
}

/**
 * Which spellings of `field` actually exist in a stream schema.
 *
 * SQL cannot simply reference both: naming a column the stream does not have fails the
 * whole query, which would break the feature for everyone rather than degrade it. Every
 * SQL builder below therefore asks the schema first.
 *
 * @param schema `stream.schema` as returned by `getStream()`.
 */
export function presentRumFields(schema: any[] | undefined, field: string): string[] {
  const names = new Set((schema ?? []).map((f: any) => f?.name));
  return rumFieldNames(field).filter((n) => names.has(n));
}

/**
 * A SQL expression selecting `field` under whichever spellings the stream has, or
 * `null` when it has neither (caller should skip the feature rather than build a query
 * that cannot run).
 *
 * One column  -> `_o2_trace_id`
 * Both        -> `COALESCE(_o2_trace_id, _oo_trace_id)`
 */
export function rumFieldSql(
  schema: any[] | undefined,
  field: RumInternalField | string,
): string | null {
  const present = presentRumFields(schema, field);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return `COALESCE(${present.join(", ")})`;
}

/**
 * A SQL predicate matching `field` against a value under either spelling, or `null`
 * when the stream has neither. Written as OR rather than `COALESCE(...) = v` so each
 * column can still use its own index.
 *
 * The value is interpolated by the caller and MUST already be sanitized.
 */
export function rumFieldEqualsSql(
  schema: any[] | undefined,
  field: RumInternalField | string,
  sanitizedValue: string,
): string | null {
  const present = presentRumFields(schema, field);
  if (present.length === 0) return null;
  return `(${present.map((n) => `${n} = '${sanitizedValue}'`).join(" OR ")})`;
}

/** A SQL predicate for "field is set", under either spelling. */
export function rumFieldNotNullSql(
  schema: any[] | undefined,
  field: RumInternalField | string,
): string | null {
  const present = presentRumFields(schema, field);
  if (present.length === 0) return null;
  return `(${present.map((n) => `${n} IS NOT NULL`).join(" OR ")})`;
}
