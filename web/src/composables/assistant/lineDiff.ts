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

/** Above this many lines on a side the diff is not counted line by line. */
export const MAX_DIFF_LINES = 1_000;

/** One line of the unified diff. */
export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** The unified line diff (longest common subsequence); `null` when a side is too long to count. */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null;
  const width = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i++] });
      j++;
    } else if (
      j < b.length &&
      (i === a.length || lcs[i * width + j + 1] > lcs[(i + 1) * width + j])
    )
      out.push({ kind: "added", text: b[j++] });
    else out.push({ kind: "removed", text: a[i++] });
  }
  return out;
}

/** Lines added and removed, for the diff's one announcement. */
export function diffCounts(
  before: string,
  after: string,
): { added: number; removed: number } | null {
  const lines = diffLines(before, after);
  if (!lines) return null;
  return {
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}
