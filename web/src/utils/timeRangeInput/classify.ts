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
  digitRun,
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
  UNIVERSAL_JOINS,
  wordy,
  type Scan,
} from "./phrases";
import { countCompletions, shorthandOutcome } from "./shorthand";
import type { Alt, Draft, Outcome, Point } from "./types";

// The only joins that also separate log fields (`<stamp> - 200`); every other join is a range join.
const LOG_SEPARATORS = ["-", "–"];

function copyPayload(text: string): Outcome {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { t: "invalid", reason: "unreadable" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { t: "invalid", reason: "unreadable" };
  const keys = Object.keys(value);
  const start: unknown = Reflect.get(value, "start_date");
  const end: unknown = Reflect.get(value, "end_date");
  const exact = keys.length === 2 && keys.includes("start_date") && keys.includes("end_date");
  if (!exact || !Number.isSafeInteger(start) || !Number.isSafeInteger(end))
    return { t: "invalid", reason: "unreadable" };
  if (typeof start !== "number" || typeof end !== "number")
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

/** A first line that starts with a stamp; a second stamp right after it asks which one. */
function logLine(norm: Normalized, env: Env): Outcome {
  const line = norm.firstLine;
  const stamps = scanStamp(line, 0, env.nowUs, env.zone).filter(timed);
  const best = stamps.sort((a, b) => b.end - a.end)[0];
  if (!best) return { t: "none" };
  const more = best.end === line.length ? norm.text.length > line.length : line[best.end] === " ";
  // The first line is a prefix of `text`, and `fold` indexes `text`, so the joins compare folded.
  const tail = (t: string): string => t.slice(best.end + 1, line.length);
  if (!more || rangeTail(tail(norm.fold), tail(norm.text), env)) return { t: "none" };
  const second = scanStamp(line, best.end + 1, env.nowUs, env.zone)
    .filter(timed)
    .sort((a, b) => b.end - a.end)[0];
  const tag = (drafts: Draft[]): Draft[] =>
    drafts.map((d) => ({ ...d, notes: [...d.notes, { kind: "log-line" }] }));
  if (second && (second.end === line.length || line[second.end] === " ")) {
    const drafts = [...singleDrafts(best.alts, env), ...singleDrafts(second.alts, env)];
    return {
      t: "drafts",
      drafts: tag(drafts).map((d) => ({ ...d, why: "log-stamps" })),
      form: "log-line",
      why: "log-stamps",
    };
  }
  return { t: "drafts", drafts: tag(singleDrafts(best.alts, env)), form: "log-line" };
}

// After a log separator (or `/`) only stamp characters, shaped like an hour, clock or year after `-`,
// make a broken range; after a word join (`to`, `bis`, `から`) any tail holding a digit does.
function rangeTail(rest: string, raw: string, env: Env): boolean {
  const joins = [...env.pack.joins, ...templateJoins(env), ...UNIVERSAL_JOINS];
  return joins.some((j) => {
    const word = wordy(j.charCodeAt(j.length - 1));
    if (!rest.startsWith(j) || (word && wordy(rest.charCodeAt(j.length)))) return false;
    const t = rest.slice(j.length).trimStart();
    const n = digitRun(t, 0);
    const shaped =
      t === "" ||
      (n > 0 && n < 3 && (t[n] === ":" || n === t.length)) ||
      (n === 4 && (t.length === 4 || t[4] === "-"));
    const stamp = /^[\d:+.tz -]*$/.test(zoneless(t, raw.slice(rest.length - t.length)));
    if (LOG_SEPARATORS.includes(j)) return shaped && stamp;
    return j === "/" ? stamp : t === "" || !/^\D*$/.test(t);
  });
}

// A stamp's zone suffix (`Europe/Berlin`, `UTC`) is cut off, so it cannot hide a broken range.
function zoneless(t: string, raw: string): string {
  const at = raw.lastIndexOf(" ") + 1;
  const whole = at > 0 && scanZone(raw, at).some((z) => z.end === raw.length);
  return whole ? t.slice(0, at - 1) : t;
}

// The word after `{start}` in a range template (`から`, `부터`, `until`) joins a range too.
function templateJoins(env: Env): string[] {
  return env.pack.rangeTemplates.flatMap((elems) => {
    const at = elems.findIndex((e) => e.k === "slot" && e.s === "start");
    const next = elems[at + 1];
    return at >= 0 && next?.k === "lit" ? next.alts : [];
  });
}

function allDigits(text: string): boolean {
  return text.length > 0 && digitRun(text, 0) === text.length;
}

/** Runs the §4.2 steps in order; the first step that claims the input is final. */
export function classify(norm: Normalized, env: Env): { outcome: Outcome; scan: Scan } {
  const text = norm.text;
  const sc = newScan(text, norm.fold, env);
  const lower = text.toLowerCase();
  if (text.startsWith("{")) return { outcome: copyPayload(text), scan: sc };
  if (lower.startsWith("http://") || lower.startsWith("https://") || text.startsWith("?")) {
    return { outcome: urlOutcome(text, env), scan: sc };
  }
  const steps: (() => Outcome)[] = [
    () => rangeOutcome(sc),
    () => (allDigits(text) ? bareNumber(text, env) : { t: "none" }),
    () => {
      const single = scanStamp(text, 0, env.nowUs, env.zone).filter((s) => s.end === text.length);
      const drafts = singleDrafts(
        single.flatMap((s) => s.alts),
        env,
      );
      return drafts.length > 0
        ? { t: "drafts", drafts, form: "iso", why: drafts.find((d) => d.why)?.why }
        : { t: "none" };
    },
    () => logLine(norm, env),
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
