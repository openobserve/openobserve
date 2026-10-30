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

import type { ChatMessage, ContentBlock, ImageAttachment, TurnSpan } from "@/ts/interfaces/chat";
import type { ChatApproval } from "@/services/assistant";
import { gt, raw, type TranslateFn } from "@/types/i18n";

import { toAssistantError } from "./assistantErrors";
import { generateNavigationFromToolResult } from "./navigationRoutes";
import {
  interruptSteps,
  reduce,
  type ApprovalBlockData,
  type ReducerCtx,
  type StreamState,
} from "./reducer";

export type { TurnSpan };

export type TurnStatus = "running" | "completed" | "cancelled" | "failed" | "interrupted";

/** Who reads the fold: the owner can still act on a running turn, a viewer of a share cannot. */
export type HistoryAudience = "owner" | "viewer";

/** `replay` is the new transcript's fold: typed steps and outcome markers instead of the legacy text markers. */
export type FoldPhase = "stream" | "replay";

/** One turn of a stored conversation, as `GET /ai/chats/{id}` returns it. */
export interface StoredTurn {
  /** Absent from shared reads. */
  user_message_id?: string;
  turn_id?: string;
  created?: number | null;
  /** Null on a failed turn that stored nothing (the message never reached the agent). */
  user: {
    text: string;
    images?: { filename: string; mime: string; url: string }[];
  } | null;
  /** The SSE frames the live stream produced for this turn. */
  frames: any[];
  error?: string | null;
  status?: TurnStatus;
  error_code?: string | null;
  /** Seq range of the turn's events; absent on a turn that stored nothing. */
  first_seq?: number | null;
  last_seq?: number | null;
}

/** `export` is the owner's own download: no actions, model names scrubbed. */
export type RecordAudience = "owner" | "viewer" | "export";

export interface ProjectRecordOptions {
  /** `redact_tools`: tool inputs, outputs and payload diffs go; names, counts and approval outcomes stay. */
  redacted?: boolean;
  hidden?: Record<string, { reason: "stream_forbidden"; stream: string }>;
  /** `hide_attachments`: the prompt's images go; see `hidesAttachments` for the default. */
  hideAttachments?: boolean;
  timezone: string;
  scrubModels: boolean;
  /** Defaults to the app's translator; the golden tests pass a key echo. */
  t?: TranslateFn;
  /** The chat read's `approvals[]`: how the owner answered cards whose resolution the turns lack. */
  approvals?: readonly ChatApproval[];
}

declare module "@/ts/interfaces/chat" {
  interface ContentBlock {
    /** A tool step whose stream the viewer may not read. */
    hidden?: { reason: "stream_forbidden"; stream: string };
    /** Epoch ms of a `compacting` frame, minute precision. */
    compactedAt?: number;
  }
}

/** Every frame type `frames.ts` parses; `projectRecord.spec.ts` pins the two lists together. */
export const KNOWN_FRAME_TYPES: ReadonlySet<string> = new Set([
  "status",
  "title",
  "tool_call",
  "tool_result",
  "message_delta",
  "message",
  "usage",
  "confirmation_required",
  "navigation_action",
  "error",
  "complete",
  "cancelled",
  "turn_started",
  "step",
  "retrying",
  "compacting",
  "permission_denied",
  "confirmation_resolved",
  "query",
  "resource_changed",
  "findings",
  "sync",
  "sync_state",
]);

const MINUTE_MS = 60_000;

const UNSAFE_RECORD_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

// Provider model ids as they leak into agent text; a word boundary keeps "o11y" and plain words out.
const MODEL_NAME =
  /\b(?:gpt-[\w.-]+|chatgpt[\w.-]*|claude(?:-[\w.]+)*|gemini(?:-[\w.]+)*|llama[\w.-]*|mistral[\w.-]*|mixtral[\w.-]*|deepseek[\w.-]*|qwen[\w.-]*|o[134]-(?:mini|preview|pro)[\w.-]*)\b/gi;

// Keys whose values are ids or enums, never prose a model name could be in.
const SCRUB_SKIP_KEYS: ReadonlySet<string> = new Set([
  "type",
  "id",
  "call_id",
  "turn_id",
  "tool",
  "kind",
  "code",
  "error_code",
  "trace_id",
  "by",
]);

