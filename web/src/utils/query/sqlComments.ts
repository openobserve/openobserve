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

export function stripCommentLines(raw: string): string {
  const commentStarts = new Set<number>();
  let i = 0;
  while (i < raw.length) {
    const end = maskedSpanEnd(raw, i);
    if (end === null) {
      i++;
    } else {
      if (raw.startsWith("--", i)) commentStarts.add(i);
      i = end;
    }
  }
  let offset = 0;
  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    if (!commentStarts.has(offset + line.length - line.trimStart().length)) kept.push(line);
    offset += line.length + 1;
  }
  return kept.join("\n");
}

export function maskedSpanEnd(raw: string, i: number): number | null {
  if (raw.startsWith("--", i)) {
    const newline = raw.indexOf("\n", i);
    return newline < 0 ? raw.length : newline;
  }
  if (raw.startsWith("/*", i)) {
    const close = raw.indexOf("*/", i + 2);
    return close < 0 ? raw.length : close + 2;
  }
  if (raw[i] !== "'" && raw[i] !== '"') return null;
  return quotedSpanEnd(raw, i);
}

// A doubled quote is an escaped quote inside the literal, not its end.
function quotedSpanEnd(raw: string, i: number): number {
  const quote = raw[i];
  let j = i + 1;
  while (j < raw.length) {
    if (raw[j] !== quote) j++;
    else if (raw[j + 1] === quote) j += 2;
    else return j + 1;
  }
  return raw.length;
}
