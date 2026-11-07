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

import { reactive } from "vue";

import { parseAttachmentBlocks } from "@/composables/assistant/pure";
import aiChatShare from "@/services/ai_chat_share";
import type { ChatMessage } from "@/ts/interfaces/chat";

import { hasAttachments } from "./chatShare";

export type AttachmentsKnown = "yes" | "no" | "unknown";

const MAX_CHECKED = 200;

const MAX_TURNS = 2000;

// Module scope: a history row's Share and the manager it opens read the same check.
const checked = reactive(new Map<string, boolean>());

const keyOf = (org: string, sid: string): string => `${org}\u0000${sid}`;

/** What Share knows about a chat's attachments: from its loaded messages, else from an earlier check. */
export function knownAttachments(
  org: string,
  sid: string,
  messages: readonly ChatMessage[] | undefined,
): AttachmentsKnown {
  if (messages) return hasAttachments(messages) ? "yes" : "no";
  const value = checked.get(keyOf(org, sid));
  if (value === undefined) return "unknown";
  return value ? "yes" : "no";
}

/** Reads the stored chat once; throws when it can't, and a reply it can't fully read counts as holding attachments. */
export async function checkAttachments(org: string, sid: string): Promise<boolean> {
  const { data } = await aiChatShare.chatTurns(org, sid);
  const value = data?.has_more === true || turnsHaveAttachments(data?.turns);
  const key = keyOf(org, sid);
  checked.delete(key);
  checked.set(key, value);
  if (checked.size > MAX_CHECKED) checked.delete(checked.keys().next().value as string);
  return value;
}

export function resetAttachmentChecks(): void {
  checked.clear();
}

/** Stored turns hold an attachment when a prompt carried an image or an attachment block. */
export function turnsHaveAttachments(turns: unknown): boolean {
  if (!Array.isArray(turns) || turns.length > MAX_TURNS) return true;
  return turns.some((turn) => {
    const user = (turn as { user?: unknown } | null)?.user;
    if (!user || typeof user !== "object") return false;
    const { images, text } = user as { images?: unknown; text?: unknown };
    if (Array.isArray(images) && images.length > 0) return true;
    return typeof text === "string" && parseAttachmentBlocks(text).blocks.length > 0;
  });
}
