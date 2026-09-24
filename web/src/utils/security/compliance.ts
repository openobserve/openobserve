// Copyright 2026 OpenObserve Inc.
//
// compliance.ts — logging/detection coverage evidence against framework controls
// (not certification); control texts live in i18n under siem.compliance.controls.

import { FieldIndex } from "./fields";
import { normalizeTactic, type AttackTactic } from "./mitre";
import type { SourceType } from "./sourceTypes";
import type { SourceHealth } from "./streams";

// ── Signals ─────────────────────────────────────────────────────────────────

export interface SourceSignal {
  name: string;
  health: SourceHealth;
  /** Classifier source id (`aws_cloudtrail`), or null when unidentified. */
  sourceId: string | null;
  label: string | null;
  /** Identified as a security source with enough confidence to rely on. */
  security: boolean;
  /** Effective retention in days; Infinity when never deleted; null when unknown. */
  retentionDays: number | null;
  /**
   * Record fields the source's mapping could not resolve to a stored column
   * (of actor, time, outcome). Empty means all three map to real columns.
   */
  unmappedFields: NormalizedField[];
}

export type NormalizedField = "actor" | "time" | "outcome";

export interface DetectionSignal {
  name: string;
  enabled: boolean;
  tactics: string[];
  /** ATT&CK technique ids from the rule's tags. */
  techniques: string[];
  /** Non-skipped evaluations in the last 24 hours, and how many of them errored. */
  evaluations: number;
  errors: number;
  /** False when only part of its history could be read, so errors may be missed. */
  runsComplete: boolean;
}

export interface ComplianceSignals {
  sources: SourceSignal[];
  detections: DetectionSignal[];
  /**
   * Cases opened on this org, from the incidents stats API; null when the
   * deployment cannot answer (OSS answers 403), which is not assessable.
   */
  caseCount: number | null;
}

// ── What each identified source records ─────────────────────────────────────
// Taken from what each producer's log contains, per its vendor documentation:
// CloudTrail records console sign-ins as well as control-plane calls; Okta's
// System Log records sign-ins and admin changes; VPC Flow records network only.

export type Capability = "authentication" | "admin" | "network" | "endpoint" | "cloud";

export const SOURCE_CAPABILITIES: Record<string, Capability[]> = {
  aws_cloudtrail: ["authentication", "admin", "cloud"],
  aws_vpc_flow: ["network", "cloud"],
  azure_signin: ["authentication", "cloud"],
  azure_activity: ["admin", "cloud"],
  gcp_audit: ["admin", "cloud"],
  k8s_audit: ["admin"],
  github_audit: ["admin", "cloud"],
  okta_system_log: ["authentication", "admin", "cloud"],
  windows_sysmon_process: ["endpoint"],
  windows_security: ["authentication", "admin", "endpoint"],
  linux_auditd: ["admin", "endpoint"],
  linux_auth: ["authentication", "endpoint"],
  webserver_access: ["network"],
  proxy_access: ["network"],
  dns_query: ["network"],
  firewall: ["network"],
  zeek_conn: ["network"],
  ids_alert: ["network"],
};

export function capabilitiesOf(source: SourceSignal): Capability[] {
  if (!source.security || !source.sourceId) return [];
  return SOURCE_CAPABILITIES[source.sourceId] ?? [];
}

// ── Normalisation ───────────────────────────────────────────────────────────

/**
 * Which of actor / time / outcome the source's mapping resolves to a real
 * column in this stream. Outcome also counts when the source signals failure
 * by the presence of a field (CloudTrail's errorCode) and that field exists.
 */
export function unmappedNormalizedFields(
  source: SourceType | null,
  fields: string[],
): NormalizedField[] {
  if (!source) return ["actor", "time", "outcome"];
  const index = new FieldIndex(fields);
  const resolves = (paths: string[] | undefined) =>
    (paths ?? []).some((path) => path.split("|").some((option) => index.has(option)));
  const missing: NormalizedField[] = [];
  if (!resolves(source.map.actor as string[] | undefined)) missing.push("actor");
  if (!resolves([...((source.map.time as string[] | undefined) ?? []), "_timestamp"]))
    missing.push("time");
  if (
    !resolves(source.map.statusId as string[] | undefined) &&
    !resolves(source.failureWhenPresent)
  )
    missing.push("outcome");
  return missing;
}

// ── Controls ────────────────────────────────────────────────────────────────

