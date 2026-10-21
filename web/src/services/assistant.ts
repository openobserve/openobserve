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
  /** `/confirm {id, extend:true}` resets a card's expiry. */
  approval_extend?: boolean;
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

/** `POST /ai/confirm/{sid}`; Edit then approve resolves as a deny, so there is no `edits` (round 2 X-30). */
export interface ConfirmBody {
  approved?: boolean;
  scope?: string;
  items?: string[];
  reply?: string;
  /** Asks for more time on the card `id` instead of deciding. */
  id?: string;
  extend?: boolean;
}

/** o2-ai answers a delete batch item by item; a permission or CLI answer only echoes the decision. */
export interface ConfirmResponse {
  approved?: boolean;
  deleted?: boolean | number;
  count?: number;
  total?: number;
  results?: unknown[];
  kind?: string;
  /** A permission approve: false when the agent was never unblocked. */
  replied?: boolean;
  /** The card's new expiry after `extend`. */
  expires_at?: number;
}

/** The restored object, when the server's action ledger can undo an entry. */
export interface UndoResponse {
  id?: string;
}

/** `POST /ai/feedback`; `trace_id` ties the rating to the turn's workflow trace. */
export interface FeedbackBody {
  feedback_type: string;
  query_index: number;
  trace_id?: string;
  /** The turn the vote is about; o2-ai ignores it until it stores votes with the turn. */
  turn_id?: string;
  comment?: string;
  rating?: string;
  /** 1–5 for `feedback_type: "rating"`. */
  value?: number;
}

export const PROBE_TIMEOUT_MS = 5_000;

/** A deny or an undo with no answer by then reads as unconfirmed; an approve adds time per item it acts on. */
export const CONFIRM_TIMEOUT_MS = 15_000;

// Assistant calls render their own 403 and handle 401 without the interceptor's logout-and-reload.
const ASSISTANT_REQUEST: AxiosRequestConfig = { silentForbidden: true, assistantManaged: true };

// A cancel must outlive the page that sent it (sign-out, tab close), which only fetch's keepalive gives.
const KEEPALIVE_REQUEST: AxiosRequestConfig = {
  ...ASSISTANT_REQUEST,
  adapter: "fetch",
  fetchOptions: { keepalive: true },
};

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

  /** Stop on the server; JSON, because a cross-site form post cannot send that content type (constraint 15). */
  cancelTurn: async (org: string, sid: string, turnId: string): Promise<void> => {
    await http().post(
      `/api/${enc(org)}/ai/chats/${enc(sid)}/cancel`,
      { turn_id: turnId },
      { ...KEEPALIVE_REQUEST, headers: { "x-o2-assistant-session-id": sid } },
    );
  },

  /** The incident analysis has its own cancel route (`incidents.rs:755`; round 1 E-10). */
  cancelIncidentAnalysis: async (org: string, incidentId: string): Promise<void> => {
    await http().delete(
      `/api/v2/${enc(org)}/alerts/incidents/${enc(incidentId)}/rca`,
      KEEPALIVE_REQUEST,
    );
  },

  /** Posted on the originating session only; keepalive, so a decision made as the page goes still lands, and bounded, so a card never hangs on it. */
  confirm: async (
    org: string,
    sid: string,
    body: ConfirmBody,
    timeout: number = CONFIRM_TIMEOUT_MS,
  ): Promise<ConfirmResponse> => {
    const res = await http().post<ConfirmResponse>(
      `/api/${enc(org)}/ai/confirm/${enc(sid)}`,
      body,
      { ...KEEPALIVE_REQUEST, timeout },
    );
    return res.data ?? {};
  },

  /** Undoes one entry of the server's action ledger. */
  undo: async (org: string, ledgerId: string): Promise<UndoResponse> => {
    const res = await http().post<UndoResponse>(
      `/api/${enc(org)}/ai/actions/${enc(ledgerId)}/undo`,
      {},
      { ...ASSISTANT_REQUEST, timeout: CONFIRM_TIMEOUT_MS },
    );
    return res.data ?? {};
  },

  feedback: async (org: string, sid: string, body: FeedbackBody): Promise<void> => {
    await http().post(`/api/${enc(org)}/ai/feedback`, body, {
      ...ASSISTANT_REQUEST,
      headers: { "x-o2-assistant-session-id": sid },
    });
  },
};

export default assistant;
