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
import { z } from "zod";

import type { CreditMode, StoredTurn, Tri } from "@/composables/assistant";
import { getUUIDv7 } from "@/utils/uuid";

import http from "./http";

/** `GET /api/{org}/ai/capabilities` (B-06); every field is optional so consumers only read it. */
export interface AssistantCapabilitiesResponse {
  health?: {
    status?: "ok" | "down" | "unreachable" | "unknown";
    checked_at?: number | string;
    last_error?: string | { message?: string; at?: string };
  };
  model?: string;
  agent_version?: string;
  model_provider?: string;
  redaction_applied?: boolean;
  can_chat?: boolean;
  can_write?: boolean;
  can_share?: boolean;
  can_read_shares?: boolean;
  persistence?: boolean;
  public_links?: boolean;
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
  /** `chat_stream` takes `replaces_turn_id`. */
  turn_versions?: boolean;
  /** `POST /ai/feedback` stores the vote with its turn. */
  feedback_stored?: boolean;
  rca_chat_mode?: boolean;
  rca_feedback?: boolean;
  gate?: string;
}

/** `GET /api/{org}/ai/usage`, validated; `resetsAt` (ms) only once the server sends `resets_at`. */
export interface AssistantUsage {
  mode: CreditMode;
  credits_used: number;
  credits_limit: number;
  resetsAt?: number;
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

/** One row of `GET /api/{org}/ai/chats`; the marker, pin and agent fields are absent on today's server. */
export interface ChatSummaryWire {
  session_id: string;
  title: string;
  /** Microseconds. */
  created_at: number;
  updated_at: number;
  last_committed_seq: number;
  forked_from_share?: string;
  active_turn?: boolean;
  active_turn_id?: string;
  pending_approval?: boolean;
  pinned?: boolean;
  agent_type?: string | null;
  origin?: string;
}

export interface ChatsPage {
  chats: ChatSummaryWire[];
  next_cursor?: string | null;
  retention_days?: number;
  /** Every chat of this user in the org, when the server counts them. */
  total?: number;
}

/** `GET /api/{org}/ai/chats/{sid}`; `not_modified` keeps the caller's copy. */
export interface ChatDetail extends ChatSummaryWire {
  not_modified?: boolean;
  state_version?: string;
  turns?: StoredTurn[];
  partial_from_seq?: number;
  has_more?: boolean;
  /** Each approval card the chat raised and the server's record of its decision. */
  approvals?: ChatApproval[];
}

export interface ChatApproval {
  id: string;
  /** `withdrawn` and a denied row's `expired` come from the stored `confirmation_resolved`, since the row stores both as `denied`. */
  status: "pending" | "approved" | "denied" | "expired" | "withdrawn";
  /** Epoch ms of the decision, from the stored `confirmation_resolved`. */
  at?: number;
}

export interface ChatImportItem {
  client_id: string;
  title: string;
  created: number;
  origin: string;
  pinned?: boolean;
  turns: StoredTurn[];
}

export interface ChatImportResult {
  imported: { client_id: string; session_id: string }[];
  skipped: string[];
  failed: { client_id: string; code: string }[];
}

export interface ListChatsParams {
  cursor?: string | null;
  limit?: number;
  /** Sent only when the server advertises `history_search`; today's server ignores it. */
  q?: string;
}

export const PROBE_TIMEOUT_MS = 5_000;

/** Past OpenObserve's 60 s `/confirm` relay, so its own answer lands first; an approve adds time per item. */
export const CONFIRM_TIMEOUT_MS = 65_000;

/** An undo with no answer by then reads as unconfirmed. */
export const UNDO_TIMEOUT_MS = 15_000;

// Assistant calls render their own 403 and handle 401 without the interceptor's logout-and-reload.
const ASSISTANT_REQUEST: AxiosRequestConfig = { silentForbidden: true, assistantManaged: true };

// A cancel must outlive the page that sent it (sign-out, tab close), which only fetch's keepalive gives.
const KEEPALIVE_REQUEST: AxiosRequestConfig = {
  ...ASSISTANT_REQUEST,
  adapter: "fetch",
  fetchOptions: { keepalive: true },
};

const enc = encodeURIComponent;

// The server's own page size (`chats.rs` default), so Load older and the client search see the same pages.
const CHATS_PAGE = 50;

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } })?.response?.status;

const CREDIT_MODES: ReadonlySet<string> = new Set([
  "free",
  "consent_required",
  "pay_as_you_go",
  "exhausted",
]);

// A count past the safe-integer range is not a count; it would render as hundreds of digits.
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(Math.floor(value)) && value >= 0
    ? Math.floor(value)
    : null;

