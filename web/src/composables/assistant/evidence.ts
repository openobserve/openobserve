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

import type { ChatMessage, ContentBlock, NavigationAction } from "@/ts/interfaces/chat";
import { epochMs, sqlStreamOf, streamTypeOf } from "@/utils/assistant/explorerRoutes";

import type { QueryRef } from "./actions/types";
import type { ContextChip } from "./context/types";
import { isFirstPartyTool } from "./navigationRoutes";

/** A typed query from a `query` frame or a tool result's `query`; times are epoch ms. */
export interface QueryBlockData {
  language: QueryRef["language"];
  text: string;
  stream?: string;
  streamType?: string;
  from?: number;
  to?: number;
  validated?: boolean;
  callId?: string;
}

/** A `navigation_action` as the reducer keeps it: never its label, ids bounded. */
export interface LinkBlockData {
  resourceType: string;
  action: string;
  target: Record<string, unknown>;
  /** A redacted reader's copy: it names the kind of view, never its query, stream or window. */
  redacted?: boolean;
}

/** What `complete` says about its turn, kept on the answer so a reload shows the same footer and vote. */
export interface FooterData {
  traceId?: string;
  /** The server's id of the turn, from `turn_started`; the vote names it. */
  serverTurnId?: string;
  usage?: FooterUsage;
  contextUsed?: string[];
  persisted?: boolean;
  durationMs?: number;
}

export interface FooterUsage {
  credits?: number;
  totalTokens?: number;
  llmCalls?: number;
}

/** A tool result cut to what the trail shows: the first rows, counts and CLI output. */
export interface StepResult {
  hits?: Record<string, string>[];
  total?: number;
  took?: number;
  scannedBytes?: number;
  stdout?: string;
  exitCode?: number;
  truncated?: boolean;
}

export interface FindingsData {
  likelyCause: string;
  confidence: "high" | "medium" | "low" | "inconclusive";
  evidence: { text: string; callId?: string; kind: "verified" | "inferred" }[];
  ruledOut: string[];
  unknowns: string[];
  nextSteps: string[];
}

export type StepKind =
  | "query"
  | "promql"
  | "traces"
  | "stream_list"
  | "schema"
  | "cli"
  | "create"
  | "update"
  | "delete"
  | "tool";

export type StepStateName = "running" | "done" | "failed" | "interrupted";

/** One trail row's facts; the component composes the sentence from them. */
export interface StepFacts {
  callId: string;
  /** 1-based position in the trail. */
  n: number;
  tool: string;
  kind: StepKind;
  state: StepStateName;
  target: string | null;
  query: QueryRef | null;
  range: { from: number; to: number } | null;
  rows: number | null;
  count: number | null;
  tookMs: number | null;
  /** The tool's own failure message, bounded; shown as text, never as HTML. */
  error: string | null;
  suggestion: string | null;
  result: StepResult | null;
  command: string | null;
}

/** A fence of the answer as a runnable query. */
export interface FenceQuery {
  query: QueryRef;
  rangeSource: "step" | "turn" | "page";
  sourceStep: StepFacts | null;
}

export const MAX_HIT_ROWS = 10;

export const MAX_RESULT_ROWS = 50;

const MAX_HIT_COLUMNS = 20;

const MAX_CELL_CHARS = 500;

const MAX_TEXT_CHARS = 20_000;

const MAX_OUTPUT_CHARS = 16_000;

const MAX_MESSAGE_CHARS = 300;

const MAX_LIST_ITEMS = 20;

const QUERY_KINDS: ReadonlySet<StepKind> = new Set(["query", "promql", "traces"]);

const POLICY_CODES: ReadonlySet<string> = new Set(["permission_denied_tool", "data_level_blocked"]);

const CLI_TOOL = /command|cli|shell|kubectl|exec/i;

const STREAM_CHIPS: ReadonlySet<string> = new Set([
  "stream",
  "log_row",
  "field",
  "cell",
  "query_error",
  "span",
]);

