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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import oncallService, { RESPONSE_PAGE_LIMIT } from "./oncall";
import { incidentKeys } from "./incidents.querykeys";
import { oncallKeys } from "./oncall.querykeys";
import {
  LIVE_STALE_TIME,
  MEDIUM_STALE_TIME,
  NORMAL_STALE_TIME,
} from "@/composables/query/cachePolicy";
import type {
  CauseGroup,
  CoverageGaps,
  EscalationProgress,
  MyDeliveries,
  MyOnCall,
  OnCallPolicy,
  OnCallPosition,
  OnCallResponse,
  OnCallSchedule,
  OnCallTeam,
  OnCallTeamMember,
  Override,
  OwnershipRule,
  OwnershipStats,
  PresetDescriptor,
  ResolvedSegment,
  Rotation,
  RoutingConfig,
  TeamLoad,
  TeamOverview,
  Unavailability,
} from "@/ts/interfaces/oncall";

/// Derived from the service so a new filter cannot silently fall out of the key.
type ResponseFilters = Omit<Parameters<typeof oncallService.listResponses>[0], "org_identifier">;
type UnroutedFilters = Omit<Parameters<typeof oncallService.unroutedSignals>[0], "org_identifier">;
type MyDeliveriesFilters = Omit<Parameters<typeof oncallService.myDeliveries>[0], "org_identifier">;

/**
 * The org's on-call teams. A catalogue read by nine screens — the teams pages,
 * the response views, and three alert surfaces that only want a team's NAME —
 * so one entry serves all of them instead of a request per screen.
 */
