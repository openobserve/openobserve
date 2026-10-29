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

import type { AssistantSignal } from "@/components/ai-assistant/common/AssistantStatusDot.types";
import type { HistoryRow } from "@/composables/assistant";
import type { I18nKey } from "@/types/i18n";

/** A chat's live state in words; `null` is a chat at rest. */
export type ChatStatus = "needs_you" | "answering" | "failed";

export const CHAT_STATUS_KEYS: Record<ChatStatus, I18nKey> = {
  needs_you: "assistant.history.state.needsApproval",
  answering: "assistant.history.state.answering",
  failed: "assistant.history.state.failed",
};

/** The status mark beside the words, so colour is never the only cue. */
export const CHAT_STATUS_SIGNAL: Record<ChatStatus, AssistantSignal> = {
  needs_you: "attention",
  answering: "working",
  failed: "failed",
};

/** `turnState` is this tab's turn for the chat, when it holds one. */
export function chatStatusOf(
  row: Pick<HistoryRow, "pendingApproval" | "activeTurn">,
  turnState?: string,
): ChatStatus | null {
  if (row.pendingApproval) return "needs_you";
  if (row.activeTurn) return "answering";
  return turnState === "failed" ? "failed" : null;
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