const ROW_WINDOW_MS = 60_000;

const ARG_KEYS = [
  "stream_name",
  "stream",
  "stream_type",
  "sql",
  "query",
  "start_time",
  "end_time",
  "command",
  "name",
] as const;

/** The call arguments the trail and the query block read, each string bounded. */
export function boundedArgs(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, any>;
  const body = source.request_body?.query ?? {};
  const out: Record<string, unknown> = {};
  for (const key of ARG_KEYS) {
    const value =
      source[key] ??
      (key === "sql" || key === "start_time" || key === "end_time" ? body[key] : undefined);
    const kept = boundedValue(value);
    if (kept !== undefined) out[key] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A tool response cut to the first rows and the counts; anything else is dropped. */
export function boundedResult(raw: unknown): StepResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const out: StepResult = {};
  if (Array.isArray(source.hits)) out.hits = source.hits.slice(0, MAX_HIT_ROWS).map(boundedRow);
  const total = finite(source.total);
  if (total !== null) out.total = total;
  const took = finite(source.took);
  if (took !== null) out.took = took;
  const scanned = finite(source.scan_size);
  if (scanned !== null) out.scannedBytes = scanned * 1024 * 1024;
  const stdout =
    typeof source.stdout === "string"
      ? source.stdout
      : typeof source.output === "string"
        ? source.output
        : null;
  if (stdout !== null) out.stdout = stdout.slice(0, MAX_OUTPUT_CHARS);
  const exit = finite(source.exit_code);
  if (exit !== null) out.exitCode = exit;
  if (source.truncated === true || (stdout?.length ?? 0) > MAX_OUTPUT_CHARS) out.truncated = true;
  return Object.keys(out).length ? out : undefined;
}

/** One result row as display strings, at most 20 columns of 500 characters. */
export function boundedRow(row: unknown): Record<string, string> {
  if (!row || typeof row !== "object") return {};
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>)
      .slice(0, MAX_HIT_COLUMNS)
      .map(([key, value]) => [key.slice(0, 100), cellText(value)]),
  );
}

/** A typed query payload, or null when it has no text. */
export function boundedQuery(raw: unknown, callId?: string): QueryBlockData | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, any>;
  const text = typeof source.text === "string" ? source.text.trim().slice(0, MAX_TEXT_CHARS) : "";
  if (!text) return null;
  const language = languageOf(source.language);
  const range = source.time_range ?? source;
  const from = epochMs(range.from);
  const to = epochMs(range.to);
  return {
    language,
    text,
    ...(typeof source.stream === "string" &&
      source.stream && { stream: source.stream.slice(0, 200) }),
    ...(streamTypeOf(source.stream_type) && { streamType: streamTypeOf(source.stream_type) }),
    ...(from !== null && to !== null && to > from && { from, to }),
    ...(typeof source.validated === "boolean" && { validated: source.validated }),
    ...(callId && { callId }),
  };
}

/** A findings frame as the card reads it; `null` when it is not a usable payload. */
export function boundedFindings(raw: unknown): FindingsData | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const confidence = source.confidence;
  if (
    typeof source.likely_cause !== "string" ||
    (confidence !== "high" &&
      confidence !== "medium" &&
      confidence !== "low" &&
      confidence !== "inconclusive")
  )
    return null;
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string" && !!item.trim())
          .slice(0, MAX_LIST_ITEMS)
          .map((item) => item.slice(0, MAX_MESSAGE_CHARS))
      : [];
  const evidence = Array.isArray(source.evidence)
    ? source.evidence.slice(0, MAX_LIST_ITEMS).flatMap((item) => {
        const entry = item as Record<string, unknown>;
        if (
          typeof entry?.text !== "string" ||
          (entry.kind !== "verified" && entry.kind !== "inferred")
        )
          return [];
        return [
          {
            text: entry.text.slice(0, MAX_MESSAGE_CHARS),
            kind: entry.kind as "verified" | "inferred",
            ...(typeof entry.call_id === "string" &&
              entry.call_id && { callId: entry.call_id.slice(0, 64) }),
          },
        ];
      })
    : [];
  return {
    likelyCause: source.likely_cause.slice(0, MAX_MESSAGE_CHARS),
    confidence,
    evidence,
    ruledOut: list(source.ruled_out),
    unknowns: list(source.unknowns),
    nextSteps: list(source.next_steps),
  };
}

