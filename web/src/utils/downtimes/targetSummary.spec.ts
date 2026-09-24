// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import type { DimensionCondition, DowntimeTarget } from "@/services/downtimes";
import { conditionSummary, sortedTargets, targetSummary } from "./targetSummary";

const eq = (key: string, value: string): DimensionCondition => ({
  type: "pair",
  key,
  operator: "=",
  value,
});
const and = (...items: DimensionCondition[]): DimensionCondition => ({
  type: "group",
  op: "and",
  items,
});
const or = (...items: DimensionCondition[]): DimensionCondition => ({
  type: "group",
  op: "or",
  items,
});

const folderName = (_module: string, id: string) =>
  ({ "7Hq9infra": "Infra" })[id as "7Hq9infra"];

describe("conditionSummary", () => {
  it("lists one AND group of = pairs as key=value pairs", () => {
    expect(conditionSummary(and(eq("service", "payments"), eq("env", "prod")), gt)).toBe(
      "service=payments · env=prod",
    );
  });

  it("shows an OR group of = pairs on one key as a count of that key", () => {
    const cond = and(eq("service", "kafka"), or(eq("host", "a"), eq("host", "b"), eq("host", "c")));
    expect(conditionSummary(cond, gt)).toBe("service=kafka · 3 hosts");
  });

  it("shows a bare pair and a bare OR group", () => {
    expect(conditionSummary(eq("service", "payments"), gt)).toBe("service=payments");
    expect(conditionSummary(or(eq("host", "a"), eq("host", "b")), gt)).toBe("2 hosts");
  });

  it("falls back to 'condition' for any other tree", () => {
    const ne: DimensionCondition = { type: "pair", key: "env", operator: "!=", value: "staging" };
    expect(conditionSummary(and(eq("service", "payments"), ne), gt)).toBe("condition");
    expect(conditionSummary(or(eq("service", "a"), eq("env", "b")), gt)).toBe("condition");
  });

  it("returns null when there is no condition", () => {
    expect(conditionSummary(undefined, gt)).toBeNull();
  });
});

describe("targetSummary", () => {
  it("says all folders for a whole module", () => {
    const chip = targetSummary({ module: "anomaly_detections", folders: { kind: "all" } }, gt);
    expect(chip.label).toBe("Anomaly");
    expect(chip.text).toBe("all folders");
    expect(chip.icon).toBe("query-stats");
  });

  it("names one folder and counts several", () => {
    const one: DowntimeTarget = {
      module: "alerts",
      folders: { kind: "some", folder_ids: ["7Hq9infra"] },
    };
    const two: DowntimeTarget = {
      module: "alerts",
      folders: { kind: "some", folder_ids: ["a", "b"] },
    };
    expect(targetSummary(one, gt, folderName).text).toBe("Infra folder");
    expect(targetSummary(two, gt, folderName).text).toBe("2 folders");
  });

  it("adds tags, items and the count-as-good mode", () => {
    expect(
      targetSummary(
        { module: "synthetics", folders: { kind: "all" }, tags: ["service:payments"] },
        gt,
      ).text,
    ).toBe("all folders · tag service:payments");
    expect(
      targetSummary({ module: "slos", folders: { kind: "all" }, ids: ["a", "b", "c"] }, gt).text,
    ).toBe("all folders · 3 items");
    expect(
      targetSummary({ module: "slos", folders: { kind: "all" }, slo_mode: "count_as_good" }, gt)
        .text,
    ).toBe("all folders · as good");
    expect(
      targetSummary({ module: "slos", folders: { kind: "all" }, slo_mode: "exclude" }, gt).text,
    ).toBe("all folders");
  });

  it("orders targets as the Applies to strip does", () => {
    const sorted = sortedTargets([
      { module: "slos", folders: { kind: "all" } },
      { module: "alerts", folders: { kind: "all" } },
      { module: "synthetics", folders: { kind: "all" } },
    ]);
    expect(sorted.map((s) => s.module)).toEqual(["alerts", "synthetics", "slos"]);
  });
});
