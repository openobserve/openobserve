// Copyright 2026 OpenObserve Inc.

// Intel tables are enrichment tables named `ioc_*` or `threat_intel*`; the server recognises and sweeps indicators.

import type { ClassifiedValue } from "@/services/securityIntel";

export const INDICATOR_TYPES = ["ip", "cidr", "domain", "url", "hash", "email"] as const;
export type IndicatorType = (typeof INDICATOR_TYPES)[number];

export const INTEL_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type IntelSeverity = (typeof INTEL_SEVERITIES)[number];

/** Columns every intel table is written with, in CSV order. */
export const INTEL_COLUMNS = [
  "indicator",
  "type",
  "severity",
  "confidence",
  "source",
  "description",
  "added_at",
  "expires_at",
] as const;

export interface Indicator {
  indicator: string;
  type: IndicatorType;
  severity: IntelSeverity;
  /** 0–100, how sure the source is. */
  confidence: number;
  source: string;
  description: string;
  /** ISO timestamp. */
  addedAt: string;
  /** ISO timestamp, or "" for never. */
  expiresAt: string;
  /** Enrichment table the indicator came from. */
  table: string;
}

export type SweepType = Exclude<IndicatorType, "cidr">;

/** `exact`: the whole column value is the indicator; `token`: it appears inside a longer value. */
export type MatchMode = "exact" | "token";

export interface Sighting {
  stream: string;
  column: string;
  mode: MatchMode;
  /** The value as stored in this column (case preserved), for pivots. */
  raw: string;
  count: number;
  /** Microseconds. */
  first: number;
  last: number;
}

export interface IndicatorMatch {
  indicator: Indicator;
  sightings: Sighting[];
  hits: number;
  first: number;
  last: number;
}

/** Largest CSV read in the browser; a full list with descriptions fits well inside it. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Mirrors the backend's stream-name formatting so the name we show is the one stored. */
export function intelTableName(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  if (!name) return "";
  return isIntelTable(name) ? name : `ioc_${name}`;
}

/** Which enrichment tables this page lists; the server applies the same prefix rule to writes. */
export function isIntelTable(name: string): boolean {
  return /^(ioc_|threat_intel)/i.test(name);
}

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function indicatorsToCsv(indicators: Omit<Indicator, "table">[]): string {
  const lines = [INTEL_COLUMNS.join(",")];
  for (const i of indicators) {
    lines.push(
      [
        i.indicator,
        i.type,
        i.severity,
        i.confidence,
        i.source,
        i.description,
        i.addedAt,
        i.expiresAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

const asSeverity = (value: unknown): IntelSeverity => {
  const v = String(value ?? "").toLowerCase();
  return (INTEL_SEVERITIES as readonly string[]).includes(v) ? (v as IntelSeverity) : "medium";
};

const asConfidence = (value: unknown, fallback = 50): number => {
  const n = Number(value);
  return Number.isFinite(n) && String(value ?? "").trim() !== ""
    ? Math.max(0, Math.min(100, Math.round(n)))
    : fallback;
};

/** The cell a stored row's indicator is read from for display. */
export const indicatorCell = (row: Record<string, unknown>) =>
  String(row.indicator ?? row.ioc ?? row.value ?? "");

/** A stored row as an Indicator, given the server's reading of its indicator cell. */
export function rowToIndicator(
  row: Record<string, unknown>,
  table: string,
  classified: Pick<ClassifiedValue, "indicator" | "type"> | null,
): Indicator | null {
  if (!classified) return null;
  return {
    indicator: classified.indicator,
    type: classified.type,
    severity: asSeverity(row.severity),
    confidence: asConfidence(row.confidence),
    source: String(row.source ?? ""),
    description: String(row.description ?? ""),
    addedAt: String(row.added_at ?? ""),
    expiresAt: String(row.expires_at ?? ""),
    table,
  };
}

export interface CsvImport {
  indicators: Omit<Indicator, "table">[];
  invalid: number;
  /** Set when the file has no `indicator` column at all. */
  missingColumn: boolean;
}

/** Reads an uploaded CSV into indicators; `classify` reads each indicator cell on the server. */
export async function indicatorsFromCsv(
  text: string,
  defaults: { severity: IntelSeverity; source: string; confidence: number },
  nowIso: string,
  classify: (values: string[]) => Promise<(ClassifiedValue | null)[]>,
): Promise<CsvImport> {
  const [header = [], ...body] = parseCsv(text);
  const cols = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_"),
  );
  const at = (name: string) => cols.indexOf(name);
  const indicatorAt = [at("indicator"), at("ioc"), at("value")].find((i) => i !== -1) ?? -1;
  if (indicatorAt === -1) return { indicators: [], invalid: 0, missingColumn: true };
  const out: CsvImport = { indicators: [], invalid: 0, missingColumn: false };
  const cell = (row: string[], name: string) =>
    at(name) === -1 ? "" : (row[at(name)] ?? "").trim();
  const classified = await classify(body.map((row) => row[indicatorAt] ?? ""));
  body.forEach((row, index) => {
    const found = classified[index] ?? null;
    if (!found) {
      out.invalid += 1;
      return;
    }
    if (found.duplicate) return;
    out.indicators.push({
      indicator: found.indicator,
      type: found.type,
      severity: asSeverity(cell(row, "severity") || defaults.severity),
      confidence: asConfidence(cell(row, "confidence") || defaults.confidence),
      source: cell(row, "source") || defaults.source,
      description: cell(row, "description"),
      addedAt: cell(row, "added_at") || nowIso,
      expiresAt: cell(row, "expires_at"),
    });
  });
  return out;
}

export function isExpired(indicator: Pick<Indicator, "expiresAt">, nowMs: number): boolean {
  if (!indicator.expiresAt) return false;
  const at = Date.parse(indicator.expiresAt);
  return Number.isFinite(at) && at <= nowMs;
}

/** Expires within `days`, and not already expired. */
export function expiresSoon(
  indicator: Pick<Indicator, "expiresAt">,
  nowMs: number,
  days = 7,
): boolean {
  if (!indicator.expiresAt) return false;
  const at = Date.parse(indicator.expiresAt);
  return Number.isFinite(at) && at > nowMs && at - nowMs <= days * 86_400_000;
}

/** Column a stored row keeps its indicator in; `ioc` and `value` are accepted too. */
export function indicatorColumnOf(row: Record<string, unknown>): string | null {
  for (const col of ["indicator", "ioc", "value"]) {
    if (String(row[col] ?? "").trim()) return col;
  }
  return null;
}

/** A row the backend stores for a header-only upload: every value empty. */
export function isBlankRow(row: Record<string, unknown>): boolean {
  return Object.entries(row).every(([k, v]) => k === "_timestamp" || v === "" || v == null);
}

/** Columns of the stored rows, `_timestamp` excluded, in first-seen order. */
export function rowColumns(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row))
      if (key !== "_timestamp" && !cols.includes(key)) cols.push(key);
  }
  return cols;
}

