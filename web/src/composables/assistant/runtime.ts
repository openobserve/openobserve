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
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";

import config from "@/aws-exports";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import { contextRegistry } from "@/composables/contextProviders/registry";
import { queryClient } from "@/composables/query/queryClient";
import useBreakpoint from "@/composables/useBreakpoint";
import assistantService, { type AssistantCapabilitiesResponse } from "@/services/assistant";
import searchService from "@/services/search";
import { gt } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { capabilitiesQuery } from "@/services/assistant.queries";
import { assistantKeys } from "@/services/assistant.querykeys";
import type { TelemetryContextGetters, TelemetryRole } from "@/services/assistantAnalytics";
import { computeUserOrgKey } from "@/utils/userOrgKey";

import { requestDashboardDraft } from "./actions/appliers/drafts";
import { pruneQueryRuns } from "./actions/appliers/query";
import { registerBuiltInAppliers } from "./actions/appliers";
import { createActionDispatcher, type ActionEnv } from "./actions/registry";
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
import { serialize } from "./context/serialize";
import { createHintChannel, type AssistantHintChannel } from "./hints";
import { createLifecycle, type AssistantLifecycleRuntime } from "./lifecycle";
import { createOpenAssistant, type OpenAssistantCall } from "./openAssistant";
import { setRuntimeHandle } from "./runtimeHandle";
import { createTurnEngine, type TurnEngineDeps } from "./turnEngine";
import {
  createAssistantCapability,
  type AssistantCapabilityHandle,
  type AssistantServerConfig,
  type CapabilityDeps,
} from "./useAssistantCapability";
import { useAssistantClient } from "./useAssistantClient";

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
  /** Identifiers of every org of the user, so sign-out drops each org's recall. */
  getOrganizations?(): string[];
  router?: Pick<Router, "currentRoute" | "push" | "resolve">;
}

export interface AssistantRuntime {
  store: AssistantStoreInternal;
  capability: AssistantCapabilityHandle;
  hosts: HostRegistry;
  hints: AssistantHintChannel;
  lifecycle: AssistantLifecycleRuntime;
  context: ShallowRef<AssistantRuntimeContext | null>;
  /** Set by `telemetryContext`; the `context.client.ui_version` of every turn (B-13). */
  uiVersion: ShallowRef<string>;
  openAssistant(args: OpenAssistantCall): Promise<OpenAssistantResult>;
}

export type AssistantRuntimeStore = AssistantStoreInternal & {
  /** Wires the getters; safe to call before or after the first access. */
  init(context: AssistantRuntimeContext): void;
  /** The envelope getters for `setAssistantTelemetryContext`. */
  telemetryContext(uiVersion: string): TelemetryContextGetters;
};

export function getAssistantRuntime(): AssistantRuntime {
  if (!runtime) {
    runtime = buildRuntime();
    setRuntimeHandle(runtime);
  }
  return runtime;
}

/** Drops the singleton so a spec builds a fresh runtime; never called by app code. */
export function resetAssistantRuntimeForTests(): void {
  runtime?.capability.dispose();
  runtime?.lifecycle.dispose();
  runtime?.hints.close();
  runtime = null;
  setRuntimeHandle(null);
}

/** A new tab the opened page cannot script back; `noopener` would make `window.open` return null even on success. */
export function openTabWithoutOpener(href: string): boolean {
  const opened = window.open(href, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
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
        return (uiVersion: string) => {
          rt.uiVersion.value = uiVersion;
          return telemetryGetters(rt, uiVersion);
        };
      const value = Reflect.get(rt.store, prop);
      return typeof value === "function" ? value.bind(rt.store) : value;
    },
  });
}

function buildRuntime(): AssistantRuntime {
  // Detached, so a first access from inside a component never ties the runtime to that component's life.
  return effectScope(true).run(() => {
    const context = shallowRef<AssistantRuntimeContext | null>(null);
    const uiVersion = shallowRef("");
    const { lgUp } = useBreakpoint();
    const deps: AssistantStoreDeps = inertAssistantDeps({
      getOrg: () => context.value?.getOrg() ?? null,
      getUser: () => context.value?.getUser() ?? null,
    });
    deps.engine = createTurnEngine(
      engineDeps(
        deps,
        () => store,
        () => capability,
        () => lgUp.value,
        uiVersion,
      ),
    );

    deps.engine.setRequestBuilder(serialize);
    registerBuiltInAppliers();
    deps.actions = createActionDispatcher(
      actionEnv(
        context,
        () => store,
        () => capability,
        () => hosts,
      ),
    );

    const hints = createHintChannel("");
    deps.hints = hints;
    const store = createAssistantStore(deps, {
      signOutKeys: () => orgKeysOf(context.value),
      remoteLight: () => lifecycle.remoteLight(),
      turnLock: (sid) => lifecycle.turnLock(sid),
    });
    flushDraftsOnLeave(store);
    // A deleted session, or one of the org the user just left, keeps no Run rows or searches.
    watch(
      () => {
        const org = context.value?.getOrg()?.identifier;
        return Object.values(store.state.sessions)
          .filter((session) => !org || session.org === org)
          .map((session) => session.sid);
      },
      (sids) => pruneQueryRuns(new Set(sids)),
    );
    const capability = createAssistantCapability(capabilityDeps(context));
    const hosts = createHostRegistry();
    // Synchronous, so `state.ready` never lags the gate a door just read.
    watch(capability.capability, (value) => store.syncCapability(value), {
      immediate: true,
      flush: "sync",
    });
    watchIdentity(context, store, capability, hints);
    const lifecycle = createLifecycle({
      store,
      hints,
      engine: deps.engine,
      client: useAssistantClient(),
      now: deps.now,
      currentOrgName: () =>
        context.value?.getOrg()?.name ?? context.value?.getOrg()?.identifier ?? "",
      currentOrg: () => context.value?.getOrg()?.identifier ?? null,
      currentEmail: () => context.value?.getUser()?.email ?? null,
    });
    const openAssistant = createOpenAssistant({
      store,
      capability: () => capability.capability.value,
      hosts,
      routeName: () => String(context.value?.router?.currentRoute.value.name ?? ""),
      routePrefersFloating: () => prefersFloating(context.value?.router?.currentRoute.value),
      pushRoute: (to) => void context.value?.router?.push(to).catch(() => undefined),
      lgUp: () => lgUp.value,
      viewportPx: () => window.innerWidth,
      viewportHeightPx: () => window.innerHeight,
      currentOrg: () => context.value?.getOrg()?.identifier ?? null,
      now: deps.now,
    });
    return { store, capability, hosts, hints, lifecycle, context, uiVersion, openAssistant };
  })!;
}