export const oncallTeamsQuery = (org: string) =>
  queryOptions({
    queryKey: oncallKeys.teams(org),
    queryFn: async (): Promise<OnCallTeam[]> =>
      (await oncallService.listTeams({ org_identifier: org })).data ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

/**
 * The org's catch-all team. Three components ask for it independently and two
 * of them render on the Routing screen at once, so a shared entry is what stops
 * the pair disagreeing the moment one writes it.
 */
export const routingConfigQuery = (org: string) =>
  queryOptions({
    queryKey: oncallKeys.routingConfig(org),
    queryFn: async (): Promise<RoutingConfig | null> =>
      (await oncallService.getRoutingConfig({ org_identifier: org })).data ?? null,
    staleTime: NORMAL_STALE_TIME,
  });

export const oncallTeamQuery = (org: string, teamId: string) =>
  queryOptions({
    queryKey: oncallKeys.team(org, teamId),
    queryFn: async (): Promise<OnCallTeam | null> =>
      (await oncallService.getTeam({ org_identifier: org, team_id: teamId })).data ?? null,
    staleTime: NORMAL_STALE_TIME,
  });

export const teamMembersQuery = (org: string, teamId: string) =>
  queryOptions({
    queryKey: oncallKeys.members(org, teamId),
    queryFn: async (): Promise<OnCallTeamMember[]> =>
      (await oncallService.listMembers({ org_identifier: org, team_id: teamId })).data ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

export const teamScheduleQuery = (org: string, teamId: string) =>
  queryOptions({
    queryKey: oncallKeys.schedule(org, teamId),
    queryFn: async (): Promise<OnCallSchedule | null> =>
      (await oncallService.getSchedule({ org_identifier: org, team_id: teamId })).data ?? null,
    staleTime: NORMAL_STALE_TIME,
  });

export const teamPolicyQuery = (org: string, teamId: string) =>
  queryOptions({
    queryKey: oncallKeys.policy(org, teamId),
    queryFn: async (): Promise<OnCallPolicy | null> =>
      (await oncallService.getPolicy({ org_identifier: org, team_id: teamId })).data ?? null,
    staleTime: NORMAL_STALE_TIME,
  });

/** The server-shipped catalogue of schedule shapes — the same four for every org. */
export const schedulePresetsQuery = (org: string) =>
  queryOptions({
    queryKey: oncallKeys.presets(org),
    queryFn: async (): Promise<PresetDescriptor[]> =>
      (await oncallService.listSchedulePresets({ org_identifier: org })).data ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

/**
 * Who the team would page. Handovers move it with no write behind them, which
 * is why it takes the live tier rather than the config one its inputs sit on.
 */
export const whoIsOnCallQuery = (org: string, teamId: string, at?: number) =>
  queryOptions({
    queryKey: oncallKeys.whoIsOnCall(org, teamId, at),
    queryFn: async (): Promise<OnCallPosition[]> =>
      (await oncallService.whoIsOnCall({ org_identifier: org, team_id: teamId, at })).data ?? [],
    staleTime: LIVE_STALE_TIME,
  });

/** Mixes the ladder (config) with `covered_now`, so it follows the live half. */
export const teamOverviewQuery = (org: string, teamId: string) =>
  queryOptions({
    queryKey: oncallKeys.teamOverview(org, teamId),
    queryFn: async (): Promise<TeamOverview | null> =>
      (await oncallService.teamOverview({ org_identifier: org, team_id: teamId })).data ?? null,
    staleTime: LIVE_STALE_TIME,
  });

/** A dry run of the ladder as it stands right now, so it cannot outlive a handover. */
export const escalationPreviewQuery = (org: string, teamId: string, priority?: number) =>
  queryOptions({
    queryKey: oncallKeys.escalationPreview(org, teamId, priority),
    queryFn: async () =>
      (await oncallService.escalationPreview({ org_identifier: org, team_id: teamId, priority }))
        .data ?? null,
    staleTime: LIVE_STALE_TIME,
  });

export const teamReachabilityQuery = (org: string, teamId: string) =>
  queryOptions({
    queryKey: oncallKeys.teamReachability(org, teamId),
    queryFn: async () =>
      (await oncallService.teamReachability({ org_identifier: org, team_id: teamId })).data ?? null,
    staleTime: MEDIUM_STALE_TIME,
  });

export const teamConfigRisksQuery = (org: string, teamId: string) =>
  queryOptions({
    queryKey: oncallKeys.teamRisks(org, teamId),
    queryFn: async () =>
      (await oncallService.teamConfigRisks({ org_identifier: org, team_id: teamId })).data ?? null,
    staleTime: MEDIUM_STALE_TIME,
  });

export const teamLoadQuery = (org: string, teamId: string) =>
  queryOptions({
    queryKey: oncallKeys.teamLoad(org, teamId),
    queryFn: async (): Promise<TeamLoad | null> =>
      (await oncallService.teamLoad({ org_identifier: org, team_id: teamId })).data ?? null,
    staleTime: MEDIUM_STALE_TIME,
  });

/**
 * The calendar's resolved lanes. The key buckets the window because the callers
 * anchor it on `Date.now()`; the request still carries their exact bounds.
 */
export const resolvedScheduleQuery = (
  org: string,
  teamId: string,
  from: number,
  to: number,
  rotationId?: string,
) =>
  queryOptions({
    queryKey: oncallKeys.resolvedSchedule(org, teamId, from, to, rotationId),
    queryFn: async (): Promise<ResolvedSegment[]> =>
      (
        await oncallService.resolvedSchedule({
          org_identifier: org,
          team_id: teamId,
          from,
          to,
          rotation_id: rotationId,
        })
      ).data ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });

export const teamOverridesQuery = (org: string, teamId: string, from?: number, to?: number) =>
  queryOptions({
    queryKey: oncallKeys.overrides(org, teamId, from, to),
    queryFn: async (): Promise<Override[]> =>
      (await oncallService.listOverrides({ org_identifier: org, team_id: teamId, from, to }))
        .data ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });

/** Which signals a team catches. Config, so it only moves when somebody writes a rule. */
export const ownershipRulesQuery = (org: string, teamId?: string) =>
  queryOptions({
    queryKey: oncallKeys.ownershipRules(org, teamId),
    queryFn: async (): Promise<OwnershipRule[]> =>
      (await oncallService.listOwnershipRules({ org_identifier: org, team_id: teamId })).data ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

/** Pages raised. Live: a new one can land with nothing on this client behind it. */
export const responsesQuery = (org: string, filters: ResponseFilters = {}) =>
  queryOptions({
    queryKey: oncallKeys.responses(org, filters),
    queryFn: async (): Promise<OnCallResponse[]> =>
      (await oncallService.listResponses({ org_identifier: org, ...filters })).data ?? [],
    staleTime: LIVE_STALE_TIME,
  });

/**
 * The whole list, walked page by page inside ONE entry.
 *
 * The cap verdict rides in the returned value rather than being written to a
 * ref mid-walk: on a cache hit the loop does not run, and a `truncated` banner
 * set as a side effect would then describe the walk before last.
 *
 * The key carries the filters and never the offset — the pages are one answer,
 * not several.
 */
export const pagedResponsesQuery = (
  org: string,
  filters: Omit<ResponseFilters, "limit" | "offset"> = {},
  maxPages = 3,
) =>
  queryOptions({
    queryKey: oncallKeys.responses(org, filters),
    queryFn: async (): Promise<{ rows: OnCallResponse[]; truncated: boolean }> => {
      const rows: OnCallResponse[] = [];
      for (let page = 0; page < maxPages; page++) {
        const batch =
          (
            await oncallService.listResponses({
              org_identifier: org,
              ...filters,
              limit: RESPONSE_PAGE_LIMIT,
              offset: page * RESPONSE_PAGE_LIMIT,
            })
          ).data ?? [];
        rows.push(...batch);
        // A short page is the end of the list, whatever the cap allows.
        if (batch.length < RESPONSE_PAGE_LIMIT) return { rows, truncated: false };
      }
      return { rows, truncated: true };
    },
    staleTime: LIVE_STALE_TIME,
  });

/** One page with its timeline. Live: it moves under the reader as the ladder runs. */
export const responseQuery = (org: string, responseId: string) =>
  queryOptions({
    queryKey: oncallKeys.response(org, responseId),
    queryFn: async () =>
      (await oncallService.getResponse({ org_identifier: org, response_id: responseId })).data ??
      null,
    staleTime: LIVE_STALE_TIME,
  });

/** Carries a countdown the client watches expire — see the force at the caller. */
export const responseProgressQuery = (org: string, responseId: string) =>
  queryOptions({
    queryKey: oncallKeys.responseProgress(org, responseId),
    queryFn: async (): Promise<EscalationProgress | null> =>
      (await oncallService.escalationProgress({ org_identifier: org, response_id: responseId }))
        .data ?? null,
    staleTime: LIVE_STALE_TIME,
  });

/** How this signal ended the last times it fired — history, so it cannot change under us. */
export const responsePriorCausesQuery = (org: string, responseId: string) =>
  queryOptions({
    queryKey: oncallKeys.responsePriorCauses(org, responseId),
    queryFn: async (): Promise<CauseGroup[]> =>
      (await oncallService.priorCauses({ org_identifier: org, response_id: responseId })).data ??
      [],
    staleTime: NORMAL_STALE_TIME,
  });

export const responseHistoryQuery = (org: string, responseId: string, limit?: number) =>
  queryOptions({
    queryKey: oncallKeys.responseHistory(org, responseId, limit),
    queryFn: async (): Promise<OnCallResponse[]> =>
      (await oncallService.responseHistory({ org_identifier: org, response_id: responseId, limit }))
        .data ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

/** Receipts land after the page does, so this can be stale the moment it is read. */
export const responseDeliveriesQuery = (
  org: string,
  responseId: string,
  limit?: number,
  offset?: number,
) =>
  queryOptions({
    queryKey: oncallKeys.responseDeliveries(org, responseId, limit, offset),
    queryFn: async () =>
      (
        await oncallService.listDeliveries({
          org_identifier: org,
          response_id: responseId,
          limit,
          offset,
        })
      ).data ?? null,
    staleTime: LIVE_STALE_TIME,
  });

/** The incident drawer's question: what did this incident page, and to whom. */
export const responsesForIncidentQuery = (org: string, incidentId: string) =>
  queryOptions({
    queryKey: oncallKeys.responsesForIncident(org, incidentId),
    queryFn: async (): Promise<OnCallResponse[]> =>
      (
        await oncallService.listResponsesForIncident({
          org_identifier: org,
          incident_id: incidentId,
        })
      ).data ?? [],
    staleTime: LIVE_STALE_TIME,
  });

/** Whether anybody holds the pager right now — no write moves it, the clock does. */
export const coverageGapsQuery = (org: string, at?: number, limit?: number) =>
  queryOptions({
    queryKey: oncallKeys.coverageGaps(org),
    queryFn: async (): Promise<CoverageGaps | null> =>
      (await oncallService.coverageGaps({ org_identifier: org, at, limit })).data ?? null,
    staleTime: LIVE_STALE_TIME,
  });

/** Counts accrue from traffic, not from writes, so it sits between the two tiers. */
export const ownershipStatsQuery = (org: string, teamId?: string, days?: number) =>
  queryOptions({
    queryKey: oncallKeys.ownershipStats(org, teamId, days),
    queryFn: async (): Promise<OwnershipStats | null> =>
      (await oncallService.ownershipStats({ org_identifier: org, team_id: teamId, days })).data ??
      null,
    staleTime: MEDIUM_STALE_TIME,
  });

export const unroutedSignalsQuery = (org: string, filters: UnroutedFilters = {}) =>
  queryOptions({
    queryKey: oncallKeys.unrouted(org, filters),
    queryFn: async () =>
      (await oncallService.unroutedSignals({ org_identifier: org, ...filters })).data ?? null,
    staleTime: LIVE_STALE_TIME,
  });

/** The signed-in reader's own shifts. */
export const myOnCallQuery = (org: string) =>
  queryOptions({
    queryKey: oncallKeys.myOnCall(org),
    queryFn: async (): Promise<MyOnCall | null> =>
      (await oncallService.myOnCall({ org_identifier: org })).data ?? null,
    staleTime: LIVE_STALE_TIME,
  });

/** Drives the unread badge, so it must not outlive a page arriving. */
export const myDeliveriesQuery = (org: string, filters: MyDeliveriesFilters = {}) =>
  queryOptions({
    queryKey: oncallKeys.myDeliveries(org, filters),
    queryFn: async (): Promise<MyDeliveries | null> =>
      (await oncallService.myDeliveries({ org_identifier: org, ...filters })).data ?? null,
    staleTime: LIVE_STALE_TIME,
  });

export const unavailabilityQuery = (org: string, userEmail?: string, from?: number, to?: number) =>
  queryOptions({
    queryKey: oncallKeys.unavailability(org, userEmail, from, to),
    queryFn: async (): Promise<Unavailability[]> =>
      (
        await oncallService.listUnavailability({
          org_identifier: org,
          user_email: userEmail,
          from,
          to,
        })
      ).data ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Everything one team owns — roster, schedule, policy, and every view derived
 * from them — sits under `oncallKeys.team(org, id)`, so a team-shaped write
 * drops that one prefix instead of naming each read it moved. The org-wide
 * coverage answer and the caller's own page sit outside it and are named.
 */
const teamWriteScopes = (org: string, teamId: string) => [
  oncallKeys.team(org, teamId),
  oncallKeys.coverageGaps(org),
  oncallKeys.myAll(org),
];

export const createTeamMutation = (org: string) =>
  mutationOptions({
    mutationFn: (data: { name: string; timezone: string; description?: string | null }) =>
      oncallService.createTeam({ org_identifier: org, data }),
    // A new team starts unstaffed, so it is part of the coverage answer at once.
    meta: {
      invalidates: [oncallKeys.teamsAll(org), oncallKeys.coverageGaps(org), oncallKeys.myAll(org)],
      silentError: true,
    },
  });

/** The timezone moves every resolved shift, not just the header, so the whole team drops. */
export const updateTeamMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (data: { name?: string; timezone?: string; description?: string | null }) =>
      oncallService.updateTeam({ org_identifier: org, team_id: teamId, data }),
    meta: { invalidates: [oncallKeys.teamsAll(org)], silentError: true },
  });

/** The team leaves every scope it appeared in, including another team's routing fallback. */
export const deleteTeamMutation = (org: string) =>
  mutationOptions({
    mutationFn: (teamId: string) =>
      oncallService.deleteTeam({ org_identifier: org, team_id: teamId }),
    meta: { invalidates: [oncallKeys.all(org)], silentError: true },
  });

export const addTeamMembersMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (userEmails: string[]) =>
      oncallService.addMembers({
        org_identifier: org,
        team_id: teamId,
        data: { user_emails: userEmails },
      }),
    meta: { invalidates: teamWriteScopes(org, teamId), silentError: true },
  });

/** Removing the last reachable member can silence a rung, so the ladder drops with the roster. */
export const removeTeamMemberMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (userEmail: string) =>
      oncallService.removeMember({ org_identifier: org, team_id: teamId, user_email: userEmail }),
    meta: { invalidates: teamWriteScopes(org, teamId), silentError: true },
  });

export const setTeamScheduleMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (data: { timezone: string; rotations: Rotation[] }) =>
      oncallService.setSchedule({ org_identifier: org, team_id: teamId, data }),
    meta: { invalidates: teamWriteScopes(org, teamId), silentError: true },
  });

/** A full replace of the team's rotations — the same blast radius as `setSchedule`. */
export const applySchedulePresetMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (data: Record<string, unknown> & { preset: string }) =>
      oncallService.applySchedulePreset({ org_identifier: org, team_id: teamId, data }),
    meta: { invalidates: teamWriteScopes(org, teamId), silentError: true },
  });

export const setTeamPolicyMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (data: Parameters<typeof oncallService.setPolicy>[0]["data"]) =>
      oncallService.setPolicy({ org_identifier: org, team_id: teamId, data }),
    // Rungs feed the overview, the dry run and the risk list; coverage is unmoved.
    meta: { invalidates: [oncallKeys.team(org, teamId)], silentError: true },
  });

