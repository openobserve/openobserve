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

import { SPAN_KIND_MAP } from "@/utils/traces/constants";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { DURATION_BOUNDS_US, formatDurationBound } from "./latencyHeatmap";

export const SAMPLE_TARGET = 2000;
export const SAMPLE_LIMIT = 4000;
export const TOP_VALUES = 6;
export const NUMERIC_BINS = 10;
export const CARDS_PAGE = 24;

const OUTSIDE_CAP_US = 3 * 3600 * 1_000_000;
const ID_FIELDS = ["trace_id", "span_id", "reference_parent_span_id", "reference_parent_trace_id"];
const EXCLUDED_COLUMNS = ["start_time", "end_time", "events", "links"];

export type ComparisonKind = "duration" | "errors" | "rate";
export type BaselineMode = "outside" | "before";

export type ComparisonSelection = {
  kind: ComparisonKind;
  windowStartUs: number;
  windowEndUs: number;
  rangeStartUs: number;
  rangeEndUs: number;
  durationLoUs: number | null;
  durationHiUs: number | null;
  filter: string;
};

export interface Population {
  where: string;
  startUs: number;
  endUs: number;
}

export type Populations =
  | { selection: Population; baseline: Population | null; capped: boolean; limited: boolean }
  | { error: "rangeTooLong" };

export interface SchemaField {
  name: string;
  type?: string;
}

export type SampleRow = Record<string, unknown>;

export type Bucket =
  | { kind: "value"; value: string }
  | { kind: "noValue" }
  | { kind: "empty" }
  | { kind: "bin"; index: number }
  | { kind: "other"; count: number };

export interface BucketRow {
  bucket: Bucket;
  // Display text for a value; field values are data, so the UI shows it raw.
  label: string;
  sel: number;
  base: number;
}

export interface NumericBin {
  lo: number;
  hi: number;
  sel: number;
  base: number;
}

export interface FieldComparison {
  name: string;
  dataType: string;
  kind: "categorical" | "numeric";
  score: number;
  presenceSel: number;
  presenceBase: number;
  // Categorical: top values plus Other. Numeric: the (no value) and (empty) buckets that occur.
  rows: BucketRow[];
  bins?: NumericBin[];
  topBin?: number;
  numericCast?: boolean;
  durationLiterals?: boolean;
}

export interface ComparisonResult {
  ranked: FieldComparison[];
  mostlyEmpty: FieldComparison[];
  highCardinality: { name: string; distinct: number }[];
  constant: string[];
  noiseFloorPts: number;
}

const timeRange = (a: number, b: number) => `_timestamp >= ${a} AND _timestamp < ${b}`;

function band(lo: number | null, hi: number | null): string {
  const parts: string[] = [];
  if (lo) parts.push(`duration >= ${lo}`);
  if (hi !== null) parts.push(`duration < ${hi}`);
  return parts.join(" AND ");
}

const and = (...parts: string[]) => parts.filter((p) => p !== "").join(" AND ");

