// Copyright 2026 OpenObserve Inc.

/**
 * The Playground draft model and the pure functions over it.
 *
 * Kept out of the components so template substitution, variable extraction and
 * the zero-reference guard are testable without mounting anything — they are
 * the parts that have to be right before a single prompt is sent.
 */

import type { I18nText } from "@/types/i18n";
import type {
  PlaygroundRequestMessage,
  PlaygroundScoreResult,
} from "@/services/llm-playground.service";

/** Golden answers feed scorers only. Binding one into a task prompt would leak
 *  the answer into the question, so this token is never substituted. */
export const EXPECTED_OUTPUT_TOKEN = "expected_output";

/** A bench holds at most four variants — past that the columns stop being
 *  comparable at a glance, which is the only reason to put them side by side. */
export const MAX_VARIANTS = 4;

/** The row key used in editor-bench mode, where there is no row table. */
export const SINGLE_ROW_KEY = "single";

export type PlaygroundRole = "system" | "user" | "assistant" | "tool";

export interface PlaygroundMessage {
  id: string;
  role: PlaygroundRole;
  content: string;
  /** Carried in from a source trace — removable, never editable. */
  readonly?: boolean;
  /** `tool` role only: the function this result answers. */
  toolName?: string;
  /** `tool` role only: stable identity shared by the call and its result. */
  toolCallId?: string;
  /** `tool` role only: JSON arguments passed into the function. */
  toolArguments?: string;
  /** Assistant reasoning replayed verbatim for DeepSeek tool-enabled turns. */
  reasoningContent?: string;
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
}

/** Where the loaded `vars` came from, and where it sits in the dataset so the
 *  bench can walk to the neighbouring item without a picker. */
export interface PlaygroundSample {
  datasetId: string;
  datasetName: string;
  itemId: string;
  /** Zero-based position in the dataset, for Prev/Next. */
  index: number;
  total: number;
}

export interface PlaygroundProvenance {
  type: "experiment" | "dataset" | "trace";
  label: I18nText;
}

export interface PlaygroundDraft {
  variants: PlaygroundVariant[];
  /** The values bound to `{{tokens}}` in the messages. */
  vars: Record<string, string>;
  expectedSingle: string | null;
  /** The dataset item currently loaded into `vars`, if any. */
  sample: PlaygroundSample | null;
  provenance: PlaygroundProvenance | null;
  /** Scorers to judge the outputs with, at their latest version. Pinning a
   *  version belongs to an Experiment, not to a draft. */
  scorerIds: string[];
  /** Score every output as soon as its run finishes. */
  autoScore: boolean;
}

export interface PlaygroundUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface PlaygroundToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** One scorer's verdict on one output — the endpoint's result, kept as the
 *  bench's own model so there is one definition of a score, not two. */
export type PlaygroundScore = PlaygroundScoreResult;

export interface PlaygroundCellError {
  message: string;
  retryable: boolean;
}

export interface PlaygroundCell {
  status: "idle" | "streaming" | "done" | "error";
  text: string;
  reasoningContent: string | null;
  toolCall: PlaygroundToolCall | null;
  usage: PlaygroundUsage | null;
  error: PlaygroundCellError | null;
  /** Verdicts on this output. Absent until it has been scored. */
  scores?: PlaygroundScore[];
  scoring?: boolean;
  /** The output and scorer set these verdicts belong to. An output that has
   *  not changed is never re-scored, and a judge call is not free. */
  scoredKey?: string;
}

/** `{ [variantId]: { [rowKey]: cell } }` — kept beside the draft rather than
 *  inside it, so editing a variant never orphans or silently drops results. */
export type PlaygroundResults = Record<string, Record<string, PlaygroundCell>>;

// ── ids ───────────────────────────────────────────────────────────

let idCounter = 0;

/** Draft-local id: a counter, so the helpers stay deterministic under test.
 *  Anything that adopts a draft from outside this page load must call
 *  [`adoptIds`] first — see there for why. */
export function playgroundId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Take ownership of the ids in a draft that came from outside this page load —
 * a restored session, a recent draft, a shared snapshot.
 *
 * The counter restarts at zero on every load, while those ids were spent by an
 * earlier one. Skip this and the next message or variant is handed an id the
 * bench already holds, after which every lookup by id — update, remove, the
 * results a cell is keyed by, Vue's own `:key` — resolves to whichever of the
 * two comes first. A model change lands on the wrong column and one ✕ deletes
 * both.
 */
export function adoptIds(draft: PlaygroundDraft): void {
  for (const variant of draft.variants) {
    claimId(variant.id);
    for (const message of variant.messages) claimId(message.id);
  }
}

