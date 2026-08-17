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
  | "whole_team"
  /** The three slot-naming targets. The unsuffixed three keep meaning the
   *  DEFAULT slot — every stored policy row holds `{"kind":"on_call_now"}`
   *  and it has to keep meaning the primary. */
  | "on_call_in_slot"
  | "next_on_call_in_slot"
  | "everyone_in_slot";

/** The kinds that carry a slot name. */
export type SlotTargetKind = "on_call_in_slot" | "next_on_call_in_slot" | "everyone_in_slot";

export type EscalationTarget =
  | { kind: Exclude<EscalationTargetKind, "user" | SlotTargetKind> }
  | { kind: "user"; email: string }
  | { kind: SlotTargetKind; slot: string };

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
  | "exhausted"
  /**
   * One page, to one person, on one channel (storage id 10).
   *
   * The machine-readable half of the ledger. Deliberately kept off the human
   * timeline — a responder wants one legible "paged ana, bo" line, not a row
   * per address — but it is what `GET /responses/{id}/deliveries` returns, so
   * the kind has to exist here even though `OnCallTimeline` filters it out.
   */
  | "delivery"
  /**
   * The L0 agent's structured verdict for this firing (storage id 11).
   *
   * Its own kind rather than another `rca` because it is the durable,
   * auditable copy of a machine's *recommendation* — "why was I not paged"
   * has to be answerable from it.
   */
  | "ai_verdict"
  /**
   * A verdict raised this firing's severity (storage id 12).
   *
   * Carries the severity asked for beside the one applied: a clamped promotion
   * is two different facts, and a responder woken by one is owed both.
   */
  | "severity_promoted"
  /**
   * The condition fired again so soon after recovering that the engine treated
   * it as the same unstable firing and did not page (storage id 13).
   *
   * "This was dampened" is the one thing a smoothed record must not hide — the
   * responder has to see that the condition came back and nobody was woken.
   */
  | "flapped";

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

/**
 * What the user asked for when the schedule editor opened.
 *
 * The rotation table already emits which row was clicked; carrying that
 * through means one click lands on that rotation's form instead of on a bulk
 * editor the user then has to navigate a second time.
 *
 * `name` is a rotation's stored name — data, not display text.
 */
export type ScheduleEditorIntent =
  | { mode: "new" }
  | { mode: "edit"; name: string }
  | { mode: "duplicate"; name: string };

export interface Rotation {
  /** What this rotation is called — a label for a shift, not a rung of the
   *  ladder. Two rotations in different slots may share a name. */
  name: string;
  /**
   * Which slot this rotation staffs. Absent means {@link DEFAULT_SLOT}.
   *
   * Rotations **sharing** a slot are layers and compete by priority and
   * restriction. Rotations in **different** slots do not compete at all: both
   * resolve, at the same instant, each with its own members and handover day.
   * That is what makes a secondary a separate pool rather than next week's
   * primary.
   */
  slot?: string;
  /** Participants in handover order. */
  members: string[];
  /**
   * How far down the cycle the derived secondary sits.
   *
   * **Absent means derived** — `max(1, len/2)` — not `1`. Writing the old
   * behaviour into every rotation would have frozen it into the data. A
   * three-person roster stays lockstep, which is correct: the only other offset
   * would make the secondary *last* week's primary.
   *
   * `0` is refused with a 400 — it would make the secondary the person already
   * on call. Larger than the roster is clamped silently, so a shrinking team
   * never takes its own rotation out of service.
   */
  secondary_offset?: number;
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

/**
 * The slot a rotation, cover or ladder rung belongs to. Absent means
 * {@link DEFAULT_SLOT} — every rotation written before slots existed is the
 * team's primary, and reading it any other way would silently rewire a stored
 * ladder the day somebody added a second pool.
 *
 * Slots resolve **independently and at the same time**: two slots are two
 * answers to "who is on call", not two candidates for one answer. Layering —
 * priority, restrictions, validity windows — happens *within* a slot.
 */
export const DEFAULT_SLOT = "primary";

/** Server-side comparison is case- and whitespace-insensitive; match it. */
export function sameSlot(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? DEFAULT_SLOT).trim().toLowerCase() === (b ?? DEFAULT_SLOT).trim().toLowerCase();
}

