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
  newScan,
  phraseOutcome,
  rangeOutcome,
  pointDrafts,
  stampHits,
  UNIVERSAL_JOINS,
  unmarked,
  wordy,
  type Scan,
} from "./phrases";
import { countCompletions, shorthandOutcome } from "./shorthand";
import type { Alt, Draft, Outcome, Point } from "./types";

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
  // `JSON.parse` keeps the last of two equal keys, so a repeated key is refused, not overridden.
  const once = ["start_date", "end_date"].every((k) => text.split(`"${k}"`).length === 2);
  if (
    !once ||
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
  const from = params.get("from");
  const to = params.get("to");
  if (from && to) {
    const r = rangeDrafts(urlPoint(from, env), urlPoint(to, env), env);
    if (r.drafts.length > 0) return { t: "drafts", drafts: r.drafts, form: "url" };
    return {
      t: "invalid",
      reason: r.zero ? "zero-length" : r.reversed ? "reversed" : "unreadable",
    };
  }
  const period = params.get("period");
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

function timed(s: Scanned<Point>): boolean {
  return s.alts.every((a) => a.v.p !== "day");
}

// Only a machine stamp starts a log line: ISO `T`, a clock with seconds, or a CLF stamp.
function machine(line: string, s: Scanned<Point>): boolean {
  const head = line.slice(0, s.end);
  return (
    /^(\d{4}[-/]\d\d[-/]\d\dT|\[?\d\d\/[a-z]{3}\/)[^]*$/i.test(head) ||
    s.alts.every((a) => "clock" in a.v && a.v.clock?.sec)
  );
}

/** A first line that starts with a stamp; a second stamp right after it asks which one. */
function logLine(norm: Normalized, sc: Scan, env: Env): Outcome {
  const line = norm.firstLine;
  // The longest timed stamp that ends at a field boundary; a stamp glued to a word is not one.
  const stampAt = (pos: number) =>
    stampHits(sc, pos, true)
      .filter((s) => timed(s) && (s.end === line.length || line[s.end] === " "))
      .sort((a, b) => b.end - a.end)[0];
  const best = stampAt(0);
  if (!best || !machine(line, best)) return { t: "none" };
  const more = best.end < line.length || norm.text.length > line.length;
  // The first line is a prefix of `text`, and `fold` indexes `text`, so the joins compare folded.
  const tail = (t: string): string => t.slice(best.end + 1, line.length);
  const rest = tail(norm.fold);
  const plain = tail(unmarked(sc));
  // A refused mark after the clock is message text, unless a range join follows it.
  const lead = plain.length - plain.trimStart().length;
  const broken = (k: number) =>
    rangeTail(rest.slice(k), plain.slice(k), tail(norm.text).slice(k), env);
  if (!more || /^ +$/.test(plain) || broken(0) || (lead > 0 && broken(lead))) return { t: "none" };
  const stamps = [best];
  const second = stampAt(best.end + 1);
  if (second) stamps.push(second);
  const drafts = stamps.flatMap((s) => singleDrafts(s.alts, env));
  for (const d of drafts) {
    if (stamps[1]) d.why = "log-stamps";
    d.notes = [...d.notes, { kind: "log-line" }];
  }
  return { t: "drafts", drafts, form: "log-line" };
}

// After `-`, `–` or `/` only stamp characters and marks shaped like an hour, clock or year make a broken
// range; after any other join a tail with a digit does, or one lone word after a word join (`to noon`).
function rangeTail(rest: string, plain: string, raw: string, env: Env): boolean {
  // The word after `{start}` in a range template (`から`, `부터`, `until`) joins a range too.
  const lits = env.pack.rangeTemplates.flatMap((elems) => {
    const at = elems.findIndex((e) => e.k === "slot" && e.s === "start");
    const next = elems[at + 1];
    return at >= 0 && next?.k === "lit" ? next.alts : [];
  });
  return [...env.pack.joins, ...lits, ...UNIVERSAL_JOINS].some((j) => {
    if (
      !rest.startsWith(j) ||
      (wordy(j.charCodeAt(j.length - 1)) && wordy(rest.charCodeAt(j.length)))
    )
      return false;
    const t = rest.slice(j.length).trimStart();
    const from = rest.length - t.length;
    // A stamp's zone suffix (`Europe/Berlin`, `UTC`) is cut off, so it cannot hide a broken range.
    const z = raw.slice(from);
    const at = z.lastIndexOf(" ") + 1;
    const zoned = at > 0 && scanZone(z, at).some((x) => x.end === z.length);
    const u = plain.slice(from, zoned ? from + at - 1 : undefined).trim();
    const shaped = /^(\d{1,2}([: ].*)?|\d{4}(-.*)?)?$/.test(u);
    const stamp = /^[\d:+.tz -]*$/.test(u);
    // The only joins that also separate log fields (`<stamp> - 200`); every other join is a range join.
    if ("-–".includes(j)) return shaped && stamp;
    const word = wordy(j.charCodeAt(0)) && /^\p{L}+$/u.test(t);
    return j === "/" ? stamp : t === "" || word || !/^\D*$/.test(t);
  });
}

/** Runs the §4.2 steps in order; the first step that claims the input is final. */
export function classify(norm: Normalized, env: Env): { outcome: Outcome; scan: Scan } {
  const text = norm.text;
  const sc = newScan(text, norm.fold, env);
  if (text.startsWith("{")) return { outcome: copyPayload(text), scan: sc };
  if (/^(https?:\/\/|\?)[^]*$/i.test(text)) return { outcome: urlOutcome(text, env), scan: sc };
  const steps: (() => Outcome)[] = [
    () => rangeOutcome(sc),
    () => (/^\d+$/.test(text) ? bareNumber(text, env) : { t: "none" }),
    () => {
      const single = scanStamp(text, 0, env.nowUs, env.zone).filter((s) => s.end === text.length);
      const drafts = singleDrafts(
        single.flatMap((s) => s.alts),
        env,
      );
      return drafts.length > 0 ? { t: "drafts", drafts, form: "iso" } : { t: "none" };
    },
    () => logLine(norm, sc, env),
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
