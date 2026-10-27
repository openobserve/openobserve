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

import { computed, markRaw, shallowReactive } from "vue";

import { createAssistantStore, inertAssistantDeps } from "../assistantStore";
import type {
  AssistantCapability,
  AssistantHostAdapter,
  AssistantStoreDeps,
  DockHostId,
  HostRegistry,
} from "../assistantStore.types";
import { createDraftStore } from "../drafts";

export const AVAILABLE: AssistantCapability = {
  gate: "available",
  edition: "ee",
  configured: true,
  health: "ok",
  canChat: "yes",
  canWrite: "yes",
  canShare: "yes",
  canShareRead: "yes",
  persistence: false,
  publicLinks: false,
  publicMaxExpiryDays: 0,
  isAdmin: false,
  rcaEnabled: false,
  source: "heuristic",
  reasonCode: "available",
};

/** The host registry the runtime builds, with reactive membership. */
export function fakeHostRegistry(): HostRegistry {
  const adapters = shallowReactive(new Map<DockHostId, AssistantHostAdapter>());
  return {
    register: (adapter) => void adapters.set(adapter.id, markRaw(adapter)),
    unregister: (id) => void adapters.delete(id),
    get: (id) => adapters.get(id),
    has: (id) => adapters.has(id),
    mounted: computed(() => [...adapters.keys()]),
  };
}

/** A ready store under `k1` / `org1` and a registry, the parts of the runtime a host reads. */
export function fakeRuntime(deps: Partial<AssistantStoreDeps> = {}) {
  let n = 0;
  const store = createAssistantStore(
    inertAssistantDeps({
      getOrg: () => ({ identifier: "org1", name: "Org 1" }),
      getUser: () => ({ email: "ada@example.com", role: "admin" }),
      uuid: () => `0190f3a0-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
      ...deps,
    }),
    { drafts: createDraftStore({ delayMs: 0 }), viewportRem: () => 80 },
  );
  store.setIdentity({ userOrgKey: "k1", org: "org1" });
  store.syncCapability(AVAILABLE);
  return { store, hosts: fakeHostRegistry() };
}
