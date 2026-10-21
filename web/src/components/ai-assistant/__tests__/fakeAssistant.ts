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

import { vi } from "vitest";
import { computed, ref, watch } from "vue";
import { createMemoryHistory, createRouter, type RouteRecordRaw } from "vue-router";
import { createStore } from "vuex";

import { createAssistantStore, inertAssistantDeps } from "@/composables/assistant/assistantStore";
import type {
  AssistantCapability,
  AssistantStoreDeps,
  GateCode,
} from "@/composables/assistant/assistantStore.types";
import type { UseAssistantCapability } from "@/composables/assistant/useAssistantCapability";

/** A real store and a writable capability for component specs; nothing reaches the runtime singleton. */
export function fakeAssistant(
  gate: GateCode = "available",
  over: Partial<AssistantCapability> = {},
  deps: Partial<AssistantStoreDeps> = {},
  viewportRem = 80,
) {
  let n = 0;
  const store = createAssistantStore(
    inertAssistantDeps({
      getOrg: () => ({ identifier: "default", name: "default" }),
      getUser: () => ({ email: "ada@example.com", role: "admin" }),
      uuid: () => `0190a1b2-c3d4-7e5f-8a9b-${String(++n).padStart(12, "0")}`,
      ...deps,
    }),
    { viewportRem: () => viewportRem },
  );
  const capability = ref<AssistantCapability>({
    gate,
    edition: "ee",
    configured: gate !== "not_configured",
    health: gate === "unhealthy" ? "down" : "ok",
    canChat: gate === "no_permission" ? "no" : "yes",
    canWrite: "yes",
    canShare: "yes",
    canShareRead: "yes",
    persistence: true,
    publicLinks: false,
    publicMaxExpiryDays: 0,
    isAdmin: true,
    rcaEnabled: false,
    source: "heuristic",
    reasonCode: gate,
    ...over,
  });
  watch(capability, (value) => store.syncCapability(value), { immediate: true, deep: true });
  store.setIdentity({ userOrgKey: "k1", org: "default" });
  const gateRef = computed(() => capability.value.gate);
  const handle = Object.assign(
    computed(() => capability.value),
    {
      gate: gateRef,
      assistantCanChat: computed(() => ["available", "unhealthy"].includes(gateRef.value)),
      unknownNotice: computed(
        () => gateRef.value === "available" && capability.value.canChat === "unknown",
      ),
      noteForbidden: vi.fn(),
      noteAgentUnavailable: vi.fn(),
      noteAdmitted: vi.fn(),
    },
  ) as UseAssistantCapability;
  return { store, capability, handle };
}

export function fakeRouter(extra: RouteRecordRaw[] = []) {
  const blank = { render: () => null };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: blank },
      { path: "/logs", name: "logs", component: blank },
      { path: "/assistant/:chatId?", name: "assistant", component: blank },
      { path: "/iam/roles", name: "roles", component: blank },
      ...extra,
    ],
  });
}

export function fakeVuex() {
  return createStore({
    state: { selectedOrganization: { identifier: "default", label: "default" } },
  });
}
