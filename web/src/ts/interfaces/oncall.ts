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
 * Who a level of the ladder pages.
 *
 * Three kinds, down from eight. Six of the old ones existed only to name a
 * slot or to describe a derivation — `next_on_call` computed a second person
 * from the first's roster, so a position existed whether or not anybody
 * staffed it. Nothing here conjures a person: if a level resolves to somebody,
 * a shift rule put them there.
 */
export type EscalationTargetKind = "rotation" | "user" | "whole_team";

/**
 * How much of a rotation a level pages.
 *
 * This is why three kinds are enough — "everyone in this rotation" is a mode,
 * not a fourth kind.
 */
export type RotationMode =
  /** The one person the rotation puts on call at that instant. */
  | "on_call"
  /** Everyone on the rotation's winning shift rule, on shift or not. */
  | "all";

export type EscalationTarget =
  | {
      kind: "rotation";
      /** The rotation's **id**, never its name — a rotation is renameable and
       *  a stored policy must not start paging a different position because
       *  somebody fixed a typo on a calendar. */
      rotation_id: string;
      /** Omitted from the wire when it is `on_call`, so a level written
       *  without it round-trips unchanged. Never send `"on_call"` explicitly. */
      mode?: RotationMode;
    }
  | { kind: "user"; email: string }
  | { kind: "whole_team" };

/**
 * Offered in the target picker, in the order they are listed.
 *
 * Three radio options: pick a rotation, pick people, or pick the whole team.
 * Several targets in one step fire together — that is now the **only** way to
 * page more than one person.
 */
export const TARGET_KINDS: EscalationTargetKind[] = ["rotation", "user", "whole_team"];

/** Does this kind carry a `rotation_id`? Narrows, so the caller can read it. */
export function isRotationTarget(
  target: EscalationTarget,
): target is Extract<EscalationTarget, { kind: "rotation" }> {
  return target.kind === "rotation";
}

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
   * the kind has to exist here even though the human timeline filters it out.
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
 * `id` is a rotation's stored id — data, not display text. It was the name
 * until rotations became renameable objects; a name is no longer a stable
 * handle for one.
 */
export type ScheduleEditorIntent =
  | { mode: "new" }
  | { mode: "edit"; id: string }
  | { mode: "duplicate"; id: string };

/**
 * One layer inside a rotation — a roster, a cadence, and when it applies.
 *
 * This is what a `Rotation` used to be. It became a rule *inside* one when
 * rotations turned into named objects: follow-the-sun is several rules in
 * **one** rotation, because three regional rules are one person on call across
 * three timezones' working hours — not three people on call at once.
 */
export interface ShiftRule {
  /** What this rule is called on the calendar. "APAC business hours",
   *  "Weekend", "Base rotation". */
  name: string;
  /** Participants in handover order. */
  members: string[];
  /** Shift length in microseconds. */
  shift_micros: number;
  /**
   * Instant `members[0]`'s first shift begins, in microseconds.
   *
   * This is also the whole of the "secondary" mechanism. Two rotations with the
   * same roster and anchors one shift apart can never resolve to the same
   * person — and that is *data*, not a rule: nothing at resolution time knows
   * the two are related, and dragging one anchor breaks the pairing on purpose.
   * It replaced `secondary_offset`, which computed the second person from the
   * first's roster and so produced a position that existed whether or not
   * anybody staffed it.
   */
  anchor_micros: number;
  /// Higher wins when two rules in the same rotation both apply. Explicit
  /// rather than positional, so reordering the list cannot silently change who
  /// gets paged.
  priority?: number;
  /// When this rule applies. Empty means always — the catch-all every
  /// follow-the-sun setup needs underneath the restricted ones.
  restrictions?: TimeWindow[];
  /**
   * The rule is not in effect before this instant. Absent means "since
   * forever".
   */
  starts_at?: number;
  /**
   * The rule is not in effect at or after this instant. Absent means "until
   * further notice".
   *
   * **This is how a rule is retired.** Deleting it is the only substitute and
   * it throws away exactly the record this field exists to keep — "the weekend
   * rule ran until March" stops being something the schedule can say.
   * Exclusive, like every other boundary here.
   */
  ends_at?: number;
}

/**
 * A named position on a team, and the only thing that puts a person on call.
 *
 * Zenduty's *schedule*, incident.io's *rota*. It replaced a `slot` string that
 * grouped rotations into positions, plus a *derived* secondary computed from
 * the primary's roster — two sources for one position, which disagreed the
 * moment they could.
 *
 * **Two rotations = two people on call. Two shift rules = one person, different
 * hours.** That sentence is the whole model.
 */