const REDACTED_KEYS: Record<string, readonly string[]> = {
  tool_call: ["context", "args", "input", "arguments"],
  tool_result: ["call_args", "response", "message", "query", "output"],
};

function toAttachment(image: {
  filename: string;
  mime: string;
  url: string;
}): ImageAttachment | null {
  const comma = image.url?.indexOf(",") ?? -1;
  if (comma < 0 || (image.mime !== "image/png" && image.mime !== "image/jpeg")) return null;
  const data = image.url.slice(comma + 1);
  return {
    data,
    mimeType: image.mime,
    filename: image.filename,
    size: Math.floor((data.length * 3) / 4),
  };
}

function lastAssistant(messages: ChatMessage[], from: number): ChatMessage {
  const last = messages[messages.length - 1];
  if (messages.length > from && last?.role === "assistant") return last;
  const created: ChatMessage = { role: "assistant", content: raw(""), contentBlocks: [] };
  messages.push(created);
  return created;
}

function appendMarker(messages: ChatMessage[], from: number, block: ContentBlock): void {
  const target = lastAssistant(messages, from);
  if (!target.contentBlocks) target.contentBlocks = [];
  target.contentBlocks.push(block);
}

function codeSuggestion(turn: StoredTurn, t: TranslateFn) {
  return turn.error_code ? t("aiAssistant.turnErrorCode", { code: turn.error_code }) : undefined;
}

// Frames already carry their own terminal for an error or a stop, so only a turn without one gets a marker.
function markTurnStatus(
  turn: StoredTurn,
  messages: ChatMessage[],
  from: number,
  state: StreamState,
  ctx: ReducerCtx,
  audience: HistoryAudience,
): void {
  const has = (type: string) => turn.frames.some((frame) => frame?.type === type);
  const { t } = ctx;
  if (turn.status === "running") {
    appendMarker(messages, from, {
      type: "status",
      turnStatus: "running",
      message:
        audience === "viewer" ? t("aiAssistant.turnRunningViewer") : t("aiAssistant.turnRunning"),
    });
  } else if (turn.status === "cancelled" && !has("cancelled") && !state.halted) {
    reduce(state, { type: "cancelled" }, ctx);
  } else if (turn.status === "interrupted" && !has("error")) {
    appendMarker(messages, from, {
      type: "error",
      message: t("aiAssistant.turnInterrupted"),
      suggestion: codeSuggestion(turn, t),
      recoverable: true,
    });
  } else if (turn.status === "failed" && !has("error")) {
    appendMarker(messages, from, {
      type: "error",
      message: turn.user ? t("aiAssistant.turnFailed") : t("aiAssistant.messageFailedToSend"),
      suggestion: codeSuggestion(turn, t),
    });
  }
}

function foldTurn(
  turn: StoredTurn,
  messages: ChatMessage[],
  ctx: ReducerCtx,
  audience: HistoryAudience,
): void {
  // A turn folds into its own list so a turn without a user message cannot write into the previous answer.
  const own: ChatMessage[] = [];
  if (turn.user) {
    const images = (turn.user.images ?? [])
      .map(toAttachment)
      .filter((img): img is ImageAttachment => img !== null);
    if (turn.user.text || images.length > 0) {
      own.push(
        ctx.phase === "replay"
          ? replayedPrompt(turn, images)
          : { role: "user", content: raw(turn.user.text), ...(images.length > 0 && { images }) },
      );
    }
  }
  // A message that never reached the agent reads as unsent, not as the server's generic failure text.
  const unsent = turn.status === "failed" && !turn.user;
  const shown = unsent
    ? { ...turn, frames: turn.frames.filter((frame) => frame?.type !== "error") }
    : turn;
  const state: StreamState = {
    messages: own,
    activeToolCall: null,
    textSegment: "",
    streamingMsg: "",
    title: undefined,
    lastTraceId: null,
    ownerUnavailable: false,
    pendingConfirmation: null,
    messageComplete: false,
    halted: false,
  };
  for (const frame of shown.frames) {
    if (state.halted) break;
    reduce(state, frame, ctx);
  }
  if (ctx.phase === "replay") markReplayStatus(shown, own, state);
  else markTurnStatus(shown, own, 0, state, ctx, audience);
  messages.push(...own);
}

