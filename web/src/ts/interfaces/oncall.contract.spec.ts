// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * H5 — pin the TS unions against the Rust enums.
 *
 * The seam defect this feature keeps producing, in its frontend form:
 * something correct on one side that nothing on the other side reaches. The
 * wire contract was audited clean once and has drifted repeatedly since —
 * `ResponseEventKind` was three variants behind within days (B5), then one
 * behind again within a day of being fixed (`flapped`); `OnCallPolicy` lacked
 * `repeat_count` while a component read it. Nothing re-checked the seam; this
 * file is the re-check.
 *
 * It parses every `#[serde(rename_all = "snake_case")]` enum out of the OSS
 * `config::meta::oncall` sources and demands each one is either MIRRORED — a
 * value-level array this file pins to the TS union in both directions at
 * compile time, and to the Rust variants at run time — or SKIPPED with a
 * recorded reason. A brand-new wire enum fails the suite until somebody makes
 * that choice consciously.
 *
 * Enterprise-side response shapes (`insight.rs` etc.) are not covered: the
 * sibling repo is not present on CI. The OSS meta module is where every
 * drift so far has originated.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import { describe, expect, it } from "vitest";

import enUS from "@/locales/languages/en-US.json";
import type {
  Channel,
  EscalationTargetKind,
  L0Mode,
  PolicyFinalAction,
  PresetInputKind,
  ResolutionCause,
  RotationMode,
  ResponderRole,
  ResponseEventKind,
  ResponseState,
  RoutingDecisionKind,
  SubjectType,
} from "@/ts/interfaces/oncall";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import type { RcaSignalClass, RcaUnverifiedCitation } from "@/services/incidents";

// ── The Rust side, parsed from source ───────────────────────────────────────

const RUST_ONCALL_META = path.resolve(process.cwd(), "../src/config/src/meta/oncall");

/** serde's `rename_all = "snake_case"` for an ident like `NoRecipients` or `InApp`. */
function snake(ident: string): string {
  return ident.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Every `pub enum` in the module whose serde attribute block says
 * `rename_all = "snake_case"`, with its variants in wire spelling. A
 * per-variant `#[serde(rename = "...")]` overrides, exactly as serde does.
 */
function rustSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? rustSources(file) : file.endsWith(".rs") ? [file] : [];
  });
}

