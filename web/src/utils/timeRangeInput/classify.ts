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

import { rangeDrafts, singleDrafts, type Env } from "./combine";
import {
  epochUs,
  scanDateMath,
  scanEpoch,
  scanIso,
  scanStamp,
  scanZone,
  type Scanned,
} from "./machine";
import type { Normalized } from "./normalize";
import {
  lexiconAt,
  marksOn,
  newScan,
  phraseOutcome,
  pointHits,
  rangeOutcome,
  pointDrafts,
  wordAt,
  type Scan,
} from "./phrases";
import { countCompletions, shorthandOutcome } from "./shorthand";
import type { Alt, ClockValue, Draft, Outcome, Point } from "./types";

// The text starts with `{`, so any JSON it holds is an object; it must have exactly the two keys.
function copyPayload(text: string): Outcome {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text);
  } catch {
    value = {};
  }
  const { start_date: start, end_date: end } = value;
  const safe = (v: unknown): v is number => Number.isSafeInteger(v);
  // `JSON.parse` keeps the last of two equal keys and rounds fractions, so the text must hold exactly
  // two integer members.
  if (
    !/^\{ ?"[^"]*" ?: ?-?\d+ ?, ?"[^"]*" ?: ?-?\d+ ?\}$/.test(text) ||
    Object.keys(value).sort().join() !== "end_date,start_date" ||
    !safe(start) ||
    !safe(end)
  )
    return { t: "invalid", reason: "unreadable" };
  if (start >= end) return { t: "invalid", reason: start === end ? "zero-length" : "reversed" };
  const draft: Draft = { startUs: start, endUs: end, softEnd: false, kind: "absolute", notes: [] };
  return { t: "drafts", drafts: [draft], form: "copy-payload" };
}

function urlPoint(value: string, env: Env): Alt<Point>[] {
  const whole = <T>(list: Scanned<T>[]): Alt<T>[] =>
    list.filter((s) => s.end === value.length).flatMap((s) => s.alts);
  const epoch = whole(scanEpoch(value, 0));
  if (epoch.length > 0) return epoch;
  const iso = whole(scanIso(value, 0));
  if (iso.length > 0) return iso;
  if (value === "now") return [{ v: { p: "now" } }];
  const math = scanDateMath(value, 0, env.nowUs, env.zone);
  return math && math.end === value.length ? math.alts : [];
}

function urlOutcome(text: string, env: Env): Outcome {
  const at = text.indexOf("?");
  const hash = text.indexOf("#", at);
  const query = at < 0 ? "" : text.slice(at + 1, hash < 0 ? undefined : hash);
  const params = new URLSearchParams(query);
  const [[from, f2], [to, t2], [period, p2]] = ["from", "to", "period"].map((k) =>
    params.getAll(k),
  );
  // A repeated param would leave a value unread.
  if ((f2 ?? t2 ?? p2) !== undefined) return { t: "invalid", reason: "unreadable" };
  if (from && to) {
    const r = rangeDrafts(urlPoint(from, env), urlPoint(to, env), env);
    if (r.drafts.length > 0) return { t: "drafts", drafts: r.drafts, form: "url" };
    return {
      t: "invalid",
      reason: r.zero ? "zero-length" : r.reversed ? "reversed" : "unreadable",
    };
  }
  if (period) {
    const out = shorthandOutcome(period, env, true);
    return out.t === "drafts" ? { ...out, form: "url" } : { t: "invalid", reason: "unreadable" };
  }
  return { t: "invalid", reason: "unreadable" };
}

function bareNumber(text: string, env: Env): Outcome {
  const n = text.length;
  if (n >= 1 && n <= 3 && text[0] !== "0")
    return { t: "incomplete", drafts: countCompletions(Number(text), env) };
  const us = epochUs(text);
  if (us === null) return { t: "invalid", reason: "out-of-range" };
  if (us === undefined) return { t: "invalid", reason: "unreadable" };
  return {
    t: "drafts",
    drafts: singleDrafts([{ v: { p: "instant", us, notes: [] } }], env),
    form: "epoch",
  };
}

// Punctuation that may close a log field: a stamp ends at it before a space, a mark right before it.
const CLOSE = ",;.):]";

