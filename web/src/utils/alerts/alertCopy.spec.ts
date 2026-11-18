// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  compactDuration,
  compactNumber,
  durationText,
  everyDuration,
  joinListMore,
  valueWithUnit,
} from "./alertCopy";

const t = i18n.global.t as unknown as TranslateFn;

describe("joinListMore", () => {
  it.each([
    [[], ""],
    [["a"], "a"],
    [["a", "b"], "a and b"],
    [["a", "b", "c"], "a, b, and c"],
    [["a", "b", "c", "d", "e"], "a, b, c, and 2 more"],
  ])("%j reads %s", (items, expected) => {
    expect(joinListMore(items, t)).toBe(expected);
  });

  it("takes a smaller cap", () => {
    expect(joinListMore(["a", "b", "c"], t, 1)).toBe("a and 2 more");
  });
});

describe("valueWithUnit", () => {
  it.each([
    [90, "percent", "short", "90 %"],
    [0.85, "percent-1", "short", "0.85 (85 %)"],
    [500, "milliseconds", "short", "500 ms"],
    [1500, "bytes-per-sec", "short", "1,500 B/s"],
    [21.5, "°C", "short", "21.5 °C"],
    [42, "", "short", "42"],
    [42, "none", "short", "42"],
    [1, "seconds", "words", "1 second"],
    [2500, "microseconds", "words", "2,500 microseconds"],
    [90, "percent", "words", "90 %"],
  ] as const)("%s %s (%s) reads %s", (value, unit, style, expected) => {
    expect(valueWithUnit(value, unit, t, style)).toBe(expected);
  });
});

describe("durations", () => {
  it.each([
    [30, "every 30 seconds", "30 seconds", "30 s"],
    [60, "every minute", "1 minute", "1 min"],
    [600, "every 10 minutes", "10 minutes", "10 min"],
    [3600, "every hour", "1 hour", "1 h"],
    [7200, "every 2 hours", "2 hours", "2 h"],
    [86400, "every day", "1 day", "1 d"],
    [90, "every 90 seconds", "90 seconds", "1 min"],
  ])("%i s reads %s / %s / %s", (seconds, every, words, compact) => {
    expect(`every ${everyDuration(seconds, t)}`).toBe(every);
    expect(durationText(seconds, t)).toBe(words);
    expect(compactDuration(seconds, t)).toBe(compact);
  });
});

describe("compactNumber", () => {
  it.each([
    [0, "0"],
    [950, "950"],
    [22_400, "22K"],
    [1_250_000, "1.3M"],
  ])("%i reads %s", (value, expected) => {
    expect(compactNumber(value)).toBe(expected);
  });
});
