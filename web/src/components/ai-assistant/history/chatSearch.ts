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

import type { StoredTurn } from "@/composables/assistant";
import type { ChatMessage } from "@/ts/interfaces/chat";

/** Characters kept before the match in a snippet; the rest of the line follows it. */
export const SNIPPET_LEAD = 32;

export const SNIPPET_LENGTH = 140;

/** Server matches read for a snippet when their title shows no match; the rest show the title alone. */
export const PEEK_LIMIT = 5;

/** Title characters a result row shows before it truncates; a later match moves the window to it. */
export const TITLE_FIT = 48;

/** Characters kept before a title match that sits past `TITLE_FIT`. */
export const TITLE_LEAD = 16;

export interface TextPart {
  text: string;
  hit: boolean;
}

/** Splits text around every case-insensitive occurrence of the needle. */
export function highlightParts(text: string, needle: string): TextPart[] {
  const q = needle.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: TextPart[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

/** The title as shown, starting a few words before a match the row would truncate away. */
export function titleWindow(title: string, needle: string): string {
  const q = needle.trim().toLowerCase();
  const at = q ? title.toLowerCase().indexOf(q) : -1;
  if (at < 0 || at + q.length <= TITLE_FIT) return title;
  const from = at - TITLE_LEAD;
  const space = title.lastIndexOf(" ", from);
  const start = space >= 0 && from - space < TITLE_LEAD ? space + 1 : from;
  return `…${title.slice(start).trimStart()}`;
}

/** One line of text around the first match, or null when the text has none. */
export function snippetOf(text: string, needle: string): string | null {
  const q = needle.trim().toLowerCase();
  if (!q) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(q);
  if (at < 0) return null;
  const start = Math.max(0, at - SNIPPET_LEAD);
  const end = Math.min(flat.length, start + SNIPPET_LENGTH);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** The first loaded message that holds the needle; a chat never opened in this browser has none. */
export function messageSnippet(messages: readonly ChatMessage[], needle: string): string | null {
  for (const message of messages) {
    const found = snippetOf(String(message.content ?? ""), needle);
    if (found) return found;
  }
  return null;
}

/** A stored chat's prompts and answer text, the parts a server search matches. */
export function turnTexts(turns: readonly StoredTurn[]): string[] {
  return turns.flatMap((turn) => {
    const answer = turn.frames
      .filter((frame) => frame?.type === "message_delta" || frame?.type === "message")
      .map((frame) => (typeof frame?.content === "string" ? frame.content : ""))
      .join("");
    return [turn.user?.text ?? "", answer].filter(Boolean);
  });
}
