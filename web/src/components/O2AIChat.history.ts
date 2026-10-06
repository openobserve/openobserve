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
import { raw, type TranslateFn } from "@/types/i18n";

import { generateNavigationFromToolResult } from "./O2AIChat.navigation";
import { reduce, type ReducerCtx, type StreamState } from "./O2AIChat.reducer";

export type { TurnSpan };

export type TurnStatus = "running" | "completed" | "cancelled" | "failed" | "interrupted";

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
): void {
  const has = (type: string) => turn.frames.some((frame) => frame?.type === type);
  const { t } = ctx;
  if (turn.status === "running") {
    appendMarker(messages, from, {
      type: "status",
      turnStatus: "running",
      message: t("aiAssistant.turnRunning"),
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

function foldTurn(turn: StoredTurn, messages: ChatMessage[], ctx: ReducerCtx): void {
  const from = messages.length;
  if (turn.user) {
    const images = (turn.user.images ?? [])
      .map(toAttachment)
      .filter((img): img is ImageAttachment => img !== null);
    messages.push({
      role: "user",
      content: raw(turn.user.text),
      ...(images.length > 0 && { images }),
    });
  }
  const state: StreamState = {
    messages,
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
  for (const frame of turn.frames) {
    if (state.halted) break;
    reduce(state, frame, ctx);
  }
  markTurnStatus(turn, messages, from, state, ctx);
}

/** Fold stored turns with the live reducer so they render like a live chat, marking unfinished or failed turns. */
export function foldTurns(
  turns: StoredTurn[],
  t: TranslateFn,
): { messages: ChatMessage[]; spans: TurnSpan[] } {
  const messages: ChatMessage[] = [];
  const spans: TurnSpan[] = [];
  // isActive records tool calls like the visible chat; auto-navigation stops a past navigation replaying as a prompt.
  const ctx: ReducerCtx = {
    isActive: true,
    autoNavigationEnabled: true,
    phase: "stream",
    t,
    generateNavigation: (tool, args, body) => generateNavigationFromToolResult(tool, args, body, t),
  };
  for (const turn of turns) {
    const before = messages.length;
    foldTurn(turn, messages, ctx);
    spans.push({
      turn_id: turn.turn_id,
      first_seq: turn.first_seq,
      last_seq: turn.last_seq,
      count: messages.length - before,
    });
  }
  return { messages, spans };
}

export function messagesFromTurns(turns: StoredTurn[], t: TranslateFn): ChatMessage[] {
  return foldTurns(turns, t).messages;
}

const hasSeq = (span: { first_seq?: number | null }) => typeof span.first_seq === "number";

/** Merge an incremental read into a cached fold: returned turns replace cached ones by `first_seq`. */
export function mergeIncremental(
  cached: { messages: ChatMessage[]; spans: TurnSpan[] },
  knownSeq: number,
  incoming: StoredTurn[],
  t: TranslateFn,
): { messages: ChatMessage[]; spans: TurnSpan[] } {
  const folded = foldTurns(incoming, t);
  const newFirstSeqs = new Set(incoming.filter(hasSeq).map((turn) => turn.first_seq));
  const newTurnIds = new Set(incoming.map((turn) => turn.turn_id).filter(Boolean));

  type Piece = { span: TurnSpan; messages: ChatMessage[] };
  const cachedPieces: Piece[] = [];
  let offset = 0;
  for (const span of cached.spans) {
    cachedPieces.push({ span, messages: cached.messages.slice(offset, offset + span.count) });
    offset += span.count;
  }
  const newPieces: Piece[] = [];
  offset = 0;
  for (const span of folded.spans) {
    newPieces.push({ span, messages: folded.messages.slice(offset, offset + span.count) });
    offset += span.count;
  }

  const keptStored = cachedPieces.filter(
    ({ span }) =>
      hasSeq(span) &&
      typeof span.last_seq === "number" &&
      span.last_seq <= knownSeq &&
      !newFirstSeqs.has(span.first_seq),
  );
  const keptUnstored = cachedPieces.filter(
    ({ span }) => !hasSeq(span) && !(span.turn_id && newTurnIds.has(span.turn_id)),
  );
  const stored = [...keptStored, ...newPieces.filter(({ span }) => hasSeq(span))].sort(
    (a, b) => (a.span.first_seq as number) - (b.span.first_seq as number),
  );
  // A full read lists never-stored failed turns after the stored ones, so the merge does too.
  const unstored = [...keptUnstored, ...newPieces.filter(({ span }) => !hasSeq(span))];
  const ordered = [...stored, ...unstored];
  return {
    messages: ordered.flatMap((piece) => piece.messages),
    spans: ordered.map((piece) => piece.span),
  };
}
