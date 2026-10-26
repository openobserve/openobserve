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

/** Heatmap y-axis ordering (`heatmap_y_sort`), and the numeric y bucketing (`heatmap_y_bucket`) and range (`heatmap_y_min` / `heatmap_y_max`) the SQL builder generates. */

import { HEATMAP_MAX_CELLS } from "./heatmapDefaults";

/** The orders `heatmap_y_sort` accepts; unset is "data". ECharts draws category 0 at the bottom, so "asc" puts the smallest value there. */
export const HEATMAP_Y_SORTS = ["data", "asc", "desc"] as const;

/** The log bases `heatmap_y_bucket.base` accepts; the first is the default. */
export const HEATMAP_Y_LOG_BASES = [10, 2] as const;

export const HEATMAP_Y_NON_POSITIVE_LABEL = "≤ 0";

const NUMERIC_SCHEMA_TYPE = /^(U?Int(8|16|32|64)|Float(16|32|64))$/;

export type HeatmapYBucket = { mode: "size"; size: number } | { mode: "log"; base: 2 | 10 };

/** The y range kept; an unset end is open. */
export interface HeatmapYRange {
  min?: number;
  max?: number;
}

export interface HeatmapYBucketing {
  bucket: HeatmapYBucket;
  range: HeatmapYRange | null;
}

export type HeatmapYBucketError = "invalidSize" | "tooManyBuckets";

/** `items` ordered by `keyOf` per `order`: numerically when every key is a finite number, else by locale string compare; "data" or unset keeps them as given. */
export function sortHeatmapCategories<T>(
  items: T[],
  keyOf: (item: T) => unknown,
  order: unknown,
): T[] {
  if (order !== "asc" && order !== "desc") return items;
  const keys = items.map(keyOf);
  const numbers = keys.map(finiteNumberOf);
  const numeric = numbers.every((value) => value !== undefined);
  const compare = (a: number, b: number) =>
    numeric
      ? (numbers[a] as number) - (numbers[b] as number)
      : String(keys[a]).localeCompare(String(keys[b]));
  const sign = order === "asc" ? 1 : -1;
  return items
    .map((_item, index) => index)
    .sort((a, b) => sign * compare(a, b) || a - b)
    .map((index) => items[index]);
}

export function heatmapYBucketing(config: any): HeatmapYBucketing | null {
  const bucket = heatmapYBucketOf(config?.heatmap_y_bucket);
  return bucket ? { bucket, range: heatmapYRangeOf(config) } : null;
}

/** Why `config`'s bucketing must not run: a size that is not a finite number > 0, or a known range that makes more buckets than a grid can hold. */
export function heatmapYBucketError(config: any): HeatmapYBucketError | null {
  const mode = config?.heatmap_y_bucket?.mode;
  if (mode !== "size") return null;
  const size = finiteNumberOf(config.heatmap_y_bucket.size);
  if (size === undefined || size <= 0) return "invalidSize";
  const count = heatmapYBucketCount({ mode, size }, heatmapYRangeOf(config));
  return count !== null && count > HEATMAP_MAX_CELLS ? "tooManyBuckets" : null;
}

/** How many buckets `bucket` makes over `range`, or null when an open end leaves it unknown until the data arrives. */
export function heatmapYBucketCount(
  bucket: HeatmapYBucket,
  range: HeatmapYRange | null,
): number | null {
  // Log buckets are bounded by the double exponent range (about 2,100 at base 2), far under the cell budget.
  if (bucket.mode !== "size" || range?.min === undefined || range?.max === undefined) return null;
  return Math.floor(range.max / bucket.size) - Math.floor(range.min / bucket.size) + 1;
}

/** `heatmap_y_min` / `heatmap_y_max` as numbers, or null when neither is set or they are inverted (min >= max). */
export function heatmapYRangeOf(config: any): HeatmapYRange | null {
  const min = finiteNumberOf(config?.heatmap_y_min);
  const max = finiteNumberOf(config?.heatmap_y_max);
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined && min >= max) return null;
  return { min, max };
}

/** Whether both y range ends are set with min >= max, which the builder and converter ignore. */
export function isHeatmapYRangeInverted(config: any): boolean {
  const min = finiteNumberOf(config?.heatmap_y_min);
  const max = finiteNumberOf(config?.heatmap_y_max);
  return min !== undefined && max !== undefined && min >= max;
}

