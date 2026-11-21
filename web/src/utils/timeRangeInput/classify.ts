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
  pointHits,
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
  // `JSON.parse` keeps the last of two equal keys, so the text must hold exactly two members.
  if (
    !/^\{ ?"[^"]*" ?:[^,}]*, ?"[^"]*" ?:[^,}]*\}$/.test(text) ||
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

// Punctuation after a mark (`PM,`, `PM:`) binds it, since reading it as message text shifts 12 h; a
// glued word character (`PM_x`, `pm2`) or a sign that may start an offset or range end does not.
function bound(line: string, i: number): boolean {
  return i >= line.length || !/^[\p{L}\p{N}_+\-–/]$/u.test(line[i]);
}

/** A first line that starts with a stamp; a second stamp right after it asks which one. */
function logLine(norm: Normalized, sc: Scan, env: Env): Outcome {
  const line = norm.firstLine;
  // The longest timed stamp, unless glued to more text; then only a shorter one before a space.
  const stampAt = (pos: number) =>
    stampHits(sc, pos, true)
      .filter((s) => timed(s) && s.end <= line.length)
      .sort((a, b) => b.end - a.end)
      .find((s, i) => (i ? !line[s.end]?.trim() : bound(line, s.end)));
  const best = stampAt(0);
  if (!best || !machine(line, best)) return { t: "none" };
  const more = best.end < line.length || norm.text.length > line.length;
  // A field ends at a space, or at a punctuation mark and the space after it.
  const skip = (k: number): number => {
    if (line[k]?.trim() && bound(line, k)) k++;
    return line[k] === " " ? k + 1 : k;
  };
  const from = skip(best.end);
  const plain = unmarked(sc);
  // A refused mark after the clock is message text, unless a range join follows it or its zone.
  let mark = from;
  while (line[mark]?.trim() && plain[mark] === " ") mark++;
  // Probing the tail for a range end must not leave the scan's partial flag set.
  const was = sc.partial;
  const broken = [from, skip(mark)].some((k) =>
    [k, skip(Math.max(k, ...scanZone(line, k).map((x) => x.end)))].some((at) =>
      rangeTail(sc, at, line.length, plain, env),
    ),
  );
  sc.partial = was;
  if (!more || /^ +$/.test(plain.slice(from, line.length)) || broken) return { t: "none" };
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
// range; after any other join a digit or a word that starts a time does (`to noon`, `到中午`).
function rangeTail(sc: Scan, at: number, end: number, plain: string, env: Env): boolean {
  const rest = sc.fold.slice(at, end);
  // The word after `{start}` in a range template (`から`, `부터`, `until`) joins a range too.
  const lits = env.pack.rangeTemplates.flatMap((elems) => {
    const i = elems.findIndex((e) => e.k === "slot" && e.s === "start");
    const next = elems[i + 1];
    return i >= 0 && next?.k === "lit" ? next.alts : [];
  });
  return [...env.pack.joins, ...lits, ...UNIVERSAL_JOINS].some((j) => {
    // A join spelled inside a mark (es `a` in `a.m.`) is no join; `unmarked` blanked it.
    if (
      !rest.startsWith(j) ||
      plain[at] === " " ||
      (wordy(j.charCodeAt(j.length - 1)) && wordy(rest.charCodeAt(j.length)))
    )
      return false;
    const t = rest.slice(j.length).trimStart();
    const from = at + rest.length - t.length;
    // A trailing zone suffix (`Europe/Berlin`, `UTC`, `25:00UTC`) is cut off, so it cannot hide a range.
    const z = sc.text.slice(from, end);
    const cut = z
      .split("")
      .findIndex(
        (_, k) =>
          " 0123456789".includes(z[k - 1]) && scanZone(z, k).some((x) => x.end === z.length),
      );
    const u = plain.slice(from, cut > 0 ? from + cut : end).trim();
    const shaped = /^(\d{1,2}(:.*| +[+-].*)?|\d{4}(-.*)?)?$/.test(u);
    const stamp = /^[\d:+.tz -]*$/.test(u);
    // The only joins that also separate log fields (`<stamp> - 200`); every other join is a range join.
    if ("-–".includes(j)) return shaped && stamp;
    // A word starts a time when it starts a point or is a mark that `unmarked` blanked.
    return j === "/"
      ? stamp
      : t === "" || !/^\D*$/.test(t) || plain[from] === " " || pointHits(sc, from).length > 0;
  });
}

/** Runs the §4.2 steps in order; the first step that claims the input is final. */
export function classify(norm: Normalized, env: Env): { outcome: Outcome; scan: Scan } {
  const text = norm.text;
  const sc = newScan(text, norm.fold, env);
  if (text.startsWith("{")) return { outcome: copyPayload(text), scan: sc };
  if (norm.url) return { outcome: urlOutcome(text, env), scan: sc };
  const steps: (() => Outcome)[] = [
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
