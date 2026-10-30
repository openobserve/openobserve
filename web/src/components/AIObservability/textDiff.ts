// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffSide {
  lineNumber: number;
  segments: DiffSegment[];
}

/** One aligned row: `null` on a side means that side has no line here. */
export interface DiffRow {
  changed: boolean;
  left: DiffSide | null;
  right: DiffSide | null;
}

type Op<T> = { kind: "same"; a: T; b: T } | { kind: "removed"; a: T } | { kind: "added"; b: T };

// ponytail: O(n*m) LCS table, fine for prompt-sized text; swap in Myers diff if inputs reach thousands of lines.
function lcs<T>(a: T[], b: T[]): Op<T>[] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const ops: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) ops.push({ kind: "same", a: a[i++], b: b[j++] });
    else if (table[i + 1][j] >= table[i][j + 1]) ops.push({ kind: "removed", a: a[i++] });
    else ops.push({ kind: "added", b: b[j++] });
  }
  while (i < a.length) ops.push({ kind: "removed", a: a[i++] });
  while (j < b.length) ops.push({ kind: "added", b: b[j++] });
  return ops;
}

function wordSegments(before: string, after: string): [DiffSegment[], DiffSegment[]] {
  const left: DiffSegment[] = [];
  const right: DiffSegment[] = [];
  for (const op of lcs(before.split(/(\s+)/), after.split(/(\s+)/))) {
    if (op.kind !== "added") left.push({ text: op.a, changed: op.kind === "removed" });
    if (op.kind !== "removed") right.push({ text: op.b, changed: op.kind === "added" });
  }
  return [left, right];
}

/** Line diff of two texts, with word-level highlights on lines that were edited in place. */
export function diffLines(before: string, after: string): DiffRow[] {
  const ops = lcs(before.split("\n"), after.split("\n"));
  const rows: DiffRow[] = [];
  let leftLine = 0;
  let rightLine = 0;
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.kind === "same") {
      rows.push({
        changed: false,
        left: { lineNumber: ++leftLine, segments: [{ text: op.a, changed: false }] },
        right: { lineNumber: ++rightLine, segments: [{ text: op.b, changed: false }] },
      });
      index++;
      continue;
    }
    // Pair a run of removed lines with the added run after it, so an edited line shows side by side.
    const removed: string[] = [];
    const added: string[] = [];
    while (index < ops.length && ops[index].kind !== "same") {
      const change = ops[index++];
      if (change.kind === "removed") removed.push(change.a);
      else if (change.kind === "added") added.push(change.b);
    }
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const before = removed[k];
      const after = added[k];
      const [left, right] =
        before !== undefined && after !== undefined
          ? wordSegments(before, after)
          : [[{ text: before ?? "", changed: true }], [{ text: after ?? "", changed: true }]];
      rows.push({
        changed: true,
        left: before === undefined ? null : { lineNumber: ++leftLine, segments: left },
        right: after === undefined ? null : { lineNumber: ++rightLine, segments: right },
      });
    }
  }
  return rows;
}

export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  return {
    added: rows.filter((row) => row.changed && row.right).length,
    removed: rows.filter((row) => row.changed && row.left).length,
  };
}
