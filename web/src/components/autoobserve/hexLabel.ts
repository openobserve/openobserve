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
// Whole sizes, so one map never mixes 12 with an off-scale 10.5.
const FONT_STEP = 1;
const ELLIPSIS = "…";
// A 1-2 character line reads as a typo ("svc-" over "e", demo bug 7), so every wrapped line keeps 3.
const MIN_PART = 3;

// Coverage labels join a name and its place ("svc-a · ns-b"); a line never ends on the joiner.
const PLACE = " · ";

const places = (name: string) =>
  name.split(PLACE).map((part, i, all) => (i < all.length - 1 ? `${part}${PLACE}` : part));

// Hyphen- or underscore-separated parts of the name, each keeping its separator; a place is never split.
const segments = (name: string) =>
  places(name).flatMap((part, i) => (i ? [part] : (part.match(/[^-_]+[-_]*|[-_]+/g) ?? [part])));

const visible = (line: string) => line.replace(/[-_\s·]/g, "").length;

const unjoin = (line: string) => (line.endsWith(PLACE) ? line.slice(0, -PLACE.length) : line);

// Every way to group the parts into at most `max` consecutive lines, none of them a stub.
const groupings = (parts: string[], max: number): string[][] => {
  const out: string[][] = [];
  const cuts = parts.length - 1;
  for (let mask = 0; mask < 1 << cuts; mask++) {
    const lines = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
      if (mask & (1 << (i - 1))) lines.push(parts[i]);
      else lines[lines.length - 1] += parts[i];
    }
    if (lines.length > max) continue;
    if (lines.length === 1 || lines.every((l) => visible(l) >= MIN_PART))
      out.push(lines.map(unjoin));
  }
  return out;
};

// Fewest lines that fit, most balanced among those; otherwise the narrowest grouping.
const best = (name: string, font: number, max: number, room: number, measure: MeasureText) => {
  const scored = (parts: string[]) =>
    groupings(parts, max).map((lines) => ({
      lines,
      wide: Math.max(...lines.map((l) => measure(l, font))),
    }));
  const pick = (fits: { lines: string[]; wide: number }[]) =>
    fits.sort((a, b) => a.lines.length - b.lines.length || a.wide - b.wide)[0];
  // Name and place stay whole whenever they fit, as m1 draws them.
  const whole = scored(places(name)).filter((g) => g.wide <= room);
  if (whole.length) return pick(whole);
  const all = scored(segments(name));
  const fits = all.filter((g) => g.wide <= room);
  if (!fits.length) return all.sort((a, b) => a.wide - b.wide)[0];
  return pick(fits);
};

const shorten = (text: string, font: number, room: number, measure: MeasureText) => {
  if (measure(text, font) <= room) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const cut = `${text.slice(0, n)}${ELLIPSIS}`;
    if (measure(cut, font) <= room) return cut;
  }
  return "";
};

// The name at exactly this size: wrapped at its own separators, then cut with an ellipsis.
const fitAt = (
  name: string,
  room: number,
  height: number,
  size: number,
  measure: MeasureText,
): HexLabel | null => {
  const max = Math.floor(height / (size * LINE_HEIGHT));
  if (max < 1) return null;
  const fit = best(name, size, max, room, measure);
  if (fit.wide <= room) return { lines: fit.lines, font: size };
  const lines = fit.lines.map((l) => shorten(l, size, room, measure)).filter(Boolean);
  return lines.length ? { lines, font: size } : null;
};

// Wraps only at the name's own separators; one font step down, then an ellipsis.
export const fitLabel = (
  name: string,
  room: number,
  height: number,
  font: number,
  measure: MeasureText,
): HexLabel | null => {
  const base = Math.max(MIN_FONT, Math.floor(font));
  const smaller = Math.max(MIN_FONT, base - FONT_STEP);
  for (const size of [base, smaller]) {
    const max = Math.floor(height / (size * LINE_HEIGHT));
    if (max < 1) return null;
    const fit = best(name, size, max, room, measure);
    if (fit.wide <= room) return { lines: fit.lines, font: size };
  }
  return fitAt(name, room, Math.max(height, smaller * LINE_HEIGHT), smaller, measure);
};

/** Every hex's label at one size: the smallest any of them needs, so a map never mixes two. */
export const fitLabels = (
  names: string[],
  room: number,
  height: number,
  font: number,
  measure: MeasureText,
): (HexLabel | null)[] => {
  const natural = names.map((name) => fitLabel(name, room, height, font, measure));
  const sizes = natural.flatMap((label) => (label ? [label.font] : []));
  const size = Math.min(...sizes);
  if (!sizes.length || sizes.every((s) => s === size)) return natural;
  return names.map((name) => fitAt(name, room, height, size, measure));
};

// Smallest hex worth labelling: about six average characters at the minimum font.
export const canLabel = (room: number, measure: MeasureText) => room >= measure("abcdef", MIN_FONT);
