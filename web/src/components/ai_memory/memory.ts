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

export interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
}

// Past this many line pairs the LCS table would stall the tab, so the middle is shown replaced.
const MAX_DIFF_CELLS = 250_000;

/** A line diff of two texts: shared ends kept, the middle by longest common subsequence. */
export function diffLines(before: string, after: string): DiffLine[] {
  const x = before ? before.split("\n") : [];
  const y = after ? after.split("\n") : [];
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  )
    tail++;
  const same = (lines: string[]) => lines.map((text): DiffLine => ({ kind: "same", text }));
  const middle = diffMiddle(x.slice(head, x.length - tail), y.slice(head, y.length - tail));
  return [...same(x.slice(0, head)), ...middle, ...same(x.slice(x.length - tail))];
}

function diffMiddle(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [
      ...a.map((text): DiffLine => ({ kind: "removed", text })),
      ...b.map((text): DiffLine => ({ kind: "added", text })),
    ];
  }
  const lcs = a.map(() => new Array<number>(b.length + 1).fill(0));
  lcs.push(new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push({ kind: "added", text: b[j++] });
    } else {
      out.push({ kind: "removed", text: a[i++] });
    }
  }
  return out;
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
