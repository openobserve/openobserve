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
import { flushPromises } from "@vue/test-utils";
import { vi, type Mock } from "vitest";
import { computed, defineComponent, h, ref, watch } from "vue";
import { createMemoryHistory, createRouter, type RouteRecordRaw } from "vue-router";
import { createStore } from "vuex";

import type {
  VoiceBrand,
  VoiceEngine,
  VoiceHandlers,
  VoiceListenOptions,
  VoiceMeter,
} from "@/components/ai-assistant/composer/voiceEngine";
import type { AssistantRuns, HistoryRow, RunRow } from "@/composables/assistant";
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
  rowIdFor,
  type HistoryDb,
  type LocalRecord,
} from "@/composables/assistant/historyDb";
import type { UseAssistantCapability } from "@/composables/assistant/useAssistantCapability";
import {
  createAssistantHistory,
  type HistoryDeps,
} from "@/composables/assistant/useAssistantHistory";
import { gt, raw } from "@/types/i18n";

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
      const id = await rowIdFor(record, async (at) => rows.get(at));
      const stored = rows.get(id);
      if (stored && stored.userOrgKey !== record.userOrgKey) return null;
      const next = mergeLocalRecord(stored, { ...structuredClone(record), id }, writer);
      rows.set(id, next);
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

/** Menus and overlays render inline so specs read items without driving reka's pointer events. */
export const historyStubs = {
  ODropdown: { template: '<div><slot name="trigger" /><div role="menu"><slot /></div></div>' },
  ODropdownItem: {
    props: ["iconLeft", "variant", "shortcutId"],
    emits: ["select"],
    template:
      '<div role="menuitem" v-bind="$attrs" :data-variant="variant" @click="$emit(\'select\', $event)"><slot /></div>',
  },
  ODropdownSub: {
    props: ["textValue"],
    template: '<div role="group"><slot name="trigger" /><slot /></div>',
  },
  ODropdownSeparator: { template: "<hr />" },
  OContextMenu: {
    props: ["disabled"],
    template: '<div class="contents"><slot name="trigger" /></div>',
  },
  OContextMenuItem: { template: "<span />" },
  OContextMenuSeparator: { template: "<span />" },
  OPopover: {
    props: ["open"],
    emits: ["update:open"],
    template:
      '<div><span @click="$emit(\'update:open\', !open)"><slot name="trigger" /></span><div v-if="open" data-stub="popover"><slot /></div></div>',
  },
  ODrawer: {
    props: ["open"],
    template: '<div v-if="open" data-stub="drawer"><slot /></div>',
  },
  ODialog: {
    props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "primaryButtonDisabled"],
    emits: ["update:open", "click:primary", "click:secondary"],
    template: `<div v-if="open" role="dialog" v-bind="$attrs">
      <h2>{{ title }}</h2><slot name="header" /><slot />
      <button data-stub="secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button data-stub="primary" :disabled="primaryButtonDisabled" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
    </div>`,
  },
};

export function historyRow(over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    sid: "0190a1b2-c3d4-7e5f-8a9b-00000000000a",
    chatId: 10,
    title: raw("Checkout 5xx spike"),
    titleSource: "generated",
    createdAt: Date.UTC(2026, 9, 21, 9, 0),
    updatedAt: Date.UTC(2026, 9, 21, 9, 30),
    origin: "none",
    originContainer: "sidebar",
    pinned: false,
    activeTurn: false,
    pendingApproval: false,
    share: null,
    local: false,
    ephemeral: false,
    agentType: null,
    ...over,
  };
}

export interface FakeVoiceEngine extends VoiceEngine {
  handlers: VoiceHandlers | null;
  options: VoiceListenOptions | null;
  meter: VoiceMeter & { db: number };
  abort: Mock<() => void>;
  /** The graceful stop a real recogniser offers; only a `graceful` engine has one. */
  stopSession: Mock<() => void>;
  graceful: boolean;
  rejectMic: Error | null;
  /** Resolves the pending microphone prompt when `holdPrompt` was set. */
  grant: (() => void) | null;
  holdPrompt: boolean;
  isAvailable: boolean;
  fakeBrand: VoiceBrand;
  onDevice: boolean;
}

/** A scripted recogniser: a spec drives `handlers` by hand, as `99`'s `speech` knob does in a browser. */
export function fakeVoiceEngine(): FakeVoiceEngine {
  const fake: FakeVoiceEngine = {
    handlers: null,
    options: null,
    meter: { db: -90, read: () => fake.meter.db, close: vi.fn() },
    abort: vi.fn(),
    stopSession: vi.fn(),
    graceful: false,
    rejectMic: null,
    grant: null,
    holdPrompt: false,
    isAvailable: true,
    fakeBrand: "chrome",
    onDevice: false,
    available: () => fake.isAvailable,
    brand: () => fake.fakeBrand,
    canRunOnDevice: async () => fake.onDevice,
    openMeter: () =>
      new Promise((resolve, reject) => {
        if (fake.rejectMic) return reject(fake.rejectMic);
        if (fake.holdPrompt) fake.grant = () => resolve(fake.meter);
        else resolve(fake.meter);
      }),
    listen(options, handlers) {
      fake.options = options;
      fake.handlers = handlers;
      return {
        start: vi.fn(),
        abort: fake.abort,
        ...(fake.graceful && { stop: fake.stopSession }),
      };
    },
  };
  return fake;
}

