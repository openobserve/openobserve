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

import { addDays, US_PER_DAY, US_PER_H, US_PER_MIN, US_PER_S } from "./civil";
import { rollingDrafts, singleDrafts, sinceDrafts, spanDrafts, today, type Env } from "./combine";
import { digitRun, fixedDigits, readMathUnit, scanDateMath } from "./machine";
import type { Draft, Outcome, RelativeUnit, UnitKey } from "./types";

interface Part {
  n: number;
  unit: UnitKey;
  typedM: boolean;
}

const ORDER: UnitKey[] = ["y", "M", "w", "d", "h", "m", "s"];
const ELAPSED_US: Partial<Record<UnitKey, number>> = {
  w: 7 * US_PER_DAY,
  d: US_PER_DAY,
  h: US_PER_H,
  m: US_PER_MIN,
  s: US_PER_S,
};

/** `N unit` parts with optional spaces between them; null when the text is not this shape. */
function parts(text: string): Part[] | null {
  const out: Part[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === " ") i++;
    const n = digitRun(text, i);
    if (n < 1 || n > 6) return null;
    const value = fixedDigits(text, i, n);
    i += n;
    if (text[i] === " ") i++;
    const unit = readMathUnit(text[i]);
    if (!unit || value < 1) return null;
    out.push({ n: value, unit, typedM: text[i] === "M" });
    i++;
  }
  return out.length > 0 ? out : null;
}

function chainDrafts(list: Part[], env: Env): Outcome {
  let total = 0;
  let last = -1;
  for (const p of list) {
    const rank = ORDER.indexOf(p.unit);
    const size = ELAPSED_US[p.unit];
    if (rank <= last || !size) return { t: "invalid", reason: "unreadable" };
    last = rank;
    total += p.n * size;
  }
  const smallest = list[list.length - 1].unit;
  const unit: RelativeUnit = smallest === "m" || smallest === "s" ? smallest : "h";
  const value = total / (ELAPSED_US[unit] ?? US_PER_S);
  const startUs = env.nowUs - total;
  if (!Number.isSafeInteger(startUs)) return { t: "invalid", reason: "out-of-range" };
  const allowed = env.units.includes(unit);
  const draft: Draft = {
    startUs,
    endUs: env.nowUs,
    softEnd: false,
    kind: allowed ? "rolling" : "absolute",
    rolling: allowed ? { value, unit } : undefined,
    fixedToNow: allowed ? undefined : true,
    notes: [{ kind: "elapsed-chain", totalUs: total }],
  };
  return { t: "drafts", drafts: [draft], form: "shorthand" };
}

function mathOutcome(text: string, env: Env): Outcome {
  const math = scanDateMath(text, 0, env.nowUs, env.zone, env.pack.firstDay);
  if (math === undefined) return { t: "none" };
  if (math === null || math.end !== text.length) return { t: "invalid", reason: "unreadable" };
  const only = math.offsets.length === 1 ? math.offsets[0] : undefined;
  if (only && only.sign < 0 && !math.snapped) {
    return { t: "drafts", drafts: rollingDrafts(only.n, only.unit, env), form: "date-math" };
  }
  const drafts =
    math.offsets.length === 0 && !math.snapped
      ? singleDrafts(math.alts, env)
      : sinceDrafts(math.alts, env);
  return { t: "drafts", drafts, form: "date-math" };
}

/** A calendar token as a URL `period` carries it: `calendar:<unit>:<0 or -n>`, weeks from Monday. */
function calendarOutcome(text: string, env: Env): Outcome {
  const [, name, off, extra] = text.split(":");
  const unit = (["d", "w", "M", "q", "y"] as const)[
    ["day", "week", "month", "quarter", "year"].indexOf(name)
  ];
  const n = Number(off);
  if (
    !unit ||
    extra !== undefined ||
    !Number.isInteger(n) ||
    String(n) !== off ||
    n > 0 ||
    n < -999_999
  )
    return { t: "invalid", reason: "unreadable" };
  const drafts =
    unit === "d"
      ? singleDrafts([{ v: { p: "day", ...addDays(today(env), n), rel: true } }], env)
      : spanDrafts(unit, n, env, 1);
  return { t: "drafts", drafts, form: "shorthand" };
}

/** Step 7: `15m`, `2H`, `1h30m` (elapsed time), `15M` (asks: minutes or months; months when
 * `caseExact`, as a URL `period` carries it), and date math. */
export function shorthandOutcome(text: string, env: Env, caseExact = false): Outcome {
  if (text.startsWith("calendar:")) return calendarOutcome(text, env);
  const math = mathOutcome(text, env);
  if (math.t !== "none") return math;
  const list = parts(text);
  if (!list) return { t: "none" };
  if (list.length > 1) return chainDrafts(list, env);
  const [p] = list;
  if (p.typedM && !caseExact) {
    const drafts = [...rollingDrafts(p.n, "m", env), ...rollingDrafts(p.n, "M", env)];
    return {
      t: "drafts",
      drafts: drafts.map((d) => ({ ...d, why: "unit-case" })),
      form: "shorthand",
      why: "unit-case",
    };
  }
  const drafts = rollingDrafts(p.n, p.unit, env);
  if (drafts.length === 0) return { t: "invalid", reason: "out-of-range" };
  return { t: "drafts", drafts, form: "shorthand" };
}

/** Step 4 counts: `15` asks for a unit; each completion is `last 15 <unit>`. */
export function countCompletions(n: number, env: Env): Draft[] {
  return env.units.flatMap((unit) => rollingDrafts(n, unit, env)).slice(0, 6);
}
