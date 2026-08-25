// Copyright 2026 OpenObserve Inc.

/**
 * The Playground draft model and the pure functions over it.
 *
 * Kept out of the components so template substitution, variable extraction and
 * the zero-reference guard are testable without mounting anything — they are
 * the parts that have to be right before a single prompt is sent.
 */

import type { I18nText } from "@/types/i18n";

/** Golden answers feed scorers only. Binding one into a task prompt would leak
 *  the answer into the question, so this token is never substituted. */
export const EXPECTED_OUTPUT_TOKEN = "expected_output";

/** A bench holds at most four variants — past that the columns stop being
 *  comparable at a glance, which is the only reason to put them side by side. */
export const MAX_VARIANTS = 4;

/** Diagnostic scale. Conclusions over a full dataset are an experiment's job. */
export const MAX_ROWS = 10;

/** The row key used in editor-bench mode, where there is no row table. */
export const SINGLE_ROW_KEY = "single";

export type PlaygroundRole = "system" | "user" | "assistant" | "tool";

export interface PlaygroundMessage {
  id: string;
  role: PlaygroundRole;
  content: string;
  /** Carried in from a source trace — removable, never editable. */
  readonly?: boolean;
}

export interface PlaygroundTool {
  name: string;
  description: string;
  /** Parameter JSON schema, as typed. Validated at send time, not here. */
  parameters: string;
}

export interface PlaygroundVariant {
  id: string;
  providerId: string;
  model: string;
  /** Free text: the field accepts anything and is coerced when the run is built. */
  temperature: string;
  messages: PlaygroundMessage[];
  tools: PlaygroundTool[];
  responseSchema: string | null;
  /** Config changed since the last run, so the outputs on screen no longer
   *  describe the config on screen. */
  stale: boolean;
}

export interface PlaygroundRowSource {
  datasetId: string;
  datasetName: string;
  itemId: string;
}

export interface PlaygroundRow {
  id: string;
  input: string;
  expectedOutput: string | null;
  /** Sampled by value — a later dataset edit never changes a sampled row. */
  source: PlaygroundRowSource | null;
}

export interface PlaygroundProvenance {
  type: "experiment" | "dataset";
  label: I18nText;
}

export interface PlaygroundDraft {
  variants: PlaygroundVariant[];
  /** null ⇒ editor bench. A non-empty array ⇒ compare table. */
  rows: PlaygroundRow[] | null;
  /** Editor bench only: the values bound to `{{tokens}}` in the messages. */
  vars: Record<string, string>;
  expectedSingle: string | null;
  provenance: PlaygroundProvenance | null;
}

export interface PlaygroundUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface PlaygroundToolCall {
  name: string;
  arguments: string;
}

export interface PlaygroundCellError {
  message: string;
  retryable: boolean;
}

export interface PlaygroundCell {
  status: "idle" | "streaming" | "done" | "error";
  text: string;
  toolCall: PlaygroundToolCall | null;
  usage: PlaygroundUsage | null;
  error: PlaygroundCellError | null;
}

/** `{ [variantId]: { [rowKey]: cell } }` — kept beside the draft rather than
 *  inside it, so editing a variant never orphans or silently drops results. */
export type PlaygroundResults = Record<string, Record<string, PlaygroundCell>>;

// ── ids ───────────────────────────────────────────────────────────

let idCounter = 0;

/** Draft-local id. Never persisted, so a monotonic counter is enough and keeps
 *  the helpers deterministic under test. */
