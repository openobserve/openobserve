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

// follow_ups [..] / follow_ups: [..] / a fenced json block, only as the very end of the text.
const TRAILING =
  /(?:^|\n)[ \t]*(?:```(?:json)?[ \t]*\n)?[ \t]*follow[_-]?ups?[ \t]*:?[ \t]*(\[[\s\S]*\])[ \t]*(?:\n[ \t]*```)?\s*$/i;

/** Splits a trailing `follow_ups [...]` of strings off an answer; anything looser is left as written. */
export function splitFollowUps(text: string): { text: string; items: string[] } {
  const match = TRAILING.exec(text);
  if (!match) return { text, items: [] };
  try {
    const items: unknown = JSON.parse(match[1]);
    if (!Array.isArray(items) || !items.every((item) => typeof item === "string"))
      return { text, items: [] };
    return {
      text: text.slice(0, match.index).trimEnd(),
      items: items.map((i) => i.trim()).filter(Boolean),
    };
  } catch {
    return { text, items: [] };
  }
}
