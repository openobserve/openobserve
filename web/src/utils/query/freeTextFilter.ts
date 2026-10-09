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

import { Parser as SqlParser } from "@openobserve/node-sql-parser/build/datafusionsql";
import { addSpacesToOperators } from "@/utils/queryUtils";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { maxParenDepth, SQL_PARSE_MAX_DEPTH } from "@/utils/query/sqlComplexity";

// Zero keeps scan mode off until spike S1 sets the field guard.
export const FREE_TEXT_SCAN_MAX_FIELDS = 0;

export const DEFAULT_TOKEN_LIMITS: TokenLimits = { min: 2, max: 64 };

const KEYWORDS = new Set([
  "AND",
  "OR",
  "NOT",
  "IS",
  "IN",
  "LIKE",
  "ILIKE",
  "BETWEEN",
  "NULL",
  "TRUE",
  "FALSE",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "CAST",
  "AS",
  "EXISTS",
  "DISTINCT",
  "FROM",
  "AT",
  "TIME",
  "ZONE",
  "SIMILAR",
  "ESCAPE",
]);

const CONNECTIVES = new Set(["AND", "OR", "NOT"]);

// Far above SQL_PARSE_MAX_DEPTH, yet keeps the recursive descent clear of the JS stack limit.
const MAX_TEXT_NESTING = 256;

const LIST_OWNING_KEYWORDS = new Set(["IN", "EXISTS"]);

const TWO_CHAR_OPS = new Set(["!=", "<>", "<=", ">=", "!~", "::", "||"]);

const ONE_CHAR_OPS = new Set(["=", "<", ">", "~"]);

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%"]);

const STRING_TYPES = new Set(["Utf8", "Utf8View", "LargeUtf8"]);

const IMPLICIT_FIELD_NAMES = ["column_all", "_timestamp"];

const SCAN_EXCLUDED_FIELDS = new Set([
  "_timestamp",
  "_o2_id",
  "column_all",
  "_stream_name",
  "_original",
  "_all_values",
]);

const SCAN_RANK_PATTERN = /message|msg|text|body|log|error|desc|detail|reason|content|summary/i;

// Mirrors the backend: every policy other than AtIngestion redacts hits at search time.
const AT_INGESTION_POLICY = "AtIngestion";

// One single-quoted argument and nothing else; any other call keeps the whole filter SQL.
const MATCH_ALL_CALL = /^match_all\(\s*'(?:[^']|'')*'\s*\)$/i;

const NUMERIC_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

const PREDICATE_OPERATORS = new Set([
  "=",
  "!=",
  "<>",
  "<",
  ">",
  "<=",
  ">=",
  "~",
  "!~",
  "~*",
  "!~*",
  "IN",
  "NOT IN",
  "LIKE",
  "NOT LIKE",
  "ILIKE",
  "NOT ILIKE",
  "IS",
  "IS NOT",
  "BETWEEN",
  "NOT BETWEEN",
  "SIMILAR TO",
  "NOT SIMILAR TO",
]);

export type Token =
  | { t: "word"; text: string }
  | { t: "squote"; text: string; negated?: boolean }
  | { t: "dquote"; text: string; negated?: boolean }
  | { t: "op"; text: string }
  | { t: "kw"; text: string }
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "opaque"; text: string };

export type PlanNode =
  | { k: "text"; value: string }
  | { k: "sql"; text: string }
  | { k: "not"; child: PlanNode }
  | { k: "and" | "or"; children: PlanNode[] }
  | { k: "group"; child: PlanNode };

export type FilterPlan =
  | { kind: "sql"; filter: string }
  | { kind: "freeText"; root: PlanNode; units: string[] }
  | { kind: "unclassified"; filter: string; suggestion?: PlanNode };

export type TextSearchTarget =
  | { mode: "fts"; fields: string[] }
  | { mode: "scan"; fields: string[] }
  | { mode: "blocked"; candidates: string[] };

export interface TokenLimits {
  min: number;
  max: number;
}

export interface PlanFilterOptions {
  /** The token gate applies only to fts targets; defaults to fts. */
  targetMode?: TextSearchTarget["mode"];
  tokenLimits?: TokenLimits;
  /** Text+SQL mixes are rewritten only when every selected stream has FTS; defaults to an fts target. */
  allTargetsFts?: boolean;
}

export interface SchemaField {
  name: string;
  type?: string;
}

export interface PatternAssociationRef {
  field: string;
  apply_at?: string | null;
}

export interface StreamTextSettings {
  full_text_search_keys?: string[];
  defined_schema_fields?: string[];
  index_original_data?: boolean;
  index_all_values?: boolean;
  pattern_associations?: PatternAssociationRef[];
}

export interface StreamWithSchema {
  name: string;
  schema?: SchemaField[];
  removedSchemaFields?: SchemaField[];
  settings?: StreamTextSettings;
}

export interface FreeTextScanEntry {
  fields: string[];
  materialized?: boolean;
}

export interface FreeTextContext {
  /** Every schema field of the selected streams plus the selected stream names. */
  fieldNames: ReadonlySet<string>;
  targets: Readonly<Record<string, TextSearchTarget>>;
  tokenLimits?: TokenLimits;
  freeTextScan?: Record<string, FreeTextScanEntry>;
}

export interface StreamLookup {
  hasStream: (name: string) => boolean;
  fieldsOf: (name: string) => ReadonlySet<string> | undefined;
}

export interface RecoveryCards {
  runSuggestion: string | null;
  freeTextCandidate: string | null;
}

export interface TextRange {
  start: number;
  end: number;
}

interface Lexed {
  tok: Token;
  start: number;
  end: number;
}

interface SuggestionTally {
  text: number;
  fieldValue: number;
  sql: number;
  predicates: number;
}

interface MixState {
  names: ReadonlySet<string>;
  limits: TokenLimits;
  units: number;
}

interface AstNode {
  type?: string;
  operator?: string;
  left?: AstNode;
  right?: AstNode;
  expr?: AstNode;
  where?: AstNode | null;
  groupby?: unknown;
  orderby?: unknown;
  having?: unknown;
  limit?: { value?: unknown[] } | null;
  columns?: unknown;
  from?: unknown;
  with?: unknown;
  _next?: unknown;
  table?: string | null;
  as?: string | null;
  column?: unknown;
}