// Getters, because the engine is registered before the store and the capability it calls exist.
function engineDeps(
  deps: AssistantStoreDeps,
  store: () => AssistantStoreInternal,
  capability: () => AssistantCapabilityHandle,
  lgUp: () => boolean,
  uiVersion: ShallowRef<string>,
): TurnEngineDeps {
  return {
    client: useAssistantClient(),
    store,
    capability: () => {
      const handle = capability();
      return {
        noteForbidden: handle.noteForbidden,
        noteAgentUnavailable: handle.noteAgentUnavailable,
        noteAdmitted: handle.noteAdmitted,
        persistence: () => handle.capability.value.persistence,
        attachments: () => handle.capability.value.attachments === true,
      };
    },
    history: () => deps.history,
    now: () => deps.now(),
    uuid: () => deps.uuid(),
    pageContext: () => contextRegistry.getActiveContext(),
    uiVersion: () => uiVersion.value,
    container: () => containerOf(store().state.shell.placement, lgUp()) ?? "home",
  };
}

// Getters again: the appliers run long after the runtime is built, against the live store and router.
function actionEnv(
  context: ShallowRef<AssistantRuntimeContext | null>,
  store: () => AssistantStoreInternal,
  capability: () => AssistantCapabilityHandle,
  hosts: () => HostRegistry,
): ActionEnv {
  const client = useAssistantClient();
  return {
    store,
    router: () => context.value?.router ?? null,
    get hosts() {
      return hosts();
    },
    capability: () => capability().capability.value,
    currentOrg: () => context.value?.getOrg()?.identifier ?? null,
    now: () => Date.now(),
    t: gt,
    openTab: openTabWithoutOpener,
    copy: (text) => copyToClipboard(text, gt, { silent: true }),
    async search(request) {
      const response = await searchService.search({
        org_identifier: request.org,
        query: {
          query: {
            sql: request.sql,
            start_time: request.startTime,
            end_time: request.endTime,
            from: 0,
            size: request.size,
            quick_mode: false,
          },
        },
        page_type: request.streamType,
        signal: request.signal,
        silentForbidden: true,
      });
      return (response?.data ?? {}) as Record<string, unknown>;
    },
    feedback: (org, sid, body) => client.feedback(org, sid, body),
    requestAlert: (prefill) => requestAlertCreation(prefill),
    requestDashboard: (draft) => requestDashboardDraft(draft),
  };
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
        if (result.isFetched || result.isError) onResult(result.data ?? null, result.dataUpdatedAt);
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

async function orgKeysOf(context: AssistantRuntimeContext | null): Promise<string[]> {
  const email = context?.getUser()?.email;
  const orgs = context?.getOrganizations?.() ?? [];
  if (!email) return [];
  return Promise.all(orgs.map((org) => computeUserOrgKey(email, org)));
}

// The debounce would drop the last 250 ms of typing on a reload or tab close.
function flushDraftsOnLeave(store: AssistantStoreInternal): void {
  if (typeof window === "undefined") return;
  const flush = () => store.drafts.flush();
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
}

// The user+org key is async (SHA-256), so a slower stale computation must not win over a newer one.
function watchIdentity(
  context: ShallowRef<AssistantRuntimeContext | null>,
  store: AssistantStoreInternal,
  capability: AssistantCapabilityHandle,
  hints: AssistantHintChannel,
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
      hints.rebind(identity?.userOrgKey ?? "");
    },
    { immediate: true, deep: true },
  );
  // The user channel follows the user, never the org (`signed_out` reaches every org's tabs).
  watch(
    () => context.value?.getUser()?.email ?? null,
    (email) => void hints.bindUser(email),
    { immediate: true },
  );
}

// A route asks for the floating panel by meta, or by a predicate when only some of its tabs need the width.
function prefersFloating(route: RouteLocationNormalizedLoaded | undefined): boolean {
  const wanted = route?.meta?.assistantPrefersFloating;
  return typeof wanted === "function"
    ? wanted(route as RouteLocationNormalizedLoaded)
    : wanted === true;
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