/** The usage counters of `complete` or `usage`; `credits` only when the server says so. */
export function footerUsage(raw: unknown): FooterUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const credits = finite(source.credits);
  const total =
    finite(source.total_tokens) ?? sum(finite(source.input_tokens), finite(source.output_tokens));
  const calls = finite(source.llm_calls);
  const out: FooterUsage = {
    ...(credits !== null && { credits }),
    ...(total !== null && { totalTokens: total }),
    ...(calls !== null && { llmCalls: calls }),
  };
  return Object.keys(out).length ? out : undefined;
}

/** The answer's steps in order; a policy refusal renders as its notice, not as a row. */
export function stepsOf(message: ChatMessage | null | undefined, org: string): StepFacts[] {
  const blocks = (message?.contentBlocks ?? []).filter(
    (block) =>
      block.type === "tool_call" &&
      !!block.tool &&
      !block.pendingConfirmation &&
      !POLICY_CODES.has(block.errorType ?? ""),
  );
  return blocks.map((block, index) => stepFacts(block, index + 1, org));
}

/** Only a live step is running; a stored one without its result never reads as done. */
export function stateOf(block: ContentBlock): StepStateName {
  if (block.stepState) return block.stepState;
  if (block.success === true) return "done";
  if (block.success === false) return "failed";
  return "interrupted";
}