type WhereShape = "predicate" | "column" | null;

let sharedParser: SqlParser | null = null;

/** Classifies a filter-mode input; only a wholly pure-text filter becomes `freeText`. */
export function planFilter(
  raw: string,
  booleanFields: ReadonlySet<string>,
  options: PlanFilterOptions = {},
): FilterPlan {
  const tokens = lex(raw);
  if (tokens === null) return { kind: "unclassified", filter: raw };
  const names = withImplicitFields(booleanFields);
  if (tokens.length === 0) return { kind: "sql", filter: raw };
  if (!isPureTextShape(tokens, names)) {
    return { kind: "sql", filter: planMix(tokens, raw, names, options) ?? raw };
  }
  if (exceedsTextNesting(tokens)) return { kind: "unclassified", filter: raw };

  const root = parseBooleanText(tokens);
  if (root === null) return { kind: "unclassified", filter: raw };

  const units = collectUnits(root);
  // match_all calls alone are already rendered, so there is nothing to rewrite.
  if (units.length === 0 || units.some((unit) => unit === "")) return { kind: "sql", filter: raw };
  const limits = options.tokenLimits ?? DEFAULT_TOKEN_LIMITS;
  if ((options.targetMode ?? "fts") === "fts" && !units.every((u) => hasIndexToken(u, limits))) {
    return { kind: "sql", filter: raw };
  }
  return { kind: "freeText", root, units };
}

export function phrasePlan(raw: string): FilterPlan {
  const value = raw.trim();
  if (value === "") return { kind: "sql", filter: raw };
  return { kind: "freeText", root: { k: "text", value }, units: [value] };
}

/** Renders the WHERE body; `null` only for a text plan on a blocked target. */
export function renderPlan(
  plan: FilterPlan,
  target: TextSearchTarget,
  knownFields: ReadonlySet<string>,
): string | null {
  if (plan.kind !== "freeText") return renderSqlFilter(plan.filter, knownFields);
  if (target.mode === "blocked" || target.fields.length === 0) return null;
  return renderNode(plan.root, target);
}

export function preserveFilterComments(raw: string, rendered: string): string {
  const missing: string[] = [];
  const remaining = filterComments(rendered);
  for (const comment of filterComments(raw)) {
    const at = remaining.indexOf(comment);
    if (at < 0) missing.push(comment);
    else remaining.splice(at, 1);
  }
  return missing.length ? `${missing.join("\n")}\n${rendered}` : rendered;
}

export function streamTextTarget(
  stream: StreamWithSchema,
  defaultFtsKeys: string[],
  scanConsent: string[] | undefined,
  maxScanFields: number = FREE_TEXT_SCAN_MAX_FIELDS,
  quickModeNumFields: number = 500,
): TextSearchTarget {
  const rawSchema = [
    ...asArray<SchemaField>(stream?.schema),
    ...asArray<SchemaField>(stream?.removedSchemaFields),
  ];
  const stringFields = new Set(rawSchema.filter(isStringField).map((field) => field.name));
  const settings = stream?.settings ?? {};
  const ftsKeys = unique([
    ...asStringArray(settings.full_text_search_keys),
    ...asStringArray(defaultFtsKeys),
    ...(settings.index_original_data ? ["_original"] : []),
    ...(settings.index_all_values ? ["_all_values"] : []),
  ]);
  const definedFields = asStringArray(settings.defined_schema_fields);
  const restrictDefinedFields =
    definedFields.length > 0 && definedFields.length <= quickModeNumFields;
  const fts = ftsKeys.filter(
    (key) => stringFields.has(key) && (!restrictDefinedFields || definedFields.includes(key)),
  );
  if (fts.length > 0) return { mode: "fts", fields: fts };

  const candidates = scanCandidates(rawSchema, settings);
  const chosen = unique(asStringArray(scanConsent).filter((f) => candidates.includes(f))).slice(
    0,
    Math.max(0, maxScanFields),
  );
  return chosen.length > 0 ? { mode: "scan", fields: chosen } : { mode: "blocked", candidates };
}

export function quoteFreeTextPhrase(raw: string): string {
  return `'${raw.trim().replaceAll("'", "''")}'`;
}

/** Statement-start test: the first non-comment token is SELECT or WITH. */
export function isAuthoredStatement(raw: string): boolean {
  const word = leadingWord(raw);
  return word === "select" || word === "with";
}

/** Auto-flip test; without a lookup it falls back to the statement-start test. */
export function looksLikeSqlStatement(raw: string, lookup?: StreamLookup): boolean {
  if (!isAuthoredStatement(raw)) return false;
  if (!lookup) return true;
  const stream = fromStreamName(raw);
  if (stream === null || !lookup.hasStream(stream)) return false;
  return !isSentenceShaped(raw, lookup.fieldsOf(stream));
}

export function tokenLimitsFromConfig(
  zoConfig:
    | { inverted_index_min_token_length?: unknown; inverted_index_max_token_length?: unknown }
    | null
    | undefined,
): TokenLimits {
  const min = finiteNumber(zoConfig?.inverted_index_min_token_length);
  const max = finiteNumber(zoConfig?.inverted_index_max_token_length);
  return {
    min: Math.max(min ?? DEFAULT_TOKEN_LIMITS.min, DEFAULT_TOKEN_LIMITS.min),
    max: Math.max(max ?? DEFAULT_TOKEN_LIMITS.max, DEFAULT_TOKEN_LIMITS.max),
  };
}

