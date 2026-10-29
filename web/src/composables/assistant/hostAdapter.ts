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
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowReactive,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";

import { contextRegistry } from "@/composables/contextProviders/registry";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { I18nText } from "@/types/i18n";

import type {
  AssistantHostAdapter,
  DockHostId,
  HostRegistry,
  InlineHostAdapter,
  OpenAssistantArgs,
  OpenAssistantResult,
  ProposalHostId,
} from "./assistantStore.types";
import type { PageContext } from "./context/types";
import type { OpenAssistantCall } from "./openAssistant";
import { ensureRuntime, runtimeHandle } from "./runtimeHandle";
import {
  proposalFor,
  useEditorProposal,
  type EditorBinding,
  type EditorProposal,
} from "./useEditorProposal";

/** The context key a host pushes; one per host id, so a nested editor never replaces its parent's entry. */
export const DOCK_CONTEXT_PREFIX = "assistant-dock:";

/** A form provides the name of the object it edits, so a nested editor titles its dock thread with it. */
export const assistantObjectNameKey: InjectionKey<Readonly<Ref<string>>> =
  /* @__PURE__ */ Symbol("assistantObjectName");

/** Every mounted dock host, read through the runtime's handle so importing this module builds nothing. */
export const hostRegistry: HostRegistry = /* @__PURE__ */ lazyHostRegistry();

// The width each open dock measured for itself, in rem; width readers and the host's reflow read it.
const dockWidths = /* @__PURE__ */ shallowReactive(new Map<DockHostId, number>());

/** A door that navigates to a host leaves its prompt here; the host stages it once on arrival. */
export const QUEUED_STAGE_MS = 30_000;

// Prompts waiting for their host to mount; module scope so the navigation in between keeps them.
const queuedStages = new Map<DockHostId, QueuedStage>();

export interface AssistantDockHost {
  open(): Promise<OpenAssistantResult>;
  close(): void;
  isOpen: ComputedRef<boolean>;
  widthRem: ComputedRef<number>;
  /** The toggle's payload: no chips, only the object's title, so the thread follows the object. */
  build(): NonNullable<OpenAssistantArgs["payload"]>;
  /** Ask again from the label: the prompt goes back into this host's chat, unsent. */
  askAgain(prompt: string): Promise<OpenAssistantResult>;
  /** Stages a prompt into this host's dock (the regex hand-off); never sends. */
  stage(
    payload: NonNullable<OpenAssistantArgs["payload"]>,
    call: Pick<OpenAssistantArgs, "entryKind" | "objectKind">,
  ): Promise<OpenAssistantResult>;
}

export interface AssistantDockHostOptions {
  /** False on a page that opens the sidebar instead (the functions page): the context is pushed, nothing docks. */
  dock?: boolean;
  /** A host mounted while hidden (a closed drawer) registers only while this is true. */
  active?: () => boolean;
}

/** A host editor in one call: the adapter fields it owns, how text lands, and the dock options. */
export interface DockedEditorConfig extends Omit<
  AssistantHostAdapter,
  "language" | "previewInsert" | "revert" | "dockSlot"
> {
  language(): AssistantHostAdapter["language"];
  write: EditorBinding["write"];
  /** The editor area the diff covers. */
  area?(): HTMLElement | null;
}

export interface DockedEditor {
  adapter: AssistantHostAdapter;
  proposal: EditorProposal;
  dock: AssistantDockHost;
  /** The host's body row; the dock is its last child. */
  dockSlot: Ref<HTMLElement | null>;
}

/** What a host hands its query editor for the inline helper; the editor supplies the buffer, language and focus. */
export type QueryEditorAssistant = Omit<
  InlineHostAdapter,
  "language" | "getBuffer" | "previewInsert" | "focusEditor" | "id"
> & {
  id: ProposalHostId;
  /** A docked host's own controller: the host already renders its diff and label. */
  proposal?: EditorProposal;
};

interface QueuedStage {
  payload: NonNullable<OpenAssistantArgs["payload"]>;
  call: Pick<OpenAssistantArgs, "entryKind" | "objectKind">;
  at: number;
}

