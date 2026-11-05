// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import type { PresetInput, Rotation, ShiftRule } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { fromZonedInputValue } from "@/utils/oncall";

import {
  firstFreeName,
  duplicateName,
  handoverChange,
  lastMondayMidnight,
  nextRotationName,
  sharedPeople,
  templateProblem,
} from "./OnCallSchedulePresets.target";

const nth = (n: number) => `Rotation ${n}`;
const at = (local: string, zone = "UTC") => fromZonedInputValue(local, zone) as number;

const rule = (over: Partial<ShiftRule> = {}): ShiftRule => ({
  name: "Base",
  members: [],
  shift_micros: MICROS_PER_WEEK,
  anchor_micros: at("2026-11-02T09:00"),
  ...over,
});

const rotation = (id: string, name: string, members: string[][]): Rotation => ({
  id,
  name,
  shift_rules: members.map((m) => rule({ members: m })),
});

describe("firstFreeName", () => {
  it.each([
    { taken: [], from: 1, want: "Rotation 1" },
    { taken: ["Rotation 1"], from: 1, want: "Rotation 2" },
    { taken: ["Rotation 3"], from: 3, want: "Rotation 4" },
    { taken: ["rotation 2"], from: 2, want: "Rotation 3" },
    { taken: ["Rotation 2", "Rotation 4"], from: 2, want: "Rotation 3" },
  ])("$taken from $from → $want", ({ taken, from, want }) => {
    expect(firstFreeName(taken, nth, from)).toBe(want);
  });
});

describe("nextRotationName", () => {
  it.each([
    { names: [], want: "Primary" },
    { names: ["Primary"], want: "Rotation 2" },
    { names: ["Primary", "Rotation 3"], want: "Rotation 4" },
  ])("$names → $want", ({ names, want }) => {
    expect(nextRotationName(names, nth)).toBe(want);
  });
});

describe("handoverChange", () => {
  const current = rule();
  const same = { length: false, anchor: false };
  it.each([
    { name: "no rule to compare", rule: undefined, shift: MICROS_PER_DAY, anchor: 0, want: same },
    {
      name: "same length and anchor",
      rule: current,
      shift: MICROS_PER_WEEK,
      anchor: current.anchor_micros,
      want: same,
    },
    {
      name: "anchor a whole shift later",
      rule: current,
      shift: MICROS_PER_WEEK,
      anchor: current.anchor_micros + MICROS_PER_WEEK,
      want: same,
    },
    {
      name: "anchor moved within the week",
      rule: current,
      shift: MICROS_PER_WEEK,
      anchor: current.anchor_micros + MICROS_PER_DAY,
      want: { length: false, anchor: true },
    },
    {
      name: "length changed, same anchor",
      rule: current,
      shift: MICROS_PER_DAY,
      anchor: current.anchor_micros,
      want: { length: true, anchor: false },
    },
    {
      name: "both changed",
      rule: current,
      shift: MICROS_PER_DAY,
      anchor: current.anchor_micros + 3_600_000_000,
      want: { length: true, anchor: true },
    },
  ])("$name", ({ rule: r, shift, anchor, want }) => {
    expect(handoverChange(r, shift, anchor, "UTC")).toEqual(want);
  });
});

describe("handoverChange on the team's wall clock", () => {
  const zone = "Europe/London";
  const winter = (shift: number) =>
    rule({ shift_micros: shift, anchor_micros: at("2026-01-05T09:00", zone) });
  it.each([
    {
      name: "weekly, same Monday 09:00 across DST",
      shift: MICROS_PER_WEEK,
      anchor: "2026-07-06T09:00",
      want: false,
    },
    {
      name: "daily, same 09:00 across DST",
      shift: MICROS_PER_DAY,
      anchor: "2026-07-09T09:00",
      want: false,
    },
    {
      name: "daily, 10:00 instead of 09:00",
      shift: MICROS_PER_DAY,
      anchor: "2026-07-09T10:00",
      want: true,
    },
    {
      name: "fortnightly, an odd number of weeks later",
      shift: 2 * MICROS_PER_WEEK,
      anchor: "2026-07-13T09:00",
      want: true,
    },
    {
      name: "fortnightly, an even number of weeks later",
      shift: 2 * MICROS_PER_WEEK,
      anchor: "2026-07-06T09:00",
      want: false,
    },
  ])("$name → $want", ({ shift, anchor, want }) => {
    expect(handoverChange(winter(shift), shift, at(anchor, zone), zone).anchor).toBe(want);
  });
});

