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
import http from "./http";
import type {
  OwnershipRule,
  OwnershipStats,
  ResolvedSegment,
  TeamLoad,
  TeamOverview,
  TeamReachability,
  RoutingPreview,
  RoutingConfig,
  Unavailability,
  TeamChannel,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallSchedule,
  PresetDescriptor,
  OnCallSlot,
  OnCallTeam,
  OnCallTeamMember,
  L0Policy,
  PolicyFinalAction,
  PriorityRung,
  Rotation,
  CauseAnalytics,
  ConfigRisks,
  EscalationPreview,
  CauseGroup,
  ResolutionCause,
  CoverageGaps,
  DeliveryLedger,
  EscalationProgress,
  MyOnCall,
  Override,
  PromoteResult,
  PromoteSeverity,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";

/**
 * The server caps a page of responses at 200 and defaults to 100. Asking for
 * the cap keeps the round-trip count down on the one screen that is read at 3am.
 */
export const RESPONSE_PAGE_LIMIT = 200;

const oncall = {
  listTeams: ({ org_identifier }: { org_identifier: string }) =>
    http().get<OnCallTeam[]>(`/api/${org_identifier}/oncall/teams`),

  getTeam: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<OnCallTeam>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}`,
    ),

  createTeam: ({
    org_identifier,
    data,
  }: {
    org_identifier: string;
    data: { name: string; timezone: string; description?: string | null };
  }) => http().post<OnCallTeam>(`/api/${org_identifier}/oncall/teams`, data),

  updateTeam: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    data: { name?: string; timezone?: string; description?: string | null };
  }) =>
    http().put<OnCallTeam>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}`,
      data,
    ),

  deleteTeam: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().delete(`/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}`),

  listMembers: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<OnCallTeamMember[]>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/members`,
    ),

  addMembers: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    data: { user_emails: string[] };
  }) =>
    http().post<OnCallTeamMember[]>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/members`,
      data,
    ),

  removeMember: ({
    org_identifier,
    team_id,
    user_email,
  }: {
    org_identifier: string;
    team_id: string;
    user_email: string;
  }) =>
    http().delete(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/members`,
      { params: { user_email } },
    ),

  /// The four shapes, each carrying its own form schema. Render from the
  /// response, never from the docs — a fifth preset must appear unaided.
  listSchedulePresets: ({ org_identifier }: { org_identifier: string }) =>
    http().get<PresetDescriptor[]>(`/api/${org_identifier}/oncall/schedule-presets`),

  /// A FULL REPLACE of the team's rotations, exactly like PUT /schedule —
  /// confirm before applying over an existing schedule. The result is an
  /// ordinary rotation set with nothing preset-specific stored: a preset is a
  /// starting point, not a mode. 400s name the offending field; surface the
  /// message verbatim.
  applySchedulePreset: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    data: Record<string, unknown> & { preset: string };
  }) =>
    http().post<OnCallSchedule>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/schedule/from-preset`,
      data,
    ),

  getSchedule: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<OnCallSchedule | null>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/schedule`,
    ),

  setSchedule: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    data: { timezone: string; rotations: Rotation[] };
  }) =>
    http().put<OnCallSchedule>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/schedule`,
      data,
    ),

  /// `at` resolves a future instant, so the schedule preview needs no second
  /// endpoint.
  whoIsOnCall: ({
    org_identifier,
    team_id,
    at,
  }: {
    org_identifier: string;
    team_id: string;
    at?: number;
  }) =>
    http().get<OnCallSlot[]>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/on-call`,
      at === undefined ? undefined : { params: { at } },
    ),

  getPolicy: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<OnCallPolicy>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/policy`,
    ),

  setPolicy: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    data: {
      rungs: PriorityRung[];
      destinations?: string[];
      p1_parallel?: boolean;
      p4_pages?: boolean;
      final_action?: PolicyFinalAction;
      /** Absent = unchanged. Only send when the user touched the L0 panel —
       *  editing rungs must not silently un-configure the gate. */
      l0?: L0Policy;
    };
  }) =>
    http().put<OnCallPolicy>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/policy`,
      data,
    ),

  /// `include_resolved` is off by default: the home screen is what still needs
  /// somebody, and closed pages would bury it within a day.
  listResponses: ({
    org_identifier,
    team_id,
    include_resolved,
    limit,
    offset,
  }: {
    org_identifier: string;
    team_id?: string;
    include_resolved?: boolean;
    /** Server default 100, capped at 200. */
    limit?: number;
    offset?: number;
  }) => {
    const params: Record<string, string | number | boolean> = {};
    if (team_id) params.team_id = team_id;
    if (include_resolved) params.include_resolved = true;
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    return http().get<OnCallResponse[]>(
      `/api/${org_identifier}/oncall/responses`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  /// How many records the same filters match, so a paged list can say what it
  /// is a page OF. Degrade to the loaded count if the endpoint is absent.
  countResponses: ({
    org_identifier,
    team_id,
    include_resolved,
  }: {
    org_identifier: string;
    team_id?: string;
    include_resolved?: boolean;
  }) => {
    const params: Record<string, string | boolean> = {};
    if (team_id) params.team_id = team_id;
    if (include_resolved) params.include_resolved = true;
    return http().get<{ count: number }>(
      `/api/${org_identifier}/oncall/responses/count`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  getResponse: ({
    org_identifier,
    response_id,
  }: {
    org_identifier: string;
    response_id: string;
  }) =>
    http().get<{ response: OnCallResponse; events: OnCallResponseEvent[] }>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}`,
    ),

  listOwnershipRules: ({
    org_identifier,
    team_id,
  }: {
    org_identifier: string;
    team_id?: string;
  }) =>
    http().get<OwnershipRule[]>(
      `/api/${org_identifier}/oncall/ownership`,
      team_id ? { params: { team_id } } : undefined,
    ),

  /// The same rules, plus what each one actually caught: pages in the window,
  /// when it last matched, and whether a more specific rule now takes its
  /// traffic. The shadowing analysis compares every rule against every other,
  /// so it belongs on the server — a client seeing one team's rules cannot
  /// know that another team's rule outranks it.
  ownershipStats: ({
    org_identifier,
    team_id,
    days,
  }: {
    org_identifier: string;
    team_id?: string;
    days?: number;
  }) => {
    const params: Record<string, string | number> = {};
    if (team_id) params.team_id = team_id;
    if (days !== undefined) params.days = days;
    return http().get<OwnershipStats>(
      `/api/${org_identifier}/oncall/ownership/stats`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  createOwnershipRule: ({
    org_identifier,
    data,
  }: {
    org_identifier: string;
    data: { team_id: string; dimensions: Record<string, string> };
  }) => http().post<OwnershipRule>(`/api/${org_identifier}/oncall/ownership`, data),

  deleteOwnershipRule: ({
    org_identifier,
    rule_id,
  }: {
    org_identifier: string;
    rule_id: string;
  }) =>
    http().delete(
      `/api/${org_identifier}/oncall/ownership/${encodeURIComponent(rule_id)}`,
    ),

  /// Answers "where would this route?" without waiting for an alert to fire.
  /// Where the team is talked to, and WHERE THE ANSWER CAME FROM — read
  /// whole rather than "unset", because answering with an empty list while
  /// pages go to the policy's room would be a lie of omission.
  getTeamChannel: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<TeamChannel>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/channel`,
    ),

  /// `destinations: null` clears the override (the policy's list applies
  /// again); `[]` silences the team's room on purpose. Distinct facts.
  setTeamChannel: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    data: { destinations: string[] | null };
  }) =>
    http().put<TeamChannel>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/channel`,
      data,
    ),

  /// Org-scoped, deliberately not per team. All three params optional; both
  /// bounds filter to absences overlapping [from, to).
  listUnavailability: ({
    org_identifier,
    user_email,
    from,
    to,
  }: {
    org_identifier: string;
    user_email?: string;
    from?: number;
    to?: number;
  }) => {
    const params: Record<string, string | number> = {};
    if (user_email) params.user_email = user_email;
    if (from !== undefined) params.from = from;
    if (to !== undefined) params.to = to;
    return http().get<Unavailability[]>(
      `/api/${org_identifier}/oncall/unavailability`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  /// `user_email` omitted means the caller's own absence — the common case,
  /// and the one that must not need an administrator.
  createUnavailability: ({
    org_identifier,
    data,
  }: {
    org_identifier: string;
    data: { user_email?: string; start_at: number; end_at: number; reason?: string };
  }) =>
    http().post<Unavailability>(`/api/${org_identifier}/oncall/unavailability`, data),

  deleteUnavailability: ({
    org_identifier,
    unavailability_id,
  }: {
    org_identifier: string;
    unavailability_id: string;
  }) =>
    http().delete(
      `/api/${org_identifier}/oncall/unavailability/${encodeURIComponent(unavailability_id)}`,
    ),

  /// The org's catch-all. Always 200 — an org that never set one answers
  /// with nulls, not a 404.
  getRoutingConfig: ({ org_identifier }: { org_identifier: string }) =>
    http().get<RoutingConfig>(`/api/${org_identifier}/oncall/routing/config`),

  /// Nominate (`{default_team_id}`) or clear (`{default_team_id: null}`).
  /// 404s when the team is not in THIS org — the id lives in a shared table,
  /// and storing another tenant's would start paging strangers.
  setRoutingConfig: ({
    org_identifier,
    data,
  }: {
    org_identifier: string;
    data: { default_team_id: string | null };
  }) => http().put<RoutingConfig>(`/api/${org_identifier}/oncall/routing/config`, data),

  previewRouting: ({
    org_identifier,
    data,
  }: {
    org_identifier: string;
    data: { oncall_team?: string; dimensions: Record<string, string> };
  }) =>
    http().post<RoutingPreview>(`/api/${org_identifier}/oncall/routing/preview`, data),

  /// Claims the page and stops the ladder.
  acknowledgeResponse: ({
    org_identifier,
    response_id,
  }: {
    org_identifier: string;
    response_id: string;
  }) =>
    http().post<OnCallResponse>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/acknowledge`,
    ),

  /// Quiets the page for a while WITHOUT claiming it — the record stays open
  /// and unassigned, and the ladder resumes when the snooze lapses.
  snoozeResponse: ({
    org_identifier,
    response_id,
    minutes,
  }: {
    org_identifier: string;
    response_id: string;
    minutes: number;
  }) =>
    http().post<OnCallResponse>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/snooze`,
      { minutes },
    ),

  addNote: ({
    org_identifier,
    response_id,
    body,
  }: {
    org_identifier: string;
    response_id: string;
    body: string;
  }) =>
    http().post(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/notes`,
      { body },
    ),

  /// Exactly one of `to` (a person on this team) or `to_team_id` (ownership
  /// moves to another team, which is paged under their own rotation).
  handoffResponse: ({
    org_identifier,
    response_id,
    to,
    to_team_id,
    note,
  }: {
    org_identifier: string;
    response_id: string;
    to?: string;
    to_team_id?: string;
    note?: string;
  }) =>
    http().post<OnCallResponse>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/handoff`,
      { to, to_team_id, note },
    ),

  /// The cause is what turns the next firing of the same rule into useful
  /// history rather than a list of dates.
  resolveResponse: ({
    org_identifier,
    response_id,
    cause,
    cause_note,
  }: {
    org_identifier: string;
    response_id: string;
    cause?: ResolutionCause;
    cause_note?: string;
  }) =>
    http().post<OnCallResponse>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/resolve`,
      { cause, cause_note },
    ),

  /// The on-call records that paged for an incident. Lets an incident show
  /// who it woke without duplicating any paging machinery.
  listResponsesForIncident: ({
    org_identifier,
    incident_id,
  }: {
    org_identifier: string;
    incident_id: string;
  }) =>
    http().get<OnCallResponse[]>(
      `/api/${org_identifier}/oncall/incidents/${encodeURIComponent(incident_id)}/responses`,
    ),

  /// Where the escalation ladder has got to for this record.
  escalationProgress: ({
    org_identifier,
    response_id,
  }: {
    org_identifier: string;
    response_id: string;
  }) =>
    http().get<EscalationProgress>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/escalation`,
    ),

  /// What previous firings of this subject turned out to be, grouped by cause.
  priorCauses: ({
    org_identifier,
    response_id,
  }: {
    org_identifier: string;
    response_id: string;
  }) =>
    http().get<CauseGroup[]>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/prior-causes`,
    ),

  /// The individual past firings of the same subject, newest first, with the
  /// current one excluded by the server. Prior causes says what this usually
  /// turns out to be; this says how often it fires and whether anyone answered.
  responseHistory: ({
    org_identifier,
    response_id,
    limit,
  }: {
    org_identifier: string;
    response_id: string;
    /** Server clamps to 1..100 and defaults to 10. */
    limit?: number;
  }) =>
    http().get<OnCallResponse[]>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/history`,
      limit === undefined ? undefined : { params: { limit } },
    ),

  /// Every message this page produced and whether it landed. The timeline's
  /// `page` line answers the responder-facing version; this is the ledger.
  listDeliveries: ({
    org_identifier,
    response_id,
    limit,
    offset,
  }: {
    org_identifier: string;
    response_id: string;
    /** Server default 100, clamped to 1..=200. */
    limit?: number;
    offset?: number;
  }) => {
    const params: Record<string, number> = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    return http().get<DeliveryLedger>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/deliveries`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  /// An impacted team says its own service is clear. The dependent's verb:
  /// closes this record, and closes the OWNER's when it was the last one the
  /// owner was waiting on. A plain resolve would close this record and skip
  /// that check, leaving the owner open forever — which is why the UI offers
  /// this instead of resolve on an impacted record.
  confirmRecovery: ({
    org_identifier,
    response_id,
    data,
  }: {
    org_identifier: string;
    response_id: string;
    data?: { note?: string };
  }) =>
    http().post<OnCallResponse>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/confirm-recovery`,
      data ?? {},
    ),

  /// Makes an incident out of a page that turned out to be one. Both body
  /// fields are optional: an absent title reuses the record's, and an absent
  /// severity is DERIVED from the record's priority server-side (1→P1, 2→P2,
  /// 3→P3, 4 and 5→P4). Refuses with 409 when the record already has an
  /// incident, naming it — two responders clicking at once must not end up
  /// looking at two incidents for one firing.
  promoteResponse: ({
    org_identifier,
    response_id,
    data,
  }: {
    org_identifier: string;
    response_id: string;
    data?: { title?: string; severity?: PromoteSeverity };
  }) =>
    http().post<PromoteResult>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/promote`,
      data ?? {},
    ),

  /// Advances THIS team's ladder by one rung. Ownership does not move — the
  /// caller is asking for more hands, not handing the page away.
  escalateNow: ({
    org_identifier,
    response_id,
  }: {
    org_identifier: string;
    response_id: string;
  }) =>
    http().post<OnCallResponse>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/escalate`,
    ),

  /// The teams whose schedule would page nobody at `at`. The standing banner
  /// on the teams screen, answerable on demand rather than only in a log line.
  coverageGaps: ({
    org_identifier,
    at,
    limit,
  }: {
    org_identifier: string;
    /** Micros. Omit for now — the server resolves and echoes it back as `at`. */
    at?: number;
    /** Truncates `teams`, never `total`. */
    limit?: number;
  }) => {
    const params: Record<string, number> = {};
    if (at !== undefined) params.at = at;
    if (limit !== undefined) params.limit = limit;
    return http().get<CoverageGaps>(
      `/api/${org_identifier}/oncall/coverage-gaps`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  /// Signals that matched no ownership rule. One row per dimension path, so
  /// working the queue means writing rules, not ticking off firings.
  unroutedSignals: ({
    org_identifier,
    include_dismissed,
    landing,
    limit,
  }: {
    org_identifier: string;
    /** Off = the outstanding worklist: dismissed entries are out, and so are
     *  entries an ownership rule written since would now catch. */
    include_dismissed?: boolean;
    /** Which of the queue's two emergencies. Absent = both. The server widens
     *  an unrecognised value to "both" rather than 400ing — this is a screen
     *  somebody opened to see what is broken. */
    landing?: "default_team" | "nobody";
    limit?: number;
  }) => {
    const params: Record<string, string | number | boolean> = {};
    if (include_dismissed) params.include_dismissed = true;
    if (landing) params.landing = landing;
    if (limit !== undefined) params.limit = limit;
    return http().get<UnroutedSignal[]>(
      `/api/${org_identifier}/oncall/unrouted`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  /// "Handled" — the row stays for the record. A path a new rule now covers
  /// drops out of the outstanding list on its own, so this is for the rest.
  dismissUnroutedSignal: ({
    org_identifier,
    signal_id,
  }: {
    org_identifier: string;
    signal_id: string;
  }) =>
    http().delete<UnroutedSignal>(
      `/api/${org_identifier}/oncall/unrouted/${encodeURIComponent(signal_id)}`,
    ),

  /// Everything the signed-in person's on-call screen needs, in one call.
  /// The route is `/my/teams` — `/oncall/me` never existed on the server and
  /// 404ed for exactly as long as this function pointed at it.
  myOnCall: ({ org_identifier }: { org_identifier: string }) =>
    http().get<MyOnCall>(`/api/${org_identifier}/oncall/my/teams`),

  /// Somebody stands in for the rotation over a window. Outside it the
  /// rotation resolves as normal, which is what makes an override safe.
  createOverride: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    /// `start_at` / `end_at`, NOT `starts_at` / `ends_at` — the server rejects
    /// the plural form with a 422. `end_at` is exclusive, so a cover ending
    /// exactly when the next begins does not overlap it.
    data: {
      user_email: string;
      start_at: number;
      end_at: number;
      /** Whose shift is being covered. Optional — "cover tonight" is a real
       *  request even when nobody has worked out whose shift tonight is. */
      covering_for?: string;
      note?: string;
    };
  }) =>
    http().post<Override>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/overrides`,
      data,
    ),

  listOverrides: ({
    org_identifier,
    team_id,
    from,
    to,
  }: {
    org_identifier: string;
    team_id: string;
    /** Micros. */
    from?: number;
    /** Micros. */
    to?: number;
  }) => {
    const params: Record<string, number> = {};
    if (from !== undefined) params.from = from;
    if (to !== undefined) params.to = to;
    return http().get<Override[]>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/overrides`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  deleteOverride: ({
    org_identifier,
    team_id,
    override_id,
  }: {
    org_identifier: string;
    team_id: string;
    override_id: string;
  }) =>
    http().delete(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/overrides/${encodeURIComponent(override_id)}`,
    ),
  /// Sends a real page to whoever the ladder would reach, and reports who it
  /// got to. `reached_anyone: false` carries `not_sent_because` — the honest
  /// answer to "would a page actually land", which is not otherwise knowable.
  testPage: ({
    org_identifier,
    team_id,
    priority,
  }: {
    org_identifier: string;
    team_id: string;
    priority?: number;
  }) =>
    http().post<{
      reached_anyone: boolean;
      recipients?: string[] | null;
      not_sent_because?: string | null;
    }>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/test-page`,
      priority === undefined ? {} : { priority },
    ),

  /// Cause counts over a window. The ONLY analytics endpoint that exists —
  /// there is no time-to-ack or time-to-resolve aggregate, by design.
  analyticsCauses: ({
    org_identifier,
    team_id,
    from,
    to,
  }: {
    org_identifier: string;
    team_id?: string;
    from?: number;
    to?: number;
  }) => {
    const params: Record<string, string | number> = {};
    if (team_id) params.team_id = team_id;
    if (from !== undefined) params.from = from;
    if (to !== undefined) params.to = to;
    return http().get<CauseAnalytics>(
      `/api/${org_identifier}/oncall/analytics/causes`,
      Object.keys(params).length ? { params } : undefined,
    );
  },

  /// Would a page to each member actually land, and why not. Computed from
  /// evidence, so every negative arrives with its own sentence.
  teamReachability: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<TeamReachability>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/reachability`,
    ),

  /// Configuration problems this team actually has. `message` is a finished
  /// sentence — render it, do not re-word it.
  teamConfigRisks: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<ConfigRisks>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/config-risks`,
    ),

  /// The schedule as the engine resolves it: restrictions applied, covers laid
  /// on top, gaps included as segments with nobody in them. Caps at 31 days and
  /// 2000 segments, and 400s rather than truncating — handle it as a message.
  resolvedSchedule: ({
    org_identifier,
    team_id,
    from,
    to,
  }: {
    org_identifier: string;
    team_id: string;
    /** Micros. Both bounds or neither. */
    from: number;
    to: number;
  }) =>
    http().get<ResolvedSegment[]>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/resolved-schedule`,
      { params: { from, to } },
    ),

  /// Everything the team header needs, in one call: membership, coverage, the
  /// ladder per priority, and the window's page statistics — all computed
  /// server-side rather than derived from a fetched page.
  teamOverview: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<TeamOverview>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/overview`,
    ),

  /// A dry run of one priority's ladder: who it would wake right now, rung by
  /// rung, and whether each page would actually land. Sends nothing.
  escalationPreview: ({
    org_identifier,
    team_id,
    priority,
  }: {
    org_identifier: string;
    team_id: string;
    /** 1–5. Omit for the policy's default. */
    priority?: number;
  }) =>
    http().get<EscalationPreview>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/escalation-preview`,
      priority === undefined ? undefined : { params: { priority } },
    ),

  /// Per-member page load and rotation fairness over a window.
  teamLoad: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<TeamLoad>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/load`,
    ),
};

export default oncall;