/** The ranges the turn's query steps evaluated, first seen first. */
export function windowsOf(steps: StepFacts[]): { step: StepFacts; from: number; to: number }[] {
  const seen = new Set<string>();
  const out: { step: StepFacts; from: number; to: number }[] = [];
  for (const step of steps) {
    if (!QUERY_KINDS.has(step.kind) || !step.range || step.state === "failed") continue;
    const key = `${step.range.from}:${step.range.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ step, ...step.range });
  }
  return out;
}

/** How many queries the turn ran to a result. */
export function queryCount(steps: StepFacts[]): number {
  return steps.filter((step) => QUERY_KINDS.has(step.kind) && step.state === "done").length;
}

/** Claim numbers by distinct `call_id` in order of first citation. */
export function claimNumbers(claims: string[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const id of claims) if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  return numbers;
}

/** A closed fence as a query: its step when the text matches, else the turn's window on its stream, else the page's. */
export function fenceQuery(
  code: string,
  lang: string,
  steps: StepFacts[],
  org: string,
  page: { from: number; to: number } | null,
): FenceQuery | null {
  const language = fenceLanguage(lang);
  if (!language || !code.trim()) return null;
  const text = code.trim().slice(0, MAX_TEXT_CHARS);
  const normal = normalise(text);
  const exact = steps.find((step) => step.query && normalise(step.query.text) === normal) ?? null;
  const named = language === "sql" ? sqlStreamOf(text) : undefined;
  const sameStream =
    exact ?? steps.find((step) => step.range && !!named && step.query?.stream === named) ?? null;
  const stream = exact?.query?.stream ?? named;
  const streamType =
    exact?.query?.streamType ?? (language === "promql" ? "metrics" : sameStream?.query?.streamType);
  const range = sameStream?.range ?? page;
  return {
    query: {
      language,
      text,
      ...(stream && { stream }),
      ...(streamType && { streamType }),
      ...(range && { from: range.from, to: range.to }),
      org,
    },
    rangeSource: exact ? "step" : sameStream ? "turn" : "page",
    sourceStep: exact,
  };
}

/** The window a prompt asked about: its time chip, else the page's window when it was sent. */
export function promptRange(
  prompt: ChatMessage | null | undefined,
  sent?: { from: number; to: number } | null,
): { from: number; to: number } | null {
  const chip = prompt?.chips?.find((candidate) => candidate.kind === "time");
  const from = chip?.ref?.from;
  const to = chip?.ref?.to;
  if (typeof from === "number" && typeof to === "number" && to > from) return { from, to };
  return prompt?.sentWindow ?? sent ?? null;
}

/** The non-AI path of a failed turn: its last query step over its own or the prompt's window. */
export function manualRouteOf(
  answer: ChatMessage | null | undefined,
  range: { from: number; to: number } | null,
  org: string,
): QueryRef | null {
  const steps = stepsOf(answer, org).filter((step) => step.query && QUERY_KINDS.has(step.kind));
  const last = steps.at(-1)?.query;
  if (!last) return null;
  return last.from && last.to ? last : { ...last, ...(range ?? {}) };
}

/** The tool-result routes worth a card: first-party create, get or update results with an id. */
export function toolLinksOf(message: ChatMessage | null | undefined): NavigationAction[] {
  return (message?.contentBlocks ?? []).flatMap((block) =>
    block.type === "tool_call" &&
    block.navigationAction?.action === "navigate_direct" &&
    isFirstPartyTool(block.tool) &&
    stateOf(block) === "done"
      ? [block.navigationAction]
      : [],
  );
}

/** The footer data `complete` left on the answer, if any. */
export function footerOf(message: ChatMessage | null | undefined): FooterData | null {
  const block = message?.contentBlocks?.find((candidate) => candidate.type === "footer");
  return block?.footer ?? null;
}

/** A chip's Open in {page}: its query, else its stream, over its range or one minute around its row. */
export function chipOpenQuery(chip: ContextChip, org: string): QueryRef | null {
  const ref = chip.ref;
  const stream = ref?.stream;
  const streamType = streamTypeOf(ref?.streamType);
  const sql = chip.kind === "query" && typeof chip.data === "string" ? chip.data.trim() : "";
  if (!sql && (!stream || !STREAM_CHIPS.has(chip.kind))) return null;
  const range =
    ref?.from && ref?.to && ref.to > ref.from
      ? { from: ref.from, to: ref.to }
      : rowWindow(chip.data);
  return {
    language: streamType === "metrics" && sql ? "promql" : "sql",
    text: sql ? sql.slice(0, MAX_TEXT_CHARS) : `SELECT * FROM "${stream!.replace(/"/g, "")}"`,
    ...(stream && { stream }),
    ...(streamType && { streamType }),
    ...(range ?? {}),
    org,
  };
}

/** Where a turn's vote, findings outcome and asked window are kept beside its blocks. */
export function turnAnnotationKey(
  turnId: string,
  what: "feedback" | "findings" | "window",
): string {
  return `turn:${turnId}:${what}`;
}

function stepFacts(block: ContentBlock, n: number, org: string): StepFacts {
  const tool = block.tool ?? "";
  const args = {
    ...(block.context ?? {}),
    ...flatContext(block.context),
    ...(block.callArgs ?? {}),
  };
  const kind = kindOf(tool, args);
  const query = stepQuery(block, kind, args, org);
  const summary = block.summary as unknown;
  const summaryRecord =
    summary && typeof summary === "object" ? (summary as Record<string, unknown>) : null;
  const summaryCount = summaryRecord ? finite(summaryRecord.count) : firstNumber(summary);
  const result = block.result ?? null;
  const rows = QUERY_KINDS.has(kind)
    ? (summaryCount ?? result?.total ?? result?.hits?.length ?? null)
    : null;
  const failed = stateOf(block) === "failed";
  return {
    callId: block.call_id || `step-${n}`,
    n,
    tool,
    kind,
    state: stateOf(block),
    target: text(args.stream_name) ?? text(args.stream) ?? query?.stream ?? text(args.name) ?? null,
    query,
    range: query?.from && query?.to ? { from: query.from, to: query.to } : null,
    rows,
    count: QUERY_KINDS.has(kind) ? null : summaryCount,
    tookMs: (summaryRecord ? finite(summaryRecord.took) : null) ?? result?.took ?? null,
    error: failed ? bounded(block.resultMessage) : null,
    suggestion: failed ? bounded(block.suggestion) : null,
    result,
    command: kind === "cli" ? (text(args.command) ?? null) : null,
  };
}