/** One host's docked chat: registers the adapter, pushes its context and closes the dock when the host goes away. */
export function useAssistantDockHost(
  adapter: AssistantHostAdapter,
  options: AssistantDockHostOptions = {},
): AssistantDockHost {
  const docks = options.dock !== false;
  const handle = runtimeHandle();
  const key = `${DOCK_CONTEXT_PREFIX}${adapter.id}`;
  const isOpen = computed(() => docks && isDockOpenFor(adapter));
  const widthRem = computed(() => (isOpen.value ? (dockWidths.get(adapter.id) ?? 0) : 0));
  const active = computed(() => options.active?.() ?? true);
  // A host shown before any assistant surface builds the runtime itself, out of its own chunk.
  const ready = computed(() => !!handle.value);
  let mounted = false;
  let attached = false;

  const attach = () => {
    const runtime = handle.value;
    if (attached || !runtime) return;
    attached = true;
    contextRegistry.push(key, { getContext: () => hostContext(key, adapter) });
    if (!docks) return;
    runtime.hosts.register(adapter);
    const queued = queuedStages.get(adapter.id);
    queuedStages.delete(adapter.id);
    if (queued && Date.now() - queued.at < QUEUED_STAGE_MS)
      void nextTick(() => stage(queued.payload, queued.call));
  };
  const detach = () => {
    const runtime = handle.value;
    if (!attached) return;
    attached = false;
    contextRegistry.pop(key);
    // A host that hides without unmounting (a closed dialog) settles its proposal, so the chat's Insert never hangs.
    proposalFor(adapter.id)?.discard();
    if (!docks || !runtime || runtime.hosts.get(adapter.id) !== adapter) return;
    const wasOpen = isOpen.value;
    runtime.hosts.unregister(adapter.id);
    dockWidths.delete(adapter.id);
    if (!wasOpen) return;
    trackAssistant("ai_container_closed", { reason: "host_closed" });
    runtime.store.close("host_closed");
  };

  onMounted(() => {
    mounted = true;
    if (!handle.value) void ensureRuntime();
    if (active.value) attach();
  });
  watch([active, ready], ([on]) => {
    if (!mounted) return;
    if (on) attach();
    else detach();
  });
  onBeforeUnmount(() => {
    mounted = false;
    detach();
  });

  const build = () => ({ chips: [], title: adapter.objectTitle() });
  const open = (call: OpenAssistantCall) =>
    ensureRuntime().then((runtime) => runtime.openAssistant(call));
  const stage = (
    payload: NonNullable<OpenAssistantArgs["payload"]>,
    call: Pick<OpenAssistantArgs, "entryKind" | "objectKind">,
  ) =>
    open({
      ...callFor(adapter, docks, {
        intent: "stage",
        payload: { ...payload, title: adapter.objectTitle() },
      }),
      entryKind: call.entryKind,
      objectKind: call.objectKind,
      thread: "new",
    } as OpenAssistantCall);

  return {
    isOpen,
    widthRem,
    build,
    open: () => open(callFor(adapter, docks, { intent: "open", payload: build() })),
    close() {
      if (!isOpen.value) return;
      trackAssistant("ai_container_closed", { reason: "close" });
      handle.value?.store.close("close");
    },
    stage,
    askAgain: (prompt) =>
      open(
        callFor(adapter, docks, {
          intent: "stage",
          payload: { chips: [], text: prompt, title: adapter.objectTitle() },
        }),
      ),
  };
}

/** The toggle of a host whose adapter lives in a child editor (the JSON drawers, the query node). */
export function useAssistantDockToggle(hostId: DockHostId): {
  pressed: ComputedRef<boolean>;
  build(): NonNullable<OpenAssistantArgs["payload"]>;
  close(): void;
} {
  const handle = runtimeHandle();
  return {
    pressed: computed(() => isDockOpen(hostId) && !!handle.value?.hosts.has(hostId)),
    build: () => ({ chips: [], ...titleOf(handle.value?.hosts.get(hostId)) }),
    close() {
      if (!isDockOpen(hostId)) return;
      trackAssistant("ai_container_closed", { reason: "close" });
      handle.value?.store.close("close");
    },
  };
}