// SEC-11: only the trailing blocks under the message's own nonce are attachments; anything else stays the user's text.
function replayedPrompt(turn: StoredTurn, images: ImageAttachment[]): ChatMessage {
  const { text, blocks } = parseAttachmentBlocks(turn.user?.text ?? "");
  const created = typeof turn.created === "number" ? turn.created : null;
  return {
    role: "user",
    content: raw(text),
    ...(created !== null && { sentAt: created > 1e14 ? Math.floor(created / 1000) : created }),
    ...(turn.turn_id && { turnId: turn.turn_id }),
    ...(images.length > 0 && { images }),
    ...(blocks.length > 0 && {
      contentBlocks: blocks.map((block) => ({
        type: "attachment" as const,
        attachment: { name: block.name, body: block.body },
      })),
    }),
  };
}

// HT-01 AC 7: a stored turn never shows a live step, and every ended turn replays one outcome marker.
function markReplayStatus(turn: StoredTurn, messages: ChatMessage[], state: StreamState): void {
  interruptSteps(state);
  const has = (type: string) => turn.frames.some((frame) => frame?.type === type);
  if (messages.some((message) => message.contentBlocks?.some(isOutcomeMarker))) return;
  // B-02's `by` replays as live reads it: a sign-out or the server is not the reader's own Stop.
  const by = turn.frames.find((frame) => frame?.type === "cancelled")?.by;
  if (by === "signed_out" || by === "server") {
    const errorType = by === "signed_out" ? "signed_out" : "cancelled_elsewhere";
    appendMarker(messages, 0, { type: "error", errorType });
    return;
  }
  if (turn.status === "cancelled" || has("cancelled")) {
    appendMarker(messages, 0, { type: "status", turnStatus: "stopped" });
    return;
  }
  if (turn.status === "completed" || (has("complete") && turn.status !== "failed")) return;
  const failed = turn.status === "failed" || has("error");
  const errorType = failed ? storedErrorCode(turn) : "stream_dropped";
  appendMarker(messages, 0, { type: "error", errorType });
}

function isOutcomeMarker(block: ContentBlock): boolean {
  return (block.type === "error" && !!block.errorType) || block.turnStatus === "stopped";
}

// The last error frame names the cause (an owner race leaves no marker of its own); else the stored code.
function storedErrorCode(turn: StoredTurn): string {
  const frame = [...turn.frames]
    .reverse()
    .find((f) => f?.type === "error" && f.code !== "persistence_failed");
  if (frame) return toAssistantError(frame).code;
  return toAssistantError({ type: "error", error_code: turn.error_code ?? undefined }).code;
}

/** Fold stored turns with the live reducer so they render like a live chat, marking unfinished or failed turns. */
export function foldTurns(
  turns: StoredTurn[],
  t: TranslateFn,
  audience: HistoryAudience = "owner",
  phase: FoldPhase = "stream",
): { messages: ChatMessage[]; spans: TurnSpan[] } {
  const messages: ChatMessage[] = [];
  const spans: TurnSpan[] = [];
  // isActive records tool calls like the visible chat; auto-navigation stops a past navigation replaying as a prompt.
  const ctx: ReducerCtx = {
    isActive: true,
    autoNavigationEnabled: true,
    phase,
    t,
    generateNavigation: (tool, args, body) => generateNavigationFromToolResult(tool, args, body, t),
  };
  for (const turn of turns) {
    const before = messages.length;
    foldTurn(turn, messages, ctx, audience);
    spans.push({
      turn_id: turn.turn_id,
      first_seq: turn.first_seq,
      last_seq: turn.last_seq,
      count: messages.length - before,
    });
  }
  return { messages, spans };
}

export function messagesFromTurns(
  turns: StoredTurn[],
  t: TranslateFn,
  audience: HistoryAudience = "owner",
  phase: FoldPhase = "stream",
): ChatMessage[] {
  return foldTurns(turns, t, audience, phase).messages;
}

/** One attachment block of a stored user message; `nonce` is `null` for the legacy form. */
export interface AttachmentBlock {
  name: string;
  body: string;
  nonce: string | null;
  lines?: { start: number; end: number };
}

