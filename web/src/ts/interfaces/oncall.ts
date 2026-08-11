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
  | "state";

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

export interface OnCallPolicy {
  id: string;
  org_id: string;
  team_id: string;
  rungs: PriorityRung[];
  /** Alert Destination names the webhook channel pages through. */
  destinations?: string[];
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

export const MICROS_PER_MINUTE = 60_000_000;
export const MICROS_PER_HOUR = 60 * MICROS_PER_MINUTE;
export const MICROS_PER_DAY = 24 * MICROS_PER_HOUR;
export const MICROS_PER_WEEK = 7 * MICROS_PER_DAY;