export const setTeamChannelMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (destinations: string[] | null) =>
      oncallService.setTeamChannel({
        org_identifier: org,
        team_id: teamId,
        data: { destinations },
      }),
    meta: { invalidates: [oncallKeys.team(org, teamId)], silentError: true },
  });

export const createOverrideMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (data: Parameters<typeof oncallService.createOverride>[0]["data"]) =>
      oncallService.createOverride({ org_identifier: org, team_id: teamId, data }),
    meta: { invalidates: teamWriteScopes(org, teamId), silentError: true },
  });

export const deleteOverrideMutation = (org: string, teamId: string) =>
  mutationOptions({
    mutationFn: (overrideId: string) =>
      oncallService.deleteOverride({
        org_identifier: org,
        team_id: teamId,
        override_id: overrideId,
      }),
    meta: { invalidates: teamWriteScopes(org, teamId), silentError: true },
  });

/** Org-scoped: an absence belongs to the person, so it moves every team they staff. */
export const createUnavailabilityMutation = (org: string) =>
  mutationOptions({
    mutationFn: (data: {
      user_email?: string;
      start_at: number;
      end_at: number;
      reason?: string;
    }) => oncallService.createUnavailability({ org_identifier: org, data }),
    meta: {
      invalidates: [
        oncallKeys.unavailabilityAll(org),
        oncallKeys.teamsAll(org),
        oncallKeys.coverageGaps(org),
        oncallKeys.myAll(org),
      ],
      silentError: true,
    },
  });