/** Rows as CSV with exactly the given columns, values written as stored. */
export function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return `${lines.join("\n")}\n`;
}

/** The cell each stored row is matched on when one indicator is removed; "" for blank rows. */
export const removalCells = (rows: Record<string, unknown>[]) =>
  rows.map((row) => {
    if (isBlankRow(row)) return "";
    const col = indicatorColumnOf(row);
    return col ? String(row[col]) : "";
  });

/** Removes one indicator and keeps everything else byte-for-byte; `classified` reads `removalCells(rows)`. */
export function rowsWithout(
  rows: Record<string, unknown>[],
  target: Pick<Indicator, "type" | "indicator">,
  classified: (Pick<ClassifiedValue, "indicator" | "type"> | null)[],
): { kept: Record<string, unknown>[]; removed: number } {
  const kept: Record<string, unknown>[] = [];
  let removed = 0;
  rows.forEach((row, index) => {
    if (isBlankRow(row)) return;
    const found = classified[index];
    if (found && found.type === target.type && found.indicator === target.indicator) {
      removed += 1;
      return;
    }
    const { _timestamp: _ts, ...rest } = row;
    kept.push(rest);
  });
  return { kept, removed };
}

/** Matches the table's own column set, as the backend refuses a different one on append. */
export function indicatorToRow(
  i: Omit<Indicator, "table">,
  columns: string[],
): Record<string, string> | null {
  const byColumn: Record<string, string> = {
    indicator: i.indicator,
    ioc: i.indicator,
    value: i.indicator,
    type: i.type,
    severity: i.severity,
    confidence: String(i.confidence),
    source: i.source,
    description: i.description,
    added_at: i.addedAt,
    expires_at: i.expiresAt,
  };
  const target = ["indicator", "ioc", "value"].find((c) => columns.includes(c));
  if (!target) return null;
  const row: Record<string, string> = {};
  for (const col of columns) {
    // Only one column receives the indicator; the others of the three stay empty.
    row[col] =
      ["indicator", "ioc", "value"].includes(col) && col !== target ? "" : (byColumn[col] ?? "");
  }
  return row;
}
