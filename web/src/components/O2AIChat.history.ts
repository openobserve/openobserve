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

import type { ChatMessage, ImageAttachment } from "@/ts/interfaces/chat";
import { raw, type TranslateFn } from "@/types/i18n";

import { generateNavigationFromToolResult } from "./O2AIChat.navigation";
import { reduce, type ReducerCtx, type StreamState } from "./O2AIChat.reducer";

/** One turn of a stored conversation, as `GET /ai/chats/{id}` returns it. */
export interface StoredTurn {
  user_message_id: string;
  created?: number | null;
  user: {
    text: string;
    images?: { filename: string; mime: string; url: string }[];
  };
  /** The SSE frames the live stream produced for this turn. */
  frames: any[];
  error?: string | null;
}

function toAttachment(image: { filename: string; mime: string; url: string }): ImageAttachment | null {
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

/**
 * Rebuild a stored conversation's messages by folding each turn's frames with
 * the live stream's reducer, so a restored chat renders exactly like a live
 * one (tool blocks, results, navigation buttons, errors).
 *
 * `isActive` so the reducer records tool calls as it does for the visible
 * chat; auto-navigation on so a past navigation is not replayed as a pending
 * "navigate?" confirmation. Effects are ignored: nothing here is live.
 */
export function messagesFromTurns(turns: StoredTurn[], t: TranslateFn): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const ctx: ReducerCtx = {
    isActive: true,
    autoNavigationEnabled: true,
    phase: "stream",
    t,
    generateNavigation: (tool, args, body) => generateNavigationFromToolResult(tool, args, body, t),
  };
  for (const turn of turns) {
    const images = (turn.user.images ?? [])
      .map(toAttachment)
      .filter((img): img is ImageAttachment => img !== null);
    messages.push({
      role: "user",
      content: raw(turn.user.text),
      ...(images.length > 0 && { images }),
    });
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
  }
  return messages;
}
