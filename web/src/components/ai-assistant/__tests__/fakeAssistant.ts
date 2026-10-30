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

import { QueryClient } from "@tanstack/vue-query";
import { vi } from "vitest";
import { computed, ref, watch } from "vue";
import { createMemoryHistory, createRouter, type RouteRecordRaw } from "vue-router";
import { createStore } from "vuex";

import {
  createAssistantStore,
  inertAssistantDeps,
  type AssistantStoreOptions,
} from "@/composables/assistant/assistantStore";
import type {
  AssistantCapability,
  AssistantStoreDeps,
  GateCode,
} from "@/composables/assistant/assistantStore.types";
import {
  mergeLocalRecord,
  type HistoryDb,
  type LocalRecord,
} from "@/composables/assistant/historyDb";
import type { UseAssistantCapability } from "@/composables/assistant/useAssistantCapability";
import {
  createAssistantHistory,
  type HistoryDeps,
} from "@/composables/assistant/useAssistantHistory";
import { gt } from "@/types/i18n";

/** A real store and a writable capability for component specs; nothing reaches the runtime singleton. */
export function fakeAssistant(
  gate: GateCode = "available",
  over: Partial<AssistantCapability> = {},
  deps: Partial<AssistantStoreDeps> = {},
  viewportRem = 80,
  /** The store opens chats through this history instead of the inert one (no network in specs). */
  wireHistory = false,
  historyDeps: Partial<HistoryDeps> = {},
  storeOptions: AssistantStoreOptions = {},
) {
  let n = 0;
  const storeDeps = inertAssistantDeps({
    getOrg: () => ({ identifier: "default", name: "default" }),
    getUser: () => ({ email: "ada@example.com", role: "admin" }),
    uuid: () => `0190a1b2-c3d4-7e5f-8a9b-${String(++n).padStart(12, "0")}`,
    ...deps,
  });
  const store = createAssistantStore(storeDeps, {
    viewportRem: () => viewportRem,
    ...storeOptions,
  });
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
  const db = memoryHistoryDb();
  const toast = vi.fn();
  const history = createAssistantHistory({
    store: () => store,
    capability: () => capability.value,
    org: () => "default",
    db,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    engine: () => ({ turnFrames: () => null }),
    hints: { post: vi.fn(), on: () => () => undefined },
    now: () => Date.now(),
    t: gt,
    timezone: () => "UTC",
    writer: "tab-a",
    locks: null,
    hidden: () => false,
    onVisibility: () => () => undefined,
    userHash: () => "u1",
    toast,
    ...historyDeps,
  });
  if (wireHistory) storeDeps.history = history;
  return { store, capability, handle, history, db, toast };
}

/** A cross-tab hint channel a spec fires by hand. */
export function hintBus() {
  const handlers = new Map<string, ((hint: any) => void)[]>();
  return {
    post: vi.fn(),
    on: (type: string, handler: (hint: any) => void) => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      return () => undefined;
    },
    fire: (hint: Record<string, unknown>) =>
      handlers.get(String(hint.type))?.forEach((handler) => handler({ v: 1, at: 1, ...hint })),
  };
}

/** The browser store in memory, merging as IndexedDB does. */
export function memoryHistoryDb(
  seed: LocalRecord[] = [],
): HistoryDb & { rows: Map<number, LocalRecord> } {
  const rows = new Map<number, LocalRecord>(seed.map((row) => [row.id, structuredClone(row)]));
  return {
    rows,
    list: async (key) =>
      [...rows.values()].filter((row) => row.userOrgKey === key).map((row) => structuredClone(row)),
    get: async (id) => structuredClone(rows.get(id) ?? null),
    merge: async (record, writer) => {
      const stored = rows.get(record.id);
      if (stored && stored.userOrgKey !== record.userOrgKey) return null;
      const next = mergeLocalRecord(stored, structuredClone(record), writer);
      rows.set(record.id, next);
      return structuredClone(next);
    },
    remove: async (ids, userOrgKey) => {
      for (const id of ids) if (rows.get(id)?.userOrgKey === userOrgKey) rows.delete(id);
    },
    removeAll: async (keys) => {
      let removed = 0;
      for (const [id, row] of rows)
        if (row.userOrgKey && keys.includes(row.userOrgKey)) {
          rows.delete(id);
          removed += 1;
        }
      return removed;
    },
    countUnkeyed: async () => [...rows.values()].filter((row) => !row.userOrgKey).length,
  };
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
