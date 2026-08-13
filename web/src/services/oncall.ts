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
  TeamLoad,
  TeamOverview,
  TeamReachability,
  RoutingPreview,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallSchedule,
  OnCallSlot,
  OnCallTeam,
  OnCallTeamMember,
  PolicyFinalAction,
  PriorityRung,
  Rotation,
  CauseAnalytics,
  ConfigRisks,
  CauseGroup,
  ResolutionCause,
  CoverageGaps,
  DeliveryLedger,
  EscalationProgress,
  HandoffSuggestion,
  InventoryNode,
  MyOnCall,
  Override,
  RelatedResponses,
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

  /// Records matched on facts already held — the rule, the ownership path, the
  /// dependency edges, the cause a human wrote. Nothing here is inferred.
  relatedResponses: ({
    org_identifier,
    response_id,
  }: {
    org_identifier: string;
    response_id: string;
  }) =>
    http().get<RelatedResponses>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/related`,
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

  /// Who the server would hand this to, and why. Advisory — the drawer still
  /// lets a human pick anybody.
  suggestHandoff: ({
    org_identifier,
    response_id,
  }: {
    org_identifier: string;
    response_id: string;
  }) =>
    http().get<HandoffSuggestion>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/handoff-suggestion`,
    ),

  /// Who is on call across EVERY team in one request. Replaces a per-team
  /// fan-out that made the teams list issue one call per row.
  whoIsOnCallBulk: ({ org_identifier, at }: { org_identifier: string; at?: number }) =>
    http().get<Record<string, OnCallSlot[]>>(
      `/api/${org_identifier}/oncall/on-call`,
      at === undefined ? undefined : { params: { at } },
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
    limit,
  }: {
    org_identifier: string;
    include_dismissed?: boolean;
    limit?: number;
  }) => {
    const params: Record<string, string | number | boolean> = {};
    if (include_dismissed) params.include_dismissed = true;
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

  /// Open records with no team. Distinct from `unroutedSignals`: those never
  /// became a record at all, these are records the UI can still assign.
  unroutedResponses: ({ org_identifier }: { org_identifier: string }) =>
    http().get<OnCallResponse[]>(`/api/${org_identifier}/oncall/responses/unrouted`),

  /// The identity space as discovered, with the owner each path resolves to.
  /// Additive — the ownership screen degrades to a flat rule table without it.
  identityInventory: ({ org_identifier }: { org_identifier: string }) =>
    http().get<InventoryNode[]>(`/api/${org_identifier}/oncall/routing/inventory`),

  /// Everything the signed-in person's on-call screen needs, in one call.
  myOnCall: ({ org_identifier }: { org_identifier: string }) =>
    http().get<MyOnCall>(`/api/${org_identifier}/oncall/me`),

  /// Somebody stands in for the rotation over a window. Outside it the
  /// rotation resolves as normal, which is what makes an override safe.
  createOverride: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    data: { user_email: string; starts_at: number; ends_at: number; note?: string };
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

  /// Everything the team header needs, in one call: membership, coverage, the
  /// ladder per priority, and the window's page statistics — all computed
  /// server-side rather than derived from a fetched page.
  teamOverview: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<TeamOverview>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/overview`,
    ),

  /// Per-member page load and rotation fairness over a window.
  teamLoad: ({ org_identifier, team_id }: { org_identifier: string; team_id: string }) =>
    http().get<TeamLoad>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/load`,
    ),
};

export default oncall;