// A row chip opens its stream one minute either side of the row.
function rowWindow(data: unknown): { from: number; to: number } | null {
  const row = Array.isArray(data) ? data[0] : data;
  const ts = epochMs((row as Record<string, unknown> | null)?._timestamp);
  return ts === null ? null : { from: ts - ROW_WINDOW_MS, to: ts + ROW_WINDOW_MS };
}

function stepQuery(
  block: ContentBlock,
  kind: StepKind,
  args: Record<string, unknown>,
  org: string,
): QueryRef | null {
  const typed = block.query;
  if (typed) return { ...typed, org };
  if (!QUERY_KINDS.has(kind)) return null;
  const sql = text(args.sql) ?? text(args.query);
  if (!sql) return null;
  const stream =
    text(args.stream_name) ??
    text(args.stream) ??
    (kind === "promql" ? undefined : sqlStreamOf(sql));
  const from = epochMs(args.start_time);
  const to = epochMs(args.end_time);
  const streamType =
    streamTypeOf(args.stream_type) ??
    (kind === "promql" ? "metrics" : kind === "traces" ? "traces" : undefined);
  return {
    language: kind === "promql" ? "promql" : "sql",
    text: sql.slice(0, MAX_TEXT_CHARS),
    ...(stream && { stream }),
    ...(streamType && { streamType }),
    ...(from !== null && to !== null && to > from && { from, to }),
    org,
  };
}

// The `tool_call` context nests the search under `request_body.query` in some shapes.
function flatContext(context: Record<string, any> | undefined): Record<string, unknown> {
  const query = context?.request_body?.query;
  if (!query || typeof query !== "object") return {};
  return { sql: query.sql, start_time: query.start_time, end_time: query.end_time };
}

function kindOf(tool: string, args: Record<string, unknown>): StepKind {
  const name = tool.replace(/^o2_/, "");
  if (/^searchsql$/i.test(name)) return "query";
  if (/promql/i.test(name)) return "promql";
  if (/trace/i.test(name) && /search/i.test(name)) return "traces";
  if (/^streamlist$/i.test(name)) return "stream_list";
  if (/^streamschema$/i.test(name)) return "schema";
  if (/^delete/i.test(name)) return "delete";
  if (/^update/i.test(name)) return "update";
  if (/^create/i.test(name)) return "create";
  if (CLI_TOOL.test(name) || typeof args.command === "string") return "cli";
  return "tool";
}

function fenceLanguage(lang: string): QueryRef["language"] | null {
  const name = lang.toLowerCase();
  if (name === "sql") return "sql";
  if (name === "promql") return "promql";
  if (name === "vrl") return "vrl";
  return null;
}

function languageOf(value: unknown): QueryRef["language"] {
  const name = String(value ?? "").toLowerCase();
  return name === "promql" || name === "vrl" || name === "regex" ? name : "sql";
}

function normalise(sql: string): string {
  return sql.replace(/\s+/g, " ").replace(/;\s*$/, "").trim().toLowerCase();
}

function boundedValue(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, MAX_TEXT_CHARS);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value.slice(0, 10).join(",").slice(0, 400);
  return undefined;
}

function cellText(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return (raw ?? "").slice(0, MAX_CELL_CHARS);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bounded(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_MESSAGE_CHARS)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sum(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

// "Found 3 log streams" → 3: a string summary still carries its count.
function firstNumber(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /\d[\d,]*/.exec(value);
  return match ? Number(match[0].replace(/,/g, "")) : null;
}