/** The server's body is untrusted: an unknown mode or a non-numeric count reads as no usage. */
export function parseAiUsage(body: unknown): AssistantUsage | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const used = count(value.credits_used);
  const limit = count(value.credits_limit);
  const mode = typeof value.mode === "string" && CREDIT_MODES.has(value.mode) ? value.mode : null;
  if (used === null || limit === null || !mode) return null;
  const usage: AssistantUsage = {
    mode: mode as CreditMode,
    credits_used: used,
    credits_limit: limit,
  };
  const resets =
    typeof value.resets_at === "string" && value.resets_at.length <= 64
      ? Date.parse(value.resets_at)
      : NaN;
  if (!Number.isNaN(resets)) usage.resetsAt = resets;
  return usage;
}

// Server output is untrusted: unknown keys are dropped, sizes bounded, and a bad row skipped, never the page.
const MAX_CHATS_PER_PAGE = 200;
const MAX_TURNS = 2_000;
const MAX_FRAMES_PER_TURN = 5_000;
const MAX_APPROVALS = 500;

const chatSummarySchema = z.object({
  session_id: z.string().min(1).max(128),
  title: z
    .string()
    .catch("")
    .transform((title) => title.slice(0, 200)),
  created_at: z.number().catch(0),
  updated_at: z.number().catch(0),
  last_committed_seq: z.number().catch(0),
  forked_from_share: z.string().max(128).optional().catch(undefined),
  active_turn: z.boolean().optional().catch(undefined),
  active_turn_id: z.string().max(128).optional().catch(undefined),
  pending_approval: z.boolean().optional().catch(undefined),
  pinned: z.boolean().optional().catch(undefined),
  agent_type: z.string().max(64).nullable().optional().catch(undefined),
  origin: z.string().max(32).optional().catch(undefined),
});

const chatApprovalSchema = z.object({
  id: z.string().min(1).max(128),
  status: z.enum(["pending", "approved", "denied", "expired"]),
  resolved: z
    .object({
      at: z.number().optional().catch(undefined),
      withdrawn: z.boolean().optional().catch(undefined),
      expired: z.boolean().optional().catch(undefined),
    })
    .nullable()
    .optional()
    .catch(null),
});

const storedTurnSchema = z.object({
  user_message_id: z.string().max(128).optional().catch(undefined),
  turn_id: z.string().max(128).optional().catch(undefined),
  created: z.number().nullable().optional().catch(undefined),
  user: z
    .object({
      text: z.string().catch(""),
      images: z
        .array(z.object({ filename: z.string(), mime: z.string(), url: z.string() }))
        .max(16)
        .optional()
        .catch(undefined),
    })
    .nullable()
    .catch(null),
  frames: z.array(z.unknown()).max(MAX_FRAMES_PER_TURN).catch([]),
  error: z.string().nullable().optional().catch(undefined),
  status: z
    .enum(["running", "completed", "failed", "cancelled", "interrupted"])
    .optional()
    .catch(undefined),
  error_code: z.string().max(64).nullable().optional().catch(undefined),
});

/** One page of the list, keeping only rows that parse. */
export function parseChatsPage(data: unknown): ChatsPage {
  const body = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const rows = Array.isArray(body.chats) ? body.chats.slice(0, MAX_CHATS_PER_PAGE) : [];
  const chats = rows.flatMap((row) => {
    const parsed = chatSummarySchema.safeParse(row);
    return parsed.success ? [parsed.data as ChatSummaryWire] : [];
  });
  const next = typeof body.next_cursor === "string" ? body.next_cursor.slice(0, 512) : null;
  const retention = typeof body.retention_days === "number" ? body.retention_days : undefined;
  const total =
    typeof body.total === "number" && Number.isInteger(body.total) && body.total >= 0
      ? body.total
      : undefined;
  return {
    chats,
    next_cursor: next,
    ...(retention !== undefined && { retention_days: retention }),
    ...(total !== undefined && { total }),
  };
}

/** A chat read; turns beyond the bound are dropped and malformed ones skipped. */
export function parseChatDetail(data: unknown): ChatDetail {
  const summary = chatSummarySchema.parse(data);
  const body = data as Record<string, unknown>;
  const raw = Array.isArray(body.turns) ? body.turns.slice(-MAX_TURNS) : undefined;
  const turns = raw?.flatMap((turn) => {
    const parsed = storedTurnSchema.safeParse(turn);
    return parsed.success ? [parsed.data as StoredTurn] : [];
  });
  const approvals = Array.isArray(body.approvals)
    ? body.approvals.slice(0, MAX_APPROVALS).flatMap(chatApprovalOf)
    : undefined;
  return {
    ...(summary as ChatSummaryWire),
    ...(body.not_modified === true && { not_modified: true }),
    ...(typeof body.state_version === "string" && {
      state_version: body.state_version.slice(0, 128),
    }),
    ...(turns && { turns }),
    ...(typeof body.partial_from_seq === "number" && { partial_from_seq: body.partial_from_seq }),
    ...(typeof body.has_more === "boolean" && { has_more: body.has_more }),
    ...(approvals && { approvals }),
  };
}

