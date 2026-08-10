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
  RoutingPreview,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallSchedule,
  OnCallSlot,
  OnCallTeam,
  OnCallTeamMember,
  PriorityRung,
  Rotation,
  CauseGroup,
  ResolutionCause,
} from "@/ts/interfaces/oncall";

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
    data: { rungs: PriorityRung[]; destinations?: string[] };
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
  }: {
    org_identifier: string;
    team_id?: string;
    include_resolved?: boolean;
  }) => {
    const params: Record<string, string | boolean> = {};
    if (team_id) params.team_id = team_id;
    if (include_resolved) params.include_resolved = true;
    return http().get<OnCallResponse[]>(
      `/api/${org_identifier}/oncall/responses`,
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
};

export default oncall;
