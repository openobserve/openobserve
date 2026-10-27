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

import { computed, effectScope, ref, shallowRef, watch, type ComputedRef, type Ref } from "vue";

import type { AssistantCapabilitiesResponse } from "@/services/assistant";
import { checkFeatureAccess } from "@/utils/enterpriseFeatures";

import type { AssistantCapability, CreditMode, GateCode, Tri } from "./assistantStore.types";
import { getAssistantRuntime } from "./runtime";

const DENIED_PREFIX = "o2.assistant.denied:";

// The interim heuristic (`00` §9): only these roles are presumed to chat; every other role is probed.
const HEURISTIC_YES_ROLES: ReadonlySet<string> = new Set(["admin", "root", "editor"]);

const ADMIN_ROLES: ReadonlySet<string> = new Set(["admin", "root"]);

const CHAT_GATES: ReadonlySet<GateCode> = new Set(["available", "unhealthy"]);

/** The `/config` fields the gate reads; `null` until the authenticated config has resolved. */
export interface AssistantServerConfig {
  aiEnabled: boolean;
  rbacEnabled: boolean;
  persistence: boolean;
  publicLinks: boolean;
  publicMaxExpiryDays: number;
  rcaEnabled: boolean;
}

/** Everything the capability reads, injected so the gate matrix is unit-tested with fakes. */
export interface CapabilityDeps {
  getConfig(): AssistantServerConfig | null;
  getEdition(): { isEnterprise: boolean; isCloud: boolean };
  /** `currentuser.role`; reactive when it reads Vuex state. */
  getRole(): string | null;
  /** `orgAdminFlag` of the selected org; `undefined` when unknown. */
  isOrgAdmin(): boolean | undefined;
  probe(org: string): Promise<Tri>;
  /** `onResult(null)` means B-06 is absent (404) or failed with nothing cached; `at` is when the data was fetched. */
  watchCapabilities(
    org: string,
    onResult: (data: AssistantCapabilitiesResponse | null, at?: number) => void,
  ): () => void;
  invalidateCapabilities(org: string): void;
  /** `GET /ai/usage` on Cloud; `onResult(null)` when it failed or is not served. */
  watchUsage?(org: string, onResult: (mode: CreditMode | null) => void): () => void;
  storage?(): Storage | null;
}

export interface CapabilityIdentity {
  userOrgKey: string;
  org: string;
}

/** The one reader every door, shortcut and container uses (`00` §9). */
export interface AssistantCapabilityHandle {
  capability: ComputedRef<AssistantCapability>;
  gate: ComputedRef<GateCode>;
  /** The shortcut and cheatsheet predicate: `available` and `unhealthy` only. */
  assistantCanChat: ComputedRef<boolean>;
  /** `canChat === "unknown"` renders `available` plus `assistant.gate.noPermission.unknownNotice`. */
  unknownNotice: ComputedRef<boolean>;
  /** Recomputes from scratch for a new user+org; the old org's cached denial never applies. */
  setIdentity(identity: CapabilityIdentity | null): void;
  /** A 403 from any assistant call. */
  noteForbidden(): void;
  /** An `agent_unavailable` terminal. */
  noteAgentUnavailable(): void;
  /** An admitted turn: settles `canChat` and clears an inferred `down`. */
  noteAdmitted(): void;
  dispose(): void;
}

export type UseAssistantCapability = Readonly<Ref<AssistantCapability>> &
  Pick<
    AssistantCapabilityHandle,
    | "gate"
    | "assistantCanChat"
    | "unknownNotice"
    | "noteForbidden"
    | "noteAgentUnavailable"
    | "noteAdmitted"
  >;

interface AccessState {
  value: "yes" | "no";
  source: "probe" | "cached_403";
  /** When this page load learned it; a 403 at or after the last capabilities read wins over its `can_chat`. */
  at: number;
}

interface CapabilityInput {
  config: AssistantServerConfig | null;
  edition: { isEnterprise: boolean; isCloud: boolean };
  role: string;
  isOrgAdmin: boolean | undefined;
  identified: boolean;
  b06: AssistantCapabilitiesResponse | null;
  b06At: number;
  access: AccessState | null;
  health: AssistantCapability["health"];
  creditMode: CreditMode | null;
}

/** The capability of this tab's runtime; reactive, shared by every caller. */
export function useAssistantCapability(): UseAssistantCapability {
  const handle = getAssistantRuntime().capability;
  return Object.assign(
    computed(() => handle.capability.value),
    {
      gate: handle.gate,
      assistantCanChat: handle.assistantCanChat,
      unknownNotice: handle.unknownNotice,
      noteForbidden: handle.noteForbidden,
      noteAgentUnavailable: handle.noteAgentUnavailable,
      noteAdmitted: handle.noteAdmitted,
    },
  );
}

