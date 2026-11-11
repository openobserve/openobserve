// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  BACKFILL_ATTRIBUTE,
  GROUP_BY_ATTRIBUTE,
  SIEM_MARKER,
  TIMESPAN_ATTRIBUTE,
  buildDetectionAlert,
  detectionMetaOf,
  detectionAlertName,
  detectionName,
  detectionSql,
  isSiemDetection,
  preferServerSql,
  sigmaMetadata,
  whereOfDetectionSql,
} from "./detection";
import type { CatalogRule, CompiledCorrelation } from "@/services/securitySigma";

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

const catalogRule = (overrides: Partial<CatalogRule>): CatalogRule => ({
  key: "",
  id: null,
  title: "",
  description: null,
  status: null,
  author: null,
  date: null,
  modified: null,
  level: null,
  tags: [],
  techniques: [],
  tactics: [],
  falsepositives: [],
  references: [],
  logsource: {},
  logsourceLabel: "",
  correlation: false,
  timespanMinutes: null,
  yaml: "",
  sources: [],
  ...overrides,
});

const ROOT_RULE_ID = "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1";

const rule = catalogRule({
  key: ROOT_RULE_ID,
  id: ROOT_RULE_ID,
  title: "AWS Root Account Activity",
  description: "Root should not be used after setup.",
  level: "high",
  techniques: ["T1078.004"],
  tactics: ["privilege_escalation"],
  logsource: { product: "aws", service: "cloudtrail" },
  yaml: RULE,
});

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

    expect(alert.name).toBe("AWS_Root_Account_Activity__cloudtrail");
    expect(alert.stream_name).toBe("cloudtrail");
    expect(alert.stream_type).toBe("logs");
    expect(alert.is_real_time).toBe(false);
    expect(alert.query_condition.type).toBe("sql");
    expect(alert.query_condition.sql).toBe(
      `SELECT "_timestamp", "useridentity_type" FROM "cloudtrail" WHERE lower("useridentity_type") = 'root'`,
    );
  });

  it("runs the server-built SQL when the compile response carries it", () => {
    const serverSql = `SELECT "_timestamp", "host_name", "user_name" FROM "cloudtrail" WHERE x = 1`;
    expect(build({ sql: serverSql }).query_condition.sql).toBe(serverSql);
  });

  it("builds the SQL itself when the server sent none", () => {
    expect(build({ sql: "" }).query_condition.sql).toBe(
      `SELECT "_timestamp", "useridentity_type" FROM "cloudtrail" WHERE lower("useridentity_type") = 'root'`,
    );
  });

  it("fires on a single match, because the rule already decided what is suspicious", () => {
    const { trigger_condition: trigger } = build();
    expect(trigger.threshold).toBe(1);
    expect(trigger.operator).toBe(">=");
  });

  it("carries the chosen destinations", () => {
    expect(build().destinations).toEqual(["soc-webhook"]);
  });

  it("still opens cases when no destination is chosen, since notifying is optional", () => {
    const alert = build({ destinations: [] });
    expect(alert.destinations).toEqual([]);
    expect(alert.creates_incident).toBe(true);
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
  // The backend rejects these characters outright, so a title carrying one cannot be saved as is.
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
    for (const title of [
      "Okta: MFA Factor Reset / Deactivated",
      "Possible C2 Beaconing With Fixed-Size Flows",
      "Web Request With 'Shell' & \"Quotes\" 100% #1?",
    ]) {
      expect(rejected.test(detectionName(title)), title).toBe(false);
    }
  });
});

