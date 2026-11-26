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

import { computed, type ComputedRef } from "vue";
import { onBeforeRouteUpdate } from "vue-router";
import { useStore } from "vuex";

import {
  askLeaveGuard,
  useAssistantCapability,
  useAssistantLeaveGuard,
  type AssistantCapability,
} from "@/composables/assistant";
import { raw, useI18nTyped } from "@/types/i18n";

/** What every Settings › Assistant tab reads from the session; the org is the one selected now. */
export interface AssistantSettingsPage {
  org: ComputedRef<string>;
  orgName: ComputedRef<string>;
  isAdmin: ComputedRef<boolean>;
  capability: ComputedRef<AssistantCapability>;
  aiEnabled: ComputedRef<boolean>;
  rbacEnabled: ComputedRef<boolean>;
  publicLinksAllowed: ComputedRef<boolean>;
  persistence: ComputedRef<boolean>;
  publicMaxExpiryDays: ComputedRef<number>;
  isCloud: ComputedRef<boolean>;
  isMetaOrg: ComputedRef<boolean>;
}

export function useAssistantSettingsPage(): AssistantSettingsPage {
  const store = useStore();
  const handle = useAssistantCapability();
  const capability = computed(() => handle.value);
  const zo = computed(() => (store.state.zoConfig ?? {}) as Record<string, unknown>);
  const org = computed(() => (store.state.selectedOrganization?.identifier as string) ?? "");
  return {
    org,
    orgName: computed(() => (store.state.selectedOrganization?.label as string) || org.value),
    isAdmin: computed(() => capability.value.isAdmin),
    capability,
    aiEnabled: computed(() => zo.value.ai_enabled === true),
    rbacEnabled: computed(() => zo.value.rbac_enabled !== false),
    publicLinksAllowed: computed(() => zo.value.public_ai_chat_enabled === true),
    persistence: computed(() => zo.value.ai_chat_persistence_enabled === true),
    publicMaxExpiryDays: computed(() => capability.value.publicMaxExpiryDays),
    isCloud: computed(() => capability.value.edition === "cloud"),
    isMetaOrg: computed(() => !!zo.value.meta_org && zo.value.meta_org === org.value),
  };
}

/** Guards an unsaved settings form on route leave, org switch and sign-out; a tab switch asks about this form only. */
export function useSettingsLeaveGuard(page: AssistantSettingsPage, isDirty: () => boolean): void {
  const { t } = useI18nTyped();
  const guard = {
    host: "settings" as const,
    isDirty,
    name: () => t("assistant.settings.leaveName", { org: raw(page.orgName.value) }),
  };
  useAssistantLeaveGuard(guard);
  onBeforeRouteUpdate((to, from) => to.params.tab === from.params.tab || askLeaveGuard(guard));
}

export type SettingsReadState = "loading" | "error" | "forbidden" | "ready";

/** One reading of a query for every tab: a 403 is its own state, never a load error with Retry. */
export function readStateOf(query: {
  isPending: { value: boolean };
  isError: { value: boolean };
  error: { value: unknown };
}): SettingsReadState {
  if (query.isError.value) {
    const status = (query.error.value as { response?: { status?: number } })?.response?.status;
    return status === 403 ? "forbidden" : "error";
  }
  return query.isPending.value ? "loading" : "ready";
}
