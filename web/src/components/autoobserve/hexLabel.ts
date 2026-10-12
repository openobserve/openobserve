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

export interface HexLabel {
  lines: string[];
  font: number;
}

export type MeasureText = (text: string, font: number) => number;

const MAX_FONT = 13;
const MIN_FONT = 9;
const MIN_VISIBLE = 6;
const LINE_HEIGHT = 1.15;
const ELLIPSIS = "…";

// Every way to cut the name into two lines; separators stay at the end of line one.
const splits = (name: string): [string, string][] => {
  const at = [...name].flatMap((c, i) => (c === "-" || c === "_" ? [i + 1] : []));
  const cuts = at.filter((i) => i > 0 && i < name.length);
  if (cuts.length) return cuts.map((i): [string, string] => [name.slice(0, i), name.slice(i)]);
  return Array.from({ length: name.length - 3 }, (_, k): [string, string] => [
    `${name.slice(0, k + 2)}-`,
    name.slice(k + 2),
  ]);
};

const balanced = (name: string, font: number, measure: MeasureText) =>
  splits(name)
    .map((pair) => ({ pair, wide: Math.max(...pair.map((l) => measure(l, font))) }))
    .sort((a, b) => a.wide - b.wide)[0];

const shorten = (text: string, font: number, room: number, measure: MeasureText) => {
  for (let n = text.length - 1; n > 0; n--) {
    const cut = `${text.slice(0, n)}${ELLIPSIS}`;
    if (measure(cut, font) <= room) return cut;
  }
  return "";
};

// Largest font from 13 to 9 at which the name fits whole on one or two balanced lines; otherwise a 9px cut.
export const fitLabel = (
  name: string,
  room: number,
  height: number,
  measure: MeasureText,
  allowCut: boolean,
): HexLabel | null => {
  for (let font = MAX_FONT; font >= MIN_FONT; font--) {
    if (measure(name, font) <= room && font * LINE_HEIGHT <= height) return { lines: [name], font };
    const two = name.length > 3 ? balanced(name, font, measure) : undefined;
    if (two && two.wide <= room && 2 * font * LINE_HEIGHT <= height)
      return { lines: two.pair, font };
  }
  if (!allowCut || 2 * MIN_FONT * LINE_HEIGHT > height) return null;
  const two = balanced(name, MIN_FONT, measure);
  const [first, second] = two?.pair ?? [name, ""];
  const lines = [first, second]
    .map((l) => (measure(l, MIN_FONT) <= room ? l : shorten(l, MIN_FONT, room, measure)))
    .filter(Boolean);
  const visible = lines.join("").replace(ELLIPSIS, "").length;
  return visible >= MIN_VISIBLE ? { lines, font: MIN_FONT } : null;
};

// Smallest hex worth labelling: about six average characters at the minimum font.
export const canLabel = (room: number, measure: MeasureText) => room >= measure("abcdef", MIN_FONT);
