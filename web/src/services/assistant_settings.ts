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

import http from "./http";

export type PermissionTier = "read" | "propose" | "act_with_approval";

export type DataSharingLevel = "schema" | "aggregates" | "raw";

/** `GET /api/{org}/ai/settings`; `null` from a reader means the server predates org settings. */
export interface OrgAiSettings {
  enabled: boolean;
  permission_tier: PermissionTier;
  org_sharing: boolean;
  public_sharing: boolean;
  data_sharing_level: DataSharingLevel;
  updated_by?: string;
  updated_at?: number;
  /** Public links that stop working when public sharing turns off; absent when the server does not count them. */
  public_link_count?: number;
}

export type OrgAiSettingsUpdate = Pick<
  OrgAiSettings,
  "enabled" | "permission_tier" | "org_sharing" | "public_sharing" | "data_sharing_level"
>;

export interface ToolsetTestResult {
  ok: boolean;
  duration_ms?: number;
  /** The server's fixed sentence for why the test failed. */
  error?: string;
}

/** A Test answer, checked and bounded before anything renders or announces it. */
export type CapabilityTestResult = ToolsetTestResult;

/** The capabilities fields Settings renders, checked and bounded; a wrong type reads as not reported. */
export interface CapabilityStatus {
  health: { status: string; lastError?: string; checkedAt?: number } | null;
  model?: string;
  agentVersion?: string;
  provider?: string;
  policyEnforced: boolean;
  redactionApplied: boolean;
}

export interface AssistantGrant {
  id: string;
  tool: string;
  operation: string;
  scope: "always" | "chat";
  chat_id?: string;
  granted_by: string;
  granted_at: number;
}

export type ActivityApprovalKind = "approved" | "standing" | "none";

export type ActivityResultState = "done" | "failed" | "undone";

export interface AssistantActivityEntry {
  id: string;
  at: number;
  action: string;
  /** The member the assistant acted for. */
  on_behalf_of: string;
  target?: { type?: string; id?: string; name?: string; link?: string; deleted?: boolean };
  approval?: { kind: ActivityApprovalKind; by?: string };
  result?: { state: ActivityResultState; message?: string };
  undo: { available: boolean; until?: number; reason?: string };
  /** On an undo's own row, the row it reverted. */
  undo_of?: string;
  chat_id?: string;
}

export interface AssistantActivityPage {
  rows: AssistantActivityEntry[];
  next_cursor?: string;
}

export interface AssistantActivityFilter {
  from?: number;
  to?: number;
  actor?: string;
  q?: string;
  cursor?: string;
}

export const MAX_GRANTS = 500;

export const MAX_ACTIVITY_PAGE = 200;

const MAX_TEXT = 500;

const MAX_LABEL = 100;

// Reads render their own 403 state, so the interceptor's toast would be a second message.
const READ_REQUEST: AxiosRequestConfig = { silentForbidden: true };

const TIERS: ReadonlySet<string> = new Set(["read", "propose", "act_with_approval"]);

const LEVELS: ReadonlySet<string> = new Set(["schema", "aggregates", "raw"]);

const enc = encodeURIComponent;

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } })?.response?.status;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length <= MAX_TEXT ? value : undefined;

const time = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const clip = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value ? value.slice(0, max) : undefined;

export function parseCapabilityStatus(body: unknown): CapabilityStatus | null {
  if (!isRecord(body)) return null;
  const health = isRecord(body.health) ? body.health : null;
  return {
    health:
      health && typeof health.status === "string"
        ? {
            status: health.status.slice(0, MAX_LABEL),
            lastError: clip(health.last_error, MAX_TEXT),
            checkedAt: time(health.checked_at),
          }
        : null,
    model: clip(body.model, MAX_LABEL),
    agentVersion: clip(body.agent_version, MAX_LABEL),
    provider: clip(body.model_provider, MAX_LABEL),
    policyEnforced: body.policy_enforced === true,
    redactionApplied: body.redaction_applied === true,
  };
}

/** A body that is not an object, or has no boolean `ok`, reads as a failed test; `error` may be `{code, message}`. */
export function parseTestResult(body: unknown): CapabilityTestResult {
  if (!isRecord(body) || typeof body.ok !== "boolean") return { ok: false };
  const error = isRecord(body.error) ? body.error.message : body.error;
  return { ok: body.ok, duration_ms: time(body.duration_ms), error: clip(error, MAX_TEXT) };
}

/** The body is untrusted: a missing flag or an unknown enum reads as no settings at all. */
export function parseOrgAiSettings(body: unknown): OrgAiSettings | null {
  if (!isRecord(body)) return null;
  const { enabled, permission_tier, org_sharing, public_sharing, data_sharing_level } = body;
  if (typeof enabled !== "boolean" || typeof org_sharing !== "boolean") return null;
  if (typeof public_sharing !== "boolean") return null;
  if (typeof permission_tier !== "string" || !TIERS.has(permission_tier)) return null;
  if (typeof data_sharing_level !== "string" || !LEVELS.has(data_sharing_level)) return null;
  const settings: OrgAiSettings = {
    enabled,
    permission_tier: permission_tier as PermissionTier,
    org_sharing,
    public_sharing,
    data_sharing_level: data_sharing_level as DataSharingLevel,
  };
  const by = text(body.updated_by);
  const at = time(body.updated_at);
  const links = time(body.public_link_count);
  if (by) settings.updated_by = by;
  if (at !== undefined) settings.updated_at = at;
  if (links !== undefined) settings.public_link_count = Math.floor(links);
  return settings;
}