/** Editor text with free-text units rendered; `null` when no single rendering fits every stream. */
export function materializeFreeText(
  raw: string,
  streams: string[],
  ctx: FreeTextContext,
): string | null {
  const targets = streams.map((stream) => ctx.targets[stream]);
  if (targets.length === 0 || targets.some((target) => !target)) return null;
  const target = targets[0];
  const allFts = targets.every((target) => target.mode === "fts");
  const singleScan = targets.length === 1 && target.mode === "scan";
  const targetMode = allFts ? "fts" : singleScan ? "scan" : "blocked";
  const plan = planFilter(raw, ctx.fieldNames, { targetMode, tokenLimits: ctx.tokenLimits });
  if (plan.kind !== "freeText") return raw;
  if ((!allFts && !singleScan) || target.mode === "blocked") return null;

  const rendered = renderNode(plan.root, target);
  const scanEntry = singleScan ? ctx.freeTextScan?.[streams[0]] : undefined;
  if (scanEntry) scanEntry.materialized = true;
  return rendered;
}

/** Facet-include core: `(\n<filter>\n) AND <predicate>`, or today's append when materialising fails. */
export function appendConjunct(
  filter: string,
  predicate: string,
  streams: string[],
  ctx: FreeTextContext,
): string {
  if (isBlankFilter(filter)) return predicate;
  const materialized = materializeFreeText(filter, streams, ctx);
  if (materialized === null) return `${filter} and ${predicate}`;
  return `(\n${materialized}\n) AND ${predicate}`;
}

/** Post-error recovery: a Run-as suggestion, or else the Search-text candidate. */
export function suggestRecovery(
  raw: string,
  booleanFields: ReadonlySet<string>,
  allStreamsFts: boolean,
): RecoveryCards {
  const trimmed = raw.trim();
  const tokens = lex(raw);
  if (trimmed === "" || (tokens !== null && tokens.length === 0)) {
    return { runSuggestion: null, freeTextCandidate: null };
  }
  if (tokens === null) return { runSuggestion: null, freeTextCandidate: trimmed };
  if (maxParenDepth(raw) > SQL_PARSE_MAX_DEPTH || exceedsTextNesting(tokens)) {
    return { runSuggestion: null, freeTextCandidate: null };
  }

  const tally: SuggestionTally = { text: 0, fieldValue: 0, sql: 0, predicates: 0 };
  const node = buildSuggestionExpr(tokens, raw, withImplicitFields(booleanFields), tally);
  const structural =
    node !== null && tally.text + tally.fieldValue > 0 && tally.sql + tally.fieldValue > 0;
  const text = structural ? renderNode(node, { mode: "fts", fields: [] }) : "";
  const valid = structural && whereShape(text) !== null;
  if (valid && (tally.text === 0 || allStreamsFts)) {
    return { runSuggestion: text, freeTextCandidate: null };
  }
  // Phrase search would turn an accepted field predicate into literal text, unless a valid mix is only blocked by FTS.
  if (!valid && tally.predicates > 0) return { runSuggestion: null, freeTextCandidate: null };
  return { runSuggestion: null, freeTextCandidate: trimmed };
}

/** Source offsets of the words and phrases a pure-text filter searches; empty for any other filter. */
export function freeTextRanges(
  raw: string,
  booleanFields: ReadonlySet<string>,
  options: PlanFilterOptions = {},
): TextRange[] {
  if (planFilter(raw, booleanFields, options).kind !== "freeText") return [];
  return (lex(raw) ?? [])
    .filter(({ tok }) => tok.t === "word" || tok.t === "squote" || tok.t === "dquote")
    .map(({ start, end }) => ({ start, end }));
}

function renderSqlFilter(filter: string, knownFields: ReadonlySet<string>): string {
  const body = filter
    .trim()
    .split("\n")
    .filter((line: string) => !line.trim().startsWith("--"))
    .join("\n");
  if (body.trim() === "") return "";

  const spaced = addSpacesToOperators(body);
  const parts = spaced.split(" ");
  const protectedRanges = sqlLiteralAndCommentRanges(spaced);
  let rangeIndex = 0;
  let offset = 0;
  for (const [index, token] of parts.entries()) {
    while (protectedRanges[rangeIndex]?.end <= offset) rangeIndex++;
    const range = protectedRanges[rangeIndex];
    const isProtected = range !== undefined && range.start < offset + token.length;
    const normalizedToken = token.replaceAll('"', "");
    // A field name inside a string literal is searched text, so its quotes stay as typed.
    if (!isProtected && knownFields.has(normalizedToken)) {
      parts[index] = quoteSqlIdentifierIfNeeded(normalizedToken);
    }
    offset += token.length + 1;
  }
  return parts.join(" ");
}

function sqlLiteralAndCommentRanges(raw: string): TextRange[] {
  const ranges: TextRange[] = [];
  let i = 0;
  while (i < raw.length) {
    const end = maskedSpanEnd(raw, i);
    if (end === null) {
      i++;
    } else {
      if (raw[i] !== '"') ranges.push({ start: i, end });
      i = end;
    }
  }
  return ranges;
}

function renderNode(node: PlanNode, target: { mode: "fts" | "scan"; fields: string[] }): string {
  switch (node.k) {
    case "text":
      return target.mode === "fts"
        ? `match_all(${sqlString(node.value)})`
        : scanPredicate(node.value, target.fields);
    case "sql":
      return node.text;
    case "not":
      return `NOT ${renderNode(node.child, target)}`;
    case "group":
      return `(${renderNode(node.child, target)})`;
    default:
      return node.children
        .map((child) => renderNode(child, target))
        .join(node.k === "and" ? " AND " : " OR ");
  }
}

function scanPredicate(value: string, fields: string[]): string {
  const arms = fields.map((field) => {
    const id = `"${field.replaceAll('"', '""')}"`;
    return `(${id} IS NOT NULL AND str_match_ignore_case(${id}, ${sqlString(value)}))`;
  });
  return `(${arms.join(" OR ")})`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function filterComments(raw: string): string[] {
  const comments: string[] = [];
  let i = 0;
  let quoteAllowed = true;
  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      i++;
      quoteAllowed = true;
      continue;
    }
    let end: number;
    if (isLineComment(raw, i)) {
      const newline = raw.indexOf("\n", i);
      end = newline < 0 ? raw.length : newline;
    } else if (raw.startsWith("/*", i)) {
      const close = raw.indexOf("*/", i + 2);
      end = close < 0 ? raw.length : close + 2;
    } else {
      const lexed = lexOne(raw, i, quoteAllowed);
      if (!lexed) break;
      i = lexed.end;
      quoteAllowed = lexed.tok.t === "lparen" || lexed.tok.t === "op";
      continue;
    }
    comments.push(raw.slice(i, end));
    i = end;
    quoteAllowed = true;
  }
  return comments;
}

