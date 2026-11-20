//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { escapeHtml } from "@/utils/html";

// Theme-aware CSS vars from log-highlighting.css, so both themes share one calm palette.
const SYNTAX_COLORS = {
  key: "var(--log-syntax-key)",
  stringValue: "var(--log-syntax-value)",
  numberValue: "var(--log-syntax-accent)",
  booleanValue: "var(--log-syntax-value)",
  objectValue: "var(--log-syntax-value)",
  arrayValue: "var(--log-syntax-value)",
  nullValue: "var(--log-syntax-value)",
  url: "var(--log-syntax-value)",
  ip: "var(--log-syntax-value)",
  email: "var(--log-syntax-value)",
  timestamp: "var(--log-syntax-value)",
  uuid: "var(--log-syntax-value)",
  path: "var(--log-syntax-value)",
} as const;

export const LIGHT_MODE_COLORS = SYNTAX_COLORS;
export const DARK_MODE_COLORS = SYNTAX_COLORS;

export function getThemeColors(isDark: boolean) {
  return isDark ? DARK_MODE_COLORS : LIGHT_MODE_COLORS;
}

export function findLogKeyRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const tokens = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][\w.-]*/g;
  for (const match of text.matchAll(tokens)) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > 0 && !/[\s{[,(;]/.test(text[start - 1])) continue;
    if (!/^\s*[:=](?!\/\/)/.test(text.slice(end))) continue;
    ranges.push([start, end]);
  }
  return ranges;
}

// Search matches are already split out; intersect key ranges only with the remaining text.
export function renderLogTextWithKeys(
  text: string,
  ranges: Array<[number, number]>,
  offset = 0,
): string {
  let result = "";
  let cursor = 0;
  for (const [from, to] of ranges) {
    if (to <= offset) continue;
    if (from >= offset + text.length) break;
    const start = Math.max(from - offset, 0);
    const end = Math.min(to - offset, text.length);
    result += escapeHtml(text.slice(cursor, start));
    result += `<span class="log-embedded-key">${escapeHtml(text.slice(start, end))}</span>`;
    cursor = end;
  }
  return result + escapeHtml(text.slice(cursor));
}
