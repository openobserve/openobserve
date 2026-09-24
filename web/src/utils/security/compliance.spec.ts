// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { SOURCE_TYPE_BY_ID } from "./sourceTypes";

import {
  CONTROLS,
  FRAMEWORKS,
  capabilitiesOf,
  effectiveRetentionDays,
  evaluateControl,
  evaluateRequirement,
  scoreControls,
  statusRailColor,
  unmappedNormalizedFields,
  type ComplianceSignals,
  type DetectionSignal,
  type SourceSignal,
} from "./compliance";

const source = (over: Partial<SourceSignal> = {}): SourceSignal => ({
  name: "cloudtrail",
  health: "live",
  sourceId: "aws_cloudtrail",
  label: "AWS CloudTrail",
  security: true,
  retentionDays: 3650,
  unmappedFields: [],
  ...over,
});

const det = (over: Partial<DetectionSignal> = {}): DetectionSignal => ({
  name: "rule",
  enabled: true,
  tactics: [],
  techniques: [],
  evaluations: 10,
  errors: 0,
  runsComplete: true,
  ...over,
});

const signals = (over: Partial<ComplianceSignals> = {}): ComplianceSignals => ({
  sources: [],
  detections: [],
  caseCount: null,
  ...over,
});

describe("control catalogue", () => {
  it("has unique ids and covers every framework", () => {
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(CONTROLS.length);
    for (const f of FRAMEWORKS) expect(CONTROLS.some((c) => c.framework === f)).toBe(true);
  });
});

describe("capabilities", () => {
  it("only credits identified security sources", () => {
    expect(capabilitiesOf(source())).toContain("authentication");
    expect(capabilitiesOf(source({ security: false }))).toEqual([]);
    expect(capabilitiesOf(source({ sourceId: null }))).toEqual([]);
  });
});

describe("evaluateRequirement", () => {
  it("anySource: live is met, only silent sources is partial, none is missing", () => {
    expect(
      evaluateRequirement({ kind: "anySource" }, signals({ sources: [source()] })).status,
    ).toBe("met");
    expect(
      evaluateRequirement(
        { kind: "anySource" },
        signals({ sources: [source({ health: "quiet" })] }),
      ).status,
    ).toBe("partial");
    expect(evaluateRequirement({ kind: "anySource" }, signals()).status).toBe("missing");
  });

  it("anySource: a live stream that is not identified as security is not evidence", () => {
    const res = evaluateRequirement(
      { kind: "anySource" },
      signals({ sources: [source({ name: "app_events", security: false, sourceId: null })] }),
    );
    expect(res.status).toBe("partial");
    expect(res.evidence).toEqual([]);
    expect(res.shortfall).toEqual(["app_events"]);
  });

  it("capability: an unidentified stream does not count", () => {
    const res = evaluateRequirement(
      { kind: "capability", capability: "authentication" },
      signals({
        sources: [source({ name: "syslog", sourceId: "syslog_generic", security: false })],
      }),
    );
    expect(res.status).toBe("missing");
  });

  it("normalized: partial when some reporting sources are unidentified", () => {
    const res = evaluateRequirement(
      { kind: "normalized" },
      signals({ sources: [source(), source({ name: "app", security: false })] }),
    );
    expect(res.status).toBe("partial");
    expect(res.evidence).toEqual(["cloudtrail"]);
    expect(res.shortfall).toEqual(["app"]);
  });

  it("normalized: an identified source whose actor/time/outcome do not resolve is a shortfall", () => {
    const res = evaluateRequirement(
      { kind: "normalized" },
      signals({ sources: [source({ unmappedFields: ["actor"] })] }),
    );
    expect(res.status).toBe("missing");
    expect(res.shortfall).toEqual(["cloudtrail"]);
  });

  it("retention: compares every reporting source, unknown when retention cannot be read", () => {
    const req = { kind: "retention", minDays: 365 } as const;
    expect(
      evaluateRequirement(req, signals({ sources: [source({ retentionDays: 400 })] })).status,
    ).toBe("met");
    expect(
      evaluateRequirement(
        req,
        signals({
          sources: [source({ retentionDays: 400 }), source({ name: "b", retentionDays: 30 })],
        }),
      ).status,
    ).toBe("partial");
    expect(
      evaluateRequirement(req, signals({ sources: [source({ retentionDays: null })] })).status,
    ).toBe("unknown");
  });

  it("detectionTactics: disabled rules are a shortfall, not evidence", () => {
    const req = { kind: "detectionTactics", tactics: ["credential_access"] } as const;
    const brute = det({ name: "brute", tactics: ["credential-access"] });
    expect(evaluateRequirement(req, signals({ detections: [brute] })).status).toBe("met");
    const off = evaluateRequirement(req, signals({ detections: [{ ...brute, enabled: false }] }));
    expect(off.status).toBe("partial");
    expect(off.shortfall).toEqual(["brute"]);
  });

  it("detectionTactics: an enabled rule that never ran, or errored, is not coverage", () => {
    const req = { kind: "detectionTactics", tactics: ["credential_access"] } as const;
    const tactics = ["credential_access"];
    for (const d of [det({ tactics, evaluations: 0 }), det({ tactics, errors: 2 })]) {
      const res = evaluateRequirement(req, signals({ detections: [d] }));
      expect(res.status).toBe("partial");
      expect(res.evidence).toEqual([]);
    }
  });

  it("reviewRunning: every enabled rule must have run without errors", () => {
    const d = (name: string, evaluations: number, errors = 0) => det({ name, evaluations, errors });
    const req = { kind: "reviewRunning" } as const;
    expect(evaluateRequirement(req, signals({ detections: [d("a", 5)] })).status).toBe("met");
    expect(evaluateRequirement(req, signals({ detections: [d("a", 5), d("b", 0)] })).status).toBe(
      "partial",
    );
    expect(evaluateRequirement(req, signals({ detections: [d("a", 5, 1)] })).status).toBe(
      "missing",
    );
    expect(evaluateRequirement(req, signals()).status).toBe("missing");
    // Partly read history may hide errors: not assessable rather than met.
    expect(
      evaluateRequirement(req, signals({ detections: [det({ runsComplete: false })] })).status,
    ).toBe("unknown");
  });

  it("caseManagement: met only when cases were opened, never from the build", () => {
    const req = { kind: "caseManagement" } as const;
    expect(evaluateRequirement(req, signals({ caseCount: null })).status).toBe("unknown");
    expect(evaluateRequirement(req, signals({ caseCount: 0 })).status).toBe("partial");
    expect(evaluateRequirement(req, signals({ caseCount: 3 })).status).toBe("met");
  });

  it("retention: only identified security sources are assessed", () => {
    const req = { kind: "retention", minDays: 90 } as const;
    const res = evaluateRequirement(
      req,
      signals({ sources: [source({ name: "app", security: false, retentionDays: 3650 })] }),
    );
    expect(res.status).toBe("missing");
    expect(
      evaluateRequirement(req, signals({ sources: [source({ retentionDays: Infinity })] })).status,
    ).toBe("met");
  });

  it("detectionTactics: a rule whose history was only partly read is not assessable", () => {
    const req = { kind: "detectionTactics", tactics: ["credential_access"] } as const;
    const res = evaluateRequirement(
      req,
      signals({ detections: [det({ tactics: ["credential_access"], runsComplete: false })] }),
    );
    expect(res.status).toBe("unknown");
  });

  it("detectionTechniques: only rules for the named techniques count (10.7.2)", () => {
    const pci = CONTROLS.find((c) => c.id === "pci_10_7_2")!;
    const evasion = det({ tactics: ["defense_evasion"], techniques: ["T1562.001"] });
    expect(evaluateControl(pci, signals({ detections: [evasion] })).status).toBe("missing");
    const trail = det({ tactics: ["defense_evasion"], techniques: ["t1562.008"] });
    expect(evaluateControl(pci, signals({ detections: [trail] })).status).toBe("met");
  });

  it("detectionBreadth counts distinct tactics of enabled rules", () => {
    const d = (tactics: string[]) => det({ name: tactics[0], tactics });
    const req = { kind: "detectionBreadth", min: 3 } as const;
    expect(
      evaluateRequirement(
        req,
        signals({ detections: [d(["impact"]), d(["discovery", "execution"])] }),
      ).status,
    ).toBe("met");
    expect(evaluateRequirement(req, signals({ detections: [d(["impact"])] })).status).toBe(
      "partial",
    );
  });
});