// A log line is only its leading seconds stamp with one zone and one am/pm mark; text after it that
// starts with a digit, symbol, zone or pack word goes to the range grammar, never a guess.
function logLine(norm: Normalized, sc: Scan, env: Env): Outcome {
  const line = norm.firstLine;
  const pos = line[0] === "[" ? 1 : 0;
  const gap = (k: number) => k >= line.length || line[k] === " ";
  const token = (k: number) => gap(k) || CLOSE.includes(line[k]);
  // A mark glued to a word character is message text (`pm2`); glued to a sign it may start a range.
  const glued = (k: number) => !token(k) && !wordAt(line, k);
  const was = sc.partial;
  let refused = false;
  const mark = (end: number, c: ClockValue): [number, ClockValue][] =>
    (c.sec ? [end, end + 1] : []).flatMap((p) =>
      p > end && line[end] !== " "
        ? []
        : marksOn(sc, p, c).flatMap(([e, v]): [number, ClockValue][] => {
            refused ||= e <= line.length && (glued(e) || (token(e) && !v));
            return e <= line.length && token(e) && v ? [[e, v]] : [];
          }),
    );
  const hits = scanStamp(sc.text, pos, env.nowUs, env.zone, mark).filter(
    (s) => s.end <= line.length,
  );
  const end = Math.max(-1, ...hits.map((s) => s.end));
  const alts = hits.filter((s) => s.end === end).flatMap((s) => s.alts);
  const alone = norm.text.length === end;
  const timed = alts.length > 0 && alts.every((a) => "clock" in a.v && a.v.clock?.sec);
  const close = end + (CLOSE.includes(line[end]) ? 1 : 0);
  const rest = close + (line[close] === " " ? 1 : 0);
  const marks = marksOn(sc, rest, { h: 1, mi: 0, s: 0, us: 0, word: false });
  const message = marks.some(([e]) => !token(e) && !glued(e));
  const open =
    !timed ||
    !gap(close) ||
    /^([+/]? ?\p{Nd}[^]*|[^\p{L}\p{N}]+)$/u.test(line.slice(rest)) ||
    lexiconAt(sc, rest) ||
    scanZone(line, rest + ("([".includes(line[rest]) ? 1 : 0)).length > 0 ||
    (!message && pointHits(sc, rest).length > 0);
  sc.partial = was;
  // Only a seconds stamp is a log line, so a shorter one alone on its line must not reach the next.
  if (timed ? refused : !alone && line.length === end)
    return { t: "invalid", reason: "unreadable" };
  if (open) return { t: "none" };
  const drafts = singleDrafts(alts, env);
  if (alone) return { t: "drafts", drafts, form: "iso" };
  for (const d of drafts) d.notes = [...d.notes, { kind: "log-line" }];
  return { t: "drafts", drafts, form: "log-line" };
}

/** Runs the §4.2 steps in order; the first step that claims the input is final. */
export function classify(norm: Normalized, env: Env): { outcome: Outcome; scan: Scan } {
  const text = norm.text;
  const sc = newScan(text, norm.fold, env);
  if (text.startsWith("{")) return { outcome: copyPayload(text), scan: sc };
  if (norm.url) return { outcome: urlOutcome(text, env), scan: sc };
  const steps: (() => Outcome)[] = [
    () => logLine(norm, sc, env),
    () => rangeOutcome(sc),
    () => (/^\d+$/.test(text) ? bareNumber(text, env) : { t: "none" }),
    () => {
      // A stamp never takes its zone from the next line.
      if (text !== norm.firstLine) return { t: "none" };
      const single = scanStamp(text, 0, env.nowUs, env.zone).filter((s) => s.end === text.length);
      const drafts = singleDrafts(
        single.flatMap((s) => s.alts),
        env,
      );
      return drafts.length > 0 ? { t: "drafts", drafts, form: "iso" } : { t: "none" };
    },
    () => {
      const out = shorthandOutcome(text, env);
      const orClock = env.pack.hooks.orClock;
      return orClock && out.t === "drafts" && out.form === "shorthand" && !out.why
        ? { ...out, drafts: orClock(out.drafts, () => pointDrafts(sc)) }
        : out;
    },
    () => phraseOutcome(sc),
  ];
  for (const step of steps) {
    const outcome = step();
    if (outcome.t !== "none") return { outcome, scan: sc };
  }
  return { outcome: { t: "none" }, scan: sc };
}