describe("buildDetectionAlert for a correlation", () => {
  const travelId = "01932551-8222-400e-8529-a9e1c31d8447";
  const travel = catalogRule({
    key: travelId,
    id: travelId,
    title: "Okta Impossible Travel",
    level: "high",
    techniques: ["T1078.004"],
    tactics: ["initial_access"],
    logsource: { product: "okta", service: "okta" },
    correlation: true,
    timespanMinutes: 60,
  });
  const where = `(lower("eventtype") = 'user.session.start' AND lower("outcome_result") = 'success')`;
  // As the server compiles it (o2-enterprise siem::sigma golden fixtures).
  const compiled: CompiledCorrelation = {
    sql:
      `SELECT "actor_alternateid" AS "actor_alternateid", COUNT(*) AS "event_count", ` +
      `COUNT(DISTINCT "client_geographicalcontext_country") AS "value_count", ` +
      `MIN("_timestamp") AS "first_seen", MAX("_timestamp") AS "last_seen" FROM "okta_auth" ` +
      `WHERE ${where} GROUP BY "actor_alternateid" HAVING COUNT(DISTINCT "client_geographicalcontext_country") >= 2`,
    where,
    groupColumns: ["actor_alternateid"],
    timespanMinutes: 60,
    runnable: true,
    reason: "",
  };
  const grouped = (overrides = {}) =>
    buildDetectionAlert({
      rule: travel,
      where: compiled.where,
      stream: "okta_auth",
      destinations: [],
      sourceType: "okta_system_log",
      correlation: compiled,
      ...overrides,
    });

  it("runs the compiled GROUP BY query over windows of the correlation's timespan", () => {
    const alert = grouped({ period: 15, frequency: 15 });
    expect(alert.query_condition.type).toBe("sql");
    expect(alert.query_condition.sql).toBe(compiled.sql);
    expect(alert.query_condition.sql).not.toMatch(/_timestamp\s*[<>]/);
    expect(alert.trigger_condition).toMatchObject({
      period: 60,
      operator: ">=",
      threshold: 1,
      frequency: 15,
    });
  });

  it("keeps a look-back wider than the timespan, which the windows slide across", () => {
    expect(grouped({ period: 120, frequency: 5 }).trigger_condition).toMatchObject({
      period: 120,
      frequency: 5,
    });
    expect(grouped().context_attributes[TIMESPAN_ATTRIBUTE]).toBe("60");
  });

  it("records an opted-in backfill only when one was chosen", () => {
    expect(BACKFILL_ATTRIBUTE in grouped().context_attributes).toBe(false);
    expect(BACKFILL_ATTRIBUTE in build({ backfillMinutes: 0 }).context_attributes).toBe(false);
    expect(build({ backfillMinutes: 1440 }).context_attributes[BACKFILL_ATTRIBUTE]).toBe("1440");
  });

  it("never runs less often than once per window", () => {
    expect(grouped({ frequency: 240 }).trigger_condition.frequency).toBe(60);
  });

  it("marks the detection grouped, with its SIEM attributes", () => {
    const attrs = grouped().context_attributes;
    expect(attrs[SIEM_MARKER]).toBe("true");
    expect(attrs.sigma_level).toBe("high");
    expect(attrs.sigma_id).toBe(travel.id);
    expect(attrs.mitre_techniques).toBe("T1078.004");
    expect(attrs[GROUP_BY_ATTRIBUTE]).toBe("actor_alternateid");
    expect(compiled.sql).toContain(`AS "last_seen"`);
  });

  it("keeps the group-by attribute, empty, for a correlation over the whole stream", () => {
    const attrs = grouped({ correlation: { ...compiled, groupColumns: [] } }).context_attributes;
    expect(attrs[GROUP_BY_ATTRIBUTE]).toBe("");
  });

  it("leaves a single-event detection ungrouped", () => {
    expect(GROUP_BY_ATTRIBUTE in build().context_attributes).toBe(false);
    expect(TIMESPAN_ATTRIBUTE in build().context_attributes).toBe(false);
  });

  it("gives the Events page the predicate alone, not the aggregation after it", () => {
    expect(whereOfDetectionSql(compiled.sql)).toBe(compiled.where);
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
    // An unknown level falls back to medium rather than dropping the detection or picking an extreme.
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

describe("preferServerSql", () => {
  it("prefers the server's SQL, which projects host and user columns", () => {
    const serverSql = `SELECT "_timestamp", "host", "user" FROM "s" WHERE a = 1`;
    expect(preferServerSql(serverSql, "s", "a = 1", ["x"])).toBe(serverSql);
  });

  it("falls back to the local projection when the server sent none or a blank one", () => {
    const local = `SELECT "_timestamp", "x" FROM "s" WHERE a = 1`;
    expect(preferServerSql(undefined, "s", "a = 1", ["x"])).toBe(local);
    expect(preferServerSql("  ", "s", "a = 1", ["x"])).toBe(local);
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

describe("detectionAlertName", () => {
  it("is unique per stream and stays within the name limit", () => {
    expect(detectionAlertName("AWS Root Account Activity", "cloudtrail_audit")).toBe(
      "AWS_Root_Account_Activity__cloudtrail_audit",
    );
    expect(detectionAlertName("x", "a")).not.toBe(detectionAlertName("x", "b"));
    expect(detectionAlertName("t".repeat(200), "stream").length).toBeLessThanOrEqual(100);
  });
});

describe("whereOfDetectionSql with awkward names", () => {
  it("ignores 'where' inside quoted stream names and literals", () => {
    expect(
      whereOfDetectionSql(`SELECT "_timestamp" FROM "audit-where" WHERE "msg" = 'where are you'`),
    ).toBe(`"msg" = 'where are you'`);
    expect(whereOfDetectionSql(`SELECT * FROM "s"`)).toBe("");
  });
});

describe("sigmaMetadata", () => {
  it("reads a stored rule's title, description and false positives for display", () => {
    const meta = sigmaMetadata(`${RULE}\nfalsepositives: Break-glass access`);
    expect(meta.title).toBe("AWS Root Account Activity");
    expect(meta.description).toBe("Root should not be used after setup.");
    expect(meta.falsepositives).toEqual(["Break-glass access"]);
    expect(sigmaMetadata("title: [unclosed")).toEqual({
      title: "",
      description: "",
      falsepositives: [],
    });
  });
});
