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
  EscalationLevel,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallSchedule,
  OnCallSlot,
  OnCallTeam,
  OnCallTeamMember,
  PriorityRung,
  Rotation,
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

  addMember: ({
    org_identifier,
    team_id,
    data,
  }: {
    org_identifier: string;
    team_id: string;
    data: { user_email: string; level: EscalationLevel };
  }) =>
    http().post<OnCallTeamMember>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/members`,
      data,
    ),

  removeMember: ({
    org_identifier,
    team_id,
    user_email,
    level,
  }: {
    org_identifier: string;
    team_id: string;
    user_email: string;
    level: EscalationLevel;
  }) =>
    http().delete(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/members`,
      { params: { user_email, level } },
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
    data: { rungs: PriorityRung[] };
  }) =>
    http().put<OnCallPolicy>(
      `/api/${org_identifier}/oncall/teams/${encodeURIComponent(team_id)}/policy`,
      data,
    ),

  listResponses: ({
    org_identifier,
    team_id,
  }: {
    org_identifier: string;
    team_id?: string;
  }) =>
    http().get<OnCallResponse[]>(
      `/api/${org_identifier}/oncall/responses`,
      team_id ? { params: { team_id } } : undefined,
    ),

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

  resolveResponse: ({
    org_identifier,
    response_id,
  }: {
    org_identifier: string;
    response_id: string;
  }) =>
    http().post<OnCallResponse>(
      `/api/${org_identifier}/oncall/responses/${encodeURIComponent(response_id)}/resolve`,
    ),
};

export default oncall;
