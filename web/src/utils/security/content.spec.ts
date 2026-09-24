// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  checksByRule,
  detectionState,
  firingsByName,
  groupByLogsource,
  installedBySigmaId,
  rulesForSource,
  sourcesForRule,
  streamsBySource,
  streamsForRule,
  toMicros,
} from "./content";
import { sigmaCatalog } from "./sigma";
import { SOURCE_TYPE_BY_ID } from "./sourceTypes";

const meta = (over: Record<string, unknown>) =>
  ({
    isSiem: true,
    sigmaId: "",
    sigmaYaml: "",
    level: "medium",
    severityId: 3,
    techniques: [],
    tactics: [],
    logsource: "",
    sourceType: "",
    ...over,
  }) as any;

describe("installedBySigmaId", () => {
  it("indexes SIEM detections by the Sigma rule they run", () => {
    const map = installedBySigmaId([
      { alert: { name: "a" }, meta: meta({ sigmaId: "r1" }) },
      { alert: { name: "b" }, meta: meta({ sigmaId: "r1" }) },
      { alert: { name: "c" }, meta: meta({ sigmaId: "" }) },
      { alert: { name: "d" }, meta: meta({ sigmaId: "r2", isSiem: false }) },
    ]);
    expect(map.get("r1")?.map((r) => r.alert.name)).toEqual(["a", "b"]);
    expect(map.has("r2")).toBe(false);
  });
});

describe("source matching", () => {
  const cloudtrail = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;
  const ctRule = sigmaCatalog().find((r) => r.logsource.service === "cloudtrail")!;

  it("links a rule to the source types it was written for, and back", () => {
    expect(sourcesForRule(ctRule).map((s) => s.id)).toContain("aws_cloudtrail");
    expect(rulesForSource(cloudtrail, sigmaCatalog())).toContain(ctRule);
  });

  it("finds the org's streams a rule can run on", () => {
    const bySource = streamsBySource([
      {
        name: "ct",
        fields: ["eventname", "eventsource", "awsregion", "sourceipaddress", "useridentity_type"],
      },
      { name: "empty", fields: [] },
    ]);
    expect(bySource.get("aws_cloudtrail")).toEqual(["ct"]);
    expect(streamsForRule(ctRule, bySource)).toEqual(["ct"]);
  });
});

describe("checksByRule", () => {
  const ctFields = [
    "eventname",
    "eventsource",
    "awsregion",
    "sourceipaddress",
    "useridentity_type",
  ];

  it("records per stream whether each applicable rule can run there", () => {
    const bySource = streamsBySource([{ name: "ct", fields: ctFields }]);
    const checks = checksByRule(bySource, new Map([["ct", ctFields]]));
    const ctRules = sigmaCatalog().filter((r) => r.logsource.service === "cloudtrail");
    for (const rule of ctRules) {
      expect(checks.get(rule)?.map((c) => c.stream)).toEqual(["ct"]);
    }
    // Some CloudTrail rules need fields this minimal stream lacks.
    const verdicts = ctRules.map((r) => checks.get(r)![0].compiled.runnable);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});

describe("groupByLogsource", () => {
  it("counts rules per logsource, busiest first", () => {
    const groups = groupByLogsource(sigmaCatalog());
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(sigmaCatalog().length);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].count).toBeGreaterThanOrEqual(groups[i].count);
    }
  });
});

describe("detection state", () => {
  it("counts firings per rule from history, ignoring normal runs", () => {
    const h = (alert_name: string, status: string, timestamp: number) =>
      ({ alert_name, status, timestamp }) as any;
    const map = firingsByName([
      h("a", "firing", 10),
      h("a", "notify_failed", 30),
      h("a", "normal", 99),
      h("b", "normal", 5),
    ]);
    expect(map.get("a")).toEqual({ count: 2, lastUs: 30 });
    expect(map.has("b")).toBe(false);
    expect(toMicros(1_700_000_000_000)).toBe(1_700_000_000_000_000);
    expect(toMicros(0)).toBeNull();
  });

  it("uses the last run outcome for erroring, and disabled wins", () => {
    expect(detectionState({ enabled: true, last_outcome: "error" })).toBe("erroring");
    expect(detectionState({ enabled: true, last_outcome: "firing" })).toBe("enabled");
    expect(detectionState({ enabled: false, last_outcome: "error" })).toBe("disabled");
  });
});