/** Ids not shaped `prefix-N` are left alone: they cannot collide with one this
 *  counter produces. */
function claimId(id: string): void {
  const spent = Number(id.slice(id.lastIndexOf("-") + 1));
  if (Number.isInteger(spent) && spent > idCounter) idCounter = spent;
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

// ── labels ────────────────────────────────────────────────────────

const VARIANT_LETTERS = ["A", "B", "C", "D"];

export function variantLabel(index: number): string {
  return VARIANT_LETTERS[index] ?? String(index + 1);
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
  };
}

export function starterDraft(providerId = "", model = ""): PlaygroundDraft {
  return {
    variants: [emptyVariant(providerId, model)],
    vars: {},
    expectedSingle: null,
    sample: null,
    provenance: null,
    scorerIds: [],
    autoScore: false,
  };
}

/** Deep copy with fresh ids. The clone carries none of the source's results. */
export function cloneVariant(variant: PlaygroundVariant): PlaygroundVariant {
  return {
    ...variant,
    id: playgroundId("variant"),
    messages: variant.messages.map((message) => ({ ...message, id: playgroundId("msg") })),
    tools: variant.tools.map((tool) => ({ ...tool })),
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

// ── run keys and cells ────────────────────────────────────────────

export function idleCell(): PlaygroundCell {
  return {
    status: "idle",
    text: "",
    reasoningContent: null,
    toolCall: null,
    usage: null,
    error: null,
  };
}

export function cellAt(
  results: PlaygroundResults,
  variantId: string,
  rowKey: string,
): PlaygroundCell | undefined {
  return results[variantId]?.[rowKey];
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

/**
 * Provider conversation for one variant.
 *
 * A Tool row is a compact authoring form for the protocol's two-message
 * exchange: the assistant call followed by the tool result that answers it.
 */
export function requestMessages(
  variant: PlaygroundVariant,
  vars: Record<string, string>,
): PlaygroundRequestMessage[] {
  const messages: PlaygroundRequestMessage[] = [];
  for (const message of renderedMessages(variant, vars)) {
    if (message.role !== "tool") {
      if (message.content.trim()) {
        messages.push({
          role: message.role,
          content: message.content,
          ...(message.role === "assistant" && message.reasoningContent !== undefined
            ? { reasoningContent: message.reasoningContent }
            : {}),
        });
      }
      continue;
    }

    const name = message.toolName?.trim();
    if (!name || !message.content.trim()) continue;
    const id = message.toolCallId || toolCallId(message.id);
    messages.push({
      role: "assistant",
      content: "",
      ...(message.reasoningContent !== undefined
        ? { reasoningContent: message.reasoningContent }
        : {}),
      toolCalls: [
        {
          id,
          name,
          arguments: message.toolArguments?.trim() || "{}",
        },
      ],
    });
    messages.push({ role: "tool", content: message.content, toolCallId: id });
  }
  return messages;
}

/** Stable across edits, snapshots and retries so a result never changes call. */
export function toolCallId(messageId: string): string {
  return `call_${messageId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * Retype one message.
 *
 * Tool protocol fields are dropped on the way out of `tool`; otherwise they
 * would return as stale invisible state when the row is switched back.
 */
export function withRole(message: PlaygroundMessage, role: PlaygroundRole): PlaygroundMessage {
  if (role === "tool") return { ...message, role };
  const {
    toolName: _toolName,
    toolCallId: _toolCallId,
    toolArguments: _toolArguments,
    ...rest
  } = message;
  if (role === "assistant") return { ...rest, role };
  const { reasoningContent: _reasoningContent, ...withoutReasoning } = rest;
  return { ...withoutReasoning, role };
}

/**
 * Move one message, keeping an opening `system` message pinned to the front.
 *
 * Order IS the wire format — the run sends these messages in array order — and
 * every provider reads a system message as the frame around the conversation
 * rather than a turn inside it. So the system row neither moves nor gets
 * displaced, and an out-of-range target clamps instead of throwing.
 */
export function moveMessage(
  messages: PlaygroundMessage[],
  from: number,
  to: number,
): PlaygroundMessage[] {
  if (from < 0 || from >= messages.length) return messages;
  const pinned = messages[0]?.role === "system" ? 1 : 0;
  if (from < pinned) return messages;
  const target = Math.max(pinned, Math.min(to, messages.length - 1));
  if (target === from) return messages;
  const next = [...messages];
  next.splice(target, 0, ...next.splice(from, 1));
  return next;
}

/**
 * The role a new message should take.
 *
 * A conversation alternates, so the next turn is the opposite of the last real
 * one. System and tool messages are skipped when looking back: they are context
 * around the exchange, not a turn in it, so a system-only prompt is still
 * waiting for its first user message.
 */
export function nextMessageRole(messages: PlaygroundMessage[]): PlaygroundRole {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const role = messages[index].role;
    if (role === "user") return "assistant";
    if (role === "assistant") return "user";
  }
  return "user";
}

// ── scorers ───────────────────────────────────────────────────────

/** What a scorer's template demands of the thing it judges. */
export interface ScorerEvidence {
  expectedOutput: boolean;
  trace: boolean;
}

/**
 * Read a scorer's evidence requirements out of its template.
 *
 * Deliberately the same rule the server applies before it runs one: the root of
 * every `{{token}}`, so `{{spans.0.name}}` counts as a trace reference. Doing it
 * client-side is what lets the picker say up front that a scorer cannot judge
 * this bench, instead of showing the answer as a skip after a round trip.
 */
export function scorerEvidence(template: string): ScorerEvidence {
  const evidence: ScorerEvidence = { expectedOutput: false, trace: false };
  for (const match of template.matchAll(/\{\{([^}]*)\}\}/g)) {
    const root = match[1].trim().split(".")[0];
    if (root === EXPECTED_OUTPUT_TOKEN) evidence.expectedOutput = true;
    else if (root === "spans" || root === "steps") evidence.trace = true;
  }
  return evidence;
}

/** The bench has a reference to compare against. Matches the server's rule: an
 *  empty or blank expected output is no reference at all. */
export function hasReference(expected: string | null): boolean {
  return Boolean(expected && expected.trim());
}

// ── snapshots ─────────────────────────────────────────────────────

/** Bumped only when an older payload can no longer be read as-is. */
export const PLAYGROUND_SNAPSHOT_VERSION = 1;

/**
 * What a shared snapshot carries.
 *
 * `columns` and `rows` are the only parts the server reads. It counts them
 * against the workbench limits, so they are written in ITS vocabulary and
 * duplicate what the draft already says.
 * Everything the bench needs to rebuild itself travels beside them in `draft`
 * and `results`, which the server stores verbatim and never interprets.
 */
export interface PlaygroundSnapshotPayload {
  version: number;
  columns: {
    providerId: string;
    model: string;
    params: { temperature: number };
    messages: { role: PlaygroundRole; content: string }[];
  }[];
  rows: { vars: Record<string, string>; expected: string | null }[];
  draft: PlaygroundDraft;
  results: PlaygroundResults;
}

export function snapshotPayload(
  draft: PlaygroundDraft,
  results: PlaygroundResults,
): PlaygroundSnapshotPayload {
  return {
    version: PLAYGROUND_SNAPSHOT_VERSION,
    columns: draft.variants.map((variant) => ({
      providerId: variant.providerId,
      model: variant.model,
      params: { temperature: Number(variant.temperature) || 0 },
      messages: variant.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    })),
    // One row: the bench binds a single set of values at a time.
    rows: [{ vars: { ...draft.vars }, expected: draft.expectedSingle }],
    draft: JSON.parse(JSON.stringify(draft)) as PlaygroundDraft,
    results: settledResults(results),
  };
}

/** Only outcomes travel. A cell caught mid-stream would restore as a run that
 *  is forever in flight, and an idle one carries nothing to show. */
export function settledResults(results: PlaygroundResults): PlaygroundResults {
  const settled: PlaygroundResults = {};
  for (const [variantId, byRow] of Object.entries(results)) {
    for (const [rowKey, cell] of Object.entries(byRow)) {
      if (cell.status !== "done" && cell.status !== "error") continue;
      (settled[variantId] ??= {})[rowKey] = { ...cell };
    }
  }
  return settled;
}

/**
 * Read a stored payload back into a bench, or null when it carries no draft.
 *
 * A snapshot written by a newer client is still opened: the server stores it
 * verbatim, so anything this build does not know about is simply not shown,
 * which beats refusing a link someone shared.
 */
export function draftFromSnapshot(
  payload: unknown,
): { draft: PlaygroundDraft; results: PlaygroundResults } | null {
  const stored = payload as Partial<PlaygroundSnapshotPayload> | null;
  const draft = stored?.draft;
  if (!draft || !Array.isArray(draft.variants) || !draft.variants.length) return null;
  return {
    draft: {
      variants: draft.variants,
      vars: draft.vars ?? {},
      expectedSingle: draft.expectedSingle ?? null,
      sample: draft.sample ?? null,
      provenance: draft.provenance ?? null,
      scorerIds: draft.scorerIds ?? [],
      autoScore: draft.autoScore ?? false,
    },
    results: (stored?.results ?? {}) as PlaygroundResults,
  };
}
