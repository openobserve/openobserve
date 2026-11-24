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

import type { MemoryEdit, PendingEdit } from "@/services/ai_memory";

/** Pending edits that propose the same change to the same memory, shown as one row. */
export interface PendingGroup {
  key: string;
  scope: PendingEdit["scope"];
  scope_key: string;
  edits: MemoryEdit[];
  /** A person's proposed whole text; `undefined` for edits. */
  content?: string;
  items: PendingEdit[];
  flags: PendingEdit["flags"];
}

export function groupPending(pending: PendingEdit[]): PendingGroup[] {
  const groups = new Map<string, PendingGroup>();
  for (const item of pending) {
    const key = JSON.stringify([item.scope, item.scope_key, item.edits ?? item.content ?? null]);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      group.flags = [...new Set([...group.flags, ...item.flags])];
    } else {
      groups.set(key, {
        key,
        scope: item.scope,
        scope_key: item.scope_key,
        edits: item.edits ?? [],
        content: item.edits ? undefined : (item.content ?? undefined),
        items: [item],
        flags: [...item.flags],
      });
    }
  }
  return [...groups.values()];
}

/** The old and new text of a change, for a diff: proposed edits as their removed and added lines. */
export function editsDiff(edits: MemoryEdit[]): { original: string; modified: string } {
  const original: string[] = [];
  const modified: string[] = [];
  for (const e of edits) {
    if ("old" in e) original.push(e.old);
    if ("new" in e) modified.push(e.new);
    if ("text" in e) modified.push(`[${e.section}] ${e.text}`);
  }
  return { original: original.join("\n"), modified: modified.join("\n") };
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/** `user:<id>` and `agent:<session>/<turn>` as people read them. */
export function authorLabel(author: string | null | undefined): string {
  if (!author) return "";
  if (author.startsWith("agent:")) return "AI agent";
  if (author.startsWith("user:")) return author.slice("user:".length);
  return author;
}

export type MemoryLineKind = "saved" | "pending" | "refused";

/** The compact chat line for an `update_memory` result, from the text the tool returns. */
export function memoryLine(
  text: string | undefined,
): { kind: MemoryLineKind; text: string } | null {
  const first = (text ?? "").trim().split("\n")[0]?.trim() ?? "";
  if (!first) return null;
  if (first.startsWith("Saved to") || first.startsWith("Already in")) {
    return { kind: "saved", text: first };
  }
  if (first.startsWith("Sent for approval")) return { kind: "pending", text: "Sent for approval" };
  if (first.startsWith("Not saved")) return { kind: "refused", text: first.split("; ")[0] };
  return null;
}