const NONCED_OPENER = /^--- (.+?) \[([a-z2-7]{8})\] ---$/;

const NONCED_CLOSER = /^--- end \[([a-z2-7]{8})\] ---$/;

// Anchored to line starts: the serializer breaks every block-shaped line of typed text, so only the legacy writer's blocks match.
const LEGACY_BLOCK = /^--- (.+?) (?:\(lines (\d+)-(\d+)\) )?---\n([\s\S]*?)\n--- end ---$/gm;

/** A user message's typed text and blocks: the trailing matching-nonce run, else the legacy chat's un-nonced form (`00` §6.3). */
export function parseAttachmentBlocks(text: string): { text: string; blocks: AttachmentBlock[] } {
  const nonced = parseNoncedBlocks(text);
  if (nonced.blocks.length > 0) return nonced;
  return parseLegacyBlocks(text);
}

/** Breaks block syntax in typed text, so nothing the user pasted can pass for an attachment (`00` §6.3). */
export function neutralizeBlockSyntax(text: string): string {
  return text
    .split("\n")
    .map((line) => (/^--- .* ---$/.test(line) ? `-\u200b${line.slice(1)}` : line))
    .join("\n");
}

// The serializer appends its blocks after the typed text, so only the trailing run under the last block's nonce is read.
function parseNoncedBlocks(text: string): { text: string; blocks: AttachmentBlock[] } {
  const lines = text.split("\n");
  const blocks: AttachmentBlock[] = [];
  let end = lastContentLine(lines, lines.length - 1);
  const nonce = NONCED_CLOSER.exec(lines[end] ?? "")?.[1];
  while (nonce && end >= 2 && lines[end] === `--- end [${nonce}] ---`) {
    const opener = NONCED_OPENER.exec(lines[end - 2]);
    if (!opener || opener[2] !== nonce) break;
    blocks.unshift({ name: opener[1], body: lines[end - 1], nonce });
    end = lastContentLine(lines, end - 3);
  }
  if (blocks.length === 0) return { text: text.trim(), blocks };
  return {
    text: lines
      .slice(0, end + 1)
      .join("\n")
      .trim(),
    blocks,
  };
}

function lastContentLine(lines: string[], from: number): number {
  let i = from;
  while (i >= 0 && lines[i].trim() === "") i -= 1;
  return i;
}

function parseLegacyBlocks(text: string): { text: string; blocks: AttachmentBlock[] } {
  const blocks: AttachmentBlock[] = [];
  const rest = text.replace(
    LEGACY_BLOCK,
    (_all, name: string, start?: string, end?: string, body = "") => {
      blocks.push({
        name: name.trim(),
        body,
        nonce: null,
        ...(start && end && { lines: { start: Number(start), end: Number(end) } }),
      });
      return "";
    },
  );
  return { text: rest.trim(), blocks };
}

const hasSeq = (span: { first_seq?: number | null }) => typeof span.first_seq === "number";

type Piece = { span: TurnSpan; messages: ChatMessage[] };

const piecesOf = (folded: { messages: ChatMessage[]; spans: TurnSpan[] }): Piece[] => {
  const pieces: Piece[] = [];
  let offset = 0;
  for (const span of folded.spans) {
    pieces.push({ span, messages: folded.messages.slice(offset, offset + span.count) });
    offset += span.count;
  }
  return pieces;
};

const sameTurn = (a: TurnSpan, b: TurnSpan): boolean =>
  (hasSeq(a) && hasSeq(b) && a.first_seq === b.first_seq) ||
  (!!a.turn_id && a.turn_id === b.turn_id);

/** Merge an incremental read into a cached fold: a returned turn replaces its cached copy in place, new ones follow in server order. */
export function mergeIncremental(
  cached: { messages: ChatMessage[]; spans: TurnSpan[] },
  knownSeq: number,
  incoming: StoredTurn[],
  t: TranslateFn,
  phase: FoldPhase = "stream",
): { messages: ChatMessage[]; spans: TurnSpan[] } {
  const fresh = piecesOf(foldTurns(incoming, t, "owner", phase));
  const used = new Set<Piece>();
  const ordered: Piece[] = [];
  for (const piece of piecesOf(cached)) {
    const replacement = fresh.find((next) => !used.has(next) && sameTurn(piece.span, next.span));
    if (replacement) {
      used.add(replacement);
      ordered.push(replacement);
      continue;
    }
    const committed =
      !hasSeq(piece.span) ||
      (typeof piece.span.last_seq === "number" && piece.span.last_seq <= knownSeq);
    if (committed) ordered.push(piece);
  }
  // The server lists the turns past knownSeq in the order they started, so they keep that order.
  ordered.push(...fresh.filter((piece) => !used.has(piece)));
  return {
    messages: ordered.flatMap((piece) => piece.messages),
    spans: ordered.map((piece) => piece.span),
  };
}

