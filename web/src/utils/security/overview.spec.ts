// Copyright 2026 OpenObserve Inc.
//
// The small helpers behind the SOC Overview and the Events page: severity
// tones, ATT&CK tactic coverage, source health and history bucketing.

import { describe, expect, it } from "vitest";

import { bucketMsFor, bucketize, isEvalError, isFiring, type HistoryRow } from "./history";
import { normalizeTactic, tacticCoverage, techniqueUrl } from "./mitre";
import { SOURCE_TYPE_BY_ID } from "./sourceTypes";
import { sourceColumnFor } from "./normalize";
import {
  severityRailColor,
  severityTagValue,
  toneOfSeverityId,
  toneOfSigmaLevel,
} from "./severity";
import { QUIET_AFTER_US, securityStreamNames, sourceHealth } from "./streams";

describe("severity tones", () => {
  it("folds OCSF ids, Sigma levels and case priorities onto one scale", () => {
    expect(toneOfSeverityId(6)).toBe("critical");
    expect(toneOfSeverityId(5)).toBe("critical");
    expect(toneOfSeverityId(1)).toBe("info");
    expect(toneOfSeverityId(0)).toBe("unknown");
    expect(toneOfSeverityId(99)).toBe("unknown");
    expect(toneOfSigmaLevel("informational")).toBe("info");
    expect(toneOfSigmaLevel("high")).toBe("high");
  });

  it("never hands the severity chip registry a value it has no entry for", () => {
    expect(severityTagValue("unknown")).toBe("info");
    expect(severityTagValue("high")).toBe("high");
  });

  it("draws the rail from a token, not a literal colour", () => {
    expect(severityRailColor("critical")).toMatch(/^var\(--color-/);
  });
});

describe("ATT&CK", () => {
  it("normalises tactic spellings", () => {
    expect(normalizeTactic("defense-evasion")).toBe("defense_evasion");
    expect(normalizeTactic("Command And Control")).toBe("command_and_control");
    expect(normalizeTactic("t1078")).toBeNull();
  });

  it("links sub-techniques with a path segment", () => {
    expect(techniqueUrl("T1078.004")).toBe("https://attack.mitre.org/techniques/T1078/004/");
    expect(techniqueUrl("t1110")).toBe("https://attack.mitre.org/techniques/T1110/");
  });

  it("counts enabled rules and firings per tactic, in matrix order", () => {
    const coverage = tacticCoverage(
      [
        { tactics: ["credential_access", "credential-access"], enabled: true },
        { tactics: ["persistence"], enabled: false },
      ],
      [{ tactics: ["credential_access"] }, { tactics: ["credential_access"] }],
    );
    expect(coverage[0].tactic).toBe("reconnaissance");
    const cred = coverage.find((c) => c.tactic === "credential_access")!;
    expect(cred).toEqual({ tactic: "credential_access", rules: 1, firings: 2 });
    expect(coverage.find((c) => c.tactic === "persistence")!.rules).toBe(0);
  });
});

describe("source health", () => {
  const now = 1_000_000_000_000_000;
  it("separates never-ingested from gone-quiet", () => {
    expect(sourceHealth({ doc_num: 0 }, now)).toBe("never");
    expect(sourceHealth(null, now)).toBe("never");
    expect(sourceHealth({ doc_num: 5, doc_time_max: now - 1000 }, now)).toBe("live");
    expect(sourceHealth({ doc_num: 5, doc_time_max: now - QUIET_AFTER_US - 1 }, now)).toBe("quiet");
  });

  it("lists detected streams first and hand-added ones after, without duplicates", () => {
    expect(
      securityStreamNames(["okta_logs", "nginx", "app"], ["nginx", "okta_logs", "gone"]),
    ).toEqual(["okta_logs", "nginx"]);
  });
});

describe("history", () => {
  const row = (over: Partial<HistoryRow>): HistoryRow => ({
    timestamp: 0,
    alert_name: "a",
    status: "ok",
    level: "ok",
    actual_value: 0,
    threshold_operator: null,
    start_time: 0,
    end_time: 0,
    error: null,
    is_silenced: false,
    evaluation_took_in_secs: null,
    ...over,
  });

  it("trusts the server's normalised status, not level or actual_value", () => {
    expect(isFiring(row({ status: "firing" }))).toBe(true);
    // Matched, only the notification failed: still a firing.
    expect(isFiring(row({ status: "notify_failed" }))).toBe(true);
    // Three rows seen against a threshold of 100 is a normal run.
    expect(isFiring(row({ status: "normal", actual_value: 3 }))).toBe(false);
    // Older rows carry no level; that is not a firing either.
    expect(isFiring(row({ status: "normal", level: undefined as unknown as string }))).toBe(false);
    expect(isFiring(row({ status: "error", error: "boom" }))).toBe(false);
    expect(isEvalError(row({ status: "error" }))).toBe(true);
  });

  it("buckets across the whole window, keeping empty buckets", () => {
    const buckets = bucketize(
      [
        { timeMs: 0, key: "high" as const },
        { timeMs: 59_999, key: "high" as const },
        { timeMs: 120_000, key: "low" as const },
      ],
      0,
      180_000,
      60_000,
      ["high", "low"] as const,
    );
    expect(buckets.map((b) => b.counts)).toEqual([
      { high: 2, low: 0 },
      { high: 0, low: 0 },
      { high: 0, low: 1 },
    ]);
    expect(bucketMsFor(24 * 3_600_000)).toBe(3_600_000);
  });
});

describe("sourceColumnFor", () => {
  const cloudtrail = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;

  it("finds the stored column a normalized value came from", () => {
    const raw = { useridentity_arn: "arn:aws:iam::1:user/bob", sourceipaddress: "1.2.3.4" };
    expect(sourceColumnFor(raw, cloudtrail, "actor")).toBe("useridentity_arn");
    expect(sourceColumnFor(raw, cloudtrail, "srcIp")).toBe("sourceipaddress");
  });

  it("returns null for a value that came from a constant", () => {
    expect(sourceColumnFor({ eventname: "x" }, cloudtrail, "product")).toBeNull();
  });
});