export function createAssistantCapability(deps: CapabilityDeps): AssistantCapabilityHandle {
  const scope = effectScope(true);
  const identity = shallowRef<CapabilityIdentity | null>(null);
  const b06 = shallowRef<AssistantCapabilitiesResponse | null>(null);
  const b06Settled = ref(false);
  const b06At = ref(0);
  const access = shallowRef<AccessState | null>(null);
  const health = ref<AssistantCapability["health"]>("unknown");
  const creditMode = ref<CreditMode | null>(null);
  let probed = false;
  let generation = 0;

  const store = (): Storage | null => {
    try {
      return deps.storage ? deps.storage() : window.sessionStorage;
    } catch {
      return null;
    }
  };

  const persistAccess = (next: Omit<AccessState, "at">) => {
    access.value = { ...next, at: Date.now() };
    const key = identity.value?.userOrgKey;
    if (!key) return;
    try {
      store()?.setItem(DENIED_PREFIX + key, JSON.stringify(next));
    } catch {
      // The flip still holds for this page load.
    }
  };

  const readAccess = (userOrgKey: string): AccessState | null => {
    try {
      const raw = store()?.getItem(DENIED_PREFIX + userOrgKey);
      const parsed = raw ? (JSON.parse(raw) as Partial<AccessState>) : null;
      // A state from an earlier page load is older than any capabilities read of this one.
      if (parsed?.value === "no") return { value: "no", source: "cached_403", at: 0 };
      return parsed?.value === "yes" ? { value: "yes", source: "probe", at: 0 } : null;
    } catch {
      return null;
    }
  };

  const clearAccess = () => {
    access.value = null;
    const key = identity.value?.userOrgKey;
    try {
      if (key) store()?.removeItem(DENIED_PREFIX + key);
    } catch {
      // Nothing was stored.
    }
  };

  const handle = scope.run(() => {
    const input = computed<CapabilityInput>(() => ({
      config: deps.getConfig(),
      edition: deps.getEdition(),
      role: (deps.getRole() ?? "").toLowerCase(),
      isOrgAdmin: deps.isOrgAdmin(),
      identified: identity.value !== null,
      b06: b06.value,
      b06At: b06At.value,
      access: access.value,
      health: health.value,
      creditMode: creditMode.value,
    }));
    const capability = computed(() => resolveCapability(input.value));
    const gate = computed(() => capability.value.gate);
    const entitledAndConfigured = computed(
      () => !["loading", "not_entitled", "not_configured"].includes(gate.value),
    );

    watch(
      [identity, entitledAndConfigured],
      ([id, ready], _old, onCleanup) => {
        if (!id || !ready) return;
        deps.invalidateCapabilities(id.org);
        const asked = generation;
        const stop = deps.watchCapabilities(id.org, (data, at) => {
          // An answer for the org before a switch would otherwise land on the new org's state.
          if (asked !== generation) return;
          b06Settled.value = true;
          if (!data) return;
          b06.value = data;
          b06At.value = at ?? Date.now();
          const status = healthOf(data.health?.status);
          if (status) health.value = status;
          if (data.can_chat === true && (access.value?.at ?? 0) < b06At.value) clearAccess();
        });
        onCleanup(stop);
      },
      { immediate: true },
    );

    // Off Cloud nothing is metered, so no request is sent.
    const metered = computed(() => deps.getEdition().isCloud && entitledAndConfigured.value);
    watch(
      [identity, metered],
      ([id, on], _old, onCleanup) => {
        if (!id || !on || !deps.watchUsage) return;
        const asked = generation;
        const stop = deps.watchUsage(id.org, (mode) => {
          if (asked === generation) creditMode.value = mode;
        });
        // A gate that stops metering takes the last mode with it.
        onCleanup(() => {
          stop();
          creditMode.value = null;
        });
      },
      { immediate: true },
    );

    const needsProbe = computed(() => {
      const value = input.value;
      return (
        entitledAndConfigured.value &&
        b06Settled.value &&
        typeof value.b06?.can_chat !== "boolean" &&
        value.access === null &&
        value.config?.rbacEnabled === true &&
        !presumedToChat(value)
      );
    });

    // Identity too, so a new org is probed even if `needsProbe` reads true on both sides of the switch.
    watch(
      [needsProbe, identity],
      ([need]) => {
        const id = identity.value;
        if (!need || !id || probed) return;
        probed = true;
        const asked = generation;
        void deps.probe(id.org).then(
          (result) => {
            if (asked !== generation || result === "unknown") return;
            persistAccess({ value: result, source: "probe" });
          },
          () => undefined,
        );
      },
      { immediate: true },
    );

    return {
      capability,
      gate,
      assistantCanChat: computed(() => CHAT_GATES.has(gate.value)),
      unknownNotice: computed(
        () => gate.value === "available" && capability.value.canChat === "unknown",
      ),
    };
  })!;

  return {
    ...handle,
    setIdentity(next) {
      if (next?.userOrgKey === identity.value?.userOrgKey && next?.org === identity.value?.org)
        return;
      generation += 1;
      probed = false;
      b06.value = null;
      b06At.value = 0;
      b06Settled.value = false;
      health.value = "unknown";
      creditMode.value = null;
      access.value = next ? readAccess(next.userOrgKey) : null;
      identity.value = next;
    },
    noteForbidden() {
      if (!identity.value) return;
      persistAccess({ value: "no", source: "cached_403" });
      // A 403 after `can_chat: true` holds "no" until a newer capabilities read says otherwise.
      deps.invalidateCapabilities(identity.value.org);
    },
    noteAgentUnavailable() {
      health.value = "down";
    },
    noteAdmitted() {
      health.value = "ok";
      if (identity.value && typeof b06.value?.can_chat !== "boolean")
        persistAccess({ value: "yes", source: "probe" });
    },
    dispose() {
      scope.stop();
    },
  };
}