export interface Rotation {
  /**
   * Stable handle. Unique within the team, and what an escalation level stores.
   *
   * Required on write. A level points at this rather than at `name` so that
   * renaming a rotation cannot move who gets paged.
   */
  id: string;
  /** What a level of the escalation policy names it, and what a page calls it.
   *  Renameable, precisely because levels store the id. */
  name: string;
  /**
   * The stack. Highest priority whose restrictions match wins, and exactly one
   * of them does.
   *
   * Must be non-empty: a rotation with no shift rules puts nobody on call ever,
   * and it is the one state that looks configured on a calendar and pages no
   * one.
   */
  shift_rules: ShiftRule[];
  /**
   * Where this rotation came from. `"default"` marks one the system staffed
   * when the team was created — whole roster, weekly, 24×7.
   *
   * It exists because auto-staffing costs a screen the signal it used to read
   * absence with: `GET .../schedule` no longer returns `null` for a new team,
   * so "never configured" has to be read from here instead.
   *
   * **Render it as "default rotation — everyone in turn. Customise", never as
   * something somebody designed. Never write it: any human edit clears it, by
   * definition.**
   */
  source?: string;
}

/**
 * `GET /oncall/schedule-presets`. The catalogue carries its own form schema —
 * `follow_the_sun` advertises `min: 2, max: 4` itself, so nothing about the
 * shapes is hardcoded client-side and a fifth preset appears with no UI
 * change. Build the form from THIS, never from the docs.
 */
export type PresetInputKind =
  | "group"
  | "group_list"
  | "day_of_week"
  | "day_list"
  | "minute_of_day"
  | "timezone"
  | "duration_micros"
  /** An instant, in micros since the epoch — a date and a time read in a zone,
   *  which is not the control a duration takes. */
  | "timestamp_micros"
  | "text"
  | "member_list";

export interface PresetInput {
  /** The JSON key, exactly as the request body spells it. */
  field: string;
  kind: PresetInputKind;
  label: string;
  description: string;
  required: boolean;
  min?: number;
  max?: number;
  /** What the server uses when the field is absent, already in wire shape. */
  default?: unknown;
  /** For `group` and `group_list`: the fields each group carries. */
  fields?: PresetInput[];
}

