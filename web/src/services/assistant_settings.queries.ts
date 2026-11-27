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

import {
  LIVE_STALE_TIME,
  MEDIUM_STALE_TIME,
  NORMAL_STALE_TIME,
} from "@/composables/query/cachePolicy";
import { orgKey } from "@/composables/query/keys";

import assistant from "./assistant";
import { assistantKeys, assistantSettingsKeys } from "./assistant.querykeys";
import aiToolsets, { type ToolsetCreateRequest, type ToolsetUpdateRequest } from "./ai_toolsets";
import { aiToolsetKeys } from "./ai_toolsets.querykeys";
import assistantSettings, {
  parseTestResult,
  type AssistantActivityFilter,
  type OrgAiSettingsUpdate,
} from "./assistant_settings";
import BillingService, { type AiUsage } from "./billings";
import { getResourcePermission, getRoles } from "./iam";

/** Org policy; `null` is the degraded path where every control shows the deployment value. */
export const assistantSettingsQuery = (org: string) =>
  queryOptions({
    queryKey: assistantSettingsKeys.org(org),
    queryFn: () => assistantSettings.get(org),
    staleTime: MEDIUM_STALE_TIME,
    retry: false,
    enabled: !!org,
  });

export const assistantGrantsQuery = (org: string) =>
  queryOptions({
    queryKey: assistantSettingsKeys.grants(org),
    queryFn: () => assistantSettings.grants(org),
    staleTime: LIVE_STALE_TIME,
    retry: false,
    enabled: !!org,
  });

export const assistantActivityQuery = (org: string, filter: AssistantActivityFilter) =>
  queryOptions({
    queryKey: assistantSettingsKeys.activity(org, filter),
    queryFn: () => assistantSettings.activity(org, filter),
    staleTime: LIVE_STALE_TIME,
    retry: false,
    enabled: !!org,
  });

/** The PUT takes the whole policy, so the edited keys go on top of a fresh read, never a cached one. */
export const updateAssistantSettingsMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (changes: Partial<OrgAiSettingsUpdate>) => {
      const fresh = await assistantSettings.get(org);
      if (!fresh) throw new Error("Organization settings are not available on this server.");
      return assistantSettings.update(org, { ...fresh, ...changes });
    },
    // The gate folds `enabled` into `off_for_org`, so a save also refetches capabilities.
    meta: {
      invalidates: [assistantSettingsKeys.org(org), assistantKeys.capabilities(org)],
    },
  });

/** Test never opens a chat or spends a credit; a successful test refetches the stored health. */
export const testCapabilitiesMutation = (org: string) =>
  mutationOptions({
    mutationFn: async () => parseTestResult(await assistant.testCapabilities(org)),
    meta: { invalidates: [assistantKeys.capabilities(org)], silentError: true },
  });

export const setToolsetEnabledMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      assistantSettings.setToolsetEnabled(org, vars.id, vars.enabled),
    meta: { invalidates: [aiToolsetKeys.all(org)], silentError: true },
  });

export const testToolsetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => assistantSettings.testToolset(org, id),
    meta: { invalidates: [aiToolsetKeys.all(org)], silentError: true },
  });

export const revokeGrantMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => assistantSettings.revokeGrant(org, id),
    meta: { invalidates: [assistantSettingsKeys.grants(org)] },
  });

export const undoActivityMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => assistantSettings.undoActivity(org, id),
    meta: { invalidates: [assistantSettingsKeys.activityAll(org)] },
  });

/** Another org's AI credit usage, as an operator reads it beside that org's allowance. */
export const orgAiUsageQuery = (org: string) =>
  queryOptions({
    queryKey: orgKey(org, "billing", "aiUsage"),
    queryFn: async (): Promise<AiUsage> => (await BillingService.get_ai_usage(org)).data,
    staleTime: LIVE_STALE_TIME,
    retry: false,
    enabled: !!org,
  });

