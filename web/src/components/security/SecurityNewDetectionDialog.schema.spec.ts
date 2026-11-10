// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { makeNewDetectionSchema, newDetectionDefaults } from "./SecurityNewDetectionDialog.schema";

const t = (key: string) => key;
const schema = makeNewDetectionSchema(t, () => ["taken__logs"]);

const issuesAt = (value: unknown, field: string) => {
  const res = schema.safeParse(value);
  return res.success
    ? []
    : res.error.issues.filter((i) => i.path[0] === field).map((i) => i.message);
};

describe("makeNewDetectionSchema", () => {
  it("accepts the defaults with a free name", () => {
    expect(schema.safeParse({ ...newDetectionDefaults(), name: "fresh__logs" }).success).toBe(true);
  });

  it("flags a look-back shorter than the run interval on period", () => {
    const value = { ...newDetectionDefaults(), period: "5", frequency: "15" };
    expect(issuesAt(value, "period")).toEqual(["siem.detections.validation.periodGap"]);
    expect(issuesAt({ ...value, period: "15" }, "period")).toEqual([]);
  });

  it("flags only the positive rule when period is not above 0", () => {
    const value = { ...newDetectionDefaults(), period: "0", frequency: "15" };
    expect(issuesAt(value, "period")).toEqual(["siem.detections.validation.positive"]);
  });

  it("flags a look-back shorter than the correlation's timespan", () => {
    const correlated = makeNewDetectionSchema(
      t,
      () => [],
      () => 30,
    );
    const value = { ...newDetectionDefaults(), period: "15", frequency: "5" };
    const res = correlated.safeParse(value);
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.message)).toEqual([
      "siem.detections.validation.belowTimespan",
    ]);
    expect(correlated.safeParse({ ...value, period: "30" }).success).toBe(true);
    expect(issuesAt(value, "period")).toEqual([]);
  });

  it("flags a name already in the org", () => {
    const value = { ...newDetectionDefaults(), name: "taken__logs" };
    expect(issuesAt(value, "name")).toEqual(["siem.detections.nameTaken"]);
  });

  it("treats an unparsable silence as 0, which is allowed", () => {
    expect(issuesAt({ ...newDetectionDefaults(), silence: "abc" }, "silence")).toEqual([]);
    expect(issuesAt({ ...newDetectionDefaults(), silence: "-1" }, "silence")).toEqual([
      "siem.detections.validation.nonNegative",
    ]);
  });
});