function isExcludedToken(tok: Token): boolean {
  return tok.t === "word"
    ? /^-\p{L}/u.test(tok.text)
    : (tok.t === "squote" || tok.t === "dquote") && tok.negated === true;
}

function isLineComment(raw: string, i: number): boolean {
  if (!raw.startsWith("--", i)) return false;
  let start = i;
  let end = i + 2;
  while (raw[start - 1] === "-") start--;
  while (raw[end] === "-") end++;
  return !(/[\p{L}\p{N}_]/u.test(raw[start - 1] ?? "") && /[\p{L}\p{N}_]/u.test(raw[end] ?? ""));
}

function lex(raw: string): Lexed[] | null {
  const tokens: Lexed[] = [];
  let i = 0;
  let quoteAllowed = true;
  while (i < raw.length) {
    const skipped = skipTrivia(raw, i);
    if (skipped === null) return null;
    if (skipped > i) {
      i = skipped;
      quoteAllowed = true;
      continue;
    }
    const lexed = lexOne(raw, i, quoteAllowed);
    if (lexed === null) return null;
    tokens.push(lexed);
    quoteAllowed = lexed.tok.t === "lparen" || lexed.tok.t === "op";
    i = lexed.end;
  }
  return mergeCaseSpans(mergeParenSpans(tokens, raw), raw);
}

function skipTrivia(raw: string, i: number): number | null {
  let j = i;
  while (j < raw.length) {
    if (/\s/.test(raw[j])) {
      j++;
    } else if (isLineComment(raw, j)) {
      const newline = raw.indexOf("\n", j);
      j = newline < 0 ? raw.length : newline;
    } else if (raw.startsWith("/*", j)) {
      const close = raw.indexOf("*/", j + 2);
      if (close < 0) return null;
      j = close + 2;
    } else {
      break;
    }
  }
  return j;
}

function lexOne(raw: string, i: number, quoteAllowed: boolean): Lexed | null {
  const c = raw[i];
  if (c === "-" && quoteAllowed && (raw[i + 1] === "'" || raw[i + 1] === '"')) {
    const quoted = lexQuoted(raw, i + 1);
    return quoted && (quoted.tok.t === "squote" || quoted.tok.t === "dquote")
      ? { ...quoted, start: i, tok: { ...quoted.tok, negated: true } }
      : null;
  }
  if ((c === "'" || c === '"') && quoteAllowed) return lexQuoted(raw, i);
  if (c === "(") return { tok: { t: "lparen" }, start: i, end: i + 1 };
  if (c === ")") return { tok: { t: "rparen" }, start: i, end: i + 1 };
  if (c === ",") return { tok: { t: "op", text: "," }, start: i, end: i + 1 };
  const two = raw.slice(i, i + 2);
  if (TWO_CHAR_OPS.has(two)) return { tok: { t: "op", text: two }, start: i, end: i + 2 };
  if (ONE_CHAR_OPS.has(c)) return { tok: { t: "op", text: c }, start: i, end: i + 1 };
  if (ARITHMETIC_OPS.has(c) && isSpaceDelimited(raw, i)) {
    return { tok: { t: "op", text: c }, start: i, end: i + 1 };
  }
  return lexWord(raw, i);
}

function lexQuoted(raw: string, i: number): Lexed | null {
  const quote = raw[i];
  let j = i + 1;
  while (j < raw.length) {
    if (raw[j] === quote) {
      if (raw[j + 1] !== quote) break;
      j += 2;
    } else {
      j++;
    }
  }
  if (j >= raw.length) return null;
  const text = raw.slice(i + 1, j).replaceAll(quote + quote, quote);
  return { tok: { t: quote === "'" ? "squote" : "dquote", text }, start: i, end: j + 1 };
}

function lexWord(raw: string, i: number): Lexed {
  let j = i + 1;
  while (j < raw.length && !endsWord(raw, j)) {
    if (raw[j] === "-") {
      do {
        j++;
      } while (raw[j] === "-");
      continue;
    }
    const quoted = startsValueLiteral(raw, j) ? lexQuoted(raw, j) : null;
    j = quoted ? quoted.end : j + 1;
  }
  const text = raw.slice(i, j);
  const tok: Token = KEYWORDS.has(text.toUpperCase()) ? { t: "kw", text } : { t: "word", text };
  return { tok, start: i, end: j };
}

// The quoted value of a `field:'two words'` unit stays inside its word.
function startsValueLiteral(raw: string, j: number): boolean {
  return raw[j - 1] === ":" && (raw[j] === "'" || raw[j] === '"');
}

function endsWord(raw: string, j: number): boolean {
  const c = raw[j];
  if (/\s/.test(c) || c === "(" || c === ")" || c === "," || ONE_CHAR_OPS.has(c)) return true;
  const two = raw.slice(j, j + 2);
  return TWO_CHAR_OPS.has(two) || isLineComment(raw, j) || two === "/*";
}

function isSpaceDelimited(raw: string, i: number): boolean {
  const before = i === 0 ? " " : raw[i - 1];
  const after = i + 1 >= raw.length ? " " : raw[i + 1];
  return (/\s/.test(before) || before === "(") && /\s/.test(after);
}

// Folds `fn(...)`, `IN (...)` and `EXISTS (...)` into one opaque token each.
function mergeParenSpans(tokens: Lexed[] | null, raw: string): Lexed[] | null {
  if (tokens === null) return null;
  const out: Lexed[] = [];
  let i = 0;
  while (i < tokens.length) {
    const current = tokens[i];
    const next = tokens[i + 1];
    if (next?.tok.t === "lparen" && ownsParenSpan(current, next)) {
      const close = matchingParen(tokens, i + 1);
      if (close < 0) return null;
      const end = tokens[close].end;
      out.push({
        tok: { t: "opaque", text: raw.slice(current.start, end) },
        start: current.start,
        end,
      });
      i = close + 1;
    } else {
      out.push(current);
      i++;
    }
  }
  return out;
}