function chatApprovalOf(value: unknown): ChatApproval[] {
  const parsed = chatApprovalSchema.safeParse(value);
  if (!parsed.success) return [];
  const { id, resolved } = parsed.data;
  const at = resolved?.at;
  const status =
    parsed.data.status !== "denied"
      ? parsed.data.status
      : resolved?.withdrawn === true
        ? "withdrawn"
        : resolved?.expired === true
          ? "expired"
          : "denied";
  return [{ id, status, ...(typeof at === "number" && at > 0 && { at }) }];
}

const assistant = {
  /** Whether this browser's session cookie is still signed in; a 401 never logs the page out. */
  sessionAlive: async (): Promise<boolean> => {
    try {
      await http().get("/api/organizations", {
        ...ASSISTANT_REQUEST,
        params: { page_num: 1, page_size: 1 },
        timeout: PROBE_TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  },

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

  /** `null` where `/ai/usage` is not served (404) or its body is not a usage. */
  usage: async (org: string): Promise<AssistantUsage | null> => {
    try {
      const res = await http().get<unknown>(`/api/${enc(org)}/ai/usage`, ASSISTANT_REQUEST);
      return parseAiUsage(res.data);
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
      { ...ASSISTANT_REQUEST, timeout: UNDO_TIMEOUT_MS },
    );
    return res.data ?? {};
  },

  listChats: async (org: string, params: ListChatsParams = {}): Promise<ChatsPage> => {
    const query: Record<string, string> = { limit: String(params.limit ?? CHATS_PAGE) };
    if (params.cursor) query.cursor = params.cursor;
    if (params.q) query.q = params.q;
    const res = await http().get<ChatsPage>(`/api/${enc(org)}/ai/chats`, {
      ...ASSISTANT_REQUEST,
      params: query,
    });
    return parseChatsPage(res.data);
  },

  /** With `known`, an unchanged chat answers `not_modified` and a stale one only its newer turns. */
  getChat: async (
    org: string,
    sid: string,
    known?: { seq?: number; version?: string },
  ): Promise<ChatDetail> => {
    const query: Record<string, string> = {};
    if (typeof known?.seq === "number") query.known_seq = String(known.seq);
    if (typeof known?.seq === "number" && known.version) query.known_version = known.version;
    const res = await http().get<unknown>(`/api/${enc(org)}/ai/chats/${enc(sid)}`, {
      ...ASSISTANT_REQUEST,
      params: query,
    });
    return parseChatDetail(res.data);
  },

  renameChat: async (org: string, sid: string, title: string): Promise<void> => {
    await http().patch(`/api/${enc(org)}/ai/chats/${enc(sid)}`, { title }, ASSISTANT_REQUEST);
  },

  /** Only when the server advertises pins; today's server rejects a `PATCH` without `title`. */
  pinChat: async (org: string, sid: string, pinned: boolean): Promise<void> => {
    await http().patch(`/api/${enc(org)}/ai/chats/${enc(sid)}`, { pinned }, ASSISTANT_REQUEST);
  },

  deleteChat: async (org: string, sid: string): Promise<void> => {
    await http().delete(`/api/${enc(org)}/ai/chats/${enc(sid)}`, ASSISTANT_REQUEST);
  },

  /** Also cancels every running turn of the caller (`DELETE /ai/chats`). */
  deleteAllChats: async (org: string): Promise<void> => {
    await http().delete(`/api/${enc(org)}/ai/chats`, ASSISTANT_REQUEST);
  },

  /** Idempotent on `client_id`, so a resumed import re-posts safely. */
  importBrowserChats: async (org: string, chats: ChatImportItem[]): Promise<ChatImportResult> => {
    const res = await http().post<ChatImportResult>(
      `/api/${enc(org)}/ai/chats/import`,
      { chats },
      ASSISTANT_REQUEST,
    );
    const list = (value: unknown) => (Array.isArray(value) ? value.slice(0, chats.length) : []);
    const str = (value: unknown) => typeof value === "string";
    return {
      imported: list(res.data?.imported).filter(
        (row): row is ChatImportResult["imported"][number] =>
          str(row?.client_id) && str(row?.session_id),
      ),
      skipped: list(res.data?.skipped).filter(str),
      failed: list(res.data?.failed).filter(
        (row): row is ChatImportResult["failed"][number] => str(row?.client_id) && str(row?.code),
      ),
    };
  },

  feedback: async (org: string, sid: string, body: FeedbackBody): Promise<void> => {
    await http().post(`/api/${enc(org)}/ai/feedback`, body, {
      ...ASSISTANT_REQUEST,
      headers: { "x-o2-assistant-session-id": sid },
    });
  },
};

export default assistant;