/** Builds a host's adapter, its Insert-as-diff proposal and its dock together. */
export function useDockedEditor(
  config: DockedEditorConfig,
  options: AssistantDockHostOptions = {},
): DockedEditor {
  const dockSlot = ref<HTMLElement | null>(null);
  const { language, write, area, ...fields } = config;
  let proposal: EditorProposal | null = null;
  const adapter: AssistantHostAdapter = {
    ...fields,
    get language() {
      return language();
    },
    previewInsert: (text, mode) =>
      proposal!.propose(text, { mode, provenance: { prompt: "" }, canRun: !!config.run }),
    revert: () => proposal?.revert("original"),
    dockSlot,
  };
  proposal = useEditorProposal(adapter, { write, ...(area && { area }) });
  return { adapter, proposal, dock: useAssistantDockHost(adapter, options), dockSlot };
}

/** Leaves a prompt for `hostId`'s dock; the host stages it once when it mounts (within 30 s). */
export function queueDockStage(
  hostId: DockHostId,
  payload: NonNullable<OpenAssistantArgs["payload"]>,
  call: Pick<OpenAssistantArgs, "entryKind" | "objectKind">,
): void {
  queuedStages.set(hostId, { payload, call, at: Date.now() });
}

/** True while `hostId`'s dock is the visible container. */
export function isDockOpen(hostId: ProposalHostId): boolean {
  const placement = runtimeHandle().value?.store.state.shell.placement;
  return placement?.kind === "docked" && placement.hostId === hostId;
}

/** Focuses the open dock's composer, for the editor's own chord; false when that dock is not open. */
export function focusDockComposer(hostId: ProposalHostId): boolean {
  if (!isDockOpen(hostId)) return false;
  const composer = document.querySelector<HTMLElement>(
    `[data-assistant-root][data-placement="docked"][data-host="${hostId}"] [data-assistant-composer]`,
  );
  composer?.focus();
  return !!composer;
}

/** The dock reports its measured width, so the host's reflow and the width readers follow it. */
export function reportDockWidth(hostId: DockHostId, rem: number): void {
  if (rem > 0) dockWidths.set(hostId, rem);
  else dockWidths.delete(hostId);
}

export function openDockWidthRem(): number {
  const placement = runtimeHandle().value?.store.state.shell.placement;
  return placement?.kind === "docked" ? (dockWidths.get(placement.hostId) ?? 0) : 0;
}

function titleOf(adapter: AssistantHostAdapter | undefined): { title?: I18nText } {
  return adapter ? { title: adapter.objectTitle() } : {};
}

function isDockOpenFor(adapter: AssistantHostAdapter): boolean {
  return isDockOpen(adapter.id) && runtimeHandle().value?.hosts.get(adapter.id) === adapter;
}

function callFor(
  adapter: AssistantHostAdapter,
  docks: boolean,
  call: { intent: "open" | "stage"; payload?: OpenAssistantArgs["payload"] },
): OpenAssistantCall {
  return {
    entryKind: "editor_toggle",
    entryVerb: "ask",
    objectKind: adapter.objectKind,
    intent: call.intent,
    thread: "current",
    container: docks ? "docked" : "sidebar",
    ...(docks && { dockHost: adapter.id }),
    ...(call.payload && { payload: call.payload }),
  };
}

// The host's fields sit over the page's, so the tray shows the editor first and the page's time and org still travel.
async function hostContext(key: string, adapter: AssistantHostAdapter): Promise<PageContext> {
  const base = await contextRegistry.getContextBelow(key).catch(() => null);
  return { ...(base ?? { currentPage: adapter.id }), ...adapter.getContext() } as PageContext;
}

function lazyHostRegistry(): HostRegistry {
  const hosts = () => runtimeHandle().value?.hosts;
  let mounted: ComputedRef<DockHostId[]> | null = null;
  return {
    register: (adapter) => hosts()?.register(adapter),
    unregister: (id) => hosts()?.unregister(id),
    get: (id) => hosts()?.get(id),
    has: (id) => !!hosts()?.has(id),
    get mounted() {
      mounted ??= computed(() => hosts()?.mounted.value ?? []);
      return mounted;
    },
  };
}
