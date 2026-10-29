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
import {
  QueryObserver,
  type QueryKey,
  type QueryObserverOptions,
  type QueryObserverResult,
} from "@tanstack/vue-query";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";

import config from "@/aws-exports";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import { contextRegistry } from "@/composables/contextProviders/registry";
import { queryClient } from "@/composables/query/queryClient";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";
import useBreakpoint from "@/composables/useBreakpoint";
import { registerSessionConsentSurface } from "@/composables/usePaidOverageConsent";
import assistantService, {
  type AssistantCapabilitiesResponse,
  type AssistantUsage,
} from "@/services/assistant";
import type { PaidOverageFeature } from "@/services/paidOverage";
import { paidOverageQuery, setPaidOverageMutation } from "@/services/paidOverage.queries";
import searchService from "@/services/search";
import { toast } from "@/lib/feedback/Toast/useToast";
import { gt } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { assistantUsageQuery, capabilitiesQuery } from "@/services/assistant.queries";
import { assistantKeys } from "@/services/assistant.querykeys";
import { aiChatShareKeys } from "@/services/ai_chat_share.querykeys";
import type { TelemetryContextGetters, TelemetryRole } from "@/services/assistantAnalytics";
import { orgTimeZone } from "@/utils/formatters";
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
import { cancelConsentOnClose, createConsentRuntime, type ConsentRuntime } from "./consent";
import { serialize } from "./context/serialize";
import { createHintChannel, type AssistantHintChannel } from "./hints";
import { createIndexedDbHistory } from "./historyDb";
import { createLifecycle, type AssistantLifecycleRuntime } from "./lifecycle";
import { forgetHistoryKeys, historyKeysOf, markKeptOnSignOut, readClearOnSignOut } from "./prefs";
import { createOpenAssistant, type OpenAssistantCall } from "./openAssistant";
import { openTabWithoutOpener } from "./openTab";
import { setRuntimeHandle } from "./runtimeHandle";
import { createTurnEngine, type TurnEngineDeps } from "./turnEngine";
import {
  createAssistantCapability,
  type AssistantCapabilityHandle,
  type AssistantServerConfig,
  type CapabilityDeps,
} from "./useAssistantCapability";
import { createApprovalsRuntime, type ApprovalsRuntime } from "./useAssistantApprovals";
import { createAssistantHistory, type AssistantHistory } from "./useAssistantHistory";
import { useAssistantClient } from "./useAssistantClient";
import { assistantKeydownAt } from "./useAssistantIdleFocus";

const TELEMETRY_ROLES: Record<string, TelemetryRole> = {
  admin: "admin",
  root: "admin",
  editor: "editor",
  viewer: "viewer",
};