function resolveCapability(input: CapabilityInput): AssistantCapability {
  const config = input.config;
  const chat = resolveChat(input);
  const gate = gateOf(input, chat.canChat);
  const persistence = !!config?.persistence;
  const canShare = resolveShare(input);
  const capability: AssistantCapability = {
    gate,
    edition: input.edition.isCloud ? "cloud" : input.edition.isEnterprise ? "ee" : "oss",
    configured: !!config?.aiEnabled,
    health: input.health,
    canChat: chat.canChat,
    canWrite: resolveWrite(input, chat.canChat),
    canShare,
    canShareRead: config && !config.rbacEnabled ? "yes" : "unknown",
    persistence,
    publicLinks: !!config?.publicLinks,
    publicMaxExpiryDays: config?.publicMaxExpiryDays ?? 0,
    isAdmin: input.isOrgAdmin === true || ADMIN_ROLES.has(input.role),
    rcaEnabled: !!config?.rcaEnabled,
    source: chat.source,
    reasonCode: gate,
  };
  if (typeof input.b06?.retention_days === "number")
    capability.retentionDays = input.b06.retention_days;
  if (input.b06?.attachments === true) capability.attachments = true;
  if (input.b06?.approval_extend === true) capability.approvalExtend = true;
  if (input.creditMode && input.edition.isCloud) capability.creditMode = input.creditMode;
  if (input.b06?.history_search === true) capability.historySearch = true;
  if (input.b06?.history_pins === true) capability.historyPins = true;
  if (input.b06?.history_import === true) capability.historyImport = true;
  if (input.b06?.turn_versions === true) capability.turnVersions = true;
  if (input.b06?.feedback_stored === true) capability.feedbackStored = true;
  if (input.b06?.rca_chat_mode === true) capability.rcaChatMode = true;
  if (gate !== "available") return capability;
  if (!persistence) capability.reasonCode = "local_only";
  else if (canShare === "no") capability.reasonCode = "no_share";
  return capability;
}

function gateOf(input: CapabilityInput, canChat: Tri): GateCode {
  const config = input.config;
  if (!config || !input.identified) return "loading";
  const access = checkFeatureAccess("aiAssistant", { ...input.edition, rbac: config.rbacEnabled });
  if (!access.allowed) return "not_entitled";
  if (!config.aiEnabled) return "not_configured";
  // The org setting is the server's call; without this a reload showed the generic copy.
  if (input.b06?.gate === "off_for_org") return "off_for_org";
  if (input.health === "down") return "unhealthy";
  return canChat === "no" ? "no_permission" : "available";
}

// The server says `unreachable` where this client says `down`; its `unknown` leaves the probe's answer alone.
function healthOf(status: unknown): AssistantCapability["health"] | null {
  if (status === "ok") return "ok";
  return status === "down" || status === "unreachable" ? "down" : null;
}

function resolveChat(input: CapabilityInput): {
  canChat: Tri;
  source: AssistantCapability["source"];
} {
  const b06Chat = input.b06?.can_chat;
  const deniedSince = input.access?.value === "no" && input.access.at >= input.b06At;
  if (typeof b06Chat === "boolean" && !deniedSince)
    return { canChat: b06Chat ? "yes" : "no", source: "capabilities" };
  if (input.access?.value === "no") return { canChat: "no", source: input.access.source };
  if (input.config && !input.config.rbacEnabled) return { canChat: "yes", source: "config" };
  if (presumedToChat(input)) return { canChat: "yes", source: "heuristic" };
  if (input.access?.value === "yes") return { canChat: "yes", source: input.access.source };
  return { canChat: "unknown", source: "heuristic" };
}

function resolveShare(input: CapabilityInput): Tri {
  const b06Share = input.b06?.can_share;
  if (typeof b06Share === "boolean") return b06Share ? "yes" : "no";
  if (input.config && !input.config.rbacEnabled) return "yes";
  if (input.isOrgAdmin !== undefined) return input.isOrgAdmin ? "yes" : "no";
  return "unknown";
}

function resolveWrite(input: CapabilityInput, canChat: Tri): Tri {
  const b06Write = input.b06?.can_write;
  if (canChat === "no") return "no";
  if (typeof b06Write === "boolean") return b06Write ? "yes" : "no";
  return input.config && !input.config.rbacEnabled ? "yes" : "unknown";
}

function presumedToChat(input: CapabilityInput): boolean {
  return input.isOrgAdmin === true || HEURISTIC_YES_ROLES.has(input.role);
}