export type Requirement =
  | { kind: "anySource" }
  | { kind: "capability"; capability: Capability }
  | { kind: "capabilityBreadth"; min: number }
  | { kind: "normalized" }
  | { kind: "retention"; minDays: number }
  | { kind: "detectionTactics"; tactics: AttackTactic[] }
  | { kind: "detectionTechniques"; techniques: string[] }
  | { kind: "detectionBreadth"; min: number }
  | { kind: "reviewRunning" }
  | { kind: "caseManagement" };

export type FrameworkId = "pci" | "nist" | "soc2" | "cis";

export interface Control {
  id: string;
  framework: FrameworkId;
  /** The framework's own identifier, e.g. "10.2.1.4" or "AU-11". */
  ref: string;
  requirements: Requirement[];
}

export const FRAMEWORKS: FrameworkId[] = ["pci", "nist", "soc2", "cis"];

export const CONTROLS: Control[] = [
  // PCI DSS v4.0 — Requirement 10: log and monitor all access.
  { id: "pci_10_2_1", framework: "pci", ref: "10.2.1", requirements: [{ kind: "anySource" }] },
  {
    id: "pci_10_2_1_2",
    framework: "pci",
    ref: "10.2.1.2",
    requirements: [{ kind: "capability", capability: "admin" }],
  },
  {
    id: "pci_10_2_1_4",
    framework: "pci",
    ref: "10.2.1.4",
    requirements: [
      { kind: "capability", capability: "authentication" },
      { kind: "detectionTactics", tactics: ["credential_access"] },
    ],
  },
  {
    id: "pci_10_2_1_5",
    framework: "pci",
    ref: "10.2.1.5",
    requirements: [
      { kind: "capability", capability: "admin" },
      { kind: "detectionTactics", tactics: ["persistence", "privilege_escalation"] },
    ],
  },
  { id: "pci_10_2_2", framework: "pci", ref: "10.2.2", requirements: [{ kind: "normalized" }] },
  {
    id: "pci_10_4_1_1",
    framework: "pci",
    ref: "10.4.1.1",
    requirements: [{ kind: "reviewRunning" }],
  },
  {
    id: "pci_10_5_1",
    framework: "pci",
    ref: "10.5.1",
    requirements: [{ kind: "retention", minDays: 365 }],
  },
  {
    id: "pci_10_7_2",
    framework: "pci",
    ref: "10.7.2",
    // Logging being switched off specifically, not defence evasion in general.
    requirements: [{ kind: "detectionTechniques", techniques: ["T1562.008", "T1562.002"] }],
  },

  // NIST SP 800-53 Rev. 5 — Audit and Accountability, System Monitoring.
  { id: "nist_au_2", framework: "nist", ref: "AU-2", requirements: [{ kind: "anySource" }] },
  { id: "nist_au_3", framework: "nist", ref: "AU-3", requirements: [{ kind: "normalized" }] },
  { id: "nist_au_6", framework: "nist", ref: "AU-6", requirements: [{ kind: "reviewRunning" }] },
  {
    id: "nist_au_11",
    framework: "nist",
    ref: "AU-11",
    // AU-11's period is organisation-defined; 90 days is the CIS 8.10 floor.
    requirements: [{ kind: "retention", minDays: 90 }],
  },
  {
    id: "nist_au_12",
    framework: "nist",
    ref: "AU-12",
    requirements: [{ kind: "capabilityBreadth", min: 2 }],
  },
  {
    id: "nist_si_4",
    framework: "nist",
    ref: "SI-4",
    requirements: [{ kind: "detectionBreadth", min: 3 }, { kind: "reviewRunning" }],
  },

  // SOC 2 (2017 Trust Services Criteria) — logical access and system operations.
  {
    id: "soc2_cc6_1",
    framework: "soc2",
    ref: "CC6.1",
    requirements: [{ kind: "capability", capability: "authentication" }],
  },
  {
    id: "soc2_cc7_1",
    framework: "soc2",
    ref: "CC7.1",
    requirements: [
      { kind: "capability", capability: "admin" },
      { kind: "detectionTactics", tactics: ["defense_evasion", "persistence"] },
    ],
  },
  {
    id: "soc2_cc7_2",
    framework: "soc2",
    ref: "CC7.2",
    requirements: [{ kind: "detectionBreadth", min: 3 }, { kind: "reviewRunning" }],
  },
  {
    id: "soc2_cc7_3",
    framework: "soc2",
    ref: "CC7.3",
    requirements: [{ kind: "reviewRunning" }, { kind: "caseManagement" }],
  },

  // CIS Critical Security Controls v8 — Control 8, Audit Log Management.
  { id: "cis_8_2", framework: "cis", ref: "8.2", requirements: [{ kind: "anySource" }] },
  { id: "cis_8_5", framework: "cis", ref: "8.5", requirements: [{ kind: "normalized" }] },
  // The platform is the central store, so any reporting source is centralised.
  { id: "cis_8_9", framework: "cis", ref: "8.9", requirements: [{ kind: "anySource" }] },
  {
    id: "cis_8_10",
    framework: "cis",
    ref: "8.10",
    requirements: [{ kind: "retention", minDays: 90 }],
  },
  { id: "cis_8_11", framework: "cis", ref: "8.11", requirements: [{ kind: "reviewRunning" }] },
  {
    id: "cis_8_12",
    framework: "cis",
    ref: "8.12",
    requirements: [{ kind: "capability", capability: "cloud" }],
  },
];