export function playgroundId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// ── template variables ────────────────────────────────────────────

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Every distinct `{{token}}` across a variant's messages, in first-seen order. */
export function extractVariantVars(variant: PlaygroundVariant): string[] {
  const seen: string[] = [];
  for (const message of variant.messages) {
    for (const match of message.content.matchAll(VARIABLE_PATTERN)) {
      const name = match[1];
      if (!seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

/** The union across every variant, in first-seen order. */
export function extractVars(variants: PlaygroundVariant[]): string[] {
  const seen: string[] = [];
  for (const variant of variants) {
    for (const name of extractVariantVars(variant)) {
      if (!seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

/**
 * Substitute `{{token}}` values into a message.
 *
 * Two deliberate rules: an unmatched token renders EMPTY rather than being left
 * as a literal, because a literal `{{name}}` reaching the model is a silent
 * prompt bug; and `{{expected_output}}` is never bound, so a golden answer
 * cannot leak into the prompt that is supposed to be answering without it.
 */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(VARIABLE_PATTERN, (_match, name: string) => {
    if (name === EXPECTED_OUTPUT_TOKEN) return "";
    return vars[name] ?? "";
  });
}

/** The variables a row exposes. A plain-text row exposes exactly `input`. */
export function rowVars(row: PlaygroundRow): Record<string, string> {
  return { input: row.input };
}

/** Field names the current rows expose, usable as `{{tokens}}`. */
export function rowFieldsFor(rows: PlaygroundRow[] | null): string[] {
  if (!rows || rows.length === 0) return [];
  return ["input"];
}

/**
 * True when the rows expose fields and not one variant references any of them —
 * every row would then produce identical output while still costing
 * `rows × variants` model calls.
 */
export function hasZeroFieldReference(
  variants: PlaygroundVariant[],
  rows: PlaygroundRow[] | null,
): boolean {
  const fields = rowFieldsFor(rows);
  if (fields.length === 0) return false;
  const used = extractVars(variants);
  return !used.some((name) => fields.includes(name));
}

// ── labels ────────────────────────────────────────────────────────

const VARIANT_LETTERS = ["A", "B", "C", "D"];

export function variantLabel(index: number): string {
  return VARIANT_LETTERS[index] ?? String(index + 1);
}

export interface PlaygroundVariantSummary {
  model: string;
  temperature: string;
  /** First non-empty message, collapsed to one line for a table header. */
  promptLine: string;
}

export function variantSummary(variant: PlaygroundVariant): PlaygroundVariantSummary {
  const first = variant.messages.find((message) => message.content.trim().length > 0);
  return {
    model: variant.model,
    temperature: variant.temperature,
    promptLine: first ? first.content.replace(/\s+/g, " ").trim() : "",
  };
}

// ── draft construction and mutation ───────────────────────────────

export function emptyVariant(providerId = "", model = ""): PlaygroundVariant {
  return {
    id: playgroundId("variant"),
    providerId,
    model,
    temperature: "0",
    messages: [
      { id: playgroundId("msg"), role: "system", content: "" },
      { id: playgroundId("msg"), role: "user", content: "" },
    ],
    tools: [],
    responseSchema: null,
    stale: false,
  };
}

export function starterDraft(providerId = "", model = ""): PlaygroundDraft {
  return {
    variants: [emptyVariant(providerId, model)],
    rows: null,
    vars: {},
    expectedSingle: null,
    provenance: null,
  };
}

/** Deep copy with fresh ids. The clone has never run, so it is not stale and
 *  carries none of the source's results. */
export function cloneVariant(variant: PlaygroundVariant): PlaygroundVariant {
  return {
    ...variant,
    id: playgroundId("variant"),
    messages: variant.messages.map((message) => ({ ...message, id: playgroundId("msg") })),
    tools: variant.tools.map((tool) => ({ ...tool })),
    stale: false,
  };
}

/**
 * Append `{{field}}` to a variant's last editable user message, unless the
 * variant already references it. Used by the zero-reference warning bar, which
 * fixes every variant at once.
 */
export function withFieldInserted(variant: PlaygroundVariant, field: string): PlaygroundVariant {
  const token = `{{${field}}}`;
  if (variant.messages.some((message) => message.content.includes(token))) return variant;

  const target = [...variant.messages]
    .reverse()
    .find((message) => message.role === "user" && !message.readonly);
  if (!target) return variant;

  return {
    ...variant,
    stale: true,
    messages: variant.messages.map((message) =>
      message.id === target.id
        ? {
            ...message,
            content: message.content ? `${message.content.replace(/\s+$/, "")}\n${token}` : token,
          }
        : message,
    ),
  };
}

/**
 * Insert a token into `content` at the caret, returning the new content and
 * where the caret should land after it. Selected text is replaced.
 */
export function insertTokenAt(
  content: string,
  token: string,
  selectionStart: number,
  selectionEnd: number,
): { content: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, content.length));
  const end = Math.max(start, Math.min(selectionEnd, content.length));
  return {
    content: content.slice(0, start) + token + content.slice(end),
    caret: start + token.length,
  };
}

// ── run keys and cells ────────────────────────────────────────────

/** The row keys a run fans out over: the row ids, or the single-input key. */
export function rowKeysFor(draft: PlaygroundDraft): string[] {
  if (!draft.rows || draft.rows.length === 0) return [SINGLE_ROW_KEY];
  return draft.rows.map((row) => row.id);
}

export function idleCell(): PlaygroundCell {
  return { status: "idle", text: "", toolCall: null, usage: null, error: null };
}

export function cellAt(
  results: PlaygroundResults,
  variantId: string,
  rowKey: string,
): PlaygroundCell | undefined {
  return results[variantId]?.[rowKey];
}

/**
 * The variables in play for one run: the row's fields in table mode, or the
 * hand-entered values in editor-bench mode.
 */
export function varsForRow(draft: PlaygroundDraft, rowKey: string): Record<string, string> {
  if (rowKey === SINGLE_ROW_KEY || !draft.rows) return { ...draft.vars };
  const row = draft.rows.find((candidate) => candidate.id === rowKey);
  return row ? rowVars(row) : {};
}

/** The reference answer for a run, if the row carries one. */
export function expectedForRow(draft: PlaygroundDraft, rowKey: string): string | null {
  if (rowKey === SINGLE_ROW_KEY || !draft.rows) return draft.expectedSingle;
  return draft.rows.find((candidate) => candidate.id === rowKey)?.expectedOutput ?? null;
}

/** The messages actually sent for one row — what the drawer's rendered prompt
 *  shows, and what the run builder passes to the service. */
export function renderedMessages(
  variant: PlaygroundVariant,
  vars: Record<string, string>,
): PlaygroundMessage[] {
  return variant.messages.map((message) => ({
    ...message,
    content: renderTemplate(message.content, vars),
  }));
}
