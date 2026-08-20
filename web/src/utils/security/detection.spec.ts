// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  SIEM_MARKER,
  buildDetectionAlert,
  detectionMetaOf,
  detectionName,
  detectionSql,
  isSiemDetection,
  whereOfDetectionSql,
} from "./detection";
import { parseSigmaRule, sigmaCatalog } from "./sigma";

const RULE = `title: AWS Root Account Activity
id: 2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1
description: Root should not be used after setup.
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    userIdentity.type: Root
  condition: selection
level: high
tags:
  - attack.privilege_escalation
  - attack.t1078.004`;

const rule = (() => {
  const parsed = parseSigmaRule(RULE);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.rule;
})();

const build = (overrides = {}) =>
  buildDetectionAlert({
    rule,
    where: `lower("useridentity_type") = 'root'`,
    fields: ["useridentity_type"],
    stream: "cloudtrail",
    destinations: ["soc-webhook"],
    sourceType: "aws_cloudtrail",
    ...overrides,
  });

describe("buildDetectionAlert", () => {
  it("produces a scheduled SQL alert on the right stream", () => {
    const alert = build();

    expect(alert.name).toBe("AWS_Root_Account_Activity");
    expect(alert.stream_name).toBe("cloudtrail");
    expect(alert.stream_type).toBe("logs");
    expect(alert.is_real_time).toBe(false);
    expect(alert.query_condition.type).toBe("sql");
    expect(alert.query_condition.sql).toBe(
      `SELECT "_timestamp", "useridentity_type" FROM "cloudtrail" WHERE lower("useridentity_type") = 'root'`,
    );
  });

  it("fires on a single match, because the rule already decided what is suspicious", () => {
    const { trigger_condition: trigger } = build();
    expect(trigger.threshold).toBe(1);
    expect(trigger.operator).toBe(">=");
  });

  it("carries the destination the API requires", () => {
    expect(build().destinations).toEqual(["soc-webhook"]);
  });

  it("opts into incident correlation, which is what makes a case", () => {
    expect(build().creates_incident).toBe(true);
  });

  it("stores the rule itself, so what runs can be read back", () => {
    const attributes = build().context_attributes;

    expect(attributes[SIEM_MARKER]).toBe("true");
    expect(attributes.sigma_yaml).toBe(RULE);
    expect(attributes.sigma_id).toBe("2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1");
    expect(attributes.sigma_level).toBe("high");
    expect(attributes.sigma_logsource).toBe("product=aws service=cloudtrail");
    expect(attributes.source_type).toBe("aws_cloudtrail");
  });

  it("keeps every context attribute a string, which is all the schema stores", () => {
    for (const value of Object.values(build().context_attributes)) {
      expect(typeof value).toBe("string");
    }
  });

  it("takes the schedule from the caller and defaults sensibly", () => {
    expect(build().trigger_condition).toMatchObject({ period: 15, frequency: 15, silence: 30 });
    expect(build({ period: 60, frequency: 5, silence: 0 }).trigger_condition).toMatchObject({
      period: 60,
      frequency: 5,
      silence: 0,
    });
  });
});