// ── Evaluation ──────────────────────────────────────────────────────────────

export type ControlStatus = "met" | "partial" | "missing" | "unknown";

export interface RequirementResult {
  requirement: Requirement;
  status: ControlStatus;
  /** Sources / detections that count as evidence for this requirement. */
  evidence: string[];
  /** Sources / detections that exist but fall short (quiet, disabled, errored). */
  shortfall: string[];
}

export interface ControlResult {
  control: Control;
  status: ControlStatus;
  requirements: RequirementResult[];
}

const live = (s: SourceSignal) => s.health === "live";
/** A source that counts as evidence: reporting and identified as security. */
const counted = (s: SourceSignal) => live(s) && s.security;
/** A detection that counts as evidence: enabled, and ran in the window without errors. */
const working = (d: DetectionSignal) =>
  d.enabled && d.runsComplete && d.evaluations > 0 && d.errors === 0;
/** Enabled, no errors seen, but its history was only partly read. */
const unread = (d: DetectionSignal) => d.enabled && !d.runsComplete && d.errors === 0;
const names = <T extends { name: string }>(items: T[]) => items.map((i) => i.name);

function graded(evidence: string[], shortfall: string[]): ControlStatus {
  if (evidence.length) return "met";
  return shortfall.length ? "partial" : "missing";
}

export function evaluateRequirement(req: Requirement, s: ComplianceSignals): RequirementResult {
  const result = (status: ControlStatus, evidence: string[] = [], shortfall: string[] = []) => ({
    requirement: req,
    status,
    evidence,
    shortfall,
  });

  switch (req.kind) {
    case "anySource": {
      // A name that looks like security is not evidence; only identified sources count.
      const evidence = names(s.sources.filter(counted));
      const shortfall = names(s.sources.filter((x) => !counted(x)));
      return result(graded(evidence, shortfall), evidence, shortfall);
    }
    case "capability": {
      const having = s.sources.filter((x) => capabilitiesOf(x).includes(req.capability));
      const reporting = names(having.filter(live));
      const silent = names(having.filter((x) => !live(x)));
      return result(graded(reporting, silent), reporting, silent);
    }
    case "capabilityBreadth": {
      const caps = new Set(s.sources.filter(live).flatMap(capabilitiesOf));
      const evidence = names(s.sources.filter((x) => live(x) && capabilitiesOf(x).length));
      const status: ControlStatus =
        caps.size >= req.min ? "met" : caps.size > 0 ? "partial" : "missing";
      return result(status, status === "met" ? evidence : [], status === "met" ? [] : evidence);
    }
    case "normalized": {
      const reporting = s.sources.filter(live);
      const ok = reporting.filter((x) => x.security && x.unmappedFields.length === 0);
      if (!reporting.length) return result("missing");
      return result(
        ok.length === reporting.length ? "met" : ok.length ? "partial" : "missing",
        names(ok),
        names(reporting.filter((x) => !ok.includes(x))),
      );
    }
    case "retention": {
      const reporting = s.sources.filter(counted);
      if (!reporting.length) return result("missing");
      if (reporting.some((x) => x.retentionDays === null)) {
        return result("unknown", [], names(reporting.filter((x) => x.retentionDays === null)));
      }
      const ok = reporting.filter((x) => (x.retentionDays ?? 0) >= req.minDays);
      return result(
        ok.length === reporting.length ? "met" : ok.length ? "partial" : "missing",
        names(ok),
        names(reporting.filter((x) => (x.retentionDays ?? 0) < req.minDays)),
      );
    }
    case "detectionTactics":
    case "detectionTechniques": {
      const tagged = s.detections.filter((d) =>
        req.kind === "detectionTactics"
          ? d.tactics.some((t) => req.tactics.includes(normalizeTactic(t) as AttackTactic))
          : d.techniques.some((t) => req.techniques.includes(t.toUpperCase())),
      );
      // Enabled is not enough: a rule that never ran, or errored, detects nothing.
      const on = names(tagged.filter(working));
      if (!on.length && tagged.some(unread)) {
        return result("unknown", [], names(tagged.filter(unread)));
      }
      const off = names(tagged.filter((d) => !working(d)));
      return result(graded(on, off), on, off);
    }
    case "detectionBreadth": {
      const healthy = s.detections.filter(working);
      const tactics = new Set(
        healthy.flatMap((d) => d.tactics.map((t) => normalizeTactic(t))).filter(Boolean),
      );
      const status: ControlStatus =
        tactics.size >= req.min ? "met" : tactics.size > 0 ? "partial" : "missing";
      const rest = names(s.detections.filter((d) => d.enabled && !working(d)));
      if (status !== "met" && s.detections.some(unread)) {
        return result("unknown", [], names(s.detections.filter(unread)));
      }
      return result(
        status,
        status === "met" ? names(healthy) : [],
        status === "met" ? rest : [...names(healthy), ...rest],
      );
    }
    case "reviewRunning": {
      const enabled = s.detections.filter((d) => d.enabled);
      if (!enabled.length) return result("missing");
      const healthy = enabled.filter(working);
      const short = enabled.filter((d) => !working(d));
      // A rule whose history was only partly read may have errors we did not see.
      const partlyRead = enabled.filter(unread);
      if (short.length === partlyRead.length && partlyRead.length) {
        return result("unknown", [], names(partlyRead));
      }
      return result(
        short.length === 0 ? "met" : healthy.length ? "partial" : "missing",
        names(healthy),
        names(short),
      );
    }
    // Met only on evidence that cases are actually opened, never from a build flag.
    case "caseManagement":
      if (s.caseCount === null) return result("unknown");
      return result(s.caseCount > 0 ? "met" : "partial");
  }
}