export const deleteUnavailabilityMutation = (org: string) =>
  mutationOptions({
    mutationFn: (unavailabilityId: string) =>
      oncallService.deleteUnavailability({
        org_identifier: org,
        unavailability_id: unavailabilityId,
      }),
    meta: {
      invalidates: [
        oncallKeys.unavailabilityAll(org),
        oncallKeys.teamsAll(org),
        oncallKeys.coverageGaps(org),
        oncallKeys.myAll(org),
      ],
      silentError: true,
    },
  });

/**
 * A page moves for the reader's own list as well as the team's, so every row
 * action drops both scopes. The id rides in the variables because one list
 * writes to many rows, and `meta` is static — which is also why the note lands
 * on the whole scope rather than the one response: everything under it is on
 * the live tier, so the extra read is the one already on screen.
 */
const responseWriteScopes = (org: string) => [oncallKeys.responsesAll(org), oncallKeys.myAll(org)];

/** Handing over or closing changes a team's own counters, so those drop too. */
const responseAndTeamScopes = (org: string) => [
  oncallKeys.responsesAll(org),
  oncallKeys.myAll(org),
  oncallKeys.teamsAll(org),
];

export const acknowledgeResponseMutation = (org: string) =>
  mutationOptions({
    mutationFn: (responseId: string) =>
      oncallService.acknowledgeResponse({ org_identifier: org, response_id: responseId }),
    meta: { invalidates: responseWriteScopes(org), silentError: true },
  });

