// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import type { EscalationTarget, OnCallPolicy, ShiftRule } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { fromZonedInputValue } from "@/utils/oncall";

import {
  isOffStretch,
  laneCadence,
  pagedAlone,
  pagedAtAll,
  pagedTogether,
} from "./OnCallScheduleTimeline.lanes";

const at = (local: string, zone = "UTC") => fromZonedInputValue(local, zone) as number;
const NOW = at("2026-11-04T12:00");

const rule = (over: Partial<ShiftRule> = {}): ShiftRule => ({
  name: "Base",
  members: ["ana@o2.ai", "bob@o2.ai"],
  shift_micros: MICROS_PER_WEEK,
  anchor_micros: at("2026-11-02T09:00"),
  ...over,
});

const rot = (id: string): EscalationTarget => ({ kind: "rotation", rotation_id: id });

const policy = (steps: EscalationTarget[][]): OnCallPolicy => ({
  id: "p",
  org_id: "o",
  team_id: "t",
  rungs: [
    {
      priority: 1,
      channels: [],
      steps: steps.map((targets, i) => ({ after_micros: i, targets })),
    },
  ],
});

describe("laneCadence", () => {
  const H = MICROS_PER_DAY / 24;
  const weekdays = { days: [0, 1, 2, 3, 4], start_minute: 0, end_minute: 1440 };
  it.each([
    ["a weekly rule", [rule()], { kind: "weekly", weekday: 0, minute: 540 }],
    [
      "a daily rule restricted to weekdays says daily, whatever today is",
      [rule({ shift_micros: MICROS_PER_DAY, restrictions: [weekdays] })],
      { kind: "daily", minute: 540 },
    ],
    [
      "every three days",
      [rule({ shift_micros: 3 * MICROS_PER_DAY })],
      { kind: "days", days: 3, minute: 540 },
    ],
    ["every twelve hours", [rule({ shift_micros: 12 * H })], { kind: "every", micros: 12 * H }],
    [
      "two rules on one cadence say it once",
      [rule(), rule({ name: "Weekend", anchor_micros: at("2026-10-26T09:00") })],
      { kind: "weekly", weekday: 0, minute: 540 },
    ],
    [
      "two rules on different cadences say none",
      [rule(), rule({ name: "Weekend", anchor_micros: at("2026-11-04T23:30") })],
      null,
    ],
    [
      "a stopped rule does not count",
      [rule(), rule({ anchor_micros: at("2026-11-04T23:30"), ends_at: NOW })],
      { kind: "weekly", weekday: 0, minute: 540 },
    ],
    ["a rule not started yet does not count", [rule({ starts_at: NOW + 1 })], null],
    ["a rule with nobody in it does not count", [rule({ members: [] })], null],
    ["no rules", [], null],
  ])("%s", (_name, rules, expected) => {
    expect(laneCadence(rules, NOW, "UTC")).toEqual(expected);
  });

  // An anchor set in winter still reads 09:00 in summer: the cadence is wall clock, not UTC.
  it("reads the anchor on the team's clock across a DST change", () => {
    const zone = "America/New_York";
    const winter = rule({ anchor_micros: at("2026-03-02T09:00", zone) });
    expect(laneCadence([winter], at("2026-07-01T12:00", zone), zone)).toEqual({
      kind: "weekly",
      weekday: 0,
      minute: 540,
    });
  });
});

describe("pagedAlone", () => {
  it.each([
    ["no policy keeps the gap loud", null, true],
    ["a step paging only this rotation", policy([[rot("a")]]), true],
    [
      "the rotation twice, in two modes, is still only it",
      policy([[rot("a"), { ...rot("a"), mode: "all" }]]),
      true,
    ],
    ["paged alongside another rotation", policy([[rot("a"), rot("b")]]), false],
    ["paged alongside a person", policy([[rot("a"), { kind: "user", email: "x@o2.ai" }]]), false],
    ["never named", policy([[rot("b")]]), false],
    ["a later step alone", policy([[rot("a"), rot("b")], [rot("a")]]), true],
    ["a policy with no steps", policy([]), false],
  ])("%s", (_name, given, expected) => {
    expect(pagedAlone(given, "a")).toBe(expected);
  });
});

describe("pagedTogether", () => {
  it.each([
    ["no policy says nothing", null, false],
    ["one step pages both", policy([[rot("a"), rot("b")]]), true],
    ["two steps, one each", policy([[rot("a")], [rot("b")]]), false],
  ])("%s", (_name, given, expected) => {
    expect(pagedTogether(given, "b", "a")).toBe(expected);
  });
});

describe("pagedAtAll", () => {
  it.each([
    ["no policy says nothing is wrong", null, true],
    ["named in a step", policy([[rot("b")], [rot("a"), rot("b")]]), true],
    ["named nowhere", policy([[rot("b")]]), false],
  ])("%s", (_name, given, expected) => {
    expect(pagedAtAll(given, "a")).toBe(expected);
  });
});

describe("isOffStretch", () => {
  it.each([
    [
      "nobody, outside every rule, not paged alone",
      { user_email: null, rotation: null },
      false,
      true,
    ],
    ["inside a rule's hours is a gap", { user_email: null, rotation: "Weekdays" }, false, false],
    ["paged alone is a gap", { user_email: null, rotation: null }, true, false],
    ["somebody on it is neither", { user_email: "a@o2.ai", rotation: null }, false, false],
  ])("%s", (_name, segment, alone, expected) => {
    expect(isOffStretch(segment, alone)).toBe(expected);
  });
});

// p1_parallel fires every P1 step at once, so the P1 rung acts as one step; other rungs keep their steps.
describe("p1_parallel", () => {
  const twoRungs = (parallel: boolean | undefined, p2: EscalationTarget[][]): OnCallPolicy => ({
    ...policy([[rot("a")], [rot("b")]]),
    p1_parallel: parallel,
    rungs: [
      ...policy([[rot("a")], [rot("b")]]).rungs,
      { priority: 2, channels: [], steps: p2.map((targets, i) => ({ after_micros: i, targets })) },
    ],
  });
  it.each([
    ["off: P1 steps page a and b apart", false, [], true, false],
    ["unset reads as off", undefined, [], true, false],
    ["on: P1 pages a and b together", true, [], false, true],
    ["on: a P2 step paging a alone still counts", true, [[rot("a")], [rot("b")]], true, true],
  ])("%s", (_name, parallel, p2, alone, together) => {
    const given = twoRungs(parallel, p2);
    expect(pagedAlone(given, "a")).toBe(alone);
    expect(pagedTogether(given, "b", "a")).toBe(together);
  });
});