/** Whether `field` is a bare column of the builder, the only y the converter treats as bucketed. */
export function isPlainYField(field: any): boolean {
  return (
    !!field &&
    !field.isDerived &&
    !field.functionName &&
    field.args?.[0]?.type === "field" &&
    !!field.args[0].value?.field
  );
}

export function isNumericYField(field: any, dashboardPanelData: any): boolean {
  if (!isPlainYField(field)) return false;
  const { field: name, streamAlias } = field.args[0].value;
  const streamFields = dashboardPanelData?.meta?.streamFields?.groupedFields?.find((it: any) =>
    streamAlias ? it.stream_alias === streamAlias : it.stream_alias == null,
  );
  const type = streamFields?.schema?.find((it: any) => it.name === name)?.type;
  return NUMERIC_SCHEMA_TYPE.test(String(type ?? ""));
}

/** The SQL for the lower bound of the bucket holding `expr`; null y stays null rather than joining the <= 0 bucket. */
export function heatmapYBucketSql(expr: string, bucket: HeatmapYBucket): string {
  // Cast first: integer division truncates toward zero and would merge the two buckets around 0.
  const value = `CAST(${expr} AS DOUBLE)`;
  if (bucket.mode === "size") return `floor(${value} / ${bucket.size}) * ${bucket.size}`;
  // log10 / log2 are exact on powers of their base, where log(base, y) puts 1000 in the 100 bucket.
  return `CASE WHEN ${expr} > 0 THEN pow(${bucket.base}, floor(log${bucket.base}(${value}))) WHEN ${expr} <= 0 THEN 0 END`;
}

/** The SQL condition keeping `expr` inside `range`, or "" when both ends are open. */
export function heatmapYRangeSql(expr: string, range: HeatmapYRange | null): string {
  const conditions: string[] = [];
  if (range?.min !== undefined) conditions.push(`${expr} >= ${range.min}`);
  if (range?.max !== undefined) conditions.push(`${expr} <= ${range.max}`);
  return conditions.join(" AND ");
}

/** The y label for the bucket starting at `lower`, as "lower–upper"; the log-mode bucket at 0 holds every value <= 0. */
export function heatmapYBucketLabel(lower: number, bucket: HeatmapYBucket): string {
  if (bucket.mode === "log" && lower === 0) return HEATMAP_Y_NON_POSITIVE_LABEL;
  return `${tidyNumber(lower)}–${tidyNumber(bucketUpper(lower, bucket))}`;
}

export function heatmapYBucketInRange(
  lower: number,
  bucket: HeatmapYBucket,
  range: HeatmapYRange | null,
): boolean {
  // The log bucket at 0 holds every value <= 0, so a negative max still reaches it.
  if (bucket.mode === "log" && lower === 0) return range?.min === undefined || range.min <= 0;
  if (range?.max !== undefined && lower > range.max) return false;
  if (range?.min === undefined) return true;
  return bucketUpper(lower, bucket) > range.min;
}

/** Whether `value` can be the lower bound the builder's SQL gives a bucket, which a query not bucketed by it rarely returns for every row. */
export function isHeatmapYBucketLowerBound(value: number, bucket: HeatmapYBucket): boolean {
  if (!Number.isFinite(value)) return false;
  if (bucket.mode === "size") return isNearInteger(value / bucket.size);
  if (value === 0) return true;
  return value > 0 && isNearInteger(Math.log(value) / Math.log(bucket.base));
}

function heatmapYBucketOf(raw: any): HeatmapYBucket | null {
  if (raw?.mode === "size") {
    const size = finiteNumberOf(raw.size);
    return size !== undefined && size > 0 ? { mode: "size", size } : null;
  }
  if (raw?.mode === "log") {
    const base = Number(raw.base ?? HEATMAP_Y_LOG_BASES[0]);
    return base === 2 || base === 10 ? { mode: "log", base } : null;
  }
  return null;
}

function bucketUpper(lower: number, bucket: HeatmapYBucket): number {
  return bucket.mode === "size" ? lower + bucket.size : lower * bucket.base;
}

function finiteNumberOf(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isNearInteger(value: number): boolean {
  return Math.abs(value - Math.round(value)) <= 1e-9 * Math.max(1, Math.abs(value));
}

/** `value` without binary float noise, so 0.1 + 0.2 reads as 0.3. */
function tidyNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}
