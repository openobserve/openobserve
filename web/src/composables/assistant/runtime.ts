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

import {
  computed,
  effectScope,
  markRaw,
  shallowReactive,
  shallowRef,
  watch,
  type ShallowRef,
} from "vue";
import { QueryObserver, type QueryKey, type QueryObserverOptions } from "@tanstack/vue-query";
import type { Router } from "vue-router";

import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import useBreakpoint from "@/composables/useBreakpoint";
import assistantService, { type AssistantCapabilitiesResponse } from "@/services/assistant";
import { capabilitiesQuery } from "@/services/assistant.queries";
import { assistantKeys } from "@/services/assistant.querykeys";
import type { TelemetryContextGetters, TelemetryRole } from "@/services/assistantAnalytics";
import { computeUserOrgKey } from "@/utils/userOrgKey";

import {
  containerOf,
  createAssistantStore,
  inertAssistantDeps,
  type AssistantStoreInternal,
} from "./assistantStore";
import type {
  AssistantHostAdapter,
  AssistantStoreDeps,
  DockHostId,
  HostRegistry,
  OpenAssistantResult,
} from "./assistantStore.types";
import { createOpenAssistant, type OpenAssistantCall } from "./openAssistant";
import {
  createAssistantCapability,
  type AssistantCapabilityHandle,
  type AssistantServerConfig,
  type CapabilityDeps,
} from "./useAssistantCapability";

const TELEMETRY_ROLES: Record<string, TelemetryRole> = {
  admin: "admin",
  root: "admin",
  editor: "editor",
  viewer: "viewer",
};

// Built on first property access, so importing the barrel constructs nothing and the chunk can be dropped.
export const assistantStore: AssistantRuntimeStore = /* @__PURE__ */ lazyAssistantStore();

let runtime: AssistantRuntime | null = null;

/** What `main.ts` wires once `/config` resolves; every getter reads Vuex lazily so the runtime stays reactive. */
export interface AssistantRuntimeContext {
  getOrg(): { identifier: string; name: string } | null;
  getUser(): { email: string; role: string } | null;
  /** `null` until the authenticated config has resolved (the gate stays `loading`). */
  getConfig(): AssistantServerConfig | null;
  isOrgAdmin(): boolean | undefined;
  router?: Pick<Router, "currentRoute" | "push">;
}

export interface AssistantRuntime {
  store: AssistantStoreInternal;
  capability: AssistantCapabilityHandle;
  hosts: HostRegistry;
  context: ShallowRef<AssistantRuntimeContext | null>;
  openAssistant(args: OpenAssistantCall): Promise<OpenAssistantResult>;
}

export type AssistantRuntimeStore = AssistantStoreInternal & {
  /** Wires the getters; safe to call before or after the first access. */
  init(context: AssistantRuntimeContext): void;
  /** The envelope getters for `setAssistantTelemetryContext`. */
  telemetryContext(uiVersion: string): TelemetryContextGetters;
};

export function getAssistantRuntime(): AssistantRuntime {
  runtime ??= buildRuntime();
  return runtime;
}

/** Drops the singleton so a spec builds a fresh runtime; never called by app code. */
export function resetAssistantRuntimeForTests(): void {
  runtime?.capability.dispose();
  runtime = null;
}

function lazyAssistantStore(): AssistantRuntimeStore {
  return new Proxy({} as AssistantRuntimeStore, {
    get(_target, prop) {
      const rt = getAssistantRuntime();
      if (prop === "init")
        return (context: AssistantRuntimeContext) => {
          rt.context.value = context;
        };
      if (prop === "telemetryContext")
        return (uiVersion: string) => telemetryGetters(rt, uiVersion);
      const value = Reflect.get(rt.store, prop);
      return typeof value === "function" ? value.bind(rt.store) : value;
    },
  });
}