const MAX_ENDED_TURNS = 64;

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
  approvals: ApprovalsRuntime;
  consent: ConsentRuntime;
  history: AssistantHistory;
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
  runtime?.history.dispose();
  runtime?.lifecycle.dispose();
  runtime?.hints.close();
  runtime = null;
  setRuntimeHandle(null);
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
    const dispatcher = createActionDispatcher(
      actionEnv(
        context,
        () => store,
        () => capability,
        () => hosts,
      ),
    );
    deps.actions = dispatcher;

    const hints = createHintChannel("");
    deps.hints = hints;
    hints.on("share_changed", (hint) => invalidateShares(store, context, hint.sid));
    const approvals = createApprovalsRuntime({
      state: () => store.state,
      annotate: (sid, blockId, patch) => store.annotate(sid, blockId, patch),
      resend: (sid, snapshot, input, opts) => store.resend(sid, snapshot, input, opts),
      engine: () => deps.engine,
      dispatch: dispatcher.approvals,
      extend: (org, sid, id) => useAssistantClient().confirm(org, sid, { id, extend: true }),
      extendable: () => capability.capability.value.approvalExtend === true,
      changed: refreshLists,
      hints,
      now: deps.now,
      lastKeydownAt: assistantKeydownAt,
      t: gt,
    });
    deps.approvals = approvals;
    const consent = createConsentRuntime(consentDeps(context, () => store, deps, hints));
    deps.consent = consent;
    deps.engine.setConsentHandler(consent.onConsentRequired);
    registerSessionConsentSurface(consent.promptFor);
    const store = createAssistantStore(deps, {
      signOutKeys: () => orgKeysOf(context.value),
      remoteLight: () =>
        lifecycle.remoteLight() ??
        (deps.history as Partial<AssistantHistory>).listLight?.value ??
        null,
      turnLock: (sid) => lifecycle.turnLock(sid),
    });
    flushDraftsOnLeave(store);
    cancelConsentOnClose(() => store.state, consent);
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
    const history = createAssistantHistory({
      ...historyDeps(
        context,
        () => store,
        () => capability,
        deps,
      ),
      approvals: () => approvals,
    });
    deps.history = history;
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
      onTurnEnded: refreshUsage,
      purge: () => purgeOnSignOut(context.value, capability, hints, history),
    });
    // The hint arrives on both the org and the user channel; one refresh per turn.
    const endedTurns = new Set<string>();
    hints.on("turn_ended", (hint) => {
      if (endedTurns.has(hint.turnId)) return;
      if (endedTurns.size >= MAX_ENDED_TURNS) endedTurns.clear();
      endedTurns.add(hint.turnId);
      refreshUsage(hint.org);
    });
    hints.on("consent_granted", (hint) => refreshUsage(hint.org));
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
    return {
      store,
      capability,
      hosts,
      hints,
      lifecycle,
      approvals,
      consent,
      history,
      context,
      uiVersion,
      openAssistant,
    };
  })!;
}

// History is built after the store and the capability, which take it lazily through `deps`.
function historyDeps(
  context: ShallowRef<AssistantRuntimeContext | null>,
  store: () => AssistantStoreInternal,
  capability: () => AssistantCapabilityHandle,
  deps: AssistantStoreDeps,
): Parameters<typeof createAssistantHistory>[0] {
  const locks = typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
  return {
    store,
    capability: () => capability().capability.value,
    org: () => context.value?.getOrg()?.identifier ?? null,
    db: createIndexedDbHistory(),
    queryClient,
    engine: () => deps.engine,
    hints: deps.hints,
    now: () => Date.now(),
    t: gt,
    timezone: orgTimeZone,
    writer: deps.uuid(),
    locks,
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    onVisibility(cb) {
      if (typeof document === "undefined") return () => undefined;
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    toast: (options) => void toast(options),
    userHash: () => (deps.hints as AssistantHintChannel).userHash(),
  };
}

// Server mode always purges the browser cache; local mode only when the user asked; every org this user wrote goes.
async function purgeOnSignOut(
  context: AssistantRuntimeContext | null,
  capability: AssistantCapabilityHandle,
  hints: AssistantHintChannel,
  history: AssistantHistory,
): Promise<void> {
  const hash = hints.userHash();
  if (!capability.capability.value.persistence && !(hash && readClearOnSignOut(hash))) {
    if (hash && history.localRecords().length > 0) markKeptOnSignOut(hash);
    return;
  }
  const keys = new Set([...(await orgKeysOf(context)), ...(hash ? historyKeysOf(hash) : [])]);
  await history.purge([...keys]);
  if (hash) forgetHistoryKeys(hash);
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
        rcaChatMode: () => handle.capability.value.rcaChatMode === true,
      };
    },
    history: () => deps.history,
    now: () => deps.now(),
    uuid: () => deps.uuid(),
    pageContext: () => contextRegistry.getActiveContext(),
    uiVersion: () => uiVersion.value,
    container: () => containerOf(store().state.shell.placement, lgUp()) ?? "home",
    approvals: () => deps.approvals,
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
    currentUser: () => context.value?.getUser()?.email ?? "",
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
    confirm: (org, sid, body, timeoutMs) => client.confirm(org, sid, body, timeoutMs),
    undo: (org, ledgerId) => assistantService.undo(org, ledgerId),
    requestAlert: (prefill) => requestAlertCreation(prefill),
    requestDashboard: (draft) => requestDashboardDraft(draft),
  };
}

