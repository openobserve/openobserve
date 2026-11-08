// Copyright 2026 OpenObserve Inc.

// Sigma API answers for component specs, in the shapes the server returns.
import type {
  CatalogRule,
  CompiledSigma,
  MitreCoverage,
  SigmaCompileRequest,
  SigmaCompileResponse,
  TechniqueCell,
} from "@/services/securitySigma";
import { RULE_ACCESS_KEY, RULE_STOP_LOGGING } from "./securityFixtures";

export const ROOT_RULE_ID = "2b1a2a3d-6b41-4e58-91f0-31b7e4b8b7a1";
export const TRAVEL_RULE_ID = "01932551-8222-400e-8529-a9e1c31d8447";

export const catalogRule = (overrides: Partial<CatalogRule>): CatalogRule => ({
  key: overrides.id ?? overrides.title ?? "",
  id: null,
  title: "",
  description: null,
  status: "stable",
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
  logsourceLabel: "",
  correlation: false,
  timespanMinutes: null,
  yaml: "",
  sources: [],
  ...overrides,
});

export const rootRule = catalogRule({
  id: ROOT_RULE_ID,
  title: "AWS Root Account Activity",
  description: "Root should not be used after setup.",
  techniques: ["T1078.004"],
  tactics: ["privilege_escalation"],
  logsource: { product: "aws", service: "cloudtrail" },
  logsourceLabel: "product=aws service=cloudtrail",
  yaml: "title: AWS Root Account Activity\n",
  sources: ["ocsf_native", "aws_cloudtrail"],
});

export const travelRule = catalogRule({
  id: TRAVEL_RULE_ID,
  title: "Okta Impossible Travel",
  techniques: ["T1078.004"],
  tactics: ["initial_access"],
  logsource: { product: "okta", service: "okta" },
  logsourceLabel: "product=okta service=okta",
  correlation: true,
  timespanMinutes: 60,
  yaml: "title: Okta Impossible Travel\n",
  sources: ["okta_system_log"],
});

const seedRule = (seed: typeof RULE_STOP_LOGGING) =>
  catalogRule({
    id: seed.id,
    title: seed.title,
    level: seed.level as CatalogRule["level"],
    techniques: [seed.techniques],
    tactics: [seed.tactics],
    logsource: { product: "aws", service: "cloudtrail" },
    logsourceLabel: seed.logsource,
    sources: ["ocsf_native", "aws_cloudtrail"],
  });
export const stopLoggingRule = seedRule(RULE_STOP_LOGGING);
export const accessKeyRule = seedRule(RULE_ACCESS_KEY);

export const sigmaCatalogFixture = {
  rules: [rootRule, stopLoggingRule, accessKeyRule, travelRule],
  errors: [],
};

const runnable = (where: string, fields: string[]): CompiledSigma => ({
  where,
  runnable: true,
  unsupported: [],
  assumedAbsent: [],
  fields,
});

const TRAVEL_WHERE = `(lower("eventtype") = 'user.session.start' AND lower("outcome_result") = 'success')`;

