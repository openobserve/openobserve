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

// Mirrors `config::meta::oncall`. Every wire form here is the snake_case the
// API emits — nothing is renamed on the way in.

/**
 * Who a rung of the ladder pages.
 *
 * Replaces a fixed six-slot vocabulary in which every slot needed a rotation
 * of its own. A "secondary" is not a slot anybody staffs — it is the ladder
 * walking the same rotation, which is what `next_on_call` is.
 */
export type EscalationTargetKind =
  | "on_call_now"
  | "next_on_call"
  | "everyone_on_schedule"
  | "user"
  | "whole_team";

export type EscalationTarget =
  | { kind: Exclude<EscalationTargetKind, "user"> }
  | { kind: "user"; email: string };

/** Offered in the target picker, in the order they are listed. */
export const TARGET_KINDS: EscalationTargetKind[] = [
  "on_call_now",
  "next_on_call",
  "everyone_on_schedule",
  "user",
  "whole_team",
];

/** Serialized as the integer 1–5, matching `alerts.priority`. */
export type AlertPriorityValue = 1 | 2 | 3 | 4 | 5;

export type Channel =
  | "email"
  | "sms"
  | "voice"
  | "chat"
  /** An existing alert Destination — Slack, Teams, or any HTTP endpoint. */
  | "webhook"
  | "push"
  | "in_app";

export type ResponseState =
  | "triggered"
  | "triaged"
  | "acknowledged"
  | "resolved";

export type ResponseEventKind =
  | "sys"
  | "page"
  | "ack"
  | "note"
  | "rca"
  | "handoff"
  | "recovery"
  | "state"
  /** The ladder ran out of rungs and nobody had acknowledged (storage id 9). */
  | "exhausted";

/**
 * Why this team was paged. The owner fixes the thing; an impacted team contains
 * the blast radius on its own service. Different jobs, so different records —
 * each acknowledges and resolves its own.
 */
export type ResponderRole = "owner" | "impacted";

export type SubjectType = "alert" | "incident" | "synthetic" | "anomaly";