/** The ladder resumes on its own when the snooze lapses — see the live tier on the reads. */
export const snoozeResponseMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ responseId, minutes }: { responseId: string; minutes: number }) =>
      oncallService.snoozeResponse({
        org_identifier: org,
        response_id: responseId,
        minutes,
      }),
    meta: { invalidates: responseWriteScopes(org), silentError: true },
  });

export const resolveResponseMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({
      responseId,
      cause,
      causeNote,
    }: {
      responseId: string;
      cause?: Parameters<typeof oncallService.resolveResponse>[0]["cause"];
      causeNote?: string;
    }) =>
      oncallService.resolveResponse({
        org_identifier: org,
        response_id: responseId,
        cause,
        cause_note: causeNote,
      }),
    meta: { invalidates: responseAndTeamScopes(org), silentError: true },
  });

export const handoffResponseMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({
      responseId,
      to,
      toTeamId,
      note,
    }: {
      responseId: string;
      to?: string;
      toTeamId?: string;
      note?: string;
    }) =>
      oncallService.handoffResponse({
        org_identifier: org,
        response_id: responseId,
        to,
        to_team_id: toTeamId,
        note,
      }),
    meta: { invalidates: responseAndTeamScopes(org), silentError: true },
  });

export const escalateNowMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ responseId, note }: { responseId: string; note?: string }) =>
      oncallService.escalateNow({ org_identifier: org, response_id: responseId, note }),
    meta: { invalidates: responseWriteScopes(org), silentError: true },
  });