// R' = R ∩ [Ws − Δ, We + Δ]; Δ is 3 h, or less when a query-range limit leaves less room.
export function populations(
  sel: ComparisonSelection,
  mode: BaselineMode,
  limitUs = 0,
): Populations {
  const a = sel.windowStartUs;
  const b = sel.windowEndUs;
  const length = b - a;
  if (limitUs > 0 && length > limitUs) return { error: "rangeTooLong" };

  const f = sel.filter.trim() ? `(${sel.filter.trim()})` : "";
  const term =
    sel.kind === "duration"
      ? band(sel.durationLoUs, sel.durationHiUs)
      : sel.kind === "errors"
        ? "span_status = 'ERROR'"
        : "";
  const selection = { where: and(f, timeRange(a, b), term), startUs: a, endUs: b };

  if (mode === "before") {
    return {
      selection,
      baseline: { where: and(f, timeRange(a - length, a), term), startUs: a - length, endUs: a },
      capped: false,
      limited: false,
    };
  }
  if (sel.kind === "errors") {
    const notError = "COALESCE(span_status, '') != 'ERROR'";
    return {
      selection,
      baseline: { where: and(f, timeRange(a, b), notError), startUs: a, endUs: b },
      capped: false,
      limited: false,
    };
  }

  const limitDelta = limitUs > 0 ? (limitUs - length) / 2 : Infinity;
  const delta = Math.min(OUTSIDE_CAP_US, limitDelta);
  const start = Math.max(sel.rangeStartUs, a - delta);
  const end = Math.min(sel.rangeEndUs, b + delta);
  const narrowed = start !== sel.rangeStartUs || end !== sel.rangeEndUs;
  const limited = narrowed && limitDelta < OUTSIDE_CAP_US;
  const capped = narrowed && !limited;
  const inWindow = and(timeRange(a, b), term);
  // A rate selection is the whole window, so a baseline no wider than it holds nothing.
  const empty = sel.kind === "rate" && start >= a && end <= b;
  return {
    selection,
    baseline: empty
      ? null
      : { where: and(f, timeRange(start, end), `NOT (${inWindow})`), startUs: start, endUs: end },
    capped,
    limited,
  };
}

const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function buildCountSql(stream: string, population: Population) {
  return {
    sql: `SELECT count(*) AS n FROM ${quoteIdentifier(stream)} WHERE ${population.where}`,
    startTime: population.startUs,
    endTime: population.endUs,
  };
}

// The last 8 hex digits of span_id are uniform, so a 32-bit threshold keeps about SAMPLE_TARGET rows at any size.
export function sampleThreshold(n: number): string | null {
  if (n <= SAMPLE_TARGET) return null;
  const value = Math.max(1, Math.ceil((SAMPLE_TARGET / n) * 2 ** 32));
  return value.toString(16).padStart(8, "0");
}

export function buildSampleSql(
  stream: string,
  population: Population,
  columns: string[],
  threshold: string | null,
) {
  const hash = threshold ? ` AND lower(right(span_id, 8)) < '${threshold}'` : "";
  return {
    sql:
      `SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(stream)} ` +
      `WHERE ${population.where}${hash} LIMIT ${SAMPLE_LIMIT}`,
    startTime: population.startUs,
    endTime: population.endUs,
  };
}

// Ingestion copies the status code into status_code, so it is the Errors axis too; status_message tells errors apart.
const AXIS_COLUMNS: Record<ComparisonKind, string[]> = {
  duration: ["duration"],
  errors: ["span_status", "status_code"],
  rate: [],
};

export function comparisonColumns(schema: SchemaField[], kind: ComparisonKind): SchemaField[] {
  return schema.filter(
    (f) =>
      !f.name.startsWith("_") &&
      !EXCLUDED_COLUMNS.includes(f.name) &&
      !AXIS_COLUMNS[kind].includes(f.name),
  );
}

const isNumericType = (type: string) => /^(u?int|float|decimal|double)/i.test(type);

// Plain decimal or exponent text only: Number() also reads hex, binary and blanks, which TRY_CAST turns into null.
const DECIMAL_TEXT = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !DECIMAL_TEXT.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function roundedEdges(min: number, max: number): number[] {
  const log = min > 0 && max / min >= 100;
  const exact = Array.from({ length: NUMERIC_BINS + 1 }, (_, i) =>
    log ? min * (max / min) ** (i / NUMERIC_BINS) : min + ((max - min) * i) / NUMERIC_BINS,
  );
  exact[NUMERIC_BINS] = max;
  for (let digits = 2; digits <= 6; digits++) {
    const rounded = exact.map((x) => (x === 0 ? 0 : Number(x.toPrecision(digits))));
    if (rounded.every((x, i) => i === 0 || x > rounded[i - 1])) return rounded;
  }
  return exact;
}

const durationEdges = (values: number[]) => {
  const occupied = new Set<number>();
  for (const v of values) occupied.add(DURATION_BOUNDS_US.filter((bound) => bound <= v).length);
  return [...occupied]
    .sort((x, y) => x - y)
    .map((k) => ({
      lo: k === 0 ? 0 : DURATION_BOUNDS_US[k - 1],
      hi: k === DURATION_BOUNDS_US.length ? Infinity : DURATION_BOUNDS_US[k],
    }));
};