function ownsParenSpan(current: Lexed, lparen: Lexed): boolean {
  const { tok } = current;
  if (tok.t === "word") return current.end === lparen.start;
  if (tok.t !== "kw") return false;
  const upper = tok.text.toUpperCase();
  if (LIST_OWNING_KEYWORDS.has(upper)) return true;
  return !CONNECTIVES.has(upper) && current.end === lparen.start;
}

function matchingParen(tokens: Lexed[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].tok.t === "lparen") depth++;
    if (tokens[i].tok.t === "rparen") depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function mergeCaseSpans(tokens: Lexed[] | null, raw: string): Lexed[] | null {
  if (tokens === null) return null;
  const out: Lexed[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isKeyword(tokens[i], "CASE")) {
      out.push(tokens[i]);
      i++;
      continue;
    }
    const end = matchingEnd(tokens, i);
    if (end < 0) return null;
    const span = { start: tokens[i].start, end: tokens[end].end };
    out.push({ tok: { t: "opaque", text: raw.slice(span.start, span.end) }, ...span });
    i = end + 1;
  }
  return out;
}

function matchingEnd(tokens: Lexed[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (isKeyword(tokens[i], "CASE")) depth++;
    if (isKeyword(tokens[i], "END")) depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function isKeyword(lexed: Lexed | undefined, upper: string): boolean {
  return lexed?.tok.t === "kw" && lexed.tok.text.toUpperCase() === upper;
}

function isPureTextShape(tokens: Lexed[], names: ReadonlySet<string>): boolean {
  return tokens.every((lexed, index) =>
    isPureTextToken(lexed, tokens[index - 1], tokens[index + 1], names),
  );
}

function isPureTextToken(
  lexed: Lexed,
  prev: Lexed | undefined,
  next: Lexed | undefined,
  names: ReadonlySet<string>,
): boolean {
  const { tok } = lexed;
  switch (tok.t) {
    case "kw":
      return CONNECTIVES.has(tok.text.toUpperCase());
    case "lparen":
      return !(prev && (prev.tok.t === "word" || prev.tok.t === "dquote"));
    case "rparen":
      return true;
    case "word":
      return !isFieldLikeWord(isExcludedToken(tok) ? tok.text.slice(1) : tok.text, names);
    case "dquote":
      return (
        !(tok.negated ? isFieldLikeWord(tok.text, names) : names.has(tok.text)) &&
        !gluedToNextOperand(lexed, next)
      );
    case "squote":
      return !(tok.negated && isFieldLikeWord(tok.text, names)) && !gluedToNextOperand(lexed, next);
    case "opaque":
      return isMatchAllCall(lexed);
    default:
      return false;
  }
}

function isMatchAllCall(lexed: Lexed | undefined): boolean {
  return lexed?.tok.t === "opaque" && MATCH_ALL_CALL.test(lexed.tok.text);
}

// A quoted token glued to a following operand (`"s".f`, `'a'b`) is identifier syntax, not text.
function gluedToNextOperand(lexed: Lexed, next: Lexed | undefined): boolean {
  if (!next || next.start !== lexed.end) return false;
  return next.tok.t === "word" || next.tok.t === "squote" || next.tok.t === "dquote";
}

// Exact and DataFusion-lowercased forms both count, since today's quoting loop matches exact names.
function isFieldLikeWord(word: string, names: ReadonlySet<string>): boolean {
  const colon = word.indexOf(":");
  if (colon > 0 && isFieldLikeWord(word.slice(0, colon), names)) return true;
  const base = word.split(/[.[]/)[0];
  return [word, asciiLower(word), base, asciiLower(base)].some(
    (form) => form !== "" && names.has(form),
  );
}

function parseBooleanText(tokens: Lexed[]): PlanNode | null {
  const state = { pos: 0 };
  const root = parseOr(tokens, state);
  return root !== null && state.pos === tokens.length ? root : null;
}

function parseOr(tokens: Lexed[], state: { pos: number }): PlanNode | null {
  const children: PlanNode[] = [];
  for (;;) {
    const child = parseAnd(tokens, state);
    if (child === null) return null;
    children.push(child);
    if (!isKeyword(tokens[state.pos], "OR")) break;
    state.pos++;
  }
  return children.length === 1 ? children[0] : { k: "or", children };
}

// Adjacent operands are joined by an implicit AND.
function parseAnd(tokens: Lexed[], state: { pos: number }): PlanNode | null {
  const children: PlanNode[] = [];
  for (;;) {
    const child = parseUnary(tokens, state);
    if (child === null) return null;
    children.push(child);
    if (isKeyword(tokens[state.pos], "AND")) state.pos++;
    else if (!startsOperand(tokens[state.pos])) break;
  }
  return children.length === 1 ? children[0] : { k: "and", children };
}

function parseUnary(tokens: Lexed[], state: { pos: number }): PlanNode | null {
  let negations = 0;
  while (isKeyword(tokens[state.pos], "NOT")) {
    negations++;
    state.pos++;
  }
  let node = parsePrimary(tokens, state);
  for (let i = 0; node !== null && i < negations; i++) node = { k: "not", child: node };
  return node;
}

function parsePrimary(tokens: Lexed[], state: { pos: number }): PlanNode | null {
  const lexed = tokens[state.pos];
  if (!lexed) return null;
  const { tok } = lexed;
  state.pos++;
  if (tok.t === "lparen") {
    const child = parseOr(tokens, state);
    if (child === null || tokens[state.pos]?.tok.t !== "rparen") return null;
    state.pos++;
    return { k: "group", child };
  }
  if ((tok.t === "word" || tok.t === "squote" || tok.t === "dquote") && isExcludedToken(tok)) {
    return {
      k: "not",
      child: { k: "text", value: tok.t === "word" ? tok.text.slice(1) : tok.text },
    };
  }
  if (tok.t === "word" || tok.t === "squote" || tok.t === "dquote")
    return { k: "text", value: tok.text };
  if (isMatchAllCall(lexed) && tok.t === "opaque") return { k: "sql", text: tok.text };
  return null;
}

// Counts only the groups and NOTs still open at each token, so sibling operands never add up.
function exceedsTextNesting(tokens: Lexed[]): boolean {
  const enclosing: number[] = [];
  let outer = 0;
  let pending = 0;
  for (const lexed of tokens) {
    if (isKeyword(lexed, "NOT")) {
      pending++;
    } else if (lexed.tok.t === "lparen") {
      enclosing.push(outer);
      outer += pending + 1;
      pending = 0;
    } else {
      if (lexed.tok.t === "rparen") outer = enclosing.pop() ?? 0;
      pending = 0;
    }
    if (outer + pending > MAX_TEXT_NESTING) return true;
  }
  return false;
}

function startsOperand(lexed: Lexed | undefined): boolean {
  if (!lexed) return false;
  const { t } = lexed.tok;
  return (
    t === "word" ||
    t === "squote" ||
    t === "dquote" ||
    t === "lparen" ||
    isKeyword(lexed, "NOT") ||
    isMatchAllCall(lexed)
  );
}

function collectUnits(node: PlanNode): string[] {
  switch (node.k) {
    case "text":
      return [node.value];
    case "sql":
      return [];
    case "not":
    case "group":
      return collectUnits(node.child);
    default:
      return node.children.flatMap(collectUnits);
  }
}

// Mirrors the o2 search tokenizer: ASCII alphanumeric runs, single non-ASCII alphanumerics, byte lengths.
function hasIndexToken(value: string, limits: TokenLimits): boolean {
  const pieces = value.match(/[A-Za-z0-9]+|[^\p{ASCII}]/gu) ?? [];
  return pieces.some((piece) => {
    if (!/^[A-Za-z0-9]+$/.test(piece) && !/[\p{L}\p{N}]/u.test(piece)) return false;
    const bytes = new TextEncoder().encode(piece).length;
    return bytes >= limits.min && bytes < limits.max;
  });
}

// Rendered as SQL so field checks and per-stream mapping still see every predicate; null keeps the filter.
function planMix(
  tokens: Lexed[],
  raw: string,
  names: ReadonlySet<string>,
  options: PlanFilterOptions,
): string | null {
  // A scan or blocked target would need consent or would drop the SQL half on side requests.
  const allFts = options.allTargetsFts ?? (options.targetMode ?? "fts") === "fts";
  if (!allFts || exceedsTextNesting(tokens)) return null;
  const state: MixState = {
    names,
    limits: options.tokenLimits ?? DEFAULT_TOKEN_LIMITS,
    units: 0,
  };
  const root = buildMixExpr(tokens, raw, state);
  if (root === null || state.units === 0) return null;
  const filter = renderNode(root, { mode: "fts", fields: [] });
  return whereShape(filter) === null ? null : filter;
}

function buildMixExpr(tokens: Lexed[], raw: string, state: MixState): PlanNode | null {
  const children: PlanNode[] = [];
  for (const part of splitTopLevel(tokens, "OR")) {
    const andChildren: PlanNode[] = [];
    for (const unit of splitTopLevel(part, "AND")) {
      const node = buildMixUnit(unit, raw, state);
      if (node === null) return null;
      andChildren.push(node);
    }
    children.push(andChildren.length === 1 ? andChildren[0] : { k: "and", children: andChildren });
  }
  return children.length === 1 ? children[0] : { k: "or", children };
}

function buildMixUnit(tokens: Lexed[], raw: string, state: MixState): PlanNode | null {
  if (tokens.length === 0) return null;
  if (isKeyword(tokens[0], "NOT")) {
    const child = buildMixUnit(tokens.slice(1), raw, state);
    return child === null ? null : { k: "not", child };
  }
  if (tokens[0].tok.t === "lparen" && matchingParen(tokens, 0) === tokens.length - 1) {
    const child = buildMixExpr(tokens.slice(1, -1), raw, state);
    return child === null ? null : { k: "group", child };
  }
  if (!tokens.every((lexed) => isOperandToken(lexed) || isMatchAllCall(lexed))) {
    return { k: "sql", text: sliceOf(tokens, raw) };
  }
  const children: PlanNode[] = [];
  for (const [index, lexed] of tokens.entries()) {
    const node = mixTextUnit(lexed, tokens[index + 1], state);
    if (node === null) return null;
    children.push(node);
  }
  return children.length === 1 ? children[0] : { k: "and", children };
}

// Numbers stay SQL literals here, unlike pure text, because a predicate beside them makes the filter SQL.
function mixTextUnit(lexed: Lexed, next: Lexed | undefined, state: MixState): PlanNode | null {
  const { tok } = lexed;
  if (tok.t === "opaque") return { k: "sql", text: tok.text };
  if (tok.t !== "word" && tok.t !== "squote" && tok.t !== "dquote") return null;
  if (tok.t !== "word" && gluedToNextOperand(lexed, next)) return null;
  if (tok.t === "dquote" && state.names.has(tok.text)) return null;
  if (isExcludedToken(tok) && tok.t !== "word" && isFieldLikeWord(tok.text, state.names))
    return null;
  const negated = isExcludedToken(tok);
  const value = negated && tok.t === "word" ? tok.text.slice(1) : tok.text;
  if (tok.t === "word" && (NUMERIC_LITERAL.test(value) || isFieldLikeWord(value, state.names)))
    return null;
  if (value === "" || !hasIndexToken(value, state.limits)) return null;
  state.units++;
  const text: PlanNode = { k: "text", value };
  return negated ? { k: "not", child: text } : text;
}

function buildSuggestionExpr(
  tokens: Lexed[],
  raw: string,
  names: ReadonlySet<string>,
  tally: SuggestionTally,
): PlanNode | null {
  const orParts = splitTopLevel(tokens, "OR");
  const children = orParts.map((part) => buildSuggestionAnd(part, raw, names, tally));
  if (children.some((child) => child === null)) return null;
  return children.length === 1 ? children[0] : { k: "or", children: children as PlanNode[] };
}

function buildSuggestionAnd(
  tokens: Lexed[],
  raw: string,
  names: ReadonlySet<string>,
  tally: SuggestionTally,
): PlanNode | null {
  const andParts = splitTopLevel(tokens, "AND");
  const children = andParts.map((part) => buildSuggestionUnit(part, raw, names, tally));
  if (children.some((child) => child === null)) return null;
  return children.length === 1 ? children[0] : { k: "and", children: children as PlanNode[] };
}

function buildSuggestionUnit(
  tokens: Lexed[],
  raw: string,
  names: ReadonlySet<string>,
  tally: SuggestionTally,
): PlanNode | null {
  if (tokens.length === 0) return null;
  if (isKeyword(tokens[0], "NOT")) {
    const child = buildSuggestionUnit(tokens.slice(1), raw, names, tally);
    return child === null ? null : { k: "not", child };
  }
  if (tokens[0].tok.t === "lparen" && matchingParen(tokens, 0) === tokens.length - 1) {
    const child = buildSuggestionExpr(tokens.slice(1, -1), raw, names, tally);
    return child === null ? null : { k: "group", child };
  }
  if (tokens.every(isOperandToken)) {
    return buildOperandRun(tokens, names, tally) ?? verbatimSql(tokens, raw, tally);
  }
  return buildSqlSegment(tokens, raw, names, tally);
}

// A run of words and quotes: each becomes a text unit or a `field='value'` comparison.
function buildOperandRun(
  tokens: Lexed[],
  names: ReadonlySet<string>,
  tally: SuggestionTally,
): PlanNode | null {
  const children: PlanNode[] = [];
  const counts = { text: 0, fieldValue: 0 };
  for (const { tok } of tokens) {
    const node = operandNode(tok, names);
    if (node === null) return null;
    children.push(node);
    if (node.k === "text") counts.text++;
    else counts.fieldValue++;
  }
  tally.text += counts.text;
  tally.fieldValue += counts.fieldValue;
  return children.length === 1 ? children[0] : { k: "and", children };
}

function operandNode(tok: Token, names: ReadonlySet<string>): PlanNode | null {
  if (tok.t === "squote") return tok.text === "" ? null : { k: "text", value: tok.text };
  if (tok.t === "dquote")
    return names.has(tok.text) || tok.text === "" ? null : { k: "text", value: tok.text };
  if (tok.t !== "word") return null;
  const colon = tok.text.indexOf(":");
  const left = colon > 0 ? tok.text.slice(0, colon) : "";
  const rawRest = tok.text.slice(colon + 1);
  const rest = unquoteLiteral(rawRest);
  if (left !== "" && isFieldLikeWord(left, names)) {
    const partialQuote = /^['"]/.test(rawRest) && lexQuoted(rawRest, 0)?.end !== rawRest.length;
    return rest === "" || partialQuote ? null : { k: "sql", text: `${left}=${sqlString(rest)}` };
  }
  return isFieldLikeWord(tok.text, names) ? null : { k: "text", value: tok.text };
}

// A segment with SQL tokens: verbatim when it parses, else split off a leading or trailing text run.
function buildSqlSegment(
  tokens: Lexed[],
  raw: string,
  names: ReadonlySet<string>,
  tally: SuggestionTally,
): PlanNode {
  const whole = whereShape(sliceOf(tokens, raw));
  if (whole !== null) return countSql(whole, sliceOf(tokens, raw), tally);
  for (let k = tokens.length - 1; k > 0 && isOperandToken(tokens[k]); k--) {
    const split = trySplit(tokens.slice(0, k), tokens.slice(k), raw, names, tally, "sqlFirst");
    if (split !== null) return split;
  }
  for (let k = 1; k < tokens.length && isOperandToken(tokens[k - 1]); k++) {
    const split = trySplit(tokens.slice(k), tokens.slice(0, k), raw, names, tally, "textFirst");
    if (split !== null) return split;
  }
  return verbatimSql(tokens, raw, tally);
}

// Kept as typed; the final parse of the whole suggestion rejects it when it is not valid SQL.
function verbatimSql(tokens: Lexed[], raw: string, tally: SuggestionTally): PlanNode {
  const text = sliceOf(tokens, raw);
  return countSql(whereShape(text), text, tally);
}

function trySplit(
  sqlTokens: Lexed[],
  textTokens: Lexed[],
  raw: string,
  names: ReadonlySet<string>,
  tally: SuggestionTally,
  order: "sqlFirst" | "textFirst",
): PlanNode | null {
  const sqlText = sliceOf(sqlTokens, raw);
  const shape = whereShape(sqlText);
  if (shape === null) return null;
  const local: SuggestionTally = { text: 0, fieldValue: 0, sql: 0, predicates: 0 };
  const run = buildOperandRun(textTokens, names, local);
  if (run === null) return null;
  const sqlNode = countSql(shape, sqlText, tally);
  tally.text += local.text;
  tally.fieldValue += local.fieldValue;
  return { k: "and", children: order === "sqlFirst" ? [sqlNode, run] : [run, sqlNode] };
}

function countSql(shape: WhereShape, text: string, tally: SuggestionTally): PlanNode {
  tally.sql++;
  if (shape === "predicate") tally.predicates++;
  return { k: "sql", text };
}

function isOperandToken(lexed: Lexed): boolean {
  const { t } = lexed.tok;
  return t === "word" || t === "squote" || t === "dquote";
}

// Splits at top-level connectives; the AND of `BETWEEN … AND` is not a split point.
function splitTopLevel(tokens: Lexed[], connective: "AND" | "OR"): Lexed[][] {
  const parts: Lexed[][] = [[]];
  let depth = 0;
  let pendingBetween = false;
  for (const lexed of tokens) {
    if (lexed.tok.t === "lparen") depth++;
    if (lexed.tok.t === "rparen") depth--;
    if (depth === 0 && isKeyword(lexed, "BETWEEN")) pendingBetween = true;
    const isSplit = depth === 0 && isKeyword(lexed, connective);
    if (isSplit && connective === "AND" && pendingBetween) {
      pendingBetween = false;
    } else if (isSplit) {
      parts.push([]);
      continue;
    }
    parts[parts.length - 1].push(lexed);
  }
  return parts;
}

function sliceOf(tokens: Lexed[], raw: string): string {
  return raw.slice(tokens[0].start, tokens[tokens.length - 1].end);
}

function whereShape(part: string): WhereShape {
  if (maxParenDepth(part) > SQL_PARSE_MAX_DEPTH) return null;
  const stmt = astifySelect(`select * from s where ${part}`);
  if (!stmt || stmt.type !== "select" || stmt.groupby || stmt.orderby || stmt.having) return null;
  if (stmt.limit?.value?.length) return null;
  return exprShape(stmt.where ?? undefined);
}

function exprShape(node: AstNode | undefined): WhereShape {
  if (!node) return null;
  if (node.type === "column_ref") return "column";
  if (node.type === "function") return "predicate";
  const operator = String(node.operator ?? "").toUpperCase();
  if (node.type === "unary_expr" && operator === "NOT") {
    return exprShape(node.expr) === null ? null : "predicate";
  }
  if (node.type !== "binary_expr") return null;
  if (operator === "AND" || operator === "OR") {
    return exprShape(node.left) !== null && exprShape(node.right) !== null ? "predicate" : null;
  }
  return PREDICATE_OPERATORS.has(operator) ? "predicate" : null;
}

function astifySelect(sql: string): AstNode | null {
  try {
    sharedParser ??= new SqlParser();
    const ast = sharedParser.astify(sql) as unknown as AstNode | AstNode[];
    return (Array.isArray(ast) ? ast[0] : ast) ?? null;
  } catch {
    return null;
  }
}

// A select list of bare identifiers that are not fields reads as a sentence (`select messages from cache`).
function isSentenceShaped(raw: string, fields: ReadonlySet<string> | undefined): boolean {
  if (!fields || maxParenDepth(raw) > SQL_PARSE_MAX_DEPTH) return false;
  const stmt = astifySelect(raw);
  if (stmt?.type !== "select" || !readsOneStreamDirectly(stmt)) return false;
  const columns = Array.isArray(stmt.columns) ? stmt.columns : [];
  if (columns.length === 0) return false;
  return columns.every((column: AstNode) => {
    const name = bareIdentifier(column?.expr);
    return column?.as == null && name !== null && !fields.has(name);
  });
}

// Only then are the projected names the stream's own fields; a CTE, subquery, join or union renames them.
function readsOneStreamDirectly(stmt: AstNode): boolean {
  const from: AstNode[] = Array.isArray(stmt.from) ? stmt.from : [];
  return (
    !stmt.with &&
    !stmt._next &&
    from.length === 1 &&
    typeof from[0]?.table === "string" &&
    !from[0]?.expr
  );
}

function bareIdentifier(node: AstNode | undefined): string | null {
  if (node?.type !== "column_ref" || node.table) return null;
  const column = node.column as { expr?: { type?: string; value?: unknown } } | string | undefined;
  if (typeof column !== "object" || column?.expr?.type !== "default") return null;
  return typeof column.expr.value === "string" ? column.expr.value : null;
}

function leadingWord(raw: string): string {
  const start = skipTrivia(raw, 0);
  if (start === null) return "";
  return (raw.slice(start).match(/^[A-Za-z_]+/)?.[0] ?? "").toLowerCase();
}

function fromStreamName(raw: string): string | null {
  const masked = maskLiteralsAndComments(raw);
  const match = masked.match(/\bfrom\s+("[^"]*"|[^\s,;()]+)/i);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length - match[1].length;
  const name = raw.slice(start, start + match[1].length);
  return name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name;
}

// Same-length copy with comments and string literals blanked, and quoted identifiers kept opaque.
function maskLiteralsAndComments(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const end = maskedSpanEnd(raw, i);
    if (end === null) {
      out += raw[i];
      i++;
    } else if (raw[i] === '"') {
      out += `"${"_".repeat(Math.max(0, end - i - 2))}${end - i >= 2 ? '"' : ""}`;
      i = end;
    } else {
      out += " ".repeat(end - i);
      i = end;
    }
  }
  return out;
}

function maskedSpanEnd(raw: string, i: number): number | null {
  if (raw.startsWith("--", i)) {
    const newline = raw.indexOf("\n", i);
    return newline < 0 ? raw.length : newline;
  }
  if (raw.startsWith("/*", i)) {
    const close = raw.indexOf("*/", i + 2);
    return close < 0 ? raw.length : close + 2;
  }
  if (raw[i] !== "'" && raw[i] !== '"') return null;
  return lexQuoted(raw, i)?.end ?? raw.length;
}

function isBlankFilter(filter: string): boolean {
  const tokens = lex(filter);
  return tokens === null ? filter.trim() === "" : tokens.length === 0;
}

function scanCandidates(rawSchema: SchemaField[], settings: StreamTextSettings): string[] {
  const redacted = new Set(
    asArray<PatternAssociationRef>(settings.pattern_associations)
      .filter((association) => association && association.apply_at !== AT_INGESTION_POLICY)
      .map((association) => association.field),
  );
  const names = unique(
    rawSchema
      .filter((field) => isStringField(field) && !SCAN_EXCLUDED_FIELDS.has(field.name))
      .map((field) => field.name)
      .filter((name) => !redacted.has(name)),
  );
  return [
    ...names.filter((name) => SCAN_RANK_PATTERN.test(name)),
    ...names.filter((name) => !SCAN_RANK_PATTERN.test(name)),
  ];
}

function isStringField(field: SchemaField | null | undefined): field is SchemaField {
  return !!field && typeof field.name === "string" && STRING_TYPES.has(field.type ?? "");
}

function withImplicitFields(names: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...names, ...IMPLICIT_FIELD_NAMES]);
}

function unquoteLiteral(value: string): string {
  const quote = value[0];
  if (value.length >= 2 && (quote === "'" || quote === '"') && value.endsWith(quote)) {
    return value.slice(1, -1).replaceAll(quote + quote, quote);
  }
  return value;
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asStringArray(value: unknown): string[] {
  return asArray<unknown>(value).filter((item): item is string => typeof item === "string");
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
