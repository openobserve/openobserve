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

import { mutationOptions } from "@tanstack/vue-query";

import http from "./http";

/** Body of `POST /api/{org}/ai/chats/{session_id}/branch`; `version` is the 1-based answer shown, the active one when absent. */
export interface BranchChatRequest {
  turn_id: string;
  version?: number;
}

/** Where a branched chat came from; also on `GET /ai/chats/{sid}` and the chat list rows. */
export interface BranchedFrom {
  session_id: string;
  turn_id: string;
  title: string;
}

/** 201 answer: the new chat, titled "Branch of <title>". */
export interface BranchChatResponse {
  session_id: string;
  title: string;
  branched_from: BranchedFrom;
}

export interface BranchChatVars {
  sessionId: string;
  turnId: string;
  version?: number;
}

const enc = encodeURIComponent;

const aiChatBranch = {
  // The server only accepts a JSON body here (415 otherwise), which a cross-site form post cannot send.
  branch: (org: string, sessionId: string, body: BranchChatRequest) =>
    http().post<BranchChatResponse>(`/api/${enc(org)}/ai/chats/${enc(sessionId)}/branch`, body, {
      headers: { "Content-Type": "application/json" },
    }),
};

/** A new chat seeded with the source's turns up to and including `turnId`. */
export const branchChatMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: BranchChatVars) =>
      (
        await aiChatBranch.branch(org, vars.sessionId, {
          turn_id: vars.turnId,
          ...(vars.version !== undefined && { version: vars.version }),
        })
      ).data,
    meta: { silentError: true },
  });

export default aiChatBranch;
