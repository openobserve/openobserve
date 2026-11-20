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

import { blockReasons, clampSkew, fixRange, floorOf } from "./check";
import { previousDayStart, rollingDrafts, type Env } from "./combine";
import { ELAPSED_US } from "./shorthand";
import type {
  AmbiguityReason,
  BlockReason,
  Draft,
  InputForm,
  ParseContext,
  RelativeUnit,
  TimeRangeParseResult,
  TimeRangeReading,
  ZoneNote,
} from "./types";
import { offsetAtInstant, offsetLabel } from "./zone";

interface Checked {
  draft: Draft;
  reasons: BlockReason[];
}

const FIX_UNITS = Object.entries(ELAPSED_US) as [RelativeUnit, number][];
const KEPT_NOTES = new Set(["dst-gap", "converted", "elapsed-chain", "instant-window", "log-line"]);

/** Clips soft ends, clamps ends within skew, then runs every check independently. */
export function check(d: Draft, ctx: ParseContext): Checked {
  const { allowFuture, maxEndUs } = ctx.limits;
  const now = ctx.nowUs;
  let { endUs } = d;
  const startUs = d.startUs;
  // A start past now + skew cannot be clipped, since both clips need the start before now.
  const upper = Math.min(allowFuture ? Infinity : now, maxEndUs ?? Infinity);
  if (d.softEnd && endUs > upper && upper > startUs) endUs = upper;
  else endUs = clampSkew(startUs, endUs, now, ctx.limits);
  const reasons = blockReasons(startUs, endUs, now, ctx.limits);
  const floor = floorOf(ctx.limits);
  const notes: ZoneNote[] = d.notes.filter((n) => n.kind !== "partial-retention");
  if (startUs < floor && endUs > floor)
    notes.push({ kind: "partial-retention", keptFromUs: floor });
  // A calendar token resolves to its own end, so a clip short of now makes the reading absolute.
  const clipped = d.calendarToken && endUs !== d.endUs && endUs !== now;
  const plain = clipped
    ? { kind: "absolute" as const, calendarToken: undefined, name: undefined }
    : {};
  return { draft: { ...d, ...plain, endUs, notes }, reasons };
}

function rollingFor(
  span: number,
  ctx: ParseContext,
): { value: number; unit: RelativeUnit } | undefined {
  for (const [unit, size] of FIX_UNITS) {
    if (ctx.units.includes(unit) && span % size === 0) return { value: span / size, unit };
  }
  return undefined;
}

/** One candidate per blocked reading; it must pass the whole policy again or there is none. */
function fixFor(d: Draft, reasons: BlockReason[], ctx: ParseContext, env: Env): Draft | undefined {
  const now = ctx.nowUs;
  const [startUs, endUs] =
    d.sinceClock && d.startUs > now
      ? [previousDayStart(d.sinceClock, env), now]
      : fixRange(d.startUs, d.endUs, reasons, now, ctx.limits);
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(endUs) || startUs >= endUs)
    return undefined;
  const rolling =
    d.kind === "rolling" && endUs === now ? rollingFor(endUs - startUs, ctx) : undefined;
  const make = (from: number, label?: Draft["rolling"]): Draft | undefined => {
    const fix: Draft = {
      startUs: from,
      endUs,
      softEnd: false,
      kind: label ? "rolling" : "absolute",
      rolling: label,
      fixedToNow: !label && endUs === now ? true : undefined,
      notes:
        from === d.startUs
          ? d.notes.filter((n) => n.kind === "dst-gap" || n.kind === "converted")
          : [],
    };
    const again = check(fix, ctx);
    return again.reasons.length === 0 ? again.draft : undefined;
  };
  // A rolling label starts where typing it starts (`1d` is 23 h across DST); else the fix is absolute.
  const typed = rolling && rollingDrafts(rolling.value, rolling.unit, env)[0]?.startUs;
  return (typed !== undefined && make(typed, rolling)) || make(startUs);
}

