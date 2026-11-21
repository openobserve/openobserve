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
  if (Object.keys(value).sort().join() !== "end_date,start_date" || !safe(start) || !safe(end))
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

/** A first line that starts with a stamp; a second stamp right after it asks which one. */
function logLine(norm: Normalized, sc: Scan, env: Env): Outcome {
  const line = norm.firstLine;
  const stampAt = (pos: number) =>
    stampHits(sc, pos, true)
      .filter((s) => s.end <= line.length)
      .sort((a, b) => b.end - a.end)[0];
  const best = stampAt(0);
  if (!best) return { t: "none" };
  const more = best.end === line.length ? norm.text.length > line.length : line[best.end] === " ";
  // The first line is a prefix of `text`, and `fold` indexes `text`, so the joins compare folded.
  const tail = (t: string): string => t.slice(best.end + 1, line.length);
  const rest = tail(unmarked(sc));
  // Only a timed machine stamp (ISO `T` or seconds) starts a log line; a lone mark is never its message.
  const machine = line[10] === "T" || /^[^:]*:\d\d:\d.*$/.test(line.slice(0, best.end));
  if (!more || !machine || /^ +$/.test(rest) || rangeTail(rest, tail(norm.text), env))
    return { t: "none" };
  const stamps = [best];
  const second = stampAt(best.end + 1);
  if (second && (second.end === line.length || line[second.end] === " ")) stamps.push(second);
  const drafts = stamps.flatMap((s) => singleDrafts(s.alts, env));
  for (const d of drafts) {
    if (stamps[1]) d.why = "log-stamps";
    d.notes = [...d.notes, { kind: "log-line" }];
  }
  return { t: "drafts", drafts, form: "log-line" };
}

// After a log separator (or `/`) only stamp characters and marks, shaped like an hour, clock or year
// after `-`, make a broken range; after a word join (`to`, `bis`, `から`) any tail holding a digit does.
function rangeTail(rest: string, raw: string, env: Env): boolean {
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
    // A stamp's zone suffix (`Europe/Berlin`, `UTC`) is cut off, so it cannot hide a broken range.
    const z = raw.slice(rest.length - t.length);
    const at = z.lastIndexOf(" ") + 1;
    const zoned = at > 0 && scanZone(z, at).some((x) => x.end === z.length);
    const u = (zoned ? t.slice(0, at - 1) : t).trim();
    const shaped = /^(\d{1,2}(:.*)?|\d{4}(-.*)?)?$/.test(u);
    const stamp = /^[\d:+.tz -]*$/.test(u);
    // The only joins that also separate log fields (`<stamp> - 200`); every other join is a range join.
    if ("-–".includes(j)) return shaped && stamp;
    return j === "/" ? stamp : t === "" || !/^\D*$/.test(t);
  });
}

/** Runs the §4.2 steps in order; the first step that claims the input is final. */
export function classify(norm: Normalized, env: Env): { outcome: Outcome; scan: Scan } {
  const text = norm.text;
  const sc = newScan(text, norm.fold, env);
  if (text.startsWith("{")) return { outcome: copyPayload(text), scan: sc };
  if (/^(https?:\/\/|\?)[^]*$/.test(norm.fold)) return { outcome: urlOutcome(text, env), scan: sc };
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