export interface OnCallTeam {
  id: string;
  org_id: string;
  name: string;
  timezone: string;
  description?: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Membership carries no level. Which rung somebody covers is a property of the
 * ROTATION (see `Rotation`), not of belonging to the team — a person is on the
 * team, and the schedule says when they are primary, secondary, or neither.
 */
export interface OnCallTeamMember {
  id: string;
  team_id: string;
  user_email: string;
}

/// A window a rotation is restricted to. Days are 0 = Monday .. 6 = Sunday,
/// matching the engine; minutes are from local midnight in the team's zone.
export interface TimeWindow {
  days: number[];
  start_minute: number;
  end_minute: number;
}

export interface Rotation {
  /** What this rotation is called — rotations are named shifts now, not slots
   *  in an escalation ladder. */
  name: string;
  /** Participants in handover order. */
  members: string[];
  /** Shift length in microseconds. */
  shift_micros: number;
  /** Instant `members[0]`'s first shift begins, in microseconds. */
  anchor_micros: number;
  /// Higher wins when two rotations both apply. Without a distinct value the
  /// server rejects the whole save as ambiguous, which used to take the
  /// working rotation down with the new one.
  priority?: number;
  /// When this rotation applies. Empty means always — the catch-all every
  /// follow-the-sun setup needs underneath the restricted ones.
  restrictions?: TimeWindow[];
}

export interface OnCallSchedule {
  id: string;
  org_id: string;
  team_id: string;
  timezone: string;
  rotations: Rotation[];
  created_at: number;
  updated_at: number;
}

export interface OnCallSlot {
  /** The rotation that produced this. */
  rotation: string;
  user_email: string;
  /** Who it hands over to. Absent for a one-person rotation. */
  next_user_email?: string | null;
}

export interface LadderStep {
  /** Delay from the record opening, in microseconds. Unique within a rung —
   *  targets that fire together are one rung, not several at the same delay. */
  after_micros: number;
  /** Paged simultaneously. At least one. */
  targets: EscalationTarget[];
}

export interface PriorityRung {
  priority: AlertPriorityValue;
  /** Empty means this priority never pages a human. */
  steps: LadderStep[];
  channels: Channel[];
}

/** What happens when the ladder runs out and nobody has acknowledged. */
export type PolicyFinalAction = "notify_default_team" | "stop";

export interface OnCallPolicy {
  id: string;
  org_id: string;
  team_id: string;
  rungs: PriorityRung[];
  /** Alert Destination names the webhook channel pages through. */
  destinations?: string[];
  /** Fire every P1 step at once. Nobody waits five minutes to be told the site is down. */
  p1_parallel?: boolean;
  /** Off by default — a P4 that wakes somebody is a severity bug. */
  p4_pages?: boolean;
  final_action?: PolicyFinalAction;
}

export interface SubjectRef {
  subject_type: SubjectType;
  source_id: string;
  /** 1-based firing counter — the same rule firing twice is two records. */
  firing: number;
}

export interface OnCallResponse {
  id: string;
  org_id: string;
  subject: SubjectRef;
  team_id: string;
  priority: number;
  state: ResponseState;
  opened_at: number;
  acked_by?: string | null;
  acked_at?: number | null;
  closed_at?: number | null;
  incident_id?: string | null;
  title?: string | null;
  cause?: ResolutionCause | null;
  cause_note?: string | null;
  /** Quiet until this instant (micros). Not an acknowledgement. */
  snoozed_until?: number | null;
  ladder_anchor?: number | null;
  /** Which run of the ladder this record is on. Absent means the first run. */
  ladder_run?: number | null;
  /** Always on the wire — the server defaults it to `owner`. */
  responder_role: ResponderRole;
  /** For an impacted record, the owner record it was opened alongside. */
  origin_response_id?: string | null;
}

/// Fixed list, matching the backend enum. Free text would fragment into
/// near-duplicates and never group, which is the same as recording nothing.
export const RESOLUTION_CAUSES = [
  "config_change_or_deploy",
  "capacity_or_load",
  "dependency_failure",
  "expected_or_maintenance",
  "noisy_threshold",
  "data_or_ingestion_issue",
  "genuine_defect",
  "still_unknown",
] as const;

export type ResolutionCause = (typeof RESOLUTION_CAUSES)[number];

/**
 * `GET /oncall/analytics/causes`. The only analytics endpoint that exists — it
 * counts causes, never durations, and the counting happens in the database
 * rather than over a fetched page, which is what makes it safe on any org size.
 */
export interface CauseAnalytics {
  /** Micros. */
  from: number;
  /** Micros. */
  to: number;
  team_id?: string | null;
  /** Sum of `causes[].count` — not a second query, so the shares add to 100. */
  total: number;
  causes: CauseCount[];
}

/// One row of the cause breakdown, with the most recent example so a row can be
/// a link rather than just a number.
export interface CauseCount {
  cause: ResolutionCause;
  count: number;
  last_response_id?: string | null;
  last_title?: string | null;
  last_cause_note?: string | null;
  /** Micros. */
  last_at?: number | null;
}

/// One row of the prior-causes panel: what this rule turned out to be before.
export interface CauseGroup {
  cause: ResolutionCause;
  count: number;
  note?: string | null;
  last_response_id: string;
  last_closed_at?: number | null;
}

/// One row of the pages list when grouping is on: the most recent firing of
/// an alert, plus every firing it stands for.
export interface OnCallResponseGroup {
  /// The most recent firing — what the row renders and what clicking opens.
  latest: OnCallResponse;
  /// Every record in the group, newest first.
  firings: OnCallResponse[];
  /// Records still escalating, so the row can say what acting on it will do.
  escalating: OnCallResponse[];
}

export interface FiredRung {
  after_micros: number;
  /** Absolute instant it fired. */
  at: number;
  targets: string[];
}

/// Where the ladder has got to. The question mid-incident is "when does this
/// wake somebody else".
export interface EscalationProgress {
  fired: FiredRung[];
  next_targets: string[];
  next_at?: number | null;
  exhausted: boolean;
  /** Set when the ladder is not climbing: acknowledged, snoozed, resolved. */
  stopped_because?: string | null;
}

export interface OnCallResponseEvent {
  kind: ResponseEventKind;
  at: number;
  actor: string;
  body: string;
  /** The rung this page belongs to, as its delay from the record opening. */
  rung_micros?: number | null;
}

/** A team's claim over part of the identity space. */
export interface OwnershipRule {
  id: string;
  org_id: string;
  team_id: string;
  /** `{alias_id: value}` — every pair that must match for the rule to apply. */
  dimensions: Record<string, string>;
  created_at: number;
  updated_at: number;
}

export type RoutingDecisionKind = "explicit" | "ownership" | "unrouted";

export interface RoutingPreview {
  decision: { kind: RoutingDecisionKind } & Record<string, unknown>;
  team_id: string | null;
  reason: string;
}

/** Did the transport take it. `failed` is a recorded fact, not an absence. */
export type DeliveryStatus = "sent" | "delivered" | "failed";

/**
 * One page, to one person, on one channel — the machine-readable half of the
 * ledger, and the reason a crash part-way through a rung does not re-page the
 * people it already reached.
 *
 * This is a `ResponseEvent` of kind `delivery`, which is exactly what the human
 * timeline (`getResponse`) filters OUT — the two reads are complementary and
 * neither duplicates the other. `(ladder_run, rung_micros, recipient, channel)`
 * is the ledger key.
 */
export interface DeliveryRecord {
  kind: "delivery";
  /** Micros. */
  at: number;
  /** The system actor that sent it, e.g. `o2-engine`. */
  actor: string;
  /** The one-line human form, e.g. "paged ana@o2.ai on email". */
  body: string;
  /** The rung, as its delay from the record opening. */
  rung_micros?: number | null;
  /** Absent means the first run of the ladder. */
  ladder_run?: number | null;
  /** Address it was sent to. */
  recipient?: string | null;
  channel?: Channel | null;
  /** `false` is a RECORDED failure — not the same as the field being absent. */
  delivered?: boolean | null;
}

/** `GET /oncall/responses/{id}/deliveries`. `total` is exact; `deliveries` is a page. */
export interface DeliveryLedger {
  total: number;
  deliveries: DeliveryRecord[];
}

/**
 * `GET /oncall/coverage-gaps`. An object rather than a bare array on purpose:
 * a standing banner wants the NUMBER even when it names three teams, and
 * `teams` is truncated by `limit` while `total` never is. `at` is resolved
 * server-side so the banner can name its own "as of".
 */
export interface CoverageGaps {
  /** Micros — the instant the answer is for. */
  at: number;
  total: number;
  teams: OnCallTeam[];
}

/**
 * Everything we already hold that touches this page. Every block is a fact we
 * stored — the rule, the ownership path, the dependency edges, the cause a
 * human recorded — never an inference.
 */
export interface RelatedResponses {
  same_alert: OnCallResponse[];
  open_nearby: OnCallResponse[];
  same_service: OnCallResponse[];
  same_cause: OnCallResponse[];
}

/** Who the server would hand this page to, and the fact behind the suggestion. */
export interface HandoffSuggestion {
  team_id: string;
  reason: string;
}

export type OnCallSlotRole = "primary" | "secondary";

/** One shift the signed-in user is on. */
export interface MyOnCallSlot {
  team_id: string;
  rotation: string;
  role: OnCallSlotRole;
  /** Micros. */
  starts_at: number;
  /** Micros. */
  ends_at: number;
}

export interface MyOnCallTeam {
  team_id: string;
  team_name: string;
  timezone: string;
}

/** Everything the "My on-call" screen needs, in one call. */
export interface MyOnCall {
  teams: MyOnCallTeam[];
  slots: MyOnCallSlot[];
  /** How this person is reachable, in the order the policy would try them. */
  channels: Channel[];
  open_responses: OnCallResponse[];
  pages_last_7d: number;
}

/**
 * One node of the identity inventory the ownership tree renders. `path` is the
 * canonical `k=v/k=v` form, which is also what a rule matches on.
 */
export interface InventoryNode {
  path: string;
  dimensions: Record<string, string>;
  services: number;
  pages_30d: number;
  owner_team_id: string | null;
  /** Set when the owner comes from an ancestor rather than this path. */
  inherited_from: string | null;
}

/**
 * A signal that matched no ownership rule. One row per dimension PATH, not per
 * firing: an unowned alert firing every minute is one missing rule, not four
 * hundred problems.
 */
export interface UnroutedSignal {
  id: string;
  org_id: string;
  path: string;
  dimensions: Record<string, string>;
  occurrences: number;
  /** Micros. */
  first_seen_at: number;
  /** Micros. */
  last_seen_at: number;
  last_subject_type?: SubjectType | null;
  last_source_id?: string | null;
  last_title?: string | null;
  last_priority?: number | null;
  /** Dismissed entries stay for the record — deleting them loses the evidence. */
  dismissed_at?: number | null;
  /**
   * The server's own one-line summary (`UnroutedSignal::describe()`), sent
   * beside the structured fields rather than instead of them. Rendered as-is:
   * the empty-`path` case reads nothing like the normal one, and that is the
   * branch a client recomputing the sentence would get wrong.
   */
  description: string;
}

/**
 * Somebody standing in for the rotation over a window. Drawn on top of the
 * resolved schedule; outside the window the rotation resolves as normal.
 */
export interface Override {
  id: string;
  org_id: string;
  team_id: string;
  user_email: string;
  /** Micros. */
  starts_at: number;
  /** Micros. */
  ends_at: number;
  created_by?: string | null;
  note?: string | null;
}

export const MICROS_PER_MINUTE = 60_000_000;
export const MICROS_PER_HOUR = 60 * MICROS_PER_MINUTE;
export const MICROS_PER_DAY = 24 * MICROS_PER_HOUR;
export const MICROS_PER_WEEK = 7 * MICROS_PER_DAY;
