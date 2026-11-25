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

import { EN_US_TIME_RANGE_PACK, loadTimeRangeLocale } from "../index";
import type { ParseContext, TimeRangePack, TimeRangeReading, TimeRangeLocale } from "../types";

const HALF_WINDOW_US = 300_000_000;

export interface CorpusRow {
  id: string;
  locale: string;
  input?: string;
  input_gen?: { parts: { text: string; repeat: number }[] };
  now: string;
  zone: string;
  expected: Expected;
  category: string;
  note: string;
  uncertain: boolean;
  browser_zone?: string;
  browser_locale?: string;
}

export interface Span {
  start: string;
  end: string;
  notes?: { kind: string; keptFromUs: number }[];
}

export type Expected =
  | Span
  | { state: "ambiguous"; readings: Span[] }
  | { state: "invalid" }
  | { state: "incomplete" }
  | { state: "blocked"; reason: string; reading: Span; fix: Span | null };

export const LOCALE_KEYS: Record<string, TimeRangeLocale> = {
  und: "en-us",
  "en-US": "en-us",
  "ar-SA": "ar",
  "zh-CN": "zh-cn",
  "tr-TR": "tr-turk",
  "de-DE": "de",
  "es-ES": "es",
  "fr-FR": "fr",
  "it-IT": "it",
  "ja-JP": "ja",
  "ko-KR": "ko",
  "nl-NL": "nl",
  "pt-PT": "pt",
  "zh-TW": "zh-tw",
  "ru-RU": "ru",
  "pl-PL": "pl",
  "vi-VN": "vi",
  "th-TH": "th",
};

export const ALL_LOCALES: TimeRangeLocale[] = Object.values(LOCALE_KEYS).filter(
  (v, i, a) => a.indexOf(v) === i,
);

/** ISO with offset to µs, keeping up to 6 fraction digits (nanoseconds truncate). */
export function isoUs(iso: string): number {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      iso,
    );
  if (!m) throw new Error(`bad iso ${iso}`);
  const [, y, mo, d, h, mi, s, frac, off] = m;
  const base =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) * 1000;
  const us = Number((frac ?? "").padEnd(6, "0").slice(0, 6));
  const offset =
    off === "Z"
      ? 0
      : (off[0] === "-" ? -1 : 1) * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6)));
  return base + us - offset * 60_000_000;
}

export function inputOf(row: CorpusRow): string {
  if (row.input !== undefined) return row.input;
  return (row.input_gen?.parts ?? []).map((p) => p.text.repeat(p.repeat)).join("");
}

export async function packFor(locale: string): Promise<TimeRangePack> {
  const key = LOCALE_KEYS[locale] ?? "en-us";
  return key === "en-us" ? EN_US_TIME_RANGE_PACK : loadTimeRangeLocale(key);
}

export function corpusContext(row: CorpusRow, pack: TimeRangePack): ParseContext {
  return {
    text: inputOf(row),
    nowUs: isoUs(row.now),
    zone: row.zone,
    pack,
    units: ["s", "m", "h", "d", "w", "M"],
    kinds: { relative: true, calendar: true, absolute: true },
    limits: { allowFuture: false },
  };
}

export function matches(r: TimeRangeReading, span: Span): boolean {
  const s = isoUs(span.start);
  const e = isoUs(span.end);
  // An instant is a ±5 min query window whose end policy may clip, but never to or before the instant.
  const window =
    r.startUs === s - HALF_WINDOW_US &&
    r.endUs > s &&
    r.endUs <= s + HALF_WINDOW_US &&
    r.notes.some((n) => n.kind === "instant-window" && n.instantUs === s);
  const exact = r.startUs === s && r.endUs === e;
  const notes = (span.notes ?? []).every((n) =>
    r.notes.some(
      (x) => x.kind === n.kind && x.kind === "partial-retention" && x.keptFromUs === n.keptFromUs,
    ),
  );
  return (exact || (s === e && window)) && notes;
}

export function baseContext(
  pack: TimeRangePack,
  text: string,
  nowIso = "2026-11-17T12:00:00Z",
  zone = "Europe/Berlin",
): ParseContext {
  return {
    text,
    nowUs: isoUs(nowIso),
    zone,
    pack,
    units: ["s", "m", "h", "d", "w", "M"],
    kinds: { relative: true, calendar: true, absolute: true },
    limits: { allowFuture: false },
  };
}
