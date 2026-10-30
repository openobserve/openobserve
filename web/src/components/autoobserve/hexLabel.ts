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

export const LINE_HEIGHT = 1.15;
const MIN_FONT = 9;
const FONT_STEP = 1.5;
const ELLIPSIS = "…";

// Hyphen- or underscore-separated parts, each keeping its trailing separator.
const segments = (name: string) => name.match(/[^-_]+[-_]*|[-_]+/g) ?? [name];

// Every way to group the parts into at most `max` consecutive lines.
const groupings = (parts: string[], max: number): string[][] => {
  const out: string[][] = [];
  const cuts = parts.length - 1;
  for (let mask = 0; mask < 1 << cuts; mask++) {
    const lines = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
      if (mask & (1 << (i - 1))) lines.push(parts[i]);
      else lines[lines.length - 1] += parts[i];
    }
    if (lines.length <= max) out.push(lines);
  }
  return out;
};

// Fewest lines that fit, most balanced among those; otherwise the narrowest grouping.
const best = (name: string, font: number, max: number, room: number, measure: MeasureText) => {
  const all = groupings(segments(name), max).map((lines) => ({
    lines,
    wide: Math.max(...lines.map((l) => measure(l, font))),
  }));
  const fits = all.filter((g) => g.wide <= room);
  if (!fits.length) return all.sort((a, b) => a.wide - b.wide)[0];
  return fits.sort((a, b) => a.lines.length - b.lines.length || a.wide - b.wide)[0];
};

const shorten = (text: string, font: number, room: number, measure: MeasureText) => {
  if (measure(text, font) <= room) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const cut = `${text.slice(0, n)}${ELLIPSIS}`;
    if (measure(cut, font) <= room) return cut;
  }
  return "";
};

// Wraps only at the name's own separators; one font step down, then an ellipsis.
export const fitLabel = (
  name: string,
  room: number,
  height: number,
  font: number,
  measure: MeasureText,
): HexLabel | null => {
  for (const size of [font, Math.max(MIN_FONT, font - FONT_STEP)]) {
    const max = Math.floor(height / (size * LINE_HEIGHT));
    if (max < 1) return null;
    const fit = best(name, size, max, room, measure);
    if (fit.wide <= room) return { lines: fit.lines, font: size };
  }
  const size = Math.max(MIN_FONT, font - FONT_STEP);
  const max = Math.max(1, Math.floor(height / (size * LINE_HEIGHT)));
  const lines = best(name, size, max, room, measure)
    .lines.map((l) => shorten(l, size, room, measure))
    .filter(Boolean);
  return lines.length ? { lines, font: size } : null;
};

// Smallest hex worth labelling: about six average characters at the minimum font.
export const canLabel = (room: number, measure: MeasureText) => room >= measure("abcdef", MIN_FONT);