export interface OnCallSlot {
  /** Absent means the default slot. See {@link DEFAULT_SLOT}. */
  slot?: string | null;
  /** The rotation that produced this. */
  rotation: string;
  user_email: string;
  /** Who it hands over to — **within this slot**, not the next slot. Absent
   *  for a one-person rotation. */
  next_user_email?: string | null;
  /**
   * How far down the cycle `next_user_email` sits, so the screen can say "+5"
   * rather than leaving the reader to wonder why that person.
   */
  next_offset?: number | null;
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
 * `GET /oncall/teams/{id}/reachability`.
 *
 * Answers "would a page to this person land" from EVIDENCE rather than
 * configuration: a real user of the org, a mailbox-shaped address, a transport
 * that exists, a method that has been verified. Every negative carries its own
 * reason, which is why the UI never has to invent one.
 */
export interface ChannelReadiness {
  channel: Channel;
  deliverable: boolean;
  /** On file but no transport may use it — `phone`, `push`. */
  configured_but_unverified: boolean;
  /** A finished sentence. Render verbatim. */
  blocked_because?: string | null;
}

export interface MemberReachability {
  user_email: string;
  is_org_user: boolean;
  /** `root@example` is a valid login and cannot receive mail. */
  mailbox_shaped: boolean;
  channels: ChannelReadiness[];
  deliverable_channels: Channel[];
  configured_but_unverified: string[];
  /** The one boolean the badge renders. */
  would_a_page_land: boolean;
  /** A finished sentence. Render verbatim. */
  why_not?: string | null;
}

export interface TeamReachability {
  team_id: string;
  team_name: string;
  /** One `false` here explains every unreachable row beneath it. */
  smtp_configured: boolean;
  members: MemberReachability[];
  reachable: number;
  total: number;
  unreachable_members: string[];
}

/**
 * `GET /oncall/teams/{id}/config-risks`. Computed, never stored — a risk that
 * is derived cannot disagree with the thing it describes.
 */
export interface ConfigRisk {
  kind: string;
  severity: "high" | "medium" | "low" | string;
  /** A finished sentence. Render verbatim. */
  message: string;
  priority?: string | null;
  user_email?: string | null;
  rotation?: string | null;
  rung_micros?: number | null;
}

export interface ConfigRisks {
  team_id: string;
  horizon_days: number;
  /** Pre-truncation count — may exceed `risks.length`. */
  total: number;
  risks: ConfigRisk[];
}

/**
 * `GET /oncall/teams/{id}/escalation-preview`. A dry run: who this priority
 * would wake right now, rung by rung, and whether each page would land.
 *
 * Nothing is sent. Every verdict is resolved against the rotation and the
 * transports as they stand at `at`, which is why it answers "would this work"
 * in a way reading the policy cannot.
 */
export interface PreviewRecipient {
  user_email: string;
  /** Why this person is on this rung. A finished phrase — render it. */
  reason: string;
  would_a_page_land: boolean;
  /** A finished sentence when the page would not land. */
  why_not?: string | null;
  deliverable_channels: Channel[];
}

export interface PreviewRung {
  /** Delay from the record opening. */
  after_micros: number;
  /** The engine's words for what this rung aims at, e.g. "the next on-call". */
  targets: string[];
  recipients: PreviewRecipient[];
  /** The rung fires and reaches nobody at all — worse than a slow rung. */
  resolves_to_nobody: boolean;
}

export interface EscalationPreview {
  team_id: string;
  team_name: string;
  /** `P1`..`P5`. */
  priority: string;
  /** Micros — the instant the answer is for. */
  at: number;
  pages_anyone: boolean;
  channels: Channel[];
  rungs: PreviewRung[];
  repeat_count?: number | null;
  final_action?: PolicyFinalAction | null;
  /** What happens when the ladder runs out. A finished sentence. */
  ends_with: string;
  /** How a page can leave this team, automatically or by hand. Sentences. */
  cross_team_moves: string[];
  /** True when no rung would reach a single person — the loudest finding. */
  reaches_nobody: boolean;
}

/**
 * `GET /oncall/teams/{id}/overview`. One call for the whole team header.
 *
 * Every figure is computed SERVER-side over the window — `acked_under_5m_percent`
 * counts in the database, not over a page of fetched records, which is what
 * makes it safe to show on a tile.
 */
export interface TeamRungSummary {
  /** `P1`..`P5`. */
  priority: string;
  rungs: number;
  /** False means this priority never wakes a human. */
  pages_anyone: boolean;
  /** Delay of the last rung; absent when nothing fires. */
  nobody_after_micros?: number | null;
  /** A ladder that stops short of the whole team runs out of people. */
  ends_with_whole_team: boolean;
}

export interface TeamPageStats {
  pages: number;
  acknowledged: number;
  acked_under_5m: number;
  /** Opened in the team's own night window. */
  night_pages: number;
  reached_second_rung: number;
  reached_final_rung: number;
}

export interface TeamOverview {
  team_id: string;
  team_name: string;
  timezone: string;
  members: number;
  /** Alert rules routed to this team. */
  alerts_assigned: number;
  ownership_paths: number;
  covered_now: boolean;
  on_call_now: string[];
  rungs: TeamRungSummary[];
  repeat_count?: number | null;
  final_action?: PolicyFinalAction | null;
  /** Micros. */
  from: number;
  /** Micros. */
  to: number;
  days: number;
  stats: TeamPageStats;
  acked_under_5m_percent: number;
}

/**
 * One span of `GET /oncall/teams/{id}/resolved-schedule`. Segments tile the
 * window exactly; one with no `user_email` is a GAP, which is the whole reason
 * to ask the server rather than resolve the rotation on this side.
 */
export interface ResolvedSegment {
  /**
   * Which slot this span resolves. Absent means the default slot.
   *
   * **The endpoint answers for one slot at a time.** A team with a staffed
   * `secondary` gets no `secondary` segments back, so a lane drawn for one and
   * filled from these will be empty — which is why the timeline says so rather
   * than rendering a blank week that reads as "nobody".
   */
  slot?: string | null;
  /** Micros. */
  from: number;
  /** Micros. */
  to: number;
  /** Absent means nobody is on call for this span. */
  user_email?: string | null;
  /** The layer this span belongs to — or the one a cover displaced. */
  rotation: string;
  /** Present when a cover took this span from the rotation. */
  override_id?: string | null;
}

/** `GET /oncall/teams/{id}/load`. Who has been carrying the pager. */
export interface MemberLoad {
  user_email: string;
  pages: number;
  /** Pages that landed in the team's own night window. */
  nights: number;
  acks: number;
}

export interface ShiftShare {
  user_email: string;
  micros: number;
  percent: number;
}

export interface RotationFairness {
  rotation: string;
  shares: ShiftShare[];
  verdict: string;
  /** Already-worded summary. Render verbatim. */
  summary: string;
}

export interface TeamLoad {
  team_id: string;
  from: number;
  to: number;
  days: number;
  members: MemberLoad[];
  upcoming_from: number;
  upcoming_to: number;
  rotations: RotationFairness[];
}

/**
 * `GET /oncall/analytics/causes`. The ONLY analytics endpoint that exists —
 * it counts causes, never durations, and the counting happens in the database
 * rather than over a fetched page, which is what makes it safe to show on an
 * org of any size.
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

/// One row of the cause breakdown, with the most recent example so a row can
/// be a link rather than just a number.
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

/** A rule that also matched but did not win, and the server's reason it lost. */
export interface AlsoMatchedRule {
  rule_id: string;
  team_id: string;
  team_name?: string | null;
  path: string;
  /** True when losing changes nothing — the winner routes to the same team. */
  same_team: boolean;
  /** A finished sentence explaining the precedence. Render it, never restate it. */
  lost_because: string;
}

export interface RoutingPreview {
  decision: { kind: RoutingDecisionKind } & Record<string, unknown>;
  team_id: string | null;
  reason: string;
  /** True when nothing matched and the org's fallback team caught it. */
  landed_on_default?: boolean;
  /** Server-written caveats about this route. Finished sentences. */
  notes?: string[];
  /** Every priority's shape on the team this resolves to, silent ones included. */
  ladder?: TeamRungSummary[];
  repeat_count?: number;
  final_action?: string;
  /** Who holds it this instant, and whether a page to them would land. */
  current_responder?: PreviewRecipient | null;
  /** False when the winning team has nobody on call right now. */
  covered_now?: boolean;
  /** The rules that matched and lost. Empty when the win was uncontested. */
  also_matched?: AlsoMatchedRule[];
}

/** `active` — it catches pages. `shadowed` — a more specific rule takes them
 *  first. `never_used` — it has matched nothing since it was written. */
export type OwnershipRuleHealth = "active" | "shadowed" | "never_used";

/** A rule that outranks another, from the server's shadowing analysis. */
export interface ShadowingRule {
  rule_id: string;
  team_id: string;
  team_name?: string | null;
  path: string;
  /** What it takes and why. A finished sentence. */
  outcome: string;
}

/** One ownership rule with the traffic it actually caught. */
export interface OwnershipRuleStats {
  rule_id: string;
  team_id: string;
  team_name?: string | null;
  /** `k8s-namespace=payments` — the rule as the engine reads it. */
  path: string;
  dimensions: Record<string, string>;
  created_at: number;
  pages_caught: number;
  /** Micros. Null when the rule has never matched. */
  last_matched_at?: number | null;
  health: OwnershipRuleHealth;
  /** The server's own verdict sentence. Render it rather than composing one. */
  health_summary: string;
  shadowed_by: ShadowingRule[];
}

export interface OwnershipStats {
  /** Micros — the window `pages_caught` is counted over. */
  from: number;
  to: number;
  days: number;
  total: number;
  rules: OwnershipRuleStats[];
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