export const addResponseNoteMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ responseId, body }: { responseId: string; body: string }) =>
      oncallService.addNote({ org_identifier: org, response_id: responseId, body }),
    meta: { invalidates: [oncallKeys.responsesAll(org)], silentError: true },
  });

/** It closes the OWNER's record as well — a different id, so the scope is the only honest drop. */
export const confirmRecoveryMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ responseId, note }: { responseId: string; note?: string }) =>
      oncallService.confirmRecovery({
        org_identifier: org,
        response_id: responseId,
        data: note ? { note } : undefined,
      }),
    meta: { invalidates: responseWriteScopes(org), silentError: true },
  });

/** Creates an incident, so the incident list is part of what this write moved. */
export const promoteResponseMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({
      responseId,
      data,
    }: {
      responseId: string;
      data?: Parameters<typeof oncallService.promoteResponse>[0]["data"];
    }) => oncallService.promoteResponse({ org_identifier: org, response_id: responseId, data }),
    meta: {
      invalidates: [...responseWriteScopes(org), incidentKeys.all(org)],
      silentError: true,
    },
  });

/**
 * Creating a team is three calls, and the id only exists after the first, so
 * these two carry it in the variables instead of binding it at setup. The new
 * team has nothing cached under its own prefix yet, which is why dropping the
 * teams scope is enough.
 */
