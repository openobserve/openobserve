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

import type { AxiosRequestConfig } from "axios";

import type { Tri } from "@/composables/assistant";
import { getUUIDv7 } from "@/utils/uuid";

import http from "./http";

/** `GET /api/{org}/ai/capabilities` (B-06); every field is optional so consumers only read it. */
export interface AssistantCapabilitiesResponse {
  health?: { status?: "ok" | "down"; checked_at?: number; last_error?: string };
  model?: string;
  agent_version?: string;
  model_provider?: string;
  redaction_applied?: boolean;
  can_chat?: boolean;
  can_write?: boolean;
  can_share?: boolean;
  agents?: unknown[];
  toolsets?: unknown[];
  toolset_secret_merge?: boolean;
  policy_enforced?: boolean;
  retention_days?: number;
  attachments?: boolean;
  context_used?: boolean;
  answer_locale?: boolean;
  history_search?: boolean;
  history_pins?: boolean;
  history_import?: boolean;
  turn_versions?: boolean;
  feedback_stored?: boolean;
  rca_chat_mode?: boolean;
  rca_feedback?: boolean;
  gate?: string;
}

/** `POST /api/{org}/ai/capabilities/test` (B-06): no chat, no credit. */
export interface AssistantCapabilitiesTestResponse {
  ok: boolean;
  duration_ms: number;
  error?: string;
}

export const PROBE_TIMEOUT_MS = 5_000;

// Assistant calls render their own 403 and handle 401 without the interceptor's logout-and-reload.
const ASSISTANT_REQUEST: AxiosRequestConfig = { silentForbidden: true, assistantManaged: true };

const enc = encodeURIComponent;

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } })?.response?.status;

const assistant = {
  /** `null` when the backend predates B-06 (404). */
  capabilities: async (org: string): Promise<AssistantCapabilitiesResponse | null> => {
    try {
      const res = await http().get<AssistantCapabilitiesResponse>(
        `/api/${enc(org)}/ai/capabilities`,
        ASSISTANT_REQUEST,
      );
      return res.data;
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  },

  /** The access probe: OpenFGA maps every `POST /{org}/ai/*` to the chat permission, so only a 403 says no. */
  probeChatAccess: async (org: string): Promise<Tri> => {
    try {
      await http().post(
        `/api/${enc(org)}/ai/chats/${getUUIDv7()}/cancel`,
        {},
        {
          ...ASSISTANT_REQUEST,
          timeout: PROBE_TIMEOUT_MS,
        },
      );
      return "yes";
    } catch (err) {
      const status = statusOf(err);
      if (status === 403) return "no";
      // A 401 proves nothing about the role, and no status means the network or the timeout failed.
      return status === undefined || status === 401 ? "unknown" : "yes";
    }
  },

  testCapabilities: async (org: string): Promise<AssistantCapabilitiesTestResponse> => {
    const res = await http().post<AssistantCapabilitiesTestResponse>(
      `/api/${enc(org)}/ai/capabilities/test`,
      {},
      ASSISTANT_REQUEST,
    );
    return res.data;
  },
};

export default assistant;