function parseWireEnums(): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  const files = [
    ...rustSources(RUST_ONCALL_META),
    ...["rca_runs.rs", "rca_steering.rs"].map((file) =>
      path.join(RUST_ONCALL_META, "../alerts", file),
    ),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    const uncommented = source.replace(/\/\/[^\n]*/g, "");
    for (const match of uncommented.matchAll(/string_enum!\s*\{\s*(\w+)\s*\{([^}]+)\}/g)) {
      enums.set(
        match[1],
        [...match[2].matchAll(/(\w+)\s*=>\s*"[^"]+"/g)].map((variant) => snake(variant[1])),
      );
    }
    for (let i = 0; i < lines.length; i++) {
      const head = lines[i].match(/^\s*pub enum (\w+)\s*\{?/);
      if (!head) continue;
      // The attribute block sits between the doc comment and the enum head.
      let snakeCased = false;
      for (let back = i - 1; back >= 0 && back >= i - 12; back--) {
        const attr = lines[back];
        if (/^\s*(\/\/\/|\/\/)/.test(attr)) continue;
        if (!/^\s*#\[/.test(attr) && !/^\s*\)]/.test(attr)) break;
        if (/rename_all\s*=\s*"snake_case"/.test(attr)) snakeCased = true;
      }
      if (!snakeCased) continue;

      const variants: string[] = [];
      let depth = lines[i].includes("{") ? 1 : 0;
      let pendingRename: string | null = null;
      for (let j = i + 1; j < lines.length && (depth > 0 || j === i + 1); j++) {
        const line = lines[j];
        if (depth === 1) {
          const rename = line.match(/^\s*#\[serde\(rename\s*=\s*"([^"]+)"/);
          if (rename) pendingRename = rename[1];
          // A variant ident at body depth — unit, tuple, or struct form.
          const variant = line.match(/^\s{4}([A-Z][A-Za-z0-9]*)\s*(?:\{|\(|,|$)/);
          if (variant && !/^\s*(\/\/|#\[)/.test(line)) {
            variants.push(pendingRename ?? snake(variant[1]));
            pendingRename = null;
          }
        }
        for (const ch of line) {
          if (ch === "{") depth += 1;
          else if (ch === "}") depth -= 1;
        }
        if (depth <= 0 && j > i) break;
      }
      enums.set(head[1], variants);
    }
  }
  return enums;
}

const rustEnums = parseWireEnums();

// ── The TS side: value arrays pinned to the unions both ways ────────────────

/// `satisfies` pins every array member INTO the union; `Complete<>` pins the
/// union into the array, so removing a TS variant and adding one both fail to
/// compile before the runtime half ever compares against Rust.
type Complete<U extends string, A extends readonly string[]> = [U] extends [A[number]]
  ? true
  : never;

const RESPONSE_EVENT_KINDS = [
  "sys",
  "page",
  "ack",
  "note",
  "rca",
  "handoff",
  "recovery",
  "state",
  "exhausted",
  "delivery",
  "ai_verdict",
  "severity_promoted",
  "flapped",
] as const satisfies readonly ResponseEventKind[];
const _c1: Complete<ResponseEventKind, typeof RESPONSE_EVENT_KINDS> = true;

const CHANNELS = ["email", "sms", "voice", "webhook"] as const satisfies readonly Channel[];
const _c2: Complete<Channel, typeof CHANNELS> = true;

const RESPONSE_STATES = [
  "triggered",
  "triaged",
  "acknowledged",
  "resolved",
] as const satisfies readonly ResponseState[];
const _c3: Complete<ResponseState, typeof RESPONSE_STATES> = true;

const RESPONDER_ROLES = ["owner", "impacted"] as const satisfies readonly ResponderRole[];
const _c4: Complete<ResponderRole, typeof RESPONDER_ROLES> = true;

const SUBJECT_TYPES = ["alert", "incident"] as const satisfies readonly SubjectType[];
const _c5: Complete<SubjectType, typeof SUBJECT_TYPES> = true;

const ESCALATION_TARGET_KINDS = [
  "rotation",
  "user",
  "whole_team",
] as const satisfies readonly EscalationTargetKind[];
const _c6: Complete<EscalationTargetKind, typeof ESCALATION_TARGET_KINDS> = true;

const ROTATION_MODES = ["on_call", "all"] as const satisfies readonly RotationMode[];
const _c11: Complete<RotationMode, typeof ROTATION_MODES> = true;

// Only used for its type via `typeof` below — `EscalationPolicy` has no
// `final_action` field yet, so there's no MIRROR_MAP entry to hold a runtime reference.
const _FINAL_ACTIONS = [
  "stop",
  "notify_default_team",
] as const satisfies readonly PolicyFinalAction[];
const _c7: Complete<PolicyFinalAction, typeof _FINAL_ACTIONS> = true;

const L0_MODES = ["parallel", "gate", "only", "off"] as const satisfies readonly L0Mode[];
const _c8: Complete<L0Mode, typeof L0_MODES> = true;

const ROUTING_DECISION_KINDS = [
  "explicit",
  "ownership",
  "default",
  "unrouted",
] as const satisfies readonly RoutingDecisionKind[];
const _c9: Complete<RoutingDecisionKind, typeof ROUTING_DECISION_KINDS> = true;

const PRESET_INPUT_KINDS = [
  "group",
  "group_list",
  "day_of_week",
  "day_list",
  "minute_of_day",
  "timezone",
  "duration_micros",
  "timestamp_micros",
  "text",
  "member_list",
] as const satisfies readonly PresetInputKind[];
const _c10: Complete<PresetInputKind, typeof PRESET_INPUT_KINDS> = true;

const _causes: Complete<ResolutionCause, typeof RESOLUTION_CAUSES> = true;

// RCA confidence enums that reach the UI through the run summary route.
const SIGNAL_CLASSES = [
  "logs",
  "metrics",
  "traces",
  "change",
  "infra",
  "context",
  "unclassified",
] as const satisfies readonly RcaSignalClass[];
const _c12: Complete<RcaSignalClass, typeof SIGNAL_CLASSES> = true;

type UnverifiedReason = RcaUnverifiedCitation["reason"];
const UNVERIFIED_REASONS = [
  "not_run",
  "failed",
  "ambiguous",
] as const satisfies readonly UnverifiedReason[];
const _c13: Complete<UnverifiedReason, typeof UNVERIFIED_REASONS> = true;

const incidentTypes = ts.createSourceFile(
  "incidents.ts",
  readFileSync(path.resolve(process.cwd(), "src/services/incidents.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
function incidentUnion(name: string): string[] {
  const [declaration, member] = name.split(".");
  const node = incidentTypes.statements.find(
    (node) =>
      (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      node.name.text === declaration,
  );
  const type =
    node && ts.isTypeAliasDeclaration(node)
      ? node.type
      : node && ts.isInterfaceDeclaration(node)
        ? node.members.find(
            (field) =>
              ts.isPropertySignature(field) && field.name.getText(incidentTypes) === member,
          )?.type
        : undefined;
  if (!type || !ts.isUnionTypeNode(type)) throw new Error(`Missing TypeScript wire union ${name}`);
  return type.types.map((value) => {
    if (!ts.isLiteralTypeNode(value) || !ts.isStringLiteral(value.literal)) {
      throw new Error(`Non-string wire union ${name}`);
    }
    return value.literal.text;
  });
}

const RCA_MIRRORS = {
  Confidence: "RcaBand",
  ChangeKind: "RcaChangeKind",
  HypothesisStatus: "RcaHypothesisStatus",
  Polarity: "RcaPolarity",
  Strength: "RcaStrength",
  BlindSpotAxis: "RcaBlindSpotAxis",
  BlindSpotFix: "RcaBlindSpotFix",
  RcaOutcome: "RcaOutcome",
  OutcomeReason: "RcaOutcomeReason",
  VerdictSoFarLabel: "RcaVerdictSoFar.label",
  ShownChangeState: "RcaSuspectShownState",
  TimelineView: "RcaTimelineStatus",
  RunState: "RcaRunState",
  RunTrigger: "RcaTrigger",
  RunMode: "RcaRunMode",
  RunSubjectType: "RcaRunSubjectType",
  SteerKind: "RcaSteerKind",
  SteerStatus: "RcaSteerStatus",
  SteerAction: "RcaSteerAction",
  SteerStatusReason: "RcaSteerStatusReason",
  ReportFormat: "RcaReportFormat",
};
void [_c1, _c2, _c3, _c4, _c5, _c6, _c7, _c8, _c9, _c10, _c11, _c12, _c13, _causes];

// `FinalAction` names no map below: `EscalationPolicy` carries no `final_action` field yet, so it is not a Rust enum a MIRRORED or SKIPPED entry could point at without failing the stale-entry check — `_FINAL_ACTIONS`/`_c7` above still pin `PolicyFinalAction` against drift on its own.
/** Rust enum name → the TS mirror it must equal. */
const MIRRORED: Record<string, readonly string[]> = {
  ResponseEventKind: RESPONSE_EVENT_KINDS,
  Channel: CHANNELS,
  ResponseState: RESPONSE_STATES,
  ResponderRole: RESPONDER_ROLES,
  SubjectType: SUBJECT_TYPES,
  EscalationTarget: ESCALATION_TARGET_KINDS,
  RotationMode: ROTATION_MODES,
  L0Mode: L0_MODES,
  RoutingDecision: ROUTING_DECISION_KINDS,
  PresetInputKind: PRESET_INPUT_KINDS,
  ResolutionCause: RESOLUTION_CAUSES,
  SignalClass: SIGNAL_CLASSES,
  UnverifiedReason: UNVERIFIED_REASONS,
  ...Object.fromEntries(
    Object.entries(RCA_MIRRORS).map(([rust, name]) => [rust, incidentUnion(name)]),
  ),
};

/** Every discovered serde enum needs a mirror or an explicit boundary decision. */
const SKIPPED: Record<string, string> = {
  PageAction: "stored in verdicts; the UI does not branch on the raw paging action",
  ActionKind: "stored in verdict action plans; the UI renders the report, not typed plan actions",
  AnalysisStatus: "rides the internal trigger row; no endpoint serializes it",
  SeverityDecision: "rides the internal trigger row; the event carries it as prose",
  // Engine internals that never leave the process. (RungOutcome needs no
  // entry at all — it carries no serde attribute, so it never parses as a
  // wire enum in the first place.)
  ChannelPostStage: "engine-internal broadcast bookkeeping",
  // C8 doctrine: the preset catalogue is rendered FROM the response so a
  // fifth preset appears with no UI change — hardcoding ids would re-create
  // exactly what that forbids.
  PresetId: "catalogue-driven by design; the UI must not know preset ids",
  PresetSpec: "request body built from the catalogue's own inputs schema",
  GradeReason: "raw reasons stay in the record; the UI reads the server-built card.confidence",
  LedgerTool: "internal transcript decoder tag; no endpoint serializes it",
  EndedBy: "internal finalization input; the endpoint exposes OutcomeReason",
  SuspectChangeState: "agent claim stored for metrics; UI reads code-derived ShownChangeState",
  TimelineStatus: "agent input; UI reads the evidence-checked TimelineView",
};

// ── The re-check ────────────────────────────────────────────────────────────

describe("oncall wire contract (H5)", () => {
  it("every wire enum is either mirrored or consciously skipped", () => {
    const unaccounted = [...rustEnums.keys()].filter(
      (name) => !(name in MIRRORED) && !(name in SKIPPED),
    );
    expect(
      unaccounted,
      `New wire enum(s) with no TS decision: ${unaccounted.join(", ")} — add a mirrored array or a skip reason`,
    ).toEqual([]);
  });

  it("no mirror or skip entry names an enum that no longer exists", () => {
    const stale = [...Object.keys(MIRRORED), ...Object.keys(SKIPPED)].filter(
      (name) => !rustEnums.has(name),
    );
    expect(stale, `Entries for enums gone from Rust: ${stale.join(", ")}`).toEqual([]);
  });

  for (const [name, mirror] of Object.entries(MIRRORED)) {
    it(`${name}: the TS union matches the Rust variants exactly`, () => {
      const rust = rustEnums.get(name);
      if (!rust) return; // the stale-entry test reports this case
      expect([...mirror].sort()).toEqual([...rust].sort());
    });
  }

  // The other two legs of B5's compounding failure: a variant that exists in
  // the type but has no i18n key renders on screen as the literal string
  // `oncall.eventKind_ai_verdict`. Every dynamic-key family a component
  // builds from a wire variant must be complete.
  const oncallKeys = (enUS as { oncall: Record<string, string> }).oncall;
  const FAMILIES: [string, readonly string[]][] = [
    ["eventKind_", RESPONSE_EVENT_KINDS],
    ["channel_", CHANNELS],
    ["target_", ESCALATION_TARGET_KINDS],
    ["cause_", RESOLUTION_CAUSES],
  ];
  for (const [prefix, variants] of FAMILIES) {
    it(`every ${prefix}* i18n key exists for its union`, () => {
      const missing = variants.filter((v) => !(`${prefix}${v}` in oncallKeys));
      expect(missing, `Missing oncall.${prefix}* keys for: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