describe("evaluateControl / scoreControls", () => {
  it("is met only when every requirement is", () => {
    const pci = CONTROLS.find((c) => c.id === "pci_10_2_1_4")!;
    const s = signals({ sources: [source()] });
    expect(evaluateControl(pci, s).status).toBe("partial");
    const withRule = signals({
      sources: [source()],
      detections: [det({ tactics: ["credential_access"] })],
    });
    expect(evaluateControl(pci, withRule).status).toBe("met");
  });

  it("scores assessable controls only, partial as half", () => {
    const control = CONTROLS[0];
    const mk = (status: "met" | "partial" | "missing" | "unknown") => ({
      control,
      status,
      requirements: [],
    });
    expect(scoreControls([mk("met"), mk("partial"), mk("missing"), mk("unknown")])).toEqual({
      met: 1,
      partial: 1,
      missing: 1,
      unknown: 1,
      score: 50,
    });
    expect(scoreControls([mk("unknown")]).score).toBeNull();
  });
});

describe("unmappedNormalizedFields", () => {
  const cloudtrail = SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!;
  it("resolves actor, time and outcome against the stream's real columns", () => {
    expect(
      unmappedNormalizedFields(cloudtrail, ["_timestamp", "useridentity_arn", "errorcode"]),
    ).toEqual([]);
    expect(unmappedNormalizedFields(cloudtrail, ["_timestamp", "eventname"])).toEqual([
      "actor",
      "outcome",
    ]);
    expect(unmappedNormalizedFields(null, ["x"])).toEqual(["actor", "time", "outcome"]);
  });
});

describe("helpers", () => {
  it("prefers the stream's own retention, then the server-wide value", () => {
    expect(effectiveRetentionDays(30, 3650)).toBe(30);
    expect(effectiveRetentionDays(0, 3650)).toBe(3650);
  });

  it("treats a server retention of 0 or less as never deleted, and unknown as unknown", () => {
    // The retention job does not run at all, stream settings included.
    expect(effectiveRetentionDays(30, 0)).toBe(Infinity);
    expect(effectiveRetentionDays(0, -1)).toBe(Infinity);
    expect(effectiveRetentionDays(30, undefined)).toBeNull();
  });

  it("draws the rail from a token", () => {
    expect(statusRailColor("met")).toMatch(/^var\(--color-/);
  });
});