// Writes go through the mutation's `meta.invalidates` and reads through the query, so the meter and Billing see the grant.
function consentDeps(
  context: ShallowRef<AssistantRuntimeContext | null>,
  store: () => AssistantStoreInternal,
  deps: AssistantStoreDeps,
  hints: AssistantHintChannel,
) {
  return {
    state: () => store().state,
    // The engine resumes the waiting turn; the store would join the send still in flight instead.
    send: (sid: string, turnId: string) => deps.engine.send(sid, { turnId }),
    stop: (sid: string) => store().stop(sid),
    withdraw: (sid: string) => deps.engine.consentWithdrawn?.(sid),
    enable: (org: string, feature: PaidOverageFeature) =>
      queryClient
        .getMutationCache()
        .build(queryClient, setPaidOverageMutation(org, feature))
        .execute(true)
        .finally(() => refreshUsage(org)),
    read: (org: string, feature: PaidOverageFeature) =>
      queryClient.fetchQuery({ ...paidOverageQuery(org, feature), staleTime: 0 }),
    hints,
    announce: (sid: string, key: Parameters<AssistantStoreInternal["announce"]>[1]) =>
      store().announce(sid, key),
    currentOrg: () => context.value?.getOrg()?.identifier ?? null,
    currentUser: () => context.value?.getUser()?.email ?? "",
    now: () => Date.now(),
    onVisible: (cb: () => void) => {
      if (typeof document === "undefined") return () => undefined;
      const listener = () => document.visibilityState === "visible" && cb();
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
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
    watchCapabilities: (org, onResult) =>
      observe<AssistantCapabilitiesResponse | null>(capabilitiesQuery(org), (result) =>
        onResult(result.data ?? null, result.dataUpdatedAt),
      ),
    invalidateCapabilities: (org) =>
      void queryClient.invalidateQueries({
        queryKey: assistantKeys.capabilities(org),
        refetchType: "none",
      }),
    // Focus refetch stays with the meter, so a closed panel sends nothing on focus.
    watchUsage: (org, onResult) =>
      observe<AssistantUsage | null>(
        { ...assistantUsageQuery(org), refetchOnWindowFocus: false },
        (result) => onResult(result.data?.mode ?? null),
      ),
  };
}

// vue-query's options type admits refs; these are plain values, which the core observer takes as is.
function observe<T>(
  options: unknown,
  onResult: (result: QueryObserverResult<T, Error>) => void,
): () => void {
  const observer = new QueryObserver(
    queryClient,
    options as QueryObserverOptions<T, Error, T, T, QueryKey>,
  );
  const report = () => {
    const result = observer.getCurrentResult();
    if (result.isFetched || result.isError) onResult(result);
  };
  const stop = observer.subscribe(report);
  report();
  return stop;
}

// The meter moves within one turn, and a grant elsewhere changes the mode.
function refreshUsage(org: string): void {
  if (org) void queryClient.invalidateQueries({ queryKey: assistantKeys.usage(org) });
}

// A hint only names the chat; its links are re-read, never taken from the payload.
function invalidateShares(
  store: AssistantStoreInternal,
  context: ShallowRef<AssistantRuntimeContext | null>,
  sid: string,
): void {
  const org = store.state.sessions[sid]?.org ?? context.value?.getOrg()?.identifier;
  if (org) void queryClient.invalidateQueries({ queryKey: aiChatShareKeys.forChat(org, sid) });
}

// The open Alerts and Dashboards lists hear about an approved change on their own refresh bus.
function refreshLists(types: string[]): void {
  const { emit } = useAiDashboardEvents();
  if (types.includes("dashboard")) emit({ type: "dashboard_updated" });
  if (types.includes("alert")) emit({ type: "alerts_changed" });
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