function parseGrant(value: unknown): AssistantGrant | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const tool = text(value.tool);
  const by = text(value.granted_by);
  const at = time(value.granted_at);
  if (!id || !tool || !by || at === undefined) return null;
  if (value.scope !== "always" && value.scope !== "chat") return null;
  const grant: AssistantGrant = {
    id,
    tool,
    operation: text(value.operation) ?? "",
    scope: value.scope,
    granted_by: by,
    granted_at: at,
  };
  const chat = text(value.chat_id);
  if (chat) grant.chat_id = chat;
  return grant;
}

const APPROVAL_KINDS: ReadonlySet<string> = new Set(["approved", "standing", "none"]);

const RESULT_STATES: ReadonlySet<string> = new Set(["done", "failed", "undone"]);

function parseActivityTarget(t: Record<string, unknown>): AssistantActivityEntry["target"] {
  return {
    type: text(t.type),
    id: text(t.id),
    name: text(t.name),
    link: text(t.link),
    deleted: t.deleted === true,
  };
}

function parseActivityEntry(value: unknown): AssistantActivityEntry | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const at = time(value.at);
  const action = text(value.action);
  const actor = text(value.on_behalf_of);
  if (!id || at === undefined || !action || !actor) return null;
  const undo = isRecord(value.undo) ? value.undo : {};
  const entry: AssistantActivityEntry = {
    id,
    at,
    action,
    on_behalf_of: actor,
    undo: {
      available: undo.available === true,
      until: time(undo.until),
      reason: text(undo.reason),
    },
  };
  if (isRecord(value.target)) entry.target = parseActivityTarget(value.target);
  const approval = value.approval;
  if (isRecord(approval) && APPROVAL_KINDS.has(approval.kind as string))
    entry.approval = { kind: approval.kind as ActivityApprovalKind, by: text(approval.by) };
  const result = value.result;
  if (isRecord(result) && RESULT_STATES.has(result.state as string))
    entry.result = { state: result.state as ActivityResultState, message: text(result.message) };
  entry.undo_of = text(value.undo_of);
  entry.chat_id = text(value.chat_id);
  return entry;
}

const definedOnly = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== "")) as T;

const assistantSettings = {
  /** `null` when the server predates org settings (404). */
  get: async (org: string): Promise<OrgAiSettings | null> => {
    try {
      const res = await http().get<unknown>(`/api/${enc(org)}/ai/settings`, READ_REQUEST);
      return parseOrgAiSettings(res.data);
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  },

  /** Sends only the five writable keys, never the read-only metadata. */
  update: async (org: string, body: OrgAiSettingsUpdate): Promise<OrgAiSettings | null> => {
    const payload: OrgAiSettingsUpdate = {
      enabled: body.enabled,
      permission_tier: body.permission_tier,
      org_sharing: body.org_sharing,
      public_sharing: body.public_sharing,
      data_sharing_level: body.data_sharing_level,
    };
    const res = await http().put<unknown>(`/api/${enc(org)}/ai/settings`, payload);
    return parseOrgAiSettings(res.data);
  },

  setToolsetEnabled: async (org: string, id: string, enabled: boolean): Promise<void> => {
    await http().patch(`/api/${enc(org)}/ai/toolsets/${enc(id)}`, { enabled });
  },

  /** `null` when the server cannot test toolsets (404). */
  testToolset: async (org: string, id: string): Promise<ToolsetTestResult | null> => {
    try {
      const res = await http().post<unknown>(`/api/${enc(org)}/ai/toolsets/${enc(id)}/test`, {});
      return parseTestResult(res.data);
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  },

  /** `null` when the server keeps no grants (404); malformed rows are dropped. */
  grants: async (org: string): Promise<AssistantGrant[] | null> => {
    try {
      const res = await http().get<unknown>(`/api/${enc(org)}/ai/grants`, READ_REQUEST);
      const rows = Array.isArray(res.data) ? res.data.slice(0, MAX_GRANTS) : [];
      return rows.map(parseGrant).filter((g): g is AssistantGrant => g !== null);
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  },

  revokeGrant: async (org: string, id: string): Promise<void> => {
    await http().delete(`/api/${enc(org)}/ai/grants/${enc(id)}`);
  },

  /** `null` when the server records no assistant activity (404). */
  activity: async (
    org: string,
    filter: AssistantActivityFilter = {},
  ): Promise<AssistantActivityPage | null> => {
    try {
      const res = await http().get<unknown>(`/api/${enc(org)}/ai/activity`, {
        ...READ_REQUEST,
        params: definedOnly(filter),
      });
      const body = isRecord(res.data) ? res.data : {};
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ACTIVITY_PAGE) : [];
      const page: AssistantActivityPage = {
        rows: rows.map(parseActivityEntry).filter((e): e is AssistantActivityEntry => e !== null),
      };
      const cursor = text(body.next_cursor);
      if (cursor) page.next_cursor = cursor;
      return page;
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  },

  undoActivity: async (org: string, id: string): Promise<void> => {
    await http().post(`/api/${enc(org)}/ai/activity/${enc(id)}/undo`, {});
  },
};

export default assistantSettings;
