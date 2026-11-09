// Copyright 2026 OpenObserve Inc.

// Intel tables are enrichment tables named `ioc_*` or `threat_intel*`; matching is exact, never fuzzy.

import { quoteIdent, quoteString } from "./sql";

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

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HEX = /^[0-9a-f]+$/;
const DOMAIN = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;
const EMAIL = /^[^\s@]+@([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
/** SHA-512, SHA-256, SHA-1, MD5. */
const HASH_LENGTHS = [32, 40, 64, 128];

/** File-type labels that make "cmd.exe" look like a domain; colliding TLDs (.zip, .mov) are refused too. */
const FILE_EXTENSIONS = new Set(
  (
    "exe dll sys drv bat cmd ps1 psm1 vbs vbe js jse wsf hta scr cpl msi msp lnk " +
    "pif jar bin dat tmp log txt csv json xml ini cfg conf pdf doc docx docm xls " +
    "xlsx xlsm ppt pptx rtf odt zip rar 7z gz tgz tar iso img dmg apk ipa png jpg jpeg " +
    "gif bmp svg ico mp3 mp4 mov avi wav eml msg html htm php asp aspx"
  ).split(" "),
);

/** RFC 5952 canonical IPv6 so `2001:0DB8:0:0::1` and `2001:db8::1` compare equal; null when invalid. */
export function canonicalIpv6(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value.includes(":") || !/^[0-9a-f:.]+$/.test(value)) return null;
  if (value.includes(":::")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const items = part.split(":");
    for (let i = 0; i < items.length; i++) {
      const g = items[i];
      if (i === items.length - 1 && IPV4.test(g)) {
        const [a, b, c, d] = g.split(".").map(Number);
        out.push((a << 8) | b, (c << 8) | d);
      } else if (/^[0-9a-f]{1,4}$/.test(g)) {
        out.push(parseInt(g, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;
  // A v4 tail may only end the address.
  if (halves.length === 2 && halves[0].includes(".")) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(Math.max(0, missing)).fill(0), ...tail];
  // Longest run of >= 2 zero groups, first one on ties.
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best === -1) return hex.join(":");
  return `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
}

function isIp(value: string): boolean {
  return IPV4.test(value) || canonicalIpv6(value) !== null;
}

/** Undoes threat-report defanging (`hxxp://`, `evil[.]com`) so pasted indicators match. */
export function refang(value: string): string {
  return value
    .trim()
    .replace(/^h(xx|\*\*)p(s?)(\[:\]|:)\/\//i, "http$2://")
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)|\{dot\}/gi, ".")
    .replace(/\[@\]|\(@\)|\{@\}|\[at\]|\(at\)/gi, "@")
    .replace(/\[:\]/g, ":")
    .replace(/\[\/\]/g, "/");
}

export function detectIndicatorType(raw: string): IndicatorType | null {
  const value = refang(raw).toLowerCase();
  if (!value) return null;
  if (isIp(value)) return "ip";
  const [addr, bits] = value.split("/");
  if (bits !== undefined && /^\d{1,3}$/.test(bits) && isIp(addr)) {
    const max = addr.includes(":") ? 128 : 32;
    return Number(bits) <= max ? "cidr" : null;
  }
  if (/^https?:\/\/\S+$/.test(value)) return "url";
  if (HEX.test(value) && HASH_LENGTHS.includes(value.length)) return "hash";
  if (EMAIL.test(value)) return "email";
  if (DOMAIN.test(value) && !FILE_EXTENSIONS.has(value.slice(value.lastIndexOf(".") + 1))) {
    return "domain";
  }
  return null;
}

/** Canonical form used for storage and matching. */
export function normalizeIndicator(raw: string, type: IndicatorType): string {
  const value = refang(raw);
  if (type === "ip" && value.includes(":")) return canonicalIpv6(value) ?? value.toLowerCase();
  if (type === "cidr" && value.includes(":")) {
    const [addr, bits] = value.split("/");
    return `${canonicalIpv6(addr) ?? addr.toLowerCase()}/${bits}`;
  }
  // URLs keep their path case; everything else compares case-insensitively.
  if (type === "url") {
    const m = value.match(/^(https?:\/\/)([^/?#]+)(.*)$/i);
    return m ? `${m[1].toLowerCase()}${m[2].toLowerCase()}${m[3]}` : value;
  }
  return value.toLowerCase();
}

export function isValidIndicator(raw: string, type: IndicatorType): boolean {
  return detectIndicatorType(raw) === type;
}

export interface ParsedIndicators {
  valid: { indicator: string; type: IndicatorType }[];
  invalid: { line: number; value: string }[];
  duplicates: number;
}

/** `forcedType` rejects values of any other type rather than silently re-typing them. */
export function parseIndicatorList(
  text: string,
  forcedType?: IndicatorType | null,
): ParsedIndicators {
  const out: ParsedIndicators = { valid: [], invalid: [], duplicates: 0 };
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, index) => {
    // Commas separate values but are legal inside a URL, so a URL keeps them.
    const tokens = line
      .split(/[;\s]+/)
      .flatMap((part) =>
        /^(h(tt|xx)ps?|https?)(\[:\]|:)\/\//i.test(part)
          ? [part.replace(/[,.;)]+$/, "")]
          : part.split(","),
      );
    for (const token of tokens) {
      if (!token.trim()) continue;
      const type = detectIndicatorType(token);
      if (!type || (forcedType && type !== forcedType)) {
        out.invalid.push({ line: index + 1, value: token.trim() });
        continue;
      }
      const indicator = normalizeIndicator(token, type);
      const key = `${type}:${indicator}`;
      if (seen.has(key)) {
        out.duplicates += 1;
        continue;
      }
      seen.add(key);
      out.valid.push({ indicator, type });
    }
  });
  return out;
}

/** Mirrors the backend's stream-name formatting so the name we show is the one stored. */
export function intelTableName(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  if (!name) return "";
  return isIntelTable(name) ? name : `ioc_${name}`;
}

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

/** Rows from other tools may lack our columns, so type is re-detected and bad rows return null. */
export function rowToIndicator(row: Record<string, unknown>, table: string): Indicator | null {
  const raw = String(row.indicator ?? row.ioc ?? row.value ?? "").trim();
  if (!raw) return null;
  const declared = String(row.type ?? "").toLowerCase();
  const detected = detectIndicatorType(raw);
  const type =
    (INDICATOR_TYPES as readonly string[]).includes(declared) &&
    isValidIndicator(raw, declared as IndicatorType)
      ? (declared as IndicatorType)
      : detected;
  if (!type) return null;
  return {
    indicator: normalizeIndicator(raw, type),
    type,
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

/** Reads an uploaded CSV into indicators; unknown columns are ignored. */
export function indicatorsFromCsv(
  text: string,
  defaults: { severity: IntelSeverity; source: string; confidence: number },
  nowIso: string,
): CsvImport {
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
  const seen = new Set<string>();
  const cell = (row: string[], name: string) =>
    at(name) === -1 ? "" : (row[at(name)] ?? "").trim();
  for (const row of body) {
    const parsed = rowToIndicator(
      {
        indicator: row[indicatorAt],
        type: cell(row, "type"),
        severity: cell(row, "severity") || defaults.severity,
        confidence: cell(row, "confidence") || defaults.confidence,
      },
      "",
    );
    if (!parsed) {
      out.invalid += 1;
      continue;
    }
    const key = `${parsed.type}:${parsed.indicator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.indicators.push({
      indicator: parsed.indicator,
      type: parsed.type,
      severity: parsed.severity,
      confidence: parsed.confidence,
      source: cell(row, "source") || defaults.source,
      description: cell(row, "description"),
      addedAt: cell(row, "added_at") || nowIso,
      expiresAt: cell(row, "expires_at"),
    });
  }
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

/** Types that can be matched with an exact IN list. CIDR ranges are not. */
export type SweepType = Exclude<IndicatorType, "cidr">;

const COLUMN_PATTERNS: Record<SweepType, RegExp> = {
  ip: /(^|_)(ip|ips|ipaddress|ip_address|addr|address|src|dst|source_ip|dest_ip|client_ip|remote_ip|remote_addr|sourceipaddress|srcaddr|dstaddr)$/,
  domain: /(^|_)(domain|hostname|host|fqdn|server_name|sni|query|qname|dns_query)$/,
  url: /(^|_)(url|uri|request_url|referer|referrer|full_url)$/,
  hash: /(^|_)(md5|sha1|sha256|hash|hashes|file_hash|imphash)$/,
  email: /(^|_)(email|mail|sender|recipient|from|to|user_email|username|user_name|principal)$/,
};

/** Source-mapped columns plus columns whose name says they hold that kind of value. */
export function candidateColumns(
  type: SweepType,
  fields: string[],
  mapped: string[] = [],
): string[] {
  const re = COLUMN_PATTERNS[type];
  const byName = fields.filter((f) => f !== "_timestamp" && re.test(f.toLowerCase()));
  return [...new Set([...mapped.filter((m) => fields.includes(m)), ...byName])].sort();
}

/** Folded like normalizeIndicator; `ip` too because IPv6 hex may be stored in either case. */
const CASE_FOLDED: SweepType[] = ["ip", "domain", "hash", "email"];

/** Server caps an IN list well above this; batches keep each query modest. */
export const SWEEP_BATCH = 400;

export function batches<T>(items: T[], size = SWEEP_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One search over all columns; `zo_v{i}` is null where column i did not match, so groups stay bounded. */
export function sweepSql(
  stream: string,
  columns: string[],
  type: SweepType,
  values: string[],
): string {
  const list = values.map(quoteString).join(", ");
  const parts = columns.map((column) => {
    const col = `CAST(${quoteIdent(column)} AS VARCHAR)`;
    const expr = CASE_FOLDED.includes(type) ? `LOWER(${col})` : col;
    return { col, expr, test: `${expr} IN (${list})` };
  });
  const keys = parts.map((p, i) => `CASE WHEN ${p.test} THEN ${p.expr} END AS zo_v${i}`);
  const raws = parts.map((p, i) => `MIN(${p.col}) AS zo_raw${i}`);
  return (
    `SELECT ${keys.join(", ")}, COUNT(*) AS zo_n, MIN(_timestamp) AS zo_first, ` +
    `MAX(_timestamp) AS zo_last, ${raws.join(", ")} FROM ${quoteIdent(stream)} ` +
    `WHERE ${parts.map((p) => p.test).join(" OR ")} GROUP BY ${parts.map((_, i) => `zo_v${i}`).join(", ")}`
  );
}

/** Splits a `sweepSql` answer into per-column rows, one per matched value. */
export function sweepColumnRows(
  columns: string[],
  rows: Record<string, unknown>[],
): { column: string; rows: Record<string, unknown>[] }[] {
  return columns.map((column, i) => {
    const byValue = new Map<
      string,
      { zo_value: string; zo_n: number; zo_first: number; zo_last: number; zo_raw: string }
    >();
    for (const row of rows) {
      const value = row[`zo_v${i}`];
      if (value === null || value === undefined) continue;
      const n = Number(row.zo_n ?? 0) || 0;
      const first = Number(row.zo_first ?? 0) || 0;
      const last = Number(row.zo_last ?? 0) || 0;
      const raw = String(row[`zo_raw${i}`] ?? value);
      const prev = byValue.get(String(value));
      if (!prev) {
        byValue.set(String(value), {
          zo_value: String(value),
          zo_n: n,
          zo_first: first,
          zo_last: last,
          zo_raw: raw,
        });
        continue;
      }
      prev.zo_n += n;
      prev.zo_first = Math.min(prev.zo_first, first);
      prev.zo_last = Math.max(prev.zo_last, last);
      if (raw < prev.zo_raw) prev.zo_raw = raw;
    }
    return { column, rows: [...byValue.values()] };
  });
}

/** One indicator's sightings over time in one column, for the drawer timeline. */
export function sightingsSql(
  stream: string,
  column: string,
  type: SweepType,
  value: string,
  interval: string,
): string {
  const col = `CAST(${quoteIdent(column)} AS VARCHAR)`;
  const expr = CASE_FOLDED.includes(type) ? `LOWER(${col})` : col;
  return (
    `SELECT histogram(_timestamp, '${interval}') AS zo_ts, COUNT(*) AS zo_n ` +
    `FROM ${quoteIdent(stream)} WHERE ${expr} = ${quoteString(value)} ` +
    `GROUP BY zo_ts ORDER BY zo_ts`
  );
}

export interface Sighting {
  stream: string;
  column: string;
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

/** Folds per-column sweep rows into one match per indicator, busiest first. */
export function foldMatches(
  indicators: Indicator[],
  results: { stream: string; column: string; type: SweepType; rows: Record<string, unknown>[] }[],
): IndicatorMatch[] {
  const byKey = new Map<string, Indicator>();
  for (const i of indicators) if (i.type !== "cidr") byKey.set(`${i.type}:${i.indicator}`, i);
  const matches = new Map<string, IndicatorMatch>();
  for (const result of results) {
    for (const row of result.rows) {
      const key = `${result.type}:${String(row.zo_value ?? "")}`;
      const indicator = byKey.get(key);
      if (!indicator) continue;
      const sighting: Sighting = {
        stream: result.stream,
        column: result.column,
        raw: String(row.zo_raw ?? row.zo_value ?? ""),
        count: Number(row.zo_n ?? 0) || 0,
        first: Number(row.zo_first ?? 0) || 0,
        last: Number(row.zo_last ?? 0) || 0,
      };
      if (!sighting.count) continue;
      const match = matches.get(key) ?? { indicator, sightings: [], hits: 0, first: 0, last: 0 };
      match.sightings.push(sighting);
      match.hits += sighting.count;
      match.first = match.first ? Math.min(match.first, sighting.first) : sighting.first;
      match.last = Math.max(match.last, sighting.last);
      matches.set(key, match);
    }
  }
  return [...matches.values()]
    .map((m) => ({ ...m, sightings: m.sightings.sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.hits - a.hits || b.last - a.last);
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

/** Removes one indicator and keeps everything else byte-for-byte; blank rows are dropped. */
export function rowsWithout(
  rows: Record<string, unknown>[],
  target: Pick<Indicator, "type" | "indicator">,
): { kept: Record<string, unknown>[]; removed: number } {
  const kept: Record<string, unknown>[] = [];
  let removed = 0;
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    const col = indicatorColumnOf(row);
    const raw = col ? String(row[col]) : "";
    const type = raw ? detectIndicatorType(raw) : null;
    if (type === target.type && normalizeIndicator(raw, type) === target.indicator) {
      removed += 1;
      continue;
    }
    const { _timestamp: _ts, ...rest } = row;
    kept.push(rest);
  }
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