function buildRuntime(): AssistantRuntime {
  // Detached, so a first access from inside a component never ties the runtime to that component's life.
  return effectScope(true).run(() => {
    const context = shallowRef<AssistantRuntimeContext | null>(null);
    const deps: AssistantStoreDeps = inertAssistantDeps({
      getOrg: () => context.value?.getOrg() ?? null,
      getUser: () => context.value?.getUser() ?? null,
    });
    // Services: each later package appends one `deps.<name> = create…()` line here, in WP order.

    const store = createAssistantStore(deps);
    const capability = createAssistantCapability(capabilityDeps(context));
    const hosts = createHostRegistry();
    const { lgUp } = useBreakpoint();
    // Synchronous, so `state.ready` never lags the gate a door just read.
    watch(capability.capability, (value) => store.syncCapability(value), {
      immediate: true,
      flush: "sync",
    });
    watchIdentity(context, store, capability);
    const openAssistant = createOpenAssistant({
      store,
      capability: () => capability.capability.value,
      hosts,
      routeName: () => String(context.value?.router?.currentRoute.value.name ?? ""),
      routePrefersFloating: () =>
        context.value?.router?.currentRoute.value.meta?.assistantPrefersFloating === true,
      pushRoute: (to) => void context.value?.router?.push(to).catch(() => undefined),
      lgUp: () => lgUp.value,
      viewportPx: () => window.innerWidth,
      currentOrg: () => context.value?.getOrg()?.identifier ?? null,
      now: deps.now,
    });
    return { store, capability, hosts, context, openAssistant };
  })!;
}

function capabilityDeps(context: ShallowRef<AssistantRuntimeContext | null>): CapabilityDeps {
  return {
    getConfig: () => context.value?.getConfig() ?? null,
    getEdition: () => ({
      isEnterprise: config.isEnterprise === "true",
      isCloud: config.isCloud === "true",
    }),
    getRole: () => context.value?.getUser()?.role ?? null,
    isOrgAdmin: () => context.value?.isOrgAdmin(),
    probe: (org) => assistantService.probeChatAccess(org),
    watchCapabilities(org, onResult) {
      // vue-query's options type admits refs; these are plain values, which the core observer takes as is.
      const options = capabilitiesQuery(org) as unknown as QueryObserverOptions<
        AssistantCapabilitiesResponse | null,
        Error,
        AssistantCapabilitiesResponse | null,
        AssistantCapabilitiesResponse | null,
        QueryKey
      >;
      const observer = new QueryObserver(queryClient, options);
      const report = () => {
        const result = observer.getCurrentResult();
        if (result.isFetched || result.isError) onResult(result.data ?? null);
      };
      const stop = observer.subscribe(report);
      report();
      return stop;
    },
    invalidateCapabilities: (org) =>
      void queryClient.invalidateQueries({
        queryKey: assistantKeys.capabilities(org),
        refetchType: "none",
      }),
  };
}

// The user+org key is async (SHA-256), so a slower stale computation must not win over a newer one.
function watchIdentity(
  context: ShallowRef<AssistantRuntimeContext | null>,
  store: AssistantStoreInternal,
  capability: AssistantCapabilityHandle,
): void {
  let generation = 0;
  watch(
    () => {
      const email = context.value?.getUser()?.email;
      const org = context.value?.getOrg()?.identifier;
      return email && org ? [email, org] : null;
    },
    async (pair) => {
      generation += 1;
      const asked = generation;
      const identity = pair
        ? { userOrgKey: await computeUserOrgKey(pair[0], pair[1]), org: pair[1] }
        : null;
      if (asked !== generation) return;
      capability.setIdentity(identity);
      store.setIdentity(identity);
    },
    { immediate: true, deep: true },
  );
}

function createHostRegistry(): HostRegistry {
  const adapters = shallowReactive(new Map<DockHostId, AssistantHostAdapter>());
  return {
    register: (adapter) => void adapters.set(adapter.id, markRaw(adapter)),
    unregister: (id) => void adapters.delete(id),
    get: (id) => adapters.get(id),
    has: (id) => adapters.has(id),
    mounted: computed(() => [...adapters.keys()]),
  };
}

function telemetryGetters(rt: AssistantRuntime, uiVersion: string): TelemetryContextGetters {
  const { lgUp, mdUp } = useBreakpoint();
  return {
    getContainer: () => containerOf(rt.store.state.shell.placement, lgUp.value) ?? "home",
    getRoute: () => String(rt.context.value?.router?.currentRoute.value.name ?? ""),
    getViewport: () => (lgUp.value ? "desktop" : mdUp.value ? "tablet" : "mobile"),
    getEdition: () => rt.capability.capability.value.edition,
    getCreditMode: () => rt.capability.capability.value.creditMode ?? "none",
    getRole: () => telemetryRole(rt.context.value?.getUser()?.role),
    getOrg: () => rt.context.value?.getOrg()?.identifier ?? "",
    getGate: () => rt.capability.gate.value,
    uiVersion,
  };
}

function telemetryRole(role: string | undefined): TelemetryRole {
  if (!role) return "unknown";
  return TELEMETRY_ROLES[role.toLowerCase()] ?? "custom";
}