/** The typed refusal a floor-checking server sends for a limit below current usage; `null` for anything else. */
export function belowUsageOf(err: unknown): { used: number; limit: number } | null {
  const res = (err as { response?: { status?: number; data?: unknown } })?.response;
  if (res?.status !== 409 || !res.data || typeof res.data !== "object") return null;
  const body = res.data as Record<string, unknown>;
  const inner = (body.error && typeof body.error === "object" ? body.error : body) as Record<
    string,
    unknown
  >;
  if (inner.code !== "below_usage") return null;
  const used = typeof inner.used === "number" ? inner.used : NaN;
  const limit = typeof inner.limit === "number" ? inner.limit : NaN;
  return Number.isFinite(used) && Number.isFinite(limit) ? { used, limit } : null;
}

export interface RoleChatAccess {
  role: string;
  /** `null` when this role's grants could not be read. */
  chat: boolean | null;
}

export interface RoleChatAccessList {
  roles: RoleChatAccess[];
  /** Every role in the org, also those past the cap. */
  total: number;
}

/** More roles than this and the panel lists the first ones; the full list stays in IAM › Roles. */
export const MAX_ROLES = 50;

/** Role reads in flight at once, so a large org does not fan out fifty requests. */
const ROLE_READS = 6;

const GRANTS_CHAT: ReadonlySet<string> = new Set(["AllowAll", "AllowPut"]);

/** Chat is a PUT on `ai`, alone or through AllowAll; anything else on the module grants no chat. */
export function grantsChat(permissions: unknown): boolean {
  if (!Array.isArray(permissions)) return false;
  return permissions.some(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      String((entry as Record<string, unknown>).object ?? "").startsWith("ai:") &&
      GRANTS_CHAT.has(String((entry as Record<string, unknown>).permission ?? "")),
  );
}

export const roleChatAccessQuery = (org: string) =>
  queryOptions({
    queryKey: [...assistantKeys.settings(org), "roleChatAccess"] as const,
    queryFn: async (): Promise<RoleChatAccessList> => {
      const res = await getRoles(org);
      const all = (Array.isArray(res.data) ? res.data : []).filter(
        (role: unknown): role is string => typeof role === "string" && role.length <= 256,
      );
      const roles = all.slice(0, MAX_ROLES);
      const out: RoleChatAccess[] = new Array(roles.length);
      let next = 0;
      const worker = async () => {
        while (next < roles.length) {
          const i = next++;
          out[i] = await chatAccessOf(org, roles[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(ROLE_READS, roles.length) }, worker));
      return { roles: out, total: all.length };
    },
    staleTime: NORMAL_STALE_TIME,
    retry: false,
    enabled: !!org,
  });

async function chatAccessOf(org: string, role: string): Promise<RoleChatAccess> {
  try {
    const perms = await getResourcePermission({
      role_name: role,
      org_identifier: org,
      resource: "ai",
    });
    return { role, chat: grantsChat(perms.data) };
  } catch {
    return { role, chat: null };
  }
}

/** One record for the edit form; never cached across opens, since its secrets are masked anyway. */
export const toolsetQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: [...aiToolsetKeys.all(org), "one", id] as const,
    queryFn: async (): Promise<unknown> => (await aiToolsets.get(org, id)).data,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled: !!org && !!id,
  });

/** Removal waits for the server; the list drops the row only when the refetch lands. */
export const deleteToolsetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => aiToolsets.delete(org, id),
    meta: { invalidates: [aiToolsetKeys.all(org)], silentError: true },
  });

export const createToolsetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (body: ToolsetCreateRequest) => aiToolsets.create(org, body),
    // The variables hold plaintext secrets, so a finished mutation is dropped at once.
    gcTime: 0,
    meta: { invalidates: [aiToolsetKeys.all(org)], silentError: true },
  });

export const updateToolsetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; body: ToolsetUpdateRequest }) =>
      aiToolsets.update(org, vars.id, vars.body),
    // The variables hold plaintext secrets, so a finished mutation is dropped at once.
    gcTime: 0,
    meta: { invalidates: [aiToolsetKeys.all(org)], silentError: true },
  });