/** Stands in for a textbox: the caret and draft a controller reads, and the ends it reports. */
export function fakeVoiceTarget(initial = "", id = Symbol("target")) {
  const target = {
    id,
    text: initial,
    caret: initial.length,
    writes: [] as string[],
    ends: [] as unknown[],
    ready: true,
    read: () => ({ text: target.text, caret: target.caret }),
    write(text: string) {
      target.text = text;
      target.writes.push(text);
    },
    ended(end: unknown) {
      target.ends.push(end);
    },
    holdReady: () => target.ready,
    hold: vi.fn(),
  };
  return target;
}

// Host specs load the assistant's parts as async modules, so each stub is an ES module with a default.
const esModule = <T>(component: T) => ({ __esModule: true, default: component });

export const aiEntryButtonStub = esModule(
  defineComponent({
    name: "AiEntryButton",
    props: ["pressed", "dataTest", "dockHost", "build", "appearance", "handoff", "label"],
    emits: ["closed"],
    setup:
      (props, { emit }) =>
      () =>
        h(
          "button",
          {
            "data-test": props.dataTest,
            "data-appearance": props.appearance,
            "data-dock-host": props.dockHost ?? "",
            "aria-pressed": String(!!props.pressed),
            onClick: () => (props.handoff ? props.handoff() : emit("closed")),
          },
          String(props.label ?? ""),
        ),
  }),
);

export const assistantDockStub = esModule(
  defineComponent({
    name: "AssistantDock",
    props: ["host", "anchorAbove"],
    setup: (props) => () =>
      h("div", { "data-test": "assistant-dock-stub", "data-host": props.host.id }),
  }),
);

export const aiLabelStub = esModule(
  defineComponent({
    name: "AiLabel",
    props: ["state"],
    emits: ["revert", "ask-again"],
    setup:
      (props, { emit }) =>
      () =>
        h("div", { "data-test": "ai-label-editor", "data-status": props.state.status }, [
          h("button", {
            "data-test": "ai-label-revert",
            onClick: () => emit("revert", "original"),
          }),
        ]),
  }),
);

export const diffBlockStub = esModule(
  defineComponent({
    name: "AssistantDiffBlock",
    props: ["proposal"],
    setup: (props) => () =>
      h("div", { "data-test": "assistant-diff-block", "data-proposal-id": props.proposal.id }, [
        h("button", {
          "data-test": "assistant-diff-accept",
          onClick: () => props.proposal.accept(),
        }),
        h("button", {
          "data-test": "assistant-diff-reject",
          onClick: () => props.proposal.reject(),
        }),
      ]),
  }),
);

/** Lets the async assistant parts resolve and render. */
export async function settleAsyncParts(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await vi.dynamicImportSettled();
    await flushPromises();
  }
}

/** A row as the list builds it; specs name only what they test. */
export function runRow(sid: string, over: Partial<RunRow> = {}): RunRow {
  return {
    sid,
    org: "default",
    title: `Chat ${sid}` as RunRow["title"],
    group: "answering",
    status: "working",
    agent: null,
    at: 1_000,
    startedAt: 1_000,
    turnId: `t-${sid}`,
    request: null,
    expiresAt: null,
    extendsLeft: null,
    card: null,
    consent: false,
    otherOrg: false,
    stale: false,
    ...over,
  };
}

/** The runtime's list with writable rows, so a component spec drives it directly. */
export function fakeRuns(initial: RunRow[] = []) {
  const rows = ref<RunRow[]>(initial);
  const decisions = ref<RunRow[]>([]);
  const active = ref(0);
  const requested = ref(false);
  const runs = {
    rows: computed(() => rows.value),
    otherOrg: computed(() => rows.value.filter((row) => row.otherOrg)),
    cap: computed(() => 3),
    active: computed(() => active.value),
    needsCount: computed(() => rows.value.filter((row) => row.group === "needs_you").length),
    decisions: computed(() => decisions.value),
    openRequested: requested,
    requestOpen: vi.fn(async () => void (requested.value = true)),
    takeOpenRequest: vi.fn(() => void (requested.value = false)),
    stop: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    light: () => null,
    dispose: () => undefined,
  } satisfies AssistantRuns;
  return { runs, rows, decisions, active };
}
