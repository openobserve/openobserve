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

import { LIVE_STALE_TIME, MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";

import assistant from "./assistant";
import { assistantKeys } from "./assistant.querykeys";
import { aiToolsetKeys } from "./ai_toolsets.querykeys";
import assistantSettings, {
  parseTestResult,
  type AssistantActivityFilter,
  type OrgAiSettingsUpdate,
} from "./assistant_settings";
import { assistantSettingsKeys } from "./assistant_settings.querykeys";

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
