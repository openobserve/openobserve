// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  checksByRule,
  detectionState,
  groupByLogsource,
  installedBySigmaId,
  rulesForSource,
  sourcesForRule,
  streamsBySource,
  matchedRunnable,
  ruleCounts,
  ruleStreams,
  streamsForRule,
  toMicros,
} from "./content";
import type { CatalogRule } from "@/services/securitySigma";
import {
  SOURCE_TYPES_FIXTURE,
  SOURCE_TYPE_BY_ID,
} from "@/views/Security/__fixtures__/securitySourceTypes";

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

const catalogRule = (key: string, sources: string[], logsourceLabel: string): CatalogRule => ({
  key,
  id: key,
  title: key,
  description: null,
  status: null,
  author: null,
  date: null,
  modified: null,
  level: "high",
  tags: [],
  techniques: [],
  tactics: [],
  falsepositives: [],
  references: [],
  logsource: {},
  logsourceLabel,
  correlation: false,
  timespanMinutes: null,
  yaml: "",
  sources,
});

const ctRule = catalogRule(
  "ct1",
  ["aws_cloudtrail", "ocsf_native"],
  "product=aws service=cloudtrail",
);
const oktaRule = catalogRule("okta1", ["okta_system_log"], "product=okta service=okta");
const ct2 = catalogRule("ct2", ["aws_cloudtrail"], "product=aws service=cloudtrail");

describe("source matching", () => {
  const cloudtrail = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;

  it("links a rule to the source types it was written for, and back", () => {
    expect(sourcesForRule(ctRule, SOURCE_TYPES_FIXTURE).map((s) => s.id)).toEqual([
      "ocsf_native",
      "aws_cloudtrail",
    ]);
    expect(rulesForSource(cloudtrail, [ctRule, oktaRule, ct2])).toEqual([ctRule, ct2]);
  });

  it("finds the org's streams a rule can run on", () => {
    const bySource = streamsBySource([
      { name: "ct", fields: ["eventname", "eventsource"], sourceId: "aws_cloudtrail" },
      { name: "empty", fields: [], sourceId: null },
    ]);
    expect(bySource.get("aws_cloudtrail")).toEqual(["ct"]);
    expect(streamsForRule(ctRule, bySource)).toEqual(["ct"]);
  });
});

describe("checksByRule", () => {
  it("records per stream how each rule the server compiled runs there", () => {
    const cloudtrail = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;
    const compiled = (runnable: boolean) => ({
      where: runnable ? "x" : "",
      runnable,
      unsupported: [],
      assumedAbsent: [],
      fields: [],
    });
    const checks = checksByRule([
      {
        stream: "ct",
        source: cloudtrail,
        applicable: [
          { key: "ct1", compiled: compiled(true) },
          { key: "ct2", compiled: compiled(false) },
        ],
      },
      {
        stream: "ct_b",
        source: cloudtrail,
        applicable: [{ key: "ct1", compiled: compiled(true) }],
      },
    ]);
    expect(checks.get("ct1")?.map((c) => c.stream)).toEqual(["ct", "ct_b"]);
    expect(checks.get("ct2")?.[0].compiled.runnable).toBe(false);
  });
});

describe("groupByLogsource", () => {
  it("counts rules per logsource, busiest first", () => {
    const groups = groupByLogsource([ctRule, oktaRule, ct2]);
    expect(groups).toEqual([
      { key: "product=aws service=cloudtrail", label: "product=aws service=cloudtrail", count: 2 },
      { key: "product=okta service=okta", label: "product=okta service=okta", count: 1 },
    ]);
  });
});

describe("detection state", () => {
  it("converts ms to µs and treats 0 as unknown", () => {
    expect(toMicros(1_700_000_000_000)).toBe(1_700_000_000_000_000);
    expect(toMicros(0)).toBeNull();
  });

  it("uses the last run outcome for erroring, and disabled wins", () => {
    expect(detectionState({ enabled: true, last_outcome: "error" })).toBe("erroring");
    expect(detectionState({ enabled: true, last_outcome: "firing" })).toBe("enabled");
    expect(detectionState({ enabled: false, last_outcome: "error" })).toBe("disabled");
  });

  it("flags a rule whose notifications fail as notify failing, not healthy", () => {
    expect(detectionState({ enabled: true, last_outcome: "notify_failed" })).toBe("notifyFailing");
    expect(detectionState({ enabled: false, last_outcome: "notify_failed" })).toBe("disabled");
  });
});

describe("Content counters", () => {
  it("counts a rule the server compiled for a stream as applying, so ready never exceeds applies", () => {
    const bySource = new Map([["aws_cloudtrail", ["ct"]]]);
    const compiled = { where: "x", runnable: true, unsupported: [], assumedAbsent: [], fields: [] };
    const check = { stream: "edr", source: SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!, compiled };
    expect(ruleStreams(oktaRule, bySource, [check])).toEqual(["edr"]);
    expect(ruleStreams(ctRule, bySource, [{ ...check, stream: "ct" }])).toEqual(["ct"]);

    const rows = [
      { streams: ruleStreams(oktaRule, bySource, [check]), runnable: ["edr"], installed: false },
      { streams: ["ct"], runnable: ["ct"], installed: true },
      { streams: ["ct"], runnable: [], installed: false },
      { streams: [], runnable: [], installed: false },
    ];
    const counts = ruleCounts(rows);
    expect(counts).toEqual({ ready: 1, installed: 1, applies: 3 });
    expect(counts.ready).toBeLessThanOrEqual(counts.applies);
  });

  it("does not count a rule as ready when it only compiles on another source's streams", () => {
    const compiled = { where: "x", runnable: true, unsupported: [], assumedAbsent: [], fields: [] };
    const okta = SOURCE_TYPE_BY_ID.get("okta_system_log")!;
    const ct = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;
    const generic = { ...ctRule, sources: ["ocsf_native"] } as CatalogRule;
    const checks = [
      { stream: "okta", source: okta, compiled },
      { stream: "ct", source: ct, compiled },
    ];
    expect(matchedRunnable(generic, checks)).toEqual([]);
    expect(matchedRunnable(ctRule, checks)).toEqual(["ct"]);
    const counts = ruleCounts([
      { streams: ["okta", "ct"], runnable: ["okta", "ct"], matched: [], installed: false },
      { streams: ["ct"], runnable: ["ct"], matched: ["ct"], installed: false },
    ]);
    expect(counts.ready).toBe(1);
  });
});