/**
 * A control is met only when every requirement is; missing when none is even
 * partly there; unknown when the only thing between it and "met" is a signal
 * the platform cannot read; partial otherwise.
 */
export function evaluateControl(control: Control, signals: ComplianceSignals): ControlResult {
  const requirements = control.requirements.map((r) => evaluateRequirement(r, signals));
  const statuses = requirements.map((r) => r.status);
  let status: ControlStatus;
  if (statuses.every((x) => x === "met")) status = "met";
  else if (statuses.every((x) => x === "missing")) status = "missing";
  else if (statuses.every((x) => x === "met" || x === "unknown")) status = "unknown";
  else status = "partial";
  return { control, status, requirements };
}

export interface FrameworkScore {
  met: number;
  partial: number;
  missing: number;
  unknown: number;
  /** 0–100 over assessable controls (partial counts half); null when none are. */
  score: number | null;
}

export function scoreControls(results: ControlResult[]): FrameworkScore {
  const count = (s: ControlStatus) => results.filter((r) => r.status === s).length;
  const met = count("met");
  const partial = count("partial");
  const missing = count("missing");
  const assessable = met + partial + missing;
  return {
    met,
    partial,
    missing,
    unknown: count("unknown"),
    score: assessable ? Math.round(((met + partial / 2) / assessable) * 100) : null,
  };
}

/**
 * Effective retention from the stream setting and the server-wide
 * ZO_COMPACT_DATA_RETENTION_DAYS. At ≤ 0 the retention job never runs, so
 * nothing is deleted (Infinity); when the server value is unknown, so is this.
 */
export function effectiveRetentionDays(streamDays: unknown, serverDays: unknown): number | null {
  if (serverDays === undefined || serverDays === null || serverDays === "") return null;
  const server = Number(serverDays);
  if (!Number.isFinite(server)) return null;
  if (server <= 0) return Infinity;
  const own = Number(streamDays);
  return Number.isFinite(own) && own > 0 ? own : server;
}

export const STATUS_TOKEN: Record<ControlStatus, `--color-${string}`> = {
  met: "--color-status-positive",
  partial: "--color-badge-amber-solid-bg",
  missing: "--color-badge-error-solid-bg",
  unknown: "--color-border-default",
};

/** Row rail colour for OTable's getRowStatusColor. */
export function statusRailColor(status: ControlStatus): string {
  return `var(${STATUS_TOKEN[status]})`;
}