function reading(
  d: Draft,
  ctx: ParseContext,
  form: InputForm,
  blocked?: BlockReason,
): TimeRangeReading {
  const notes: ZoneNote[] = d.notes.filter(
    (n) => KEPT_NOTES.has(n.kind) || n.kind === "partial-retention",
  );
  const r: TimeRangeReading = {
    kind: d.kind,
    startUs: d.startUs,
    endUs: d.endUs,
    startOffset: offsetLabel(offsetAtInstant(ctx.zone, d.startUs)),
    endOffset: offsetLabel(offsetAtInstant(ctx.zone, d.endUs)),
    notes,
    origin: { source: ctx.source ?? "typed", form },
  };
  if (d.rolling) r.rolling = d.rolling;
  if (d.calendarToken) r.calendarToken = d.calendarToken;
  if (d.fixedToNow) r.fixedToNow = true;
  if (d.name) r.name = d.name;
  if (blocked) r.blocked = blocked;
  return applyKinds(r, ctx);
}

/** `kinds` turns calendar readings absolute, and rolling ones absolute and fixed to now, when the
 * caller can store absolute ones. */
function applyKinds(r: TimeRangeReading, ctx: ParseContext): TimeRangeReading {
  if (!ctx.kinds.absolute) return r;
  if (r.kind === "calendar" && !ctx.kinds.calendar) {
    const { calendarToken: _token, ...rest } = r;
    return { ...rest, kind: "absolute", fixedToNow: r.endUs === ctx.nowUs ? true : undefined };
  }
  if (r.kind === "rolling" && !ctx.kinds.relative) {
    const { rolling: _rolling, ...rest } = r;
    return { ...rest, kind: "absolute", fixedToNow: true };
  }
  return r;
}

function storable(r: TimeRangeReading, ctx: ParseContext): boolean {
  const { relative, calendar, absolute } = ctx.kinds;
  return r.kind === "rolling" ? relative : r.kind === "calendar" ? calendar : absolute;
}

function safe(d: Draft): boolean {
  return Number.isSafeInteger(d.startUs) && Number.isSafeInteger(d.endUs);
}

/** Completions that pass policy, clipped; the rest are dropped. */
export function completionReadings(
  drafts: Draft[],
  ctx: ParseContext,
  form: InputForm,
): TimeRangeReading[] {
  const out: TimeRangeReading[] = [];
  for (const d of drafts) {
    if (!safe(d)) continue;
    const c = check(d, ctx);
    if (c.reasons.length > 0 || c.draft.startUs >= c.draft.endUs) continue;
    const r = reading(c.draft, ctx, form);
    if (storable(r, ctx)) out.push(r);
  }
  return out.slice(0, 6);
}

/** Policy on every reading; all rows blocked gives `blocked` with `others`, only zero-length unblocked
 * rows give `invalid/zero-length` (other zero-length rows are dropped), and none safe gives null. */
export function finalize(
  drafts: Draft[],
  why: AmbiguityReason | undefined,
  form: InputForm,
  ctx: ParseContext,
  env: Env,
): TimeRangeParseResult | null {
  const checked = drafts.filter(safe).map((d) => check(d, ctx));
  const kept = checked.filter((c) => c.reasons.length > 0 || c.draft.startUs < c.draft.endUs);
  if (checked.length > 0 && kept.length === 0)
    return { state: "invalid", reason: "zero-length", examples: [] };
  const rows = kept
    .map((c) => {
      const blocked = c.reasons[0];
      const fix = blocked ? fixFor(c.draft, c.reasons, ctx, env) : undefined;
      const fixed = fix && reading(fix, ctx, form);
      return {
        r: reading(c.draft, ctx, form, blocked),
        blocked,
        fix: fixed && storable(fixed, ctx) ? fixed : undefined,
      };
    })
    .filter((row) => storable(row.r, ctx));
  // Every reading is of a kind the caller cannot store, so none of them can be applied.
  if (kept.length > 0 && rows.length === 0)
    return { state: "invalid", reason: "unreadable", examples: [] };
  if (rows.length === 0) return null;
  if (rows.length === 1) {
    const [row] = rows;
    if (!row.blocked) return { state: "valid", reading: row.r };
    return {
      state: "blocked",
      reason: row.blocked,
      reading: row.r,
      ...(row.fix ? { fix: row.fix } : {}),
    };
  }
  if (rows.some((row) => !row.blocked)) {
    return {
      state: "ambiguous",
      reason: why ?? "repeated-hour",
      readings: rows.map((row) => row.r),
    };
  }
  const [first, ...rest] = rows;
  const fix = rows.find((row) => row.fix)?.fix;
  return {
    state: "blocked",
    reason: first.blocked ?? "future",
    reading: first.r,
    others: rest.map((row) => row.r),
    ...(fix ? { fix } : {}),
  };
}
