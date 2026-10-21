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

import type { ChatMessage } from "@/ts/interfaces/chat";

import type { AssistantSession } from "./assistantStore.types";

/** The answer to the session's latest prompt; `null` while that prompt has none yet. */
export function lastAnswerOf(session: Pick<AssistantSession, "messages"> | null | undefined) {
  const messages = session?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return messages[i];
    if (messages[i].role === "user") return null;
  }
  return null;
}

/** An answer's text blocks joined, or its plain content when it has none. */
export function answerTextOf(answer: ChatMessage | null | undefined): string {
  if (!answer) return "";
  const blocks = answer.contentBlocks ?? [];
  const texts = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "");
  return (texts.length ? texts.join("\n") : String(answer.content ?? "")).trim();
}

/** Saved Markdown as an assistant message, so it renders through the transcript's renderer. */
export function markdownMessage(
  text: string,
  extra: ChatMessage["contentBlocks"] = [],
): ChatMessage {
  return {
    role: "assistant",
    content: text,
    contentBlocks: [...(extra ?? []), { type: "text", text }],
  } as ChatMessage;
}