// A value below the first edge or above the last falls in the end bins, which offer no outward bound.
const binOf = (v: number, bins: { lo: number; hi: number }[]) => {
  for (let k = bins.length - 1; k > 0; k--) if (v >= bins[k].lo) return k;
  return 0;
};

type Key = string;
const NO_VALUE: Key = "\u0000none";
const EMPTY: Key = "\u0000empty";

const keyOf = (v: unknown): Key =>
  v === undefined || v === null ? NO_VALUE : v === "" ? EMPTY : String(v);

const bucketOf = (key: Key): Bucket =>
  key === NO_VALUE
    ? { kind: "noValue" }
    : key === EMPTY
      ? { kind: "empty" }
      : { kind: "value", value: key };

const share = (counts: Map<Key, number>, key: Key, total: number) =>
  total ? (counts.get(key) ?? 0) / total : 0;

const tally = (rows: SampleRow[], name: string, map: (v: unknown) => Key) => {
  const counts = new Map<Key, number>();
  for (const row of rows) {
    const key = map(row[name]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

export function compareFields(
  selRows: SampleRow[],
  baseRows: SampleRow[],
  fields: SchemaField[],
  kind: ComparisonKind,
): ComparisonResult {
  const ns = selRows.length;
  const nb = baseRows.length;
  const result: ComparisonResult = {
    ranked: [],
    mostlyEmpty: [],
    highCardinality: [],
    constant: [],
    noiseFloorPts: ns && nb ? 200 * Math.sqrt(0.25 * (1 / ns + 1 / nb)) : 0,
  };

  for (const { name, type = "" } of fields) {
    const all = [...selRows, ...baseRows].map((row) => row[name]);
    const present = all.filter((v) => v !== undefined && v !== null);
    const distinct = new Set(present.map(String));

    if (ID_FIELDS.includes(name)) {
      result.highCardinality.push({ name, distinct: distinct.size });
      continue;
    }

    const filled = present.filter((v) => v !== "");
    const numbers = filled.map(toNumber);
    const parses = filled.length > 0 && numbers.every((n) => n !== null);
    const numeric = parses && new Set(numbers).size > NUMERIC_BINS;

    if (!numeric && present.length >= 50 && distinct.size / present.length >= 0.9) {
      result.highCardinality.push({ name, distinct: distinct.size });
      continue;
    }

    let bins: { lo: number; hi: number }[] = [];
    let map: (v: unknown) => Key = keyOf;
    if (numeric) {
      const values = numbers as number[];
      const durationBins = name === "duration" && kind !== "duration";
      if (durationBins) {
        bins = durationEdges(values);
      } else {
        let min = Infinity;
        let max = -Infinity;
        for (const v of values) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
        const edges = roundedEdges(min, max);
        bins = edges.slice(0, -1).map((lo, k) => ({ lo, hi: edges[k + 1] }));
      }
      map = (v) => {
        const key = keyOf(v);
        if (key === NO_VALUE || key === EMPTY) return key;
        return `bin:${binOf(toNumber(v) ?? 0, bins)}`;
      };
    }

    const selCounts = tally(selRows, name, map);
    const baseCounts = tally(baseRows, name, map);
    const keys = new Set([...selCounts.keys(), ...baseCounts.keys()]);
    if (keys.size <= 1) {
      result.constant.push(name);
      continue;
    }

    let score = 0;
    for (const key of keys) {
      score = Math.max(score, Math.abs(share(selCounts, key, ns) - share(baseCounts, key, nb)));
    }
    const presence = (counts: Map<Key, number>, n: number) =>
      n ? (n - (counts.get(NO_VALUE) ?? 0)) / n : 0;

    const comparison: FieldComparison = {
      name,
      dataType: type,
      kind: numeric ? "numeric" : "categorical",
      score: score * 100,
      presenceSel: presence(selCounts, ns),
      presenceBase: presence(baseCounts, nb),
      rows: [],
    };

    if (numeric) {
      comparison.bins = bins.map((b, k) => ({
        lo: b.lo,
        hi: b.hi,
        sel: share(selCounts, `bin:${k}`, ns),
        base: share(baseCounts, `bin:${k}`, nb),
      }));
      comparison.topBin = comparison.bins.reduce(
        (best, b, k, all) =>
          Math.abs(b.sel - b.base) > Math.abs(all[best].sel - all[best].base) ? k : best,
        0,
      );
      comparison.numericCast = !isNumericType(type);
      comparison.durationLiterals = name === "duration";
      comparison.rows = [NO_VALUE, EMPTY]
        .filter((key) => keys.has(key))
        .map((key) => ({
          bucket: bucketOf(key),
          label: "",
          sel: share(selCounts, key, ns),
          base: share(baseCounts, key, nb),
        }));
    } else {
      const ordered = [...keys]
        .map((key) => ({ key, sel: share(selCounts, key, ns), base: share(baseCounts, key, nb) }))
        .sort(
          (x, y) => Math.max(y.sel, y.base) - Math.max(x.sel, x.base) || x.key.localeCompare(y.key),
        );
      const top = ordered.slice(0, TOP_VALUES);
      const rest = ordered.slice(TOP_VALUES);
      comparison.rows = top.map(({ key, sel, base }) => ({
        bucket: bucketOf(key),
        label: name === "span_kind" ? (SPAN_KIND_MAP[key] ?? key) : key,
        sel,
        base,
      }));
      if (rest.length) {
        comparison.rows.push({
          bucket: { kind: "other", count: rest.length },
          label: "",
          sel: rest.reduce((sum, r) => sum + r.sel, 0),
          base: rest.reduce((sum, r) => sum + r.base, 0),
        });
      }
    }

    const mostlyEmpty = Math.max(comparison.presenceSel, comparison.presenceBase) < 0.1;
    (mostlyEmpty ? result.mostlyEmpty : result.ranked).push(comparison);
  }

  const byScore = (x: FieldComparison, y: FieldComparison) =>
    y.score - x.score || x.name.localeCompare(y.name);
  result.ranked.sort(byScore);
  result.mostlyEmpty.sort(byScore);
  result.constant.sort();
  return result;
}

export type FilterAction = "include" | "exclude" | "gte" | "lt";

// Built here, not with buildFilterTerm: that helper reads the string "null" as is null and does not quote the field.
export function filterTermFor(
  field: FieldComparison,
  bucket: Bucket,
  action: FilterAction,
): string | null {
  const f = quoteSqlIdentifierIfNeeded(field.name);
  switch (bucket.kind) {
    case "value": {
      const literal = sqlLiteral(
        field.name === "span_kind" ? (SPAN_KIND_MAP[bucket.value] ?? bucket.value) : bucket.value,
      );
      return action === "include" ? `${f} = ${literal}` : `(${f} != ${literal} or ${f} is null)`;
    }
    case "noValue":
      return action === "include" ? `${f} is null` : `${f} is not null`;
    case "empty":
      return action === "include" ? `${f} = ''` : `(${f} != '' or ${f} is null)`;
    case "bin": {
      const bins = field.bins ?? [];
      const bin = bins[bucket.index];
      if (!bin || (action !== "gte" && action !== "lt")) return null;
      // Each end bin would select everything outward, so it offers no bound on that side.
      if (action === "gte" && bucket.index === 0) return null;
      if (action === "lt" && bucket.index === bins.length - 1) return null;
      const bound = action === "gte" ? bin.lo : bin.hi;
      const op = action === "gte" ? ">=" : "<";
      if (field.durationLiterals) return `${f} ${op} '${formatDurationBound(bound)}'`;
      // TRY_CAST yields null for a non-numeric value; a plain CAST would fail the whole search.
      const expr = field.numericCast ? `TRY_CAST(${f} AS DOUBLE)` : f;
      return `${expr} ${op} ${bound}`;
    }
    default:
      return null;
  }
}
