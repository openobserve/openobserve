// Copyright 2026 OpenObserve Inc.

import type { PresetInput, Rotation, ShiftRule } from "@/ts/interfaces/oncall";
import { DEFAULT_ROTATION_NAME } from "@/ts/interfaces/oncall";
import { anchorWeekdayTime, rotationMembers, zonedMidnight } from "@/utils/oncall";

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MICROS_PER_MINUTE = 60_000_000;

/** Why the server would refuse a template's values, mirroring preset.rs `validate`. */
export type TemplateProblemKind = "empty_window" | "overlap" | "no_days" | "week_start";

export interface TemplateProblem {
  kind: TemplateProblemKind;
  /** The input the problem is about, so the reason can use its label. */
  input: PresetInput;
}

/** Which parts of a rotation's handovers a template changes. */
export interface HandoverChange {
  length: boolean;
  anchor: boolean;
}

/** Someone a template names who already sits on another rotation. */
export interface SharedPerson {
  email: string;
  /** The other rotation's name. */
  rotation: string;
}

/** The first `make(n)`, counting up from `from`, that no name in `taken` uses (case-insensitive). [pure] */
export function firstFreeName(taken: string[], make: (n: number) => string, from: number): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  let n = from;
  while (used.has(make(n).trim().toLowerCase())) n++;
  return make(n);
}

/** The name the from-scratch editor gives a team's next rotation. [pure] */
export function nextRotationName(names: string[], nth: (n: number) => string): string {
  return names.length ? firstFreeName(names, nth, names.length + 1) : DEFAULT_ROTATION_NAME;
}

/** What a template's length and anchor change about `rule`'s handovers, read on `timezone`'s wall clock so DST moves nothing. [pure] */
export function handoverChange(
  rule: ShiftRule | undefined,
  shiftMicros: number,
  anchorMicros: number,
  timezone: string,
): HandoverChange {
  if (!rule) return { length: false, anchor: false };
  return {
    length: rule.shift_micros !== shiftMicros,
    anchor: anchorMoves(rule.anchor_micros, anchorMicros, shiftMicros, timezone),
  };
}

/** The first non-blank name that appears twice, compared trimmed and case-insensitive. [pure] */
export function duplicateName(names: string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) return names.find((n) => n.trim().toLowerCase() === key)?.trim() ?? null;
    seen.add(key);
  }
  return null;
}

/** Template people also on a rotation other than `targetId`, first match each, in template order. [pure] */
export function sharedPeople(
  members: string[],
  rotations: Rotation[],
  targetId: string,
): SharedPerson[] {
  const others = rotations
    .filter((rotation) => rotation.id !== targetId)
    .map((rotation) => ({
      name: rotation.name,
      people: new Set(rotationMembers(rotation).map((email) => email.trim().toLowerCase())),
    }));
  const seen = new Set<string>();
  const out: SharedPerson[] = [];
  for (const email of members) {
    const key = email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const other = others.find((rotation) => rotation.people.has(key));
    if (other) out.push({ email, rotation: other.name });
  }
  return out;
}

/** The latest Monday 00:00 in `timezone` at or before `nowMicros`, the anchor the server takes when none is sent. [pure] */
export function lastMondayMidnight(nowMicros: number, timezone: string): number {
  return zonedMidnight(nowMicros, timezone, -anchorWeekdayTime(nowMicros, timezone).weekday);
}

/** The first refusal the server would make for these values, or null; absent values are the server's to default. [pure] */
export function templateProblem(
  inputs: PresetInput[],
  model: Record<string, unknown>,
): TemplateProblem | null {
  for (const input of inputs) {
    if (input.kind !== "group_list") continue;
    const kind = regionsProblem(input, model[input.field]);
    if (kind) return { kind, input };
  }
  const scalars = inputs.filter((i) => i.kind !== "group" && i.kind !== "group_list");
  const minutes = scalars.filter((i) => i.kind === "minute_of_day");
  const [from, to] = minutes;
  if (minutes.length === 2 && from && to && sameNumber(model[from.field], model[to.field])) {
    return { kind: "empty_window", input: from };
  }
  const days = scalars.find((i) => i.kind === "day_list");
  const picked = days ? model[days.field] : undefined;
  if (days && Array.isArray(picked) && !picked.length) return { kind: "no_days", input: days };
  const day = scalars.find((i) => i.kind === "day_of_week");
  if (day && minutes.length === 1 && from && model[day.field] === 0 && model[from.field] === 0) {
    return { kind: "week_start", input: day };
  }
  return null;
}

function sameNumber(a: unknown, b: unknown): boolean {
  return typeof a === "number" && a === b;
}

/// Walks the minutes like preset.rs `validate_no_overlap`, since a window may wrap midnight.
function regionsProblem(input: PresetInput, value: unknown): TemplateProblemKind | null {
  const edges = (input.fields ?? []).filter((f) => f.kind === "minute_of_day");
  const [from, to] = edges;
  if (edges.length !== 2 || !from || !to || !Array.isArray(value)) return null;
  const windows = (value as Record<string, unknown>[]).map((entry) => ({
    start: Number(entry[from.field]),
    end: Number(entry[to.field]),
  }));
  if (windows.some((w) => w.start === w.end)) return "empty_window";
  for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
    const holders = windows.filter((w) =>
      w.start < w.end ? minute >= w.start && minute < w.end : minute >= w.start || minute < w.end,
    );
    if (holders.length > 1) return "overlap";
  }
  return null;
}

function minuteOfWeek(micros: number, timezone: string): number {
  const { weekday, minute } = anchorWeekdayTime(micros, timezone);
  return weekday * MINUTES_PER_DAY + minute;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/// Shifts that tile a week compare by wall-clock phase; whole-week shifts also need the week parity.
function anchorMoves(from: number, to: number, shiftMicros: number, timezone: string): boolean {
  const shift = shiftMicros / MICROS_PER_MINUTE;
  const wall = mod(minuteOfWeek(to, timezone) - minuteOfWeek(from, timezone), MINUTES_PER_WEEK);
  if (Number.isInteger(shift) && MINUTES_PER_WEEK % shift === 0) return wall % shift !== 0;
  if (Number.isInteger(shift) && shift % MINUTES_PER_WEEK === 0) {
    const weeks = Math.round((to - from) / (MINUTES_PER_WEEK * MICROS_PER_MINUTE));
    return wall !== 0 || mod(weeks, shift / MINUTES_PER_WEEK) !== 0;
  }
  return (to - from) % shiftMicros !== 0;
}
