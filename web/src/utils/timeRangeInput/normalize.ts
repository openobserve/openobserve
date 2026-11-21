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

import type { PackHooks } from "./packs/schema";

export type FoldScript = "latin" | "arabic" | "other";

export interface Normalized {
  text: string;
  fold: string;
  firstLine: string;
  /** The raw text starts with an ASCII URL scheme or a query, so a fullwidth look-alike is no URL. */
  url: boolean;
}

export const MAX_CODE_POINTS = 512;
const MAX_CODE_UNITS = 1024;

// Zero code points of the decimal digit sets people type in; each set runs zero to nine.
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66,
  0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810, 0xff10,
];
const SPACES = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
const DASHES = new Set([0x2212, 0xfe63, 0xff0d]);
const TILDES = new Set([0x301c, 0xff5e]);
const APOSTROPHES = new Set([0x2018, 0x2019, 0x02bc]);

function isSpace(cp: number): boolean {
  return SPACES.has(cp) || (cp >= 0x2000 && cp <= 0x200a);
}

function isMark(cp: number): boolean {
  return (
    (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff)
  );
}

function mapChar(cp: number): string {
  for (const zero of DIGIT_ZEROS) if (cp >= zero && cp <= zero + 9) return String(cp - zero);
  if (DASHES.has(cp)) return "-";
  if (TILDES.has(cp)) return "~";
  if (APOSTROPHES.has(cp)) return "'";
  if (isSpace(cp)) return " ";
  return String.fromCodePoint(cp);
}

// An invisible character beside a space or an end is dropped; inside a token it stays and is refused.
function mapped(nfkc: string): string {
  let out = "";
  let space = false;
  let hidden = "";
  for (const ch of nfkc) {
    const m = mapChar(ch.codePointAt(0) ?? 0);
    if (/^[^\P{Cf}\p{Bidi_C}]$/u.test(m)) {
      hidden += m;
      continue;
    }
    if (m === " ") space = out.length > 0;
    else {
      out += (space ? " " : out && hidden) + m;
      space = false;
    }
    hidden = "";
  }
  return out;
}

function foldChar(
  ch: string,
  bcp47: string,
  script: FoldScript,
  extra?: (ch: string) => string,
): string {
  let lower = ch.toLocaleLowerCase(bcp47);
  if (lower.length !== ch.length) lower = ch.toLowerCase();
  if (lower.length !== ch.length) lower = ch;
  if (script === "latin") {
    const parts = [...lower.normalize("NFD")];
    const marks = parts.slice(1).every((p) => isMark(p.codePointAt(0) ?? 0));
    if (parts.length > 1 && marks && parts[0].length === ch.length) lower = parts[0];
  }
  return extra ? extra(lower) : lower;
}

/** Each code point maps to one of the same UTF-16 length, so `fold` indexes `text` exactly. */
export function foldText(
  text: string,
  bcp47: string,
  script: FoldScript,
  extra?: (ch: string) => string,
): string {
  const whole = text.toLocaleLowerCase(bcp47);
  let out = "";
  let at = 0;
  for (const ch of text) {
    const lower = whole.length === text.length ? whole.slice(at, at + ch.length) : "";
    at += ch.length;
    const c = ch.charCodeAt(0);
    if (c < 0x80 && lower.length === 1 && lower.charCodeAt(0) < 0x80) out += lower;
    else out += foldChar(ch, bcp47, script, extra);
  }
  return out;
}

export function codePointLength(s: string): number {
  return [...s].length;
}

export function normalize(
  raw: string,
  bcp47: string,
  script: FoldScript,
  hooks: PackHooks = {},
): Normalized | "too-long" | "empty" {
  // Over 1024 code units is always over 512 code points, so a huge paste is never walked.
  if (raw.length > MAX_CODE_UNITS || codePointLength(raw) > MAX_CODE_POINTS) return "too-long";
  const clean = (s: string): string => hooks.clean?.(s) ?? s;
  const nfkc = clean(raw.normalize("NFKC"));
  if (nfkc.length > MAX_CODE_UNITS) return "too-long";
  const text = mapped(nfkc);
  if (text.length === 0) return "empty";
  return {
    text,
    fold: foldText(text, bcp47, script, hooks.fold),
    firstLine:
      [...raw]
        .map((c) => ("\r\u2028\u2029".includes(c) ? "\n" : c))
        .join("")
        .split("\n")
        .map((l) => mapped(clean(l.normalize("NFKC"))))
        .find((l) => l.length > 0) ?? "",
    url: /^\s*(https?:\/\/|[?？])[^]*$/i.test(raw),
  };
}

/** For each text code point, the raw code point it came from, via an LCS of per-character maps; -1 if none. */
export function textToRaw(raw: string, text: string): { toRaw: number[]; starts: number[] } {
  const r = [...raw];
  const t = [...text];
  const starts: number[] = [];
  let unit = 0;
  for (const ch of r) {
    starts.push(unit);
    unit += ch.length;
  }
  starts.push(unit);
  const n = r.length;
  const m = t.length;
  const keys = r.map((ch) =>
    [...ch.normalize("NFKC")].map((c) => mapChar(c.codePointAt(0) ?? 0)).join(""),
  );
  const toRaw = new Array<number>(m).fill(-1);
  let i = 0;
  let j = 0;
  // Usually `text` is the per-character maps in order, so a linear greedy walk is the LCS, even when
  // one raw character expands (`ﬀ` to `ff`).
  for (; i < n && j < m; i++) {
    const key = [...keys[i]];
    if (key.length > 0 && key.every((c, x) => t[j + x] === c)) for (const _ of key) toRaw[j++] = i;
  }
  if (j === m) return { toRaw, starts };
  toRaw.fill(-1);
  // The trace only asks whether skipping raw i keeps the LCS, so one bit per cell replaces the table.
  const w = (m >> 5) + 1;
  const skip = new Int32Array(n * w);
  let below = new Uint16Array(m + 1);
  let row = new Uint16Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      row[j] = keys[i] === t[j] ? below[j + 1] + 1 : Math.max(below[j], row[j + 1]);
      if (below[j] === row[j]) skip[i * w + (j >> 5)] |= 1 << (j & 31);
    }
    [below, row] = [row, below];
  }
  i = 0;
  j = 0;
  while (i < n && j < m) {
    if (keys[i] === t[j]) toRaw[j++] = i++;
    else if (skip[i * w + (j >> 5)] & (1 << (j & 31))) i++;
    else j++;
  }
  return { toRaw, starts };
}

/** Raw code-unit span for text code units [unitFrom, unitTo); unmatched runs take their enclosing raw span. */
export function rawSpan(
  raw: string,
  text: string,
  unitFrom: number,
  unitTo: number,
): [number, number] {
  const { toRaw, starts } = textToRaw(raw, text);
  const from = codePointLength(text.slice(0, unitFrom));
  const to = codePointLength(text.slice(0, unitTo));
  const n = starts.length - 1;
  let a = 0;
  for (let x = Math.min(from, toRaw.length - 1); x >= 0; x--) {
    if (toRaw[x] >= 0) {
      a = toRaw[x] + (x < from ? 1 : 0);
      break;
    }
  }
  let b = n;
  for (let x = Math.max(to - 1, 0); x < toRaw.length; x++) {
    if (toRaw[x] >= 0) {
      b = toRaw[x] + (x === to - 1 ? 1 : 0);
      break;
    }
  }
  return [starts[Math.min(a, n)], starts[Math.min(Math.max(a, b), n)]];
}