describe("detectionName", () => {
  // The backend rejects these outright, so a title carrying one cannot be saved
  // as written. Every rule in the shipped pack has spaces in its title.
  it("replaces every character the alerts API rejects", () => {
    expect(detectionName("Encoded PowerShell Command")).toBe("Encoded_PowerShell_Command");
    expect(detectionName("Web Shell / Admin Probing")).toBe("Web_Shell_Admin_Probing");
    expect(detectionName("a:b#c?d'e\"f%g&h")).toBe("a_b_c_d_e_f_g_h");
    expect(detectionName("a\\b")).toBe("a_b");
  });

  it("collapses a run of them into one separator", () => {
    expect(detectionName("Too   many    spaces")).toBe("Too_many_spaces");
  });

  it("does not leave a leading or trailing separator", () => {
    expect(detectionName("  padded  ")).toBe("padded");
  });

  it("never produces an empty name", () => {
    expect(detectionName("   ")).toBe("Untitled_detection");
  });

  it("produces a name the backend will accept unchanged", () => {
    // Mirrors RE_OFGA_UNSUPPORTED_NAME in src/core/src/auth.rs.
    const rejected = /[:#?\s'"%&/]/;
    for (const rule of sigmaCatalog()) {
      expect(rejected.test(detectionName(rule.title)), rule.title).toBe(false);
    }
  });
});

describe("detectionMetaOf", () => {
  it("reads back what buildDetectionAlert wrote", () => {
    const meta = detectionMetaOf(build());

    expect(meta.isSiem).toBe(true);
    expect(meta.level).toBe("high");
    expect(meta.severityId).toBe(4);
    expect(meta.techniques).toEqual(["T1078.004"]);
    expect(meta.tactics).toEqual(["privilege_escalation"]);
    expect(meta.sourceType).toBe("aws_cloudtrail");
  });

  it("treats an ordinary alert as not a detection", () => {
    expect(isSiemDetection({ name: "disk full", context_attributes: {} })).toBe(false);
    expect(isSiemDetection({ name: "disk full" })).toBe(false);
    expect(isSiemDetection(null)).toBe(false);
  });

  it("accepts the marker as a real boolean, which the API may return", () => {
    expect(isSiemDetection({ context_attributes: { siem: true } })).toBe(true);
  });

  it("survives attributes edited by hand into the wrong shape", () => {
    const meta = detectionMetaOf({
      context_attributes: { siem: "true", sigma_level: "SEVERE", mitre_techniques: "" },
    });
    // An unrecognised level falls back to medium rather than throwing away the
    // detection or inventing a severity at either extreme.
    expect(meta.level).toBe("medium");
    expect(meta.techniques).toEqual([]);
  });

  it("reads a technique list stored either way", () => {
    expect(
      detectionMetaOf({ context_attributes: { mitre_techniques: "T1078, T1110" } }).techniques,
    ).toEqual(["T1078", "T1110"]);
    expect(
      detectionMetaOf({ context_attributes: { mitre_techniques: ["T1078"] } }).techniques,
    ).toEqual(["T1078"]);
  });
});

describe("detectionSql", () => {
  // The alerts API rejects SELECT *, so the projection has to be explicit.
  it("projects the fields the rule matched on, so a firing carries its evidence", () => {
    expect(detectionSql("s", "a = 1", ["image", "commandline"])).toBe(
      `SELECT "_timestamp", "image", "commandline" FROM "s" WHERE a = 1`,
    );
  });

  it("always includes the timestamp, exactly once", () => {
    expect(detectionSql("s", "a = 1")).toBe(`SELECT "_timestamp" FROM "s" WHERE a = 1`);
    expect(detectionSql("s", "a = 1", ["_timestamp", "x"])).toBe(
      `SELECT "_timestamp", "x" FROM "s" WHERE a = 1`,
    );
  });

  it("does not repeat a field the rule referenced twice", () => {
    expect(detectionSql("s", "a = 1", ["x", "x"])).toBe(
      `SELECT "_timestamp", "x" FROM "s" WHERE a = 1`,
    );
  });

  it("never uses a star, which the alerts API rejects", () => {
    expect(detectionSql("s", "a = 1", ["x"])).not.toContain("*");
  });

  it("does not pin a time range, which the scheduler owns", () => {
    expect(detectionSql("s", "a = 1", ["x"])).not.toMatch(/between|now\(\)/i);
  });

  it("quotes a stream name containing a quote", () => {
    expect(detectionSql('we"ird', "a = 1")).toBe(`SELECT "_timestamp" FROM "we""ird" WHERE a = 1`);
  });
});

describe("whereOfDetectionSql", () => {
  it("recovers the predicate so a stored rule can be re-run over any window", () => {
    expect(whereOfDetectionSql(build().query_condition.sql)).toBe(
      `lower("useridentity_type") = 'root'`,
    );
  });

  it("returns nothing for a query it cannot read", () => {
    expect(whereOfDetectionSql("SELECT * FROM s")).toBe("");
    expect(whereOfDetectionSql(null)).toBe("");
  });
});
