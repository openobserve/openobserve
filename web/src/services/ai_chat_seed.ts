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

import type { StoredTurn } from "@/composables/assistant/pure";

import http from "./http";

/** Body of `POST /api/{org}/ai/chats/seeded`: a new chat that starts from a door's finished answer. */
export interface SeededChatRequest {
  session_id: string;
  title: string;
  agent_type?: string;
  origin: string;
  turns: StoredTurn[];
}

export interface SeededChatResponse {
  session_id: string;
  title: string;
  agent_type: string;
}

const enc = encodeURIComponent;

/** A 201 makes the chat; a 200 means this caller already holds that session id. */
export function createSeededChat(org: string, body: SeededChatRequest) {
  // The server accepts only a JSON body (415 otherwise), which a cross-site form post cannot send.
  return http().post<SeededChatResponse>(`/api/${enc(org)}/ai/chats/seeded`, body, {
    headers: { "Content-Type": "application/json" },
    silentForbidden: true,
    assistantManaged: true,
  });
}
