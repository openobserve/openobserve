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

import { escapeSingleQuotes } from "@/utils/queryUtils";

import { Parser as SqlParser } from "@openobserve/node-sql-parser/build/datafusionsql";
import { addSpacesToOperators } from "@/utils/queryUtils";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { maxParenDepth, SQL_PARSE_MAX_DEPTH } from "@/utils/query/sqlComplexity";
import { maskedSpanEnd, stripCommentLines } from "@/utils/query/sqlComments";

export { stripCommentLines };

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

const AT_INGESTION_POLICY = "AtIngestion";

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
  | { kind: "unclassified"; filter: string; suggestion?: PlanNode; held?: true };

export type TextSearchTarget =
  { mode: "fts"; fields: string[] } | { mode: "blocked"; candidates: string[] };

export interface TokenLimits {
  min: number;
  max: number;
}

export interface PlanFilterOptions {
  targetMode?: TextSearchTarget["mode"];
  tokenLimits?: TokenLimits;
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
  fieldNames: ReadonlySet<string>;
  targets: Readonly<Record<string, TextSearchTarget>>;
  tokenLimits?: TokenLimits;
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

interface TermRule {
  names: ReadonlySet<string>;
  limits: TokenLimits;
}

interface MixState extends TermRule {
  units: number;
}

interface ParseState {
  pos: number;
  rule: TermRule;
}

interface FieldValuePair {
  field: string;
  value: string;
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

export function planFilter(
  raw: string,
  booleanFields: ReadonlySet<string>,
  options: PlanFilterOptions = {},
): FilterPlan {
  const lexed = lexFilter(raw);
  if (lexed === null) return { kind: "unclassified", filter: raw };
  const rule: TermRule = {
    names: withImplicitFields(booleanFields),
    limits: options.tokenLimits ?? DEFAULT_TOKEN_LIMITS,
  };
  if (lexed.length === 0) return { kind: "sql", filter: raw };
  const tokens = withImplicitAnds(lexed, raw, rule);
  if (!isPureTextShape(tokens, rule)) return planMix(tokens, raw, rule, options);
  if (exceedsTextNesting(tokens)) return { kind: "unclassified", filter: raw };

  const root = parseBooleanText(tokens, rule);
  if (root === null) return { kind: "unclassified", filter: raw };

  const units = collectUnits(root);
  if (units.length === 0 || units.some((unit) => unit === "")) return { kind: "sql", filter: raw };
  const { limits } = rule;
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

export function renderPlan(
  plan: FilterPlan,
  target: TextSearchTarget,
  knownFields: ReadonlySet<string>,
): string | null {
  if (plan.kind !== "freeText") return renderSqlFilter(plan.filter, knownFields);
  if (target.mode === "blocked" || target.fields.length === 0) return null;
  return renderNode(plan.root);
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
  return { mode: "blocked", candidates: scanCandidates(rawSchema, settings) };
}

export function quoteFreeTextPhrase(raw: string): string {
  return `'${escapeSingleQuotes(raw.trim())}'`;
}

export function isAuthoredStatement(raw: string): boolean {
  const word = leadingWord(raw);
  return word === "select" || word === "with";
}

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

export function materializeFreeText(
  raw: string,
  streams: string[],
  ctx: FreeTextContext,
): string | null {
  const targets = streams.map((stream) => ctx.targets[stream]);
  if (targets.length === 0 || targets.some((target) => !target)) return null;
  const allFts = targets.every((target) => target.mode === "fts");
  const targetMode = allFts ? "fts" : "blocked";
  const plan = planFilter(raw, ctx.fieldNames, { targetMode, tokenLimits: ctx.tokenLimits });
  if (plan.kind !== "freeText") return raw;
  return allFts ? renderNode(plan.root) : null;
}

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

export function suggestRecovery(
  raw: string,
  booleanFields: ReadonlySet<string>,
  allStreamsFts: boolean,
  tokenLimits: TokenLimits = DEFAULT_TOKEN_LIMITS,
): RecoveryCards {
  const trimmed = raw.trim();
  const tokens = lexFilter(raw);
  if (trimmed === "" || (tokens !== null && tokens.length === 0)) {
    return { runSuggestion: null, freeTextCandidate: null };
  }
  if (tokens === null) return { runSuggestion: null, freeTextCandidate: trimmed };
  if (maxParenDepth(raw) > SQL_PARSE_MAX_DEPTH || exceedsTextNesting(tokens)) {
    return { runSuggestion: null, freeTextCandidate: null };
  }

  const tally: SuggestionTally = { text: 0, fieldValue: 0, sql: 0, predicates: 0 };
  const rule: TermRule = { names: withImplicitFields(booleanFields), limits: tokenLimits };
  const node = buildSuggestionExpr(withImplicitAnds(tokens, raw, rule), raw, rule, tally);
  const structural =
    node !== null && tally.text + tally.fieldValue > 0 && tally.sql + tally.fieldValue > 0;
  const text = structural ? renderNode(node) : "";
  const valid = structural && whereShape(text) !== null;
  if (valid && (tally.text === 0 || allStreamsFts)) {
    return { runSuggestion: text, freeTextCandidate: null };
  }
  if (!valid && tally.predicates > 0) return { runSuggestion: null, freeTextCandidate: null };
  return { runSuggestion: null, freeTextCandidate: trimmed };
}

export function freeTextRanges(
  raw: string,
  booleanFields: ReadonlySet<string>,
  options: PlanFilterOptions = {},
): TextRange[] {
  if (planFilter(raw, booleanFields, options).kind !== "freeText") return [];
  return (lexFilter(raw) ?? [])
    .filter(({ tok }) => tok.t === "word" || tok.t === "squote" || tok.t === "dquote")
    .map(({ start, end }) => ({ start, end }));
}

function renderSqlFilter(filter: string, knownFields: ReadonlySet<string>): string {
  const body = stripCommentLines(filter.trim());
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

function renderNode(node: PlanNode): string {
  switch (node.k) {
    case "text":
      return `match_all(${sqlString(node.value)})`;
    case "sql":
      return node.text;
    case "not":
      return node.child.k === "not"
        ? renderNode(node.child.child)
        : `NOT ${renderNode(node.child)}`;
    case "group":
      return `(${renderNode(node.child)})`;
    default:
      return node.children.map(renderNode).join(node.k === "and" ? " AND " : " OR ");
  }
}

function sqlString(value: string): string {
  return `'${escapeSingleQuotes(value)}'`;
}

function filterComments(raw: string): string[] {
  const comments: string[] = [];
  const dashWords = dashWordsIn(raw);
  let i = 0;
  let quoteAllowed = true;
  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      i++;
      quoteAllowed = true;
      continue;
    }
    let end: number;
    if (isLineComment(raw, i, dashWords)) {
      const newline = raw.indexOf("\n", i);
      end = newline < 0 ? raw.length : newline;
    } else if (raw.startsWith("/*", i)) {
      const close = raw.indexOf("*/", i + 2);
      end = close < 0 ? raw.length : close + 2;
    } else {
      const lexed = lexOne(raw, i, quoteAllowed, dashWords);
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

// A digit- or _-led term that names a field or is below the index minimum stays text.
function exclusionOf(tok: Token, rule: TermRule): string | null {
  if (tok.t === "squote" || tok.t === "dquote") return tok.negated === true ? tok.text : null;
  if (tok.t !== "word") return null;
  const value = tok.text.replace(/^--?(?!-)/, "");
  if (value === tok.text) return null;
  if (/^\p{L}/u.test(value)) return value;
  return /^[\p{N}_]/u.test(value) &&
    hasIndexToken(value, rule.limits) &&
    !isFieldLikeWord(value, rule.names)
    ? value
    : null;
}

function isLineComment(raw: string, i: number, dashWords: boolean): boolean {
  if (!raw.startsWith("--", i)) return false;
  let start = i;
  let end = i + 2;
  while (raw[start - 1] === "-") start--;
  while (raw[end] === "-") end++;
  const wordAfter = /[\p{L}\p{N}_]/u.test(raw[end] ?? "");
  if (dashWords && wordAfter && end - start === 2) return false;
  return !(/[\p{L}\p{N}_]/u.test(raw[start - 1] ?? "") && wordAfter);
}

// SQL reads -- as a comment, so a spaceless --word is an exclusion only in a one-line text search.
function dashWordsIn(raw: string): boolean {
  if (raw.trim().includes("\n")) return false;
  const tokens = lex(raw, true);
  return tokens !== null && tokens.every(isTextSearchToken);
}

function isTextSearchToken(lexed: Lexed): boolean {
  const { tok } = lexed;
  if (tok.t === "kw") return CONNECTIVES.has(tok.text.toUpperCase());
  if (tok.t === "opaque") return isMatchAllCall(lexed);
  return tok.t !== "op";
}

function lexFilter(raw: string): Lexed[] | null {
  return lex(raw, dashWordsIn(raw));
}

function lex(raw: string, dashWords: boolean): Lexed[] | null {
  const tokens: Lexed[] = [];
  let i = 0;
  let quoteAllowed = true;
  while (i < raw.length) {
    const skipped = skipTrivia(raw, i, dashWords);
    if (skipped === null) return null;
    if (skipped > i) {
      i = skipped;
      quoteAllowed = true;
      continue;
    }
    const lexed = lexOne(raw, i, quoteAllowed, dashWords);
    if (lexed === null) return null;
    tokens.push(lexed);
    quoteAllowed = lexed.tok.t === "lparen" || lexed.tok.t === "op";
    i = lexed.end;
  }
  return mergeCaseSpans(mergeParenSpans(tokens, raw), raw);
}

function skipTrivia(raw: string, i: number, dashWords: boolean): number | null {
  let j = i;
  while (j < raw.length) {
    if (/\s/.test(raw[j])) {
      j++;
    } else if (isLineComment(raw, j, dashWords)) {
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

function lexOne(raw: string, i: number, quoteAllowed: boolean, dashWords: boolean): Lexed | null {
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
  return lexWord(raw, i, dashWords);
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

function lexWord(raw: string, i: number, dashWords: boolean): Lexed {
  let j = i + 1;
  while (j < raw.length && !endsWord(raw, j, dashWords)) {
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

function startsValueLiteral(raw: string, j: number): boolean {
  return raw[j - 1] === ":" && (raw[j] === "'" || raw[j] === '"');
}

function endsWord(raw: string, j: number, dashWords: boolean): boolean {
  const c = raw[j];
  if (/\s/.test(c) || c === "(" || c === ")" || c === "," || ONE_CHAR_OPS.has(c)) return true;
  const two = raw.slice(j, j + 2);
  return TWO_CHAR_OPS.has(two) || isLineComment(raw, j, dashWords) || two === "/*";
}

function isSpaceDelimited(raw: string, i: number): boolean {
  const before = i === 0 ? " " : raw[i - 1];
  const after = i + 1 >= raw.length ? " " : raw[i + 1];
  return (/\s/.test(before) || before === "(") && /\s/.test(after);
}

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

function isPureTextShape(tokens: Lexed[], rule: TermRule): boolean {
  return tokens.every((lexed, index) =>
    isPureTextToken(lexed, tokens[index - 1], tokens[index + 1], rule),
  );
}

function isPureTextToken(
  lexed: Lexed,
  prev: Lexed | undefined,
  next: Lexed | undefined,
  rule: TermRule,
): boolean {
  const { tok } = lexed;
  const { names } = rule;
  switch (tok.t) {
    case "kw":
      return CONNECTIVES.has(tok.text.toUpperCase());
    case "lparen":
      return !(prev && (prev.tok.t === "word" || prev.tok.t === "dquote"));
    case "rparen":
      return true;
    case "word":
      return !isFieldLikeWord(exclusionOf(tok, rule) ?? tok.text, names);
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

function gluedToNextOperand(lexed: Lexed, next: Lexed | undefined): boolean {
  if (!next || next.start !== lexed.end) return false;
  return next.tok.t === "word" || next.tok.t === "squote" || next.tok.t === "dquote";
}

function isFieldLikeWord(word: string, names: ReadonlySet<string>): boolean {
  const colon = word.indexOf(":");
  if (colon > 0 && isFieldLikeWord(word.slice(0, colon), names)) return true;
  const base = word.split(/[.[]/)[0];
  return [word, asciiLower(word), base, asciiLower(base)].some(
    (form) => form !== "" && names.has(form),
  );
}

function parseBooleanText(tokens: Lexed[], rule: TermRule): PlanNode | null {
  const state: ParseState = { pos: 0, rule };
  const root = parseOr(tokens, state);
  return root !== null && state.pos === tokens.length ? root : null;
}

function parseOr(tokens: Lexed[], state: ParseState): PlanNode | null {
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

function parseAnd(tokens: Lexed[], state: ParseState): PlanNode | null {
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

function parseUnary(tokens: Lexed[], state: ParseState): PlanNode | null {
  let negations = 0;
  while (isKeyword(tokens[state.pos], "NOT")) {
    negations++;
    state.pos++;
  }
  let node = parsePrimary(tokens, state);
  for (let i = 0; node !== null && i < negations; i++) node = { k: "not", child: node };
  return node;
}

function parsePrimary(tokens: Lexed[], state: ParseState): PlanNode | null {
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
  const excluded = exclusionOf(tok, state.rule);
  if (excluded !== null) return { k: "not", child: { k: "text", value: excluded } };
  if (tok.t === "word" || tok.t === "squote" || tok.t === "dquote")
    return { k: "text", value: tok.text };
  if (isMatchAllCall(lexed) && tok.t === "opaque") return { k: "sql", text: tok.text };
  return null;
}

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

function hasIndexToken(value: string, limits: TokenLimits): boolean {
  const pieces = value.match(/[A-Za-z0-9]+|[^\p{ASCII}]/gu) ?? [];
  return pieces.some((piece) => {
    if (!/^[A-Za-z0-9]+$/.test(piece) && !/[\p{L}\p{N}]/u.test(piece)) return false;
    const bytes = new TextEncoder().encode(piece).length;
    return bytes >= limits.min && bytes < limits.max;
  });
}

function planMix(
  tokens: Lexed[],
  raw: string,
  rule: TermRule,
  options: PlanFilterOptions,
): FilterPlan {
  const allFts = options.allTargetsFts ?? (options.targetMode ?? "fts") === "fts";
  if (!tokens.some(isImplicitAnd)) {
    const root = allFts ? mixRoot(tokens, raw, rule) : null;
    return { kind: "sql", filter: root === null ? raw : renderNode(root) };
  }
  const root = mixRoot(tokens, raw, rule);
  // The raw text reads the -term as subtraction, so the search waits for Run as instead.
  if (root === null) return { kind: "unclassified", filter: raw, held: true };
  if (allFts) return { kind: "sql", filter: renderNode(root) };
  return { kind: "freeText", root, units: collectUnits(root) };
}

function mixRoot(tokens: Lexed[], raw: string, rule: TermRule): PlanNode | null {
  if (exceedsTextNesting(tokens)) return null;
  const state: MixState = { ...rule, units: 0 };
  const root = buildMixExpr(tokens, raw, state);
  if (root === null || state.units === 0) return null;
  return whereShape(renderNode(root)) === null ? null : root;
}

function withImplicitAnds(tokens: Lexed[], raw: string, rule: TermRule): Lexed[] {
  const out: Lexed[] = [];
  let segment = 0;
  let between = false;
  for (const lexed of tokens) {
    const betweenAnd = between && isKeyword(lexed, "AND");
    if (isKeyword(lexed, "BETWEEN")) between = true;
    if (betweenAnd) between = false;
    if (!betweenAnd && isSegmentBoundary(lexed)) {
      splitTrailingExclusions(out, segment, raw, rule);
      segment = out.length + 1;
    }
    out.push(lexed);
  }
  splitTrailingExclusions(out, segment, raw, rule);
  return out;
}

function isSegmentBoundary(lexed: Lexed): boolean {
  const { t } = lexed.tok;
  return (
    t === "lparen" || t === "rparen" || ["AND", "OR", "NOT"].some((kw) => isKeyword(lexed, kw))
  );
}

function splitTrailingExclusions(out: Lexed[], start: number, raw: string, rule: TermRule): void {
  let k = out.length;
  while (k - 1 > start && isTrailingExclusion(out[k - 1], out[k - 2], rule)) k--;
  if (k === out.length) return;
  const left = out.slice(start, k);
  if (left.every(isOperandToken) || whereShape(sliceOf(left, raw)) !== "predicate") return;
  const at = out[k].start;
  out.splice(k, 0, { tok: { t: "kw", text: "AND" }, start: at, end: at });
}

function isTrailingExclusion(lexed: Lexed, prev: Lexed, rule: TermRule): boolean {
  if (lexed.tok.t !== "word" || lexed.start <= prev.end) return false;
  const value = exclusionOf(lexed.tok, rule);
  return value !== null && hasIndexToken(value, rule.limits) && !isFieldLikeWord(value, rule.names);
}

function isImplicitAnd(lexed: Lexed): boolean {
  return lexed.start === lexed.end && isKeyword(lexed, "AND");
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
    return child === null ? null : negateFirst(child);
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

// SQL binds NOT tighter than AND, so a bare NOT negates only the first operand of the run after it.
function negateFirst(node: PlanNode): PlanNode {
  if (node.k !== "and") return { k: "not", child: node };
  const [first, ...rest] = node.children;
  return { k: "and", children: [negateFirst(first), ...rest] };
}

function mixTextUnit(lexed: Lexed, next: Lexed | undefined, state: MixState): PlanNode | null {
  const { tok } = lexed;
  if (tok.t === "opaque") return { k: "sql", text: tok.text };
  if (tok.t !== "word" && tok.t !== "squote" && tok.t !== "dquote") return null;
  if (tok.t !== "word" && gluedToNextOperand(lexed, next)) return null;
  if (tok.t === "dquote" && state.names.has(tok.text)) return null;
  const excluded = exclusionOf(tok, state);
  const negated = excluded !== null;
  if (negated && tok.t !== "word" && isFieldLikeWord(tok.text, state.names)) return null;
  const value = excluded ?? tok.text;
  if (
    tok.t === "word" &&
    ((!negated && NUMERIC_LITERAL.test(value)) || isFieldLikeWord(value, state.names))
  )
    return null;
  if (value === "" || !hasIndexToken(value, state.limits)) return null;
  state.units++;
  const text: PlanNode = { k: "text", value };
  return negated ? { k: "not", child: text } : text;
}

function buildSuggestionExpr(
  tokens: Lexed[],
  raw: string,
  rule: TermRule,
  tally: SuggestionTally,
): PlanNode | null {
  const orParts = splitTopLevel(tokens, "OR");
  const children = orParts.map((part) => buildSuggestionAnd(part, raw, rule, tally));
  if (children.some((child) => child === null)) return null;
  return children.length === 1 ? children[0] : { k: "or", children: children as PlanNode[] };
}

function buildSuggestionAnd(
  tokens: Lexed[],
  raw: string,
  rule: TermRule,
  tally: SuggestionTally,
): PlanNode | null {
  const andParts = splitTopLevel(tokens, "AND");
  const children = andParts.map((part) => buildSuggestionUnit(part, raw, rule, tally));
  if (children.some((child) => child === null)) return null;
  return children.length === 1 ? children[0] : { k: "and", children: children as PlanNode[] };
}

function buildSuggestionUnit(
  tokens: Lexed[],
  raw: string,
  rule: TermRule,
  tally: SuggestionTally,
): PlanNode | null {
  if (tokens.length === 0) return null;
  if (isKeyword(tokens[0], "NOT")) {
    const child = buildSuggestionUnit(tokens.slice(1), raw, rule, tally);
    return child === null ? null : negateFirst(child);
  }
  if (tokens[0].tok.t === "lparen" && matchingParen(tokens, 0) === tokens.length - 1) {
    const child = buildSuggestionExpr(tokens.slice(1, -1), raw, rule, tally);
    return child === null ? null : { k: "group", child };
  }
  if (tokens.every(isOperandToken)) {
    return buildOperandRun(tokens, rule, tally) ?? verbatimSql(tokens, raw, tally);
  }
  return buildSqlSegment(tokens, raw, rule, tally);
}

function buildOperandRun(tokens: Lexed[], rule: TermRule, tally: SuggestionTally): PlanNode | null {
  const children: PlanNode[] = [];
  const counts = { text: 0, fieldValue: 0 };
  for (const { tok } of tokens) {
    const node = operandNode(tok, rule);
    if (node === null) return null;
    children.push(node);
    if (node.k === "sql") counts.fieldValue++;
    else counts.text++;
  }
  tally.text += counts.text;
  tally.fieldValue += counts.fieldValue;
  return children.length === 1 ? children[0] : { k: "and", children };
}

function operandNode(tok: Token, rule: TermRule): PlanNode | null {
  const { names } = rule;
  if (tok.t === "word") {
    const unsigned = tok.text.replace(/^--?(?!-)/, "");
    const pair = fieldValuePair(unsigned, names);
    if (pair === null) return null;
    if (pair !== undefined) return { k: "sql", text: comparisonOf(pair, unsigned !== tok.text) };
  }
  const value = exclusionOf(tok, rule);
  if (value !== null) {
    return value === "" || isFieldLikeWord(value, names)
      ? null
      : { k: "not", child: { k: "text", value } };
  }
  if (tok.t === "squote") return tok.text === "" ? null : { k: "text", value: tok.text };
  if (tok.t === "dquote")
    return names.has(tok.text) || tok.text === "" ? null : { k: "text", value: tok.text };
  if (tok.t !== "word") return null;
  return isFieldLikeWord(tok.text, names) ? null : { k: "text", value: tok.text };
}

function fieldValuePair(
  word: string,
  names: ReadonlySet<string>,
): FieldValuePair | null | undefined {
  const colon = word.indexOf(":");
  const field = colon > 0 ? word.slice(0, colon) : "";
  if (field === "" || !isFieldLikeWord(field, names)) return undefined;
  const rawValue = word.slice(colon + 1);
  const value = unquoteLiteral(rawValue);
  const partialQuote = /^['"]/.test(rawValue) && lexQuoted(rawValue, 0)?.end !== rawValue.length;
  return value === "" || partialQuote ? null : { field, value };
}

// An excluded field:value keeps rows that lack the field, which NOT field='v' would drop as NULL.
function comparisonOf({ field, value }: FieldValuePair, excluded: boolean): string {
  const literal = sqlString(value);
  return excluded ? `(${field} IS NULL OR ${field}!=${literal})` : `${field}=${literal}`;
}

function buildSqlSegment(
  tokens: Lexed[],
  raw: string,
  rule: TermRule,
  tally: SuggestionTally,
): PlanNode {
  const whole = whereShape(sliceOf(tokens, raw));
  if (whole !== null) return countSql(whole, sliceOf(tokens, raw), tally);
  for (let k = tokens.length - 1; k > 0 && isOperandToken(tokens[k]); k--) {
    const split = trySplit(tokens.slice(0, k), tokens.slice(k), raw, rule, tally, "sqlFirst");
    if (split !== null) return split;
  }
  for (let k = 1; k < tokens.length && isOperandToken(tokens[k - 1]); k++) {
    const split = trySplit(tokens.slice(k), tokens.slice(0, k), raw, rule, tally, "textFirst");
    if (split !== null) return split;
  }
  return verbatimSql(tokens, raw, tally);
}

function verbatimSql(tokens: Lexed[], raw: string, tally: SuggestionTally): PlanNode {
  const text = sliceOf(tokens, raw);
  return countSql(whereShape(text), text, tally);
}

function trySplit(
  sqlTokens: Lexed[],
  textTokens: Lexed[],
  raw: string,
  rule: TermRule,
  tally: SuggestionTally,
  order: "sqlFirst" | "textFirst",
): PlanNode | null {
  const sqlText = sliceOf(sqlTokens, raw);
  const shape = whereShape(sqlText);
  if (shape === null) return null;
  const local: SuggestionTally = { text: 0, fieldValue: 0, sql: 0, predicates: 0 };
  const run = buildOperandRun(textTokens, rule, local);
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

function isSentenceShaped(raw: string, fields: ReadonlySet<string> | undefined): boolean {
  if (!fields || maxParenDepth(raw) > SQL_PARSE_MAX_DEPTH) return false;
  const stmt = astifySelect(raw);
  if (stmt?.type !== "select" || !readsOneStreamDirectly(stmt)) return false;
  const columns = Array.isArray(stmt.columns) ? stmt.columns : [];
  if (columns.length === 0) return false;
  return columns.every((column: AstNode) => {
    const name = bareIdentifier(column?.expr);
    return (column?.as === null || column?.as === undefined) && name !== null && !fields.has(name);
  });
}

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
  const start = skipTrivia(raw, 0, false);
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

function isBlankFilter(filter: string): boolean {
  const tokens = lexFilter(filter);
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
