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

import { HEATMAP_MAX_ROWS, type HeatmapConfig } from "./heatmapDefaults";

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

export interface HeatmapYField {
  isDerived?: boolean;
  functionName?: string | null;
  args?: Array<{ type?: string; value?: { field?: string; streamAlias?: string } }>;
}

export interface HeatmapYFieldSchema {
  meta?: {
    streamFields?: {
      groupedFields?: Array<{
        stream_alias?: string | null;
        schema?: Array<{ name: string; type?: string }>;
      }>;
    };
  };
}

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

/** The bucketing `config` asks for with its y range, or null when bucketing is off or its settings are unusable. */
export function heatmapYBucketing(
  config: HeatmapConfig | null | undefined,
): HeatmapYBucketing | null {
  const bucket = heatmapYBucketOf(config?.heatmap_y_bucket);
  return bucket ? { bucket, range: heatmapYRangeOf(config) } : null;
}

/** Why `config`'s bucketing must not run: a size that is not a finite number > 0, or a known range that makes more buckets than a grid can hold. */
export function heatmapYBucketError(
  config: HeatmapConfig | null | undefined,
): HeatmapYBucketError | null {
  const mode = config?.heatmap_y_bucket?.mode;
  if (mode !== "size") return null;
  const size = finiteNumberOf(config?.heatmap_y_bucket?.size);
  if (size === undefined || size <= 0) return "invalidSize";
  const count = heatmapYBucketCount({ mode, size }, heatmapYRangeOf(config));
  return count !== null && count > HEATMAP_MAX_ROWS ? "tooManyBuckets" : null;
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
export function heatmapYRangeOf(config: HeatmapConfig | null | undefined): HeatmapYRange | null {
  const min = finiteNumberOf(config?.heatmap_y_min);
  const max = finiteNumberOf(config?.heatmap_y_max);
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined && min >= max) return null;
  return { min, max };
}

/** Whether both y range ends are set with min >= max, which the builder and converter ignore. */
export function isHeatmapYRangeInverted(config: HeatmapConfig | null | undefined): boolean {
  const min = finiteNumberOf(config?.heatmap_y_min);
  const max = finiteNumberOf(config?.heatmap_y_max);
  return min !== undefined && max !== undefined && min >= max;
}

/** Whether `field` is a bare column of the builder, the only y the converter treats as bucketed. */
export function isPlainYField(field: HeatmapYField | null | undefined): boolean {
  return (
    !!field &&
    !field.isDerived &&
    !field.functionName &&
    field.args?.[0]?.type === "field" &&
    !!field.args[0]?.value?.field
  );
}

/** Whether `field` is a bare builder column whose stream schema types it as an integer or float. */
export function isNumericYField(
  field: HeatmapYField | null | undefined,
  dashboardPanelData: HeatmapYFieldSchema | null | undefined,
): boolean {
  if (!isPlainYField(field)) return false;
  const { field: name, streamAlias } = field?.args?.[0]?.value ?? {};
  const streamFields = dashboardPanelData?.meta?.streamFields?.groupedFields?.find((it) =>
    streamAlias ? it.stream_alias === streamAlias : (it.stream_alias ?? null) === null,
  );
  const type = streamFields?.schema?.find((it) => it.name === name)?.type;
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

/** The log-mode bucket at 0 holds every value <= 0, so it overlaps any range reaching 0. */
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

/** `lowerBounds` plus every empty bucket between the smallest and largest, so adjacent rows are adjacent ranges; returned as given when that would pass `maxRows`. */
export function fillHeatmapYBuckets(
  lowerBounds: number[],
  bucket: HeatmapYBucket,
  maxRows: number,
): number[] {
  // Keyed by bucket index so a returned float such as 0.30000000000000004 stays the row its cells are looked up by.
  const byIndex = new Map<number, number>();
  const extra: number[] = [];
  for (const value of lowerBounds) {
    if (bucket.mode === "log" && value <= 0) extra.push(value);
    else byIndex.set(bucketIndexOf(value, bucket), value);
  }
  if (!byIndex.size) return lowerBounds;
  const indices = [...byIndex.keys()];
  const first = Math.min(...indices);
  const last = Math.max(...indices);
  if (last - first + 1 + extra.length > maxRows) return lowerBounds;
  const filled = [...extra];
  for (let index = first; index <= last; index++) {
    filled.push(byIndex.get(index) ?? bucketLowerOf(index, bucket));
  }
  return filled;
}

function heatmapYBucketOf(raw: HeatmapConfig["heatmap_y_bucket"]): HeatmapYBucket | null {
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

function bucketIndexOf(lower: number, bucket: HeatmapYBucket): number {
  if (bucket.mode === "size") return Math.round(lower / bucket.size);
  return Math.round(Math.log(lower) / Math.log(bucket.base));
}

function bucketLowerOf(index: number, bucket: HeatmapYBucket): number {
  return bucket.mode === "size" ? index * bucket.size : Math.pow(bucket.base, index);
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