/** The one fold behind reload, shared pages and exports; a replayed card is a record, never a pending one. */
export function projectRecord(
  turns: StoredTurn[],
  audience: RecordAudience,
  options: ProjectRecordOptions,
): ChatMessage[] {
  const t = options.t ?? gt;
  const prepared = prepareTurns(turns, audience, options);
  const fold = audience === "owner" ? "owner" : "viewer";
  const { messages } = foldTurns(prepared, t, fold, "replay");
  for (const message of messages) settleMessage(message, prepared, options, t);
  return messages;
}

/** The stored turns as an audience may see them: known frames only, scrubbed and redacted; the JSON export is this. */
export function prepareTurns(
  turns: StoredTurn[],
  audience: RecordAudience,
  options: ProjectRecordOptions,
): StoredTurn[] {
  const t = options.t ?? gt;
  const warned = new Set<string>();
  const scrub = options.scrubModels || audience !== "owner";
  const theModel = scrub ? String(t("assistant.record.theModel")) : "";
  return turns.map((turn) => ({
    ...turn,
    frames: (Array.isArray(turn.frames) ? turn.frames : [])
      .filter((frame) => knownFrame(frame, warned))
      .map((frame) => projectFrame(frame, options, theModel)),
    ...(turn.user && {
      user: {
        ...turn.user,
        ...(scrub && { text: scrubText(turn.user.text, theModel) }),
        ...(options.hideAttachments && { images: [] }),
      },
    }),
  }));
}

/** A link without `hide_attachments` hides them when it is public. */
export function hidesAttachments(share: {
  hide_attachments?: boolean | null;
  visibility: string;
}): boolean {
  return share.hide_attachments ?? share.visibility === "public";
}

/** "02:14" in the org's zone; the browser's zone only when the name is unknown to `Intl`. */
export function minuteLabel(ms: number, timezone: string): string {
  const format = (timeZone?: string) =>
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(timeZone && { timeZone }),
    }).format(ms);
  try {
    return format(timezone || undefined);
  } catch {
    return format();
  }
}

// An unknown kind from a newer server is skipped with one warning per kind, never a crash.
function knownFrame(frame: unknown, warned: Set<string>): boolean {
  const type = (frame as { type?: unknown } | null)?.type;
  if (typeof type === "string" && KNOWN_FRAME_TYPES.has(type)) return true;
  const name = typeof type === "string" ? type.slice(0, 64) : typeof type;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`projectRecord: ignored unknown frame kind "${name}"`);
  }
  return false;
}

function projectFrame(frame: any, options: ProjectRecordOptions, theModel: string): any {
  let next: any = theModel ? scrubValue(frame, theModel) : frame;
  const callId = typeof next.call_id === "string" ? next.call_id : "";
  const hidden = !!callId && !!options.hidden?.[callId];
  const keys = REDACTED_KEYS[next.type];
  if (keys && (options.redacted || hidden)) {
    next = { ...next };
    for (const key of keys) delete next[key];
    if (next.type === "tool_result" && !isCountSummary(next.summary)) delete next.summary;
  }
  if (next.type === "query" && (options.redacted || hidden)) return { type: "status" };
  // A redacted link keeps where it goes, never the query, stream or window it carries.
  if (next.type === "navigation_action" && options.redacted)
    return { type: next.type, resource_type: next.resource_type, action: next.action, target: {} };
  return next;
}

function isCountSummary(summary: unknown): boolean {
  return (
    !!summary &&
    typeof summary === "object" &&
    Object.values(summary as Record<string, unknown>).every((value) => typeof value === "number")
  );
}

