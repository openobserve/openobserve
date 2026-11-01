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

import { approvalClock, type HistoryRow } from "@/composables/assistant";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";

/** A chat's status word; `null` is a chat at rest, which shows its time. */
export type ChatStatus = "needs_you" | "answering" | "failed" | "expired" | "draft";

const STATUS_WORDS: Record<ChatStatus, I18nKey> = {
  needs_you: "assistant.history.state.needsYou",
  answering: "assistant.history.state.answering",
  failed: "assistant.history.state.failed",
  expired: "assistant.history.state.expired",
  draft: "assistant.history.state.draft",
};

const WORD_CLASSES: Partial<Record<ChatStatus, string>> = {
  needs_you: "text-assistant-signal-attention",
  failed: "text-status-error-text",
};

/** The word's colour; on a filled row every word is body text, so amber and red never sit on the fill below 4.5:1. */
export function chatStatusClass(status: ChatStatus, filled: boolean): string {
  return filled ? "text-text-body" : (WORD_CLASSES[status] ?? "text-text-secondary");
}

/** The word a row shows; "Needs you · m:ss" once the request's end is known. */
export function chatStatusWord(
  status: ChatStatus,
  expiresAt: number | null | undefined,
  now: number,
  t: TranslateFn,
): I18nText {
  const word = t(STATUS_WORDS[status]);
  if (status !== "needs_you" || typeof expiresAt !== "number") return word;
  return t("assistant.turn.withElapsed", {
    status: word,
    elapsed: raw(approvalClock(expiresAt - now)),
  });
}

/** `turn` is this tab's turn for the chat, or just its state, when it holds one. */
export function chatStatusOf(
  row: Pick<HistoryRow, "pendingApproval" | "activeTurn">,
  turn?: string | { state: string; error?: { code: string } },
): ChatStatus | null {
  if (row.pendingApproval) return "needs_you";
  if (row.activeTurn) return "answering";
  const held = typeof turn === "string" ? { state: turn } : turn;
  if (held?.state !== "failed") return null;
  return held.error?.code === "approval_expired" ? "expired" : "failed";
}

/** A failed chat is at rest, so only a chat that still answers or waits is in progress. */
export function isInProgress(status: ChatStatus | null): boolean {
  return status === "needs_you" || status === "answering";
}

/** In-progress chats first, each set keeping its own order. */
export function inProgressFirst<T>(
  rows: readonly T[],
  statusOf: (row: T) => ChatStatus | null,
): T[] {
  const live = rows.filter((row) => isInProgress(statusOf(row)));
  return [...live, ...rows.filter((row) => !isInProgress(statusOf(row)))];
}