/** What the compile endpoint answers for the fixture rules. */
export function compileFixture(body: SigmaCompileRequest): SigmaCompileResponse {
  const empty: SigmaCompileResponse = {
    rule: null,
    compiled: null,
    correlation: null,
    applies: true,
    ocsfBridge: null,
    applicable: [],
    parseError: null,
  };
  const rule = sigmaCatalogFixture.rules.find((r) => r.key === body.rule_id) ?? null;
  if (!rule) {
    return body.rule_yaml
      ? { ...empty, parseError: "Rule has no detection block" }
      : {
          ...empty,
          applicable: sigmaCatalogFixture.rules
            .filter((r) => r.sources.includes(body.source_type ?? ""))
            .map((r) => ({ key: r.key, compiled: runnable(`lower("x") = 'y'`, ["x"]) })),
        };
  }
  if (rule !== travelRule) {
    return {
      ...empty,
      rule,
      compiled: runnable(`lower("useridentity_type") = 'root'`, ["useridentity_type"]),
    };
  }
  const stream = body.stream ?? "";
  return {
    ...empty,
    rule,
    compiled: runnable(TRAVEL_WHERE, ["eventtype", "outcome_result"]),
    correlation: {
      sql:
        `SELECT "actor_alternateid" AS "actor_alternateid", COUNT(*) AS "event_count", ` +
        `COUNT(DISTINCT "client_geographicalcontext_country") AS "value_count", ` +
        `MIN("_timestamp") AS "first_seen", MAX("_timestamp") AS "last_seen" FROM "${stream}" ` +
        `WHERE ${TRAVEL_WHERE} GROUP BY "actor_alternateid" HAVING COUNT(DISTINCT "client_geographicalcontext_country") >= 2`,
      where: TRAVEL_WHERE,
      groupColumns: ["actor_alternateid"],
      timespanMinutes: 60,
      runnable: true,
      reason: "",
    },
  };
}

const cell = (over: Partial<TechniqueCell> & { id: string }): TechniqueCell => ({
  name: "",
  tactics: [],
  catalogRules: [],
  detections: [],
  enabledCount: 0,
  firings: 0,
  lastFiredMs: null,
  state: "none",
  ...over,
});

const seedDetection = (seed: typeof RULE_STOP_LOGGING, id: string) => ({
  id,
  name: `${seed.title.replace(/\s+/g, "_")}__${seed.stream}`,
  enabled: true,
  sigmaId: seed.id,
  level: seed.level,
  techniques: [seed.techniques],
  tactics: [seed.tactics],
});

/** Coverage the server computes for the seed catalog and the two seed detections. */
export const coverageFixture: MitreCoverage = {
  attackVersion: "18.1",
  matrix: {
    columns: [
      { tactic: "initial_access", cells: ["T1078.004"] },
      { tactic: "persistence", cells: ["T1098.001"] },
      { tactic: "privilege_escalation", cells: ["T1078.004"] },
      { tactic: "defense_evasion", cells: ["T1562.008"] },
      { tactic: "credential_access", cells: ["T1003"] },
    ],
    unmapped: [],
    cells: [
      cell({ id: "T1003", name: "OS Credential Dumping", tactics: ["credential_access"] }),
      cell({
        id: "T1078.004",
        name: "Cloud Accounts",
        tactics: ["initial_access", "privilege_escalation"],
        catalogRules: [ROOT_RULE_ID, TRAVEL_RULE_ID],
        state: "available",
      }),
      cell({
        id: "T1098.001",
        name: "Additional Cloud Credentials",
        tactics: ["persistence"],
        catalogRules: [RULE_ACCESS_KEY.id],
        detections: [seedDetection(RULE_ACCESS_KEY, "alert-access-key")],
        enabledCount: 1,
        state: "covered",
      }),
      cell({
        id: "T1562.008",
        name: "Disable or Modify Cloud Logs",
        tactics: ["defense_evasion"],
        catalogRules: [RULE_STOP_LOGGING.id],
        detections: [seedDetection(RULE_STOP_LOGGING, "alert-stop-logging")],
        enabledCount: 1,
        state: "covered",
      }),
    ],
  },
  summary: {
    tacticsCovered: 2,
    tacticsTotal: 14,
    techniquesCovered: 2,
    techniquesTotal: 4,
    techniquesFiring: 0,
    gaps: 2,
  },
};

const ok = <T>(data: T) => ({ data, status: 200, statusText: "OK", headers: {}, config: {} });

/** A stand-in for the `securitySigma` service module. */
export const mockSigmaService = () => ({
  default: {
    catalog: async () => ok(sigmaCatalogFixture),
    compile: async (_org: string, body: SigmaCompileRequest) => ok(compileFixture(body)),
    coverage: async () => ok(coverageFixture),
    evidence: async () => ok({ stream: "", correlation: false, stored: false, groups: [] }),
    addColumns: async () => ok({}),
  },
});