// Model names go from every prose field and `model` keys go entirely; ids and enums are left alone.
function scrubValue(value: unknown, theModel: string, depth = 0): any {
  if (typeof value === "string") return scrubText(value, theModel);
  if (depth > 8 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, theModel, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "model" || key === "model_provider" || UNSAFE_RECORD_KEYS.has(key)) continue;
    out[key] = SCRUB_SKIP_KEYS.has(key) ? item : scrubValue(item, theModel, depth + 1);
  }
  return out;
}

function scrubText(text: string, theModel: string): string {
  return typeof text === "string" ? text.replace(MODEL_NAME, theModel) : text;
}

function settleMessage(
  message: ChatMessage,
  turns: StoredTurn[],
  options: ProjectRecordOptions,
  t: TranslateFn,
): void {
  if (typeof message.sentAt === "number") message.sentAt = toMinute(message.sentAt);
  const blocks = message.contentBlocks ?? [];
  for (const block of blocks) {
    if (block.approval && !blocks.some((other) => other.resolved?.id === block.approval?.id))
      block.approval = withRecordedDecision(block.approval, options.approvals);
    // Targets come from the arguments on an untyped card, so the redaction goes after the fold, not before it.
    if (block.approval && options.redacted) block.approval = redactedApproval(block.approval);
    if (block.resolved && options.redacted) {
      const { id, approved, at, expired, withdrawn } = block.resolved;
      block.resolved = {
        id,
        approved,
        ...(at !== undefined && { at }),
        ...(expired && { expired }),
        ...(withdrawn && { withdrawn }),
      };
    }
    if (block.resolved?.at !== undefined) block.resolved.at = toMinute(block.resolved.at);
    if (options.redacted) redactNavigation(block, t);
    const hidden = block.call_id ? options.hidden?.[block.call_id] : undefined;
    if (hidden)
      block.hidden = { reason: hidden.reason, stream: options.redacted ? "" : hidden.stream };
  }
  const turn = message.turnId ? turns.find((stored) => stored.turn_id === message.turnId) : null;
  if (message.role === "user" && turn?.frames.some((frame) => frame?.type === "compacting")) {
    const at = toMinute(typeof turn.created === "number" ? epochMs(turn.created) : 0);
    message.contentBlocks = [
      ...(message.contentBlocks ?? []),
      {
        type: "status",
        compactedAt: at,
        message: t("assistant.record.compacted", { time: raw(minuteLabel(at, options.timezone)) }),
      },
    ];
  }
}

// A decided server row says how the card ended; an approval with no time to show stays a record without one.
function withRecordedDecision(
  card: ApprovalBlockData,
  approvals: readonly ChatApproval[] | undefined,
): ApprovalBlockData {
  const row = approvals?.find((approval) => approval.id === card.id);
  const decided = row && row.status !== "pending" && (row.status !== "approved" || !!row.at);
  if (!row || !decided) return { ...card, noDecision: true };
  const recorded = {
    status: row.status as Exclude<ChatApproval["status"], "pending">,
    ...(row.at && { at: toMinute(row.at) }),
  };
  return { ...card, recorded };
}

// A redacted link names no resource: the card keeps what it was, how many items and whether it was answered.
function redactedApproval(card: ApprovalBlockData): ApprovalBlockData {
  const kept: Pick<ApprovalBlockData, "id" | "kind" | "total" | "noDecision" | "recorded"> = {
    id: card.id,
    kind: card.kind,
    total: card.total ?? card.targets?.length ?? 0,
    ...(card.noDecision && { noDecision: true }),
    ...(card.recorded && { recorded: card.recorded }),
  };
  return kept as ApprovalBlockData;
}

// Tool results derive links from their arguments, so the fold's link and navigation targets go after it too.
function redactNavigation(block: ContentBlock, t: TranslateFn): void {
  if (block.link)
    block.link = {
      resourceType: block.link.resourceType,
      action: block.link.action,
      target: {},
      redacted: true,
    };
  if (block.navigationAction)
    block.navigationAction = {
      resource_type: block.navigationAction.resource_type,
      action: block.navigationAction.action,
      label: t("assistant.link.redacted"),
      target: {},
    };
}

function toMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

function epochMs(value: number): number {
  return value > 1e14 ? Math.floor(value / 1000) : value;
}
