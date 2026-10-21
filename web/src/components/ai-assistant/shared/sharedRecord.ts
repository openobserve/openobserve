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

import type { StoredTurn } from "@/components/O2AIChat.history";
import { messagesFromTurns } from "@/composables/assistant/pure";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { gt, raw, type TranslateFn } from "@/types/i18n";

export interface SharedRecordOptions {
  redacted?: boolean;
  hidden?: Record<string, { reason: "stream_forbidden"; stream: string }>;
  timezone: string;
  scrubModels: boolean;
  /** Names the owner's prompts for anyone but the owner; absent means "You". */
  author?: string;
  t?: TranslateFn;
}

const MAX_DEPTH = 12;

const MODEL_NAME =
  /\b(?:[a-z][\w-]*\/)?(?:claude|gpt|gemini|llama|mistral|mixtral|deepseek|qwen|o[134])(?:[-_.: ]?(?:\d[\w.]*|sonnet|opus|haiku|pro|flash|mini|turbo|nano|preview|instruct|latest))+\b/gi;

// Inputs and outputs go; the tool's name and whether it worked stay.
const REDACTED_KEYS = ["context", "confirmationArgs", "details", "resultMessage", "summary"];

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** The viewer fold of shared turns, shaped like `projectRecord` so the one fold replaces it without touching callers. */
export function projectSharedRecord(
  turns: StoredTurn[],
  audience: "viewer" | "export",
  options: SharedRecordOptions,
): ChatMessage[] {
  void audience;
  const t = options.t ?? gt;
  const folded = messagesFromTurns(Array.isArray(turns) ? turns : [], t, "viewer", "replay");
  return folded.map((message) => {
    const blocks = message.contentBlocks?.map((block) => viewBlock(block, options, t));
    const shaped: ChatMessage = {
      ...message,
      ...(blocks && { contentBlocks: blocks }),
      ...(message.role === "user" && options.author && { author: options.author }),
    };
    return options.scrubModels ? (scrub(shaped, 0) as ChatMessage) : shaped;
  });
}

/** Replaces model names with "the model" in a string. */
export function scrubModelNames(text: string): string {
  return text.replace(MODEL_NAME, "the model");
}

/** The shared transcript as Markdown; images never travel and redaction stays as the page shows it. */
export function sharedMarkdown(
  title: string,
  messages: readonly ChatMessage[],
  t: TranslateFn = gt,
): string {
  const parts = [`# ${title}`];
  for (const message of messages) {
    const who =
      message.role === "user"
        ? (message.author ?? t("assistant.shared.markdownYou"))
        : t("assistant.name");
    const text = String(message.content ?? "").trim();
    if (text) parts.push(`## ${raw(String(who))}\n\n${text}`);
  }
  return `${parts.join("\n\n")}\n`;
}

function viewBlock(
  block: ContentBlock,
  options: SharedRecordOptions,
  t: TranslateFn,
): ContentBlock {
  if (block.type !== "tool_call") return block;
  const hidden = block.call_id ? options.hidden?.[block.call_id] : undefined;
  if (!hidden && !options.redacted) return block;
  const kept: ContentBlock = { ...block };
  for (const key of REDACTED_KEYS) delete (kept as unknown as Record<string, unknown>)[key];
  if (hidden) {
    kept.message = t("assistant.shared.streamHiddenBlock", {
      stream: raw(String(hidden.stream).slice(0, 200)),
    });
  }
  return kept;
}

// Copies as it scrubs: the fold shares objects with the query cache, which must stay intact.
function scrub(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.startsWith("data:") ? value : scrubModelNames(value);
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = key === "images" ? item : scrub(item, depth + 1);
  }
  return out;
}
