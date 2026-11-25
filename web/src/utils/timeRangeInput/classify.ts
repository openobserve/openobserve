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
import { epochUs, scanDateMath, scanEpoch, scanIso, scanStamp, type Scanned } from "./machine";
import type { Normalized } from "./normalize";
import {
  newScan,
  phraseOutcome,
  rangeOutcome,
  pointDrafts,
  secondsMarks,
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
  const hash = text.indexOf("#");
  const at = text.slice(0, hash < 0 ? undefined : hash).indexOf("?");
  const query = at < 0 ? "" : text.slice(at + 1, hash < 0 ? undefined : hash);
  const params = new URLSearchParams(query);
  const fragment = hash < 0 ? "" : text.slice(hash + 1);
  const keys = ["from", "to", "period"];
  const [[from, f2], [to, t2], [period, p2]] = keys.map((k) => params.getAll(k));
  const timeKey = (k: string): boolean =>
    keys.includes(
      [...k]
        .filter((c) => !/^\p{Cf}$/u.test(c))
        .join("")
        .toLowerCase()
        .split("=")[0],
    );
  // Text after a space, a second URL, a time param in the fragment, a look-alike key (`Period`,
  // `per\u200biod`), an empty value, a repeated param, a lone end or a period beside both ends.
  if (
    text.includes(" ") ||
    text.indexOf("://") !== text.lastIndexOf("://") ||
    fragment.includes("?") ||
    [...new URLSearchParams(fragment).keys()].some(timeKey) ||
    [...params.keys()].some((k) => !keys.includes(k) && timeKey(k)) ||
    [from, to, period].includes("") ||
    (f2 ?? t2 ?? p2) !== undefined ||
    !from !== !to ||
    (from && to && period)
  )
    return { t: "invalid", reason: "unreadable" };
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

// Every step must read the whole text, so a stamp followed by any other text (a pasted log line,
// a second line) is never read as that stamp.
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
      const single = scanStamp(text, 0, env.nowUs, env.zone, secondsMarks(sc)).filter(
        (s) => s.end === text.length,
      );
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