export interface PresetDescriptor {
  id: string;
  /** What to call it on a button. */
  name: string;
  /** One line: what applying it builds. */
  description: string;
  /** The layers it generates, highest priority first. */
  layers: string[];
  inputs: PresetInput[];
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
 * "I am away 20 Aug – 3 Sep." Org-wide, not per team — being away is a fact
 * about a person, and a per-team row is the one somebody forgets to write
 * twice. The resolver skips an away member and moves ONLY their turn.
 */
/**
 * `GET/PUT /oncall/teams/{id}/channel` — where the team is talked to.
 *
 * `source` is the point: precedence has to be visible, or "I set the team
 * channel and pages still go to the old room" is unanswerable from the API.
 * On the PUT, `null` clears the override (back to the policy's list) while
 * `[]` says "this team has no channel" — silence, on purpose. Two different
 * facts; never collapse them into one control.
 */
export interface TeamChannel {
  team_id: string;
  destinations: string[];
  source: "team" | "policy";
}

export interface Unavailability {
  id: string;
  org_id: string;
  user_email: string;
  /** Micros, inclusive. */
  start_at: number;
  /** Micros, exclusive — somebody back on the 3rd is on call on the 3rd. */
  end_at: number;
  reason?: string | null;
  created_by: string;
  created_at: number;
}

/**
 * The name the system gives a team's first rotation.
 *
 * A *name*, not a keyword: nothing in resolution treats it specially, and a
 * team may rename or delete it. It replaced `DEFAULT_SLOT`, which **was** a
 * keyword — every rotation that did not name a slot silently meant that one,
 * and six escalation targets existed to say "that one" in different ways.
 */
export const DEFAULT_ROTATION_NAME = "Primary";

/**
 * The name the system gives the second rotation, when one is asked for.
 *
 * Also just a name. The rotation it labels is entirely ordinary: same roster,
 * same cadence, anchor one shift behind. Nothing derives it and nothing links
 * the two — if somebody edits one roster and not the other they drift, and the
 * `two_rotations_resolve_to_one_person` risk is how the user finds out.
 */
export const SECONDARY_ROTATION_NAME = "Secondary";

/**
 * The name the system gives a rotation's first shift rule.
 *
 * A rule answers *when and who*; a rotation is *which position*. Naming the
 * rule after the rotation put one word on two concepts — a rotation called
 * `Secondary` whose only rule was called `Primary` was a real defect, fixed
 * server-side 2026-08-21 (API-FOR-UI §N.9b). Anything the UI mints follows.
 */
export const BASE_SHIFT_RULE_NAME = "Base";

/** The longest a rotation's name may be, server-side. */
export const MAX_ROTATION_NAME_CHARS = 64;

/**
 * Who one rotation puts on call at an instant.
 *
 * One per rotation, and a rotation is the only thing that produces one. The
 * previous shape had an entry per *slot*, where a slot could exist because
 * something derived it rather than because anybody staffed it.
 *
 * **A rotation that resolves to nobody is absent from the array**, not present
 * with a null holder — that is a coverage gap, and a screen that renders one
 * row per response entry will simply not draw it.
 */
export interface OnCallPosition {
  /** The rotation's id. What a level of the escalation policy points at. */
  rotation_id: string;
  /** The rotation's name, for a human reading a page or a calendar. */
  rotation_name: string;
  /** Which shift rule inside it produced this answer. */
  rule: string;
  user_email: string;
  /**
   * Who takes over at the next handover.
   *
   * **Display only.** Nothing pages this: it is the calendar's "up next". It
   * used to double as the secondary, which is precisely how one team got two
   * different people both correctly labelled "the secondary" — never render it
   * as a position, and never offer it as a page target.
   */
  next_user_email?: string | null;
  /** Set when a cover, rather than a shift rule, put this person here. */
  override_id?: string | null;
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

/** How the L0 agent relates to paging at one severity. */
export type L0Mode =
  /** The agent runs alongside a page that has already gone out. */
  | "parallel"
  /** The page is held for the triage budget, or until the verdict lands. */
  | "gate"
  /** The agent investigates and nobody is paged. */
  | "only";

/**
 * Per-severity modes, keyed by the UPPERCASE strings the wire uses
 * (`#[serde(rename = "P1")]`) — beside rung priorities that are integers.
 * Both forms in one policy object; this is not a mistake (API-FOR-UI §H).
 */
export interface L0Modes {
  /** Pinned `parallel` server-side — holding a critical page behind a model
   *  is not a setting the product offers. The server 400s anything else. */
  P1: L0Mode;
  P2: L0Mode;
  P3: L0Mode;
  /** Covers P4 AND P5 — neither pages a human, so neither has a gate to set.
   *  Pinned `only`; the server 400s anything else. */
  P4: L0Mode;
}

/**
 * A team's L0 block, as `l0_json` stores it. Ships with every auto-created
 * policy. There is deliberately no downgrade knob for severity: the ratchet
 * (promotion only) is an invariant of the engine, not a team preference.
 */
export interface L0Policy {
  mode: L0Modes;
  /** Seconds a gated page is held. Valid 30–600; the server REFUSES values
   *  outside the range rather than clamping — validate before sending. */
  triage_budget_seconds: number;
  allow_promotion: boolean;
  /** How far one verdict may raise a severity, so a P4 cannot become a P1 in
   *  a single hop. */
  max_promotion_steps: number;
  /** About one notification's channels, never about the record's severity. */
  allow_downgrade: boolean;
  /** Opt-in. Until enabled, a Suppress verdict is recorded as a
   *  recommendation and the page still goes out. */
  allow_suppress: boolean;
}

/** The bounds the server enforces on `triage_budget_seconds`. */
export const L0_BUDGET_MIN_SECONDS = 30;
export const L0_BUDGET_MAX_SECONDS = 600;

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
  /** How many full passes the ladder runs before `final_action`. 1 = once; there is no zero. */
  repeat_count?: number;
  final_action?: PolicyFinalAction;
  /** Absent on a PUT means UNCHANGED — only send when the user touched it. */
  l0?: L0Policy;
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
  /**
   * Where the runbook is, hoisted onto the record by the API rather than left
   * nested in the alert — this is the one screen where "where is the runbook"
   * is asked, and it must not depend on the alert still existing.
   */
  runbook_url?: string | null;
  /** How deep the ladder got, as the rung's delay from the record opening. */
  reached_rung_micros?: number | null;
  /** Server-computed, and only present on a record somebody answered. */
  time_to_ack_micros?: number | null;
}

/**
 * What `POST /responses/{id}/promote` accepts as a severity. An incident's
 * severity is NOT the record's priority: the incident scale stops at P4, so a
 * P5 page promotes to P4 rather than to a severity that does not exist.
 */
export const PROMOTE_SEVERITIES = ["P1", "P2", "P3", "P4"] as const;

export type PromoteSeverity = (typeof PROMOTE_SEVERITIES)[number];

/** What the promote call answers with — the record comes back updated. */
export interface PromoteResult {
  incident_id: string;
  severity: string;
  response: OnCallResponse;
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
  /** Which rotation the finding is about, by name, where it is about one. */
  slot?: string | null;
  rung_micros?: number | null;
  /**
   * Micros — when the finding first bites.
   *
   * **Render it.** On `two_rotations_resolve_to_one_person` it looks up to
   * three weeks ahead, and a warning about something happening in September is
   * only actionable if it says September.
   */
  at?: number | null;
  rule_id?: string | null;
  /** The ownership rule's dimensions, as the rule itself spells them. */
  path?: string | null;
  /** How many alert rules the finding costs, where that is what makes it real. */
  alert_count?: number | null;
}

export interface ConfigRisks {
  team_id: string;
  horizon_days: number;
  /** Pre-truncation count — may exceed `risks.length`. */
  total: number;
  risks: ConfigRisk[];
}

/**
 * A level points at a rotation the team does not have, so it pages nobody and
 * the ladder skips it in silence. Carries `priority`. Severity `high`.
 *
 * Renamed from `slot_pages_nobody`.
 */
export const RISK_LEVEL_PAGES_NOBODY = "level_names_a_rotation_that_does_not_exist";

/**
 * Two rotations put the same person on call at the same instant, so one person
 * holds two positions and a level paging both would page them twice.
 *
 * Carries `user_email`, `rotation` and — the part worth rendering — `at`.
 * Severity `medium`. Renamed from `slots_can_collide`.
 */
export const RISK_ROTATIONS_COLLIDE = "two_rotations_resolve_to_one_person";

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

/**
 * The L0 agent's part in one priority's ladder, as the preview reports it.
 *
 * `mode` arrives **already resolved for this priority** — the server applies
 * the P1 invariant (always `parallel`) and the pages-nobody rule (P4/P5 →
 * `only`) before answering. Never re-derive it from `policy.l0.mode`: two
 * places deciding what P1 means is how they come to disagree.
 */
export interface PreviewL0 {
  mode: L0Mode;
  /** Seconds a `gate` holds the first rung for. */
  triage_budget_seconds: number;
  /**
   * The deployment has an agent reachable. False means **draw no L0 step at
   * all**, whatever the policy says — a `gate` with nothing to gate on does
   * not hold the page, it pages immediately, and a hold drawn there reads as
   * configured and is wrong.
   */
  available: boolean;
  /** A finished sentence — render it rather than composing one. */
  summary: string;
  allow_suppress: boolean;
  allow_promotion: boolean;
  allow_downgrade: boolean;
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
  /**
   * Optional because the endpoint gained it 2026-08-21 (D-58) and a build
   * talking to an older server gets nothing — which reads the same as a
   * deployment with no agent: no L0 step.
   */
  l0?: PreviewL0 | null;
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
   * Which rotation this span resolves. Always present.
   *
   * **The endpoint answers for one rotation at a time**, defaulting to the
   * team's primary. Segments for a second rotation come from a second call with
   * its `rotation_id` — a lane drawn for one rotation and filled from another's
   * segments will be empty, which is why the timeline says so rather than
   * rendering a blank week that reads as "nobody".
   *
   * A team with **no rotations at all** gets `[]` back, not one long gap
   * segment: there is no position to be unstaffed.
   */
  rotation_id: string;
  /** Micros. */
  from: number;
  /** Micros. */
  to: number;
  /** Absent means nobody is on call for this span. */
  user_email?: string | null;
  /**
   * The **shift rule** that produced the holder, by name — so a grid can colour
   * by layer. Not the rotation: that is `rotation_id`, and every segment in one
   * response shares it.
   *
   * Null on a gap, where no rule won and therefore none named anybody.
   */
  rotation?: string | null;
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
  /** Which climb of the ladder. Absent means the first run. */
  ladder_run?: number | null;
  /** `delivery` rows: who one page was addressed to. */
  recipient?: string | null;
  channel?: Channel | null;
  /**
   * On a `delivery` row: whether the transport took that one send. On a
   * `page` row: `false` marks a rung with real recipients that reached NONE
   * of them — the transport lost the whole rung, the ladder keeps its place
   * and retries. A rung that resolved to nobody gets no marker: that rung is
   * spent, this one is not. Absent means the rung reached somebody.
   */
  delivered?: boolean | null;
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

/**
 * Why a subject routed the way it did. Five kinds, not three — `context` is
 * an alert's `context_attributes.team` naming a team, and `default` is the
 * org's nominated catch-all absorbing a signal nothing matched (drift caught
 * by the H5 contract spec on its first run).
 */
export type RoutingDecisionKind = "explicit" | "context" | "ownership" | "default" | "unrouted";

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

/** One shift the signed-in user is on. */
/**
 * One of the caller's teams, and whether they are on call for it.
 *
 * **`on_call_now` is `true` / `false` / `null`.** `null` alongside
 * `schedule_resolved: false` means the schedule could not be resolved, and it
 * is deliberately **not** reported as off duty — telling somebody they are not
 * on call when the truth is that we could not work it out is the one answer
 * this endpoint must never give. Render it as unknown.
 */
export interface MyOnCallTeam {
  team_id: string;
  team_name: string;
  timezone: string;
  description?: string | null;
  on_call_now: boolean | null;
  /** Everybody the schedule resolved for this team, not only the caller. */
  on_call: string[];
  schedule_resolved: boolean;
}

/**
 * `GET /oncall/my/teams` — the caller's teams and their duty, in one request
 * instead of N+1.
 *
 * **This type described a different response entirely** — `slots`, `channels`,
 * `open_responses`, `pages_last_7d`, none of which the endpoint sends. It went
 * unnoticed for the same reason `Override`'s did: nothing called the service
 * method, so the shape was never read against a real response.
 */
export interface MyOnCall {
  /** The instant this was resolved at. Micros. */
  at: number;
  user_email: string;
  /** True if any team is true. */
  on_call_now: boolean;
  teams: MyOnCallTeam[];
}

/**
 * One page that was sent to the caller, as their inbox renders it.
 *
 * Carries the record's fields alongside the delivery's, so a row answers "what
 * was this, and did it reach me" without opening anything. `response_state` is
 * the state **now**, not when the page went out — an inbox row for something
 * already resolved should say so.
 */
export interface MyDelivery {
  event_id: string;
  response_id: string;
  /** Micros. */
  at: number;
  body: string;
  channel: Channel;
  delivered: boolean;
  ladder_run?: number | null;
  rung_micros: number;
  team_id: string;
  title?: string | null;
  priority: number;
  response_state: ResponseState;
  subject_type: SubjectType;
  subject_id: string;
  /** Micros. Absent while unread. */
  read_at?: number | null;
  /** Always present, derived from `read_at`. */
  read: boolean;
}

export interface MyDeliveries {
  /** Respects the filter. */
  total: number;
  /**
   * **Deliberately ignores `from`/`to`.** It is the badge, and "3 unread" must
   * not change because somebody scrolled to last Tuesday.
   */
  unread: number;
  deliveries: MyDelivery[];
}

/** What `POST /oncall/my/deliveries/read` answers with. */
export interface MyDeliveriesRead {
  updated: number;
  /** Travels back so the badge is right without a second request. */
  unread: number;
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
/**
 * `GET/PUT /oncall/routing/config` — the org's nominated catch-all.
 *
 * Nothing auto-creates one: a fresh org has none, deliberately, and an
 * operator nominates one of their OWN teams. `default_team_name` is resolved
 * server-side so the screen never joins against the team list to draw one
 * label — or leaves it blank when the team is one the caller has not loaded.
 */
export interface RoutingConfig {
  org_id: string;
  default_team_id: string | null;
  default_team_name: string | null;
  /** Micros. `0` when never set. */
  updated_at: number;
}

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
  /** Set when the nominated default team absorbed this signal — the row is a
   *  routing gap that PAGED somebody, versus one that paged nobody. */
  defaulted_team_id?: string | null;
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
/**
 * A cover: somebody stands in for the rotation over a window.
 *
 * **Three of these field names were wrong** — `starts_at`, `ends_at` and
 * `note`, none of which the wire has. It went unnoticed because `listOverrides`
 * had no callers: the type was never read against a real response, only
 * written by the create form, which builds its own body. A cover shows on the
 * calendar as an `override_id` annotation, and that is a field the type did
 * get right.
 */
export interface Override {
  id: string;
  org_id: string;
  team_id: string;
  /**
   * Which rotation this cover stands over. Always present on read.
   *
   * A cover names a rotation for the same reason a level does: a cover is
   * "stand in for this position", and a position is a rotation. Covering two of
   * them is two covers, said out loud, rather than one cover that silently
   * lands the same person in both.
   */
  rotation_id: string;
  user_email: string;
  /** Micros. */
  start_at: number;
  /** Micros. */
  end_at: number;
  /**
   * Whose shift is being covered. Optional, and legitimately so: "cover
   * tonight" is a real request even when nobody has worked out whose night it
   * is yet.
   */
  covering_for?: string | null;
  /** Why. Free text, up to 500 characters. */
  reason?: string | null;
  created_by: string;
  /**
   * Micros. **Load-bearing for overlapping covers**: the latest `created_at`
   * wins the overlap, with `id` descending breaking a tie — so a list that
   * sorts by anything else shows the wrong one on top.
   */
  created_at: number;
}

/**
 * One `(recipient, channel)` a test page tried, in the order tried.
 *
 * `reason` is the other half of the answer: a test page that reached somebody
 * who should not have been on the list has still found a misconfiguration.
 */
export interface TestPageAttempt {
  channel: Channel;
  recipient: string;
  reason: string;
  delivered: boolean;
  /** The transport's own error, verbatim. Absent on success. */
  detail?: string | null;
}

/**
 * `POST /oncall/teams/{id}/test-page`. Always a 200 — a test page that found a
 * team nobody is on call for has done its job; the endpoint worked and the
 * configuration did not.
 *
 * There is no `recipients` field and never was. The UI invented one, read
 * `undefined` from every 200, and reported a delivered page as "Nothing was
 * sent — Nobody".
 */
export interface TestPageResult {
  reached_anyone: boolean;
  /** Why nothing was sent, when nothing was. Absent means it was attempted. */
  not_sent_because?: string | null;
  /** The channels this priority pages on, in fallback order. */
  channels: Channel[];
  attempts: TestPageAttempt[];
}

/**
 * What `POST .../escalate` answers with.
 *
 * **Not the bare record.** The verb reports what it did — who it woke, who it
 * chased a second time, and who it skipped because a page had already landed
 * on them — and `response` carries the record alongside. A screen that patches
 * a row from `res.data` rather than `res.data.response` writes the envelope
 * into the row.
 *
 * `ladder_exhausted` arrives as a **200**, deliberately: "there is nobody above
 * you" is an answer, not a failure, and rendering it as an error invites a
 * second press.
 */
export type EscalateResult =
  | { escalated_to: "ladder_exhausted"; response: OnCallResponse }
  | {
      escalated_to: "rung";
      /** Which rung was reached, as its delay from the ladder anchor. */
      rung_micros: number;
      /** Who the rung was dispatched to. */
      recipients: string[];
      /** Reached again although they had already been paged on this run. */
      chased: string[];
      /** Skipped: a page for this run had already landed on them. */
      deduplicated: string[];
      response: OnCallResponse;
    };

export const MICROS_PER_MINUTE = 60_000_000;
export const MICROS_PER_HOUR = 60 * MICROS_PER_MINUTE;
export const MICROS_PER_DAY = 24 * MICROS_PER_HOUR;
export const MICROS_PER_WEEK = 7 * MICROS_PER_DAY;

/**
 * What this org's telemetry actually carries, read from
 * `service_streams/_analytics`.
 *
 * The semantic groups say what a dimension COULD be called across every
 * platform the product understands; this says which of those names this org has
 * ever emitted, and with what values. A rule pinned to a dimension nothing sends
 * reads as "never matched", which is indistinguishable from a rule that is
 * simply wrong.
 */
export interface DimensionCatalogue {
  /** Dimension ids seen in this org, most useful first. */
  present: string[];
  /** `values[dimension][value]` = how many services carry it. */
  values: Record<string, Record<string, number>>;
}

/**
 * A service discovery has seen, reduced to what a routing rule needs.
 *
 * `identity` is the record's `disambiguation` — the dimensions the org's
 * identity sets say make this deployment of this service distinct. Claiming a
 * service means writing exactly those as a rule, which is why the rule editor
 * can offer it as one choice rather than three fields.
 *
 * It is empty for anything the identity sets do not cover — bare metal, a VM,
 * an appliance. Those are claimable by service name alone, and the form says so
 * rather than pretending the claim is narrower than it is.
 */
export interface DiscoveredService {
  name: string;
  /** Which identity set matched, e.g. `kubernetes`. `default` means none did. */
  setId: string;
  identity: Record<string, string>;
}