const newTeamScopes = (org: string) => [
  oncallKeys.teamsAll(org),
  oncallKeys.coverageGaps(org),
  oncallKeys.myAll(org),
];

export const staffNewTeamMembersMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ teamId, userEmails }: { teamId: string; userEmails: string[] }) =>
      oncallService.addMembers({
        org_identifier: org,
        team_id: teamId,
        data: { user_emails: userEmails },
      }),
    meta: { invalidates: newTeamScopes(org), silentError: true },
  });

export const staffNewTeamScheduleMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({
      teamId,
      data,
    }: {
      teamId: string;
      data: { timezone: string; rotations: Rotation[] };
    }) => oncallService.setSchedule({ org_identifier: org, team_id: teamId, data }),
    meta: { invalidates: newTeamScopes(org), silentError: true },
  });

/**
 * A real page to a real phone. Nothing on screen changes at success — the
 * delivery rows land afterwards — so the caller re-reads them on the next open.
 */
export const testPageMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({ teamId, priority }: { teamId: string; priority?: number }) =>
      oncallService.testPage({ org_identifier: org, team_id: teamId, priority }),
    meta: { invalidates: [oncallKeys.myAll(org)], silentError: true },
  });

/**
 * A rule decides where a signal lands, so writing one moves the unrouted queue
 * as well as the rules themselves — today's delete paths never re-read that
 * queue, and dropping the scope is what fixes it.
 */
const ownershipWriteScopes = (org: string) => [
  oncallKeys.ownershipRulesAll(org),
  oncallKeys.unroutedAll(org),
];

export const createOwnershipRuleMutation = (org: string) =>
  mutationOptions({
    mutationFn: (data: { team_id: string; dimensions: Record<string, string> }) =>
      oncallService.createOwnershipRule({ org_identifier: org, data }),
    meta: { invalidates: ownershipWriteScopes(org), silentError: true },
  });

export const updateOwnershipRuleMutation = (org: string) =>
  mutationOptions({
    mutationFn: ({
      ruleId,
      data,
    }: {
      ruleId: string;
      data: { team_id: string; dimensions: Record<string, string> };
    }) => oncallService.updateOwnershipRule({ org_identifier: org, rule_id: ruleId, data }),
    meta: { invalidates: ownershipWriteScopes(org), silentError: true },
  });

export const deleteOwnershipRuleMutation = (org: string) =>
  mutationOptions({
    mutationFn: (ruleId: string) =>
      oncallService.deleteOwnershipRule({ org_identifier: org, rule_id: ruleId }),
    meta: { invalidates: ownershipWriteScopes(org), silentError: true },
  });

export const dismissUnroutedSignalMutation = (org: string) =>
  mutationOptions({
    mutationFn: (signalId: string) =>
      oncallService.dismissUnroutedSignal({ org_identifier: org, signal_id: signalId }),
    meta: { invalidates: [oncallKeys.unroutedAll(org)], silentError: true },
  });

/** The unread count rides on the write's own response — the caller keeps reading it from there. */
export const markDeliveriesReadMutation = (org: string) =>
  mutationOptions({
    mutationFn: (data: { event_ids?: string[]; all?: boolean; read?: boolean }) =>
      oncallService.markDeliveriesRead({ org_identifier: org, data }),
    meta: { invalidates: [oncallKeys.myAll(org)], silentError: true },
  });

/** Nominating a catch-all re-shapes which signals land unrouted, and every team's risk list. */
export const setRoutingConfigMutation = (org: string) =>
  mutationOptions({
    mutationFn: (defaultTeamId: string | null) =>
      oncallService.setRoutingConfig({
        org_identifier: org,
        data: { default_team_id: defaultTeamId },
      }),
    meta: {
      invalidates: [
        oncallKeys.routingConfig(org),
        oncallKeys.teamsAll(org),
        oncallKeys.unroutedAll(org),
      ],
      silentError: true,
    },
  });