describe("duplicateName", () => {
  it.each([
    { names: ["Region 1", "Region 2"], want: null },
    { names: ["Region 2", " region 2 "], want: "Region 2" },
    { names: ["", " "], want: null },
  ])("$names → $want", ({ names, want }) => {
    expect(duplicateName(names)).toBe(want);
  });
});

describe("sharedPeople", () => {
  const rotations = [
    rotation("r1", "Primary", [["raj@x.io", "maya@x.io"]]),
    rotation("r2", "Secondary", [["tom@x.io"], ["RAJ@x.io"]]),
    rotation("r3", "Shadow", [["maya@x.io"]]),
  ];
  it.each([
    { name: "nobody shared", members: ["lena@x.io"], target: "r1", want: [] },
    {
      name: "the target's own roster is not a side effect",
      members: ["maya@x.io", "raj@x.io"],
      target: "r1",
      want: [
        { email: "maya@x.io", rotation: "Shadow" },
        { email: "raj@x.io", rotation: "Secondary" },
      ],
    },
    {
      name: "a new rotation shares with every existing one, once per person",
      members: ["maya@x.io", "maya@x.io"],
      target: "",
      want: [{ email: "maya@x.io", rotation: "Primary" }],
    },
  ])("$name", ({ members, target, want }) => {
    expect(sharedPeople(members, rotations, target)).toEqual(want);
  });
});

describe("lastMondayMidnight", () => {
  it.each([
    { name: "midweek", now: "2026-11-05T11:00", zone: "UTC", want: "2026-11-02T00:00" },
    { name: "Monday itself", now: "2026-11-02T00:30", zone: "UTC", want: "2026-11-02T00:00" },
    { name: "Sunday night", now: "2026-11-08T23:59", zone: "UTC", want: "2026-11-02T00:00" },
    {
      name: "read in the team zone",
      now: "2026-11-02T03:00",
      zone: "Asia/Kolkata",
      want: "2026-11-02T00:00",
    },
  ])("$name", ({ now, zone, want }) => {
    expect(lastMondayMidnight(at(now, zone), zone)).toBe(at(want, zone));
  });
});

describe("templateProblem", () => {
  const input = (
    field: string,
    kind: PresetInput["kind"],
    fields?: PresetInput[],
  ): PresetInput => ({
    field,
    kind,
    label: field,
    description: "",
    required: true,
    fields,
  });
  const regions = input("groups", "group_list", [
    input("name", "text"),
    input("start_minute", "minute_of_day"),
    input("end_minute", "minute_of_day"),
  ]);
  const sun = [regions];
  const split = [input("boundary_day", "day_of_week"), input("boundary_minute", "minute_of_day")];
  const hours = [
    input("days", "day_list"),
    input("start_minute", "minute_of_day"),
    input("end_minute", "minute_of_day"),
  ];
  const region = (start_minute: number, end_minute: number) => ({ start_minute, end_minute });

  it.each([
    {
      name: "regions tiling the day",
      inputs: sun,
      model: { groups: [region(0, 720), region(720, 1440)] },
      want: null,
    },
    {
      name: "a region wrapping midnight",
      inputs: sun,
      model: { groups: [region(1320, 360), region(360, 1320)] },
      want: null,
    },
    {
      name: "a region starting where it ends",
      inputs: sun,
      model: { groups: [region(0, 720), region(720, 720)] },
      want: "empty_window",
    },
    {
      name: "regions sharing an hour",
      inputs: sun,
      model: { groups: [region(0, 780), region(720, 1440)] },
      want: "overlap",
    },
    {
      name: "a wrapped region overlapping",
      inputs: sun,
      model: { groups: [region(1320, 60), region(0, 1320)] },
      want: "overlap",
    },
    {
      name: "a split mid-week",
      inputs: split,
      model: { boundary_day: 3, boundary_minute: 0 },
      want: null,
    },
    {
      name: "a split at Monday 00:00",
      inputs: split,
      model: { boundary_day: 0, boundary_minute: 0 },
      want: "week_start",
    },
    { name: "a split left to the server", inputs: split, model: {}, want: null },
    {
      name: "working hours on weekdays",
      inputs: hours,
      model: { days: [0, 1], start_minute: 540, end_minute: 1020 },
      want: null,
    },
    {
      name: "working hours on no day",
      inputs: hours,
      model: { days: [], start_minute: 540, end_minute: 1020 },
      want: "no_days",
    },
    {
      name: "working hours of no length",
      inputs: hours,
      model: { days: [0], start_minute: 540, end_minute: 540 },
      want: "empty_window",
    },
  ])("$name → $want", ({ inputs, model, want }) => {
    expect(templateProblem(inputs, model)?.kind ?? null).toBe(want);
  });
});
