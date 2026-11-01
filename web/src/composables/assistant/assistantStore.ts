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
  markRaw,
  reactive,
  ref,
  shallowRef,
  toRaw,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";

import useBreakpoint from "@/composables/useBreakpoint";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  type ChatMessage,
  type ImageAttachment,
} from "@/ts/interfaces/chat";
import type { I18nKey, I18nText } from "@/types/i18n";
import { getUUIDv7 } from "@/utils/uuid";

import { MAX_LEDGER } from "./actions/appliers/approval";
import { createAgentActions } from "./agentActions";
import { currentAgent } from "./agents";
import { ERROR_LEDGER } from "./assistantErrors";
import type {
  AssistantCapability,
  AssistantSession,
  AssistantState,
  AssistantStoreApi,
  AssistantStoreDeps,
  BlockAnnotation,
  ComposerSnapshot,
  ComposerState,
  Container,
  FloatingWindow,
  FocusedContainer,
  HistoryRow,
  HistoryService,
  Placement,
  RecordMeta,
  SessionOrigin,
  ShellState,
  Sid,
  TurnInput,
  WindowGeometry,
} from "./assistantStore.types";
import type { ContextChip } from "./context/types";
import { createDraftStore, type DraftPayload, type DraftStore } from "./drafts";
import {
  forgetTabs,
  markedUserOrgKeys,
  markTabAlive,
  pushRecall,
  readAnnotations,
  readPlacement,
  readRecall,
  readSidebar,
  readWindows,
  recallSelection,
  rememberSelection,
  removeAllSessionKeys,
  removeAnnotations,
  removeRecall,
  watchPrefs,
  writeAnnotation,
  writePlacement,
  writeSidebar,
  writeWindows,
  type RecallEntry,
} from "./prefs";
import type { TurnLockReason } from "./lifecycle";
import { getAssistantRuntime } from "./runtime";
import { SIDEBAR_MIN_REM } from "./sidebarWidth";
import { isTerminal, type TurnState, type TurnTerminal } from "./turnStates";
import { MAX_FLOATING_CHATS, cascadeGeometry, openWindowCap } from "./windows";

export { MAIN_MIN_REM, NAV_RAIL_REM, SIDEBAR_MIN_REM } from "./sidebarWidth";

export const MAX_CHIP_ROWS = 20;

export const MAX_CHIP_BYTES = 32 * 1024;

export const MAX_IMAGES = 4;

/** Above this many idle sessions the least recently used release their transcript (`00` §4.2 rule 10). */
export const IDLE_SESSION_LIMIT = 10;

export const UNDO_WINDOW_MS = 10_000;

/** Sign-out waits at most this long for this tab's turns to be stopped before it resets (`00` §12.3). */
export const SIGN_OUT_STOP_WAIT_MS = 300;

export const SIDEBAR_MAX_REM = 32;

const SIDEBAR_DEFAULT_MIN_REM = 22;

/** The running-chat limit until a typed 429 names the server's own (W-08). */
const DEFAULT_RUN_CAP = 3;

const ROW_KINDS: ReadonlySet<ContextChip["kind"]> = new Set(["log_row", "cell", "span"]);

// G0–G2: no placement, selection or draft key is written (`00` §4.2 rule 8).
const INERT_GATES: ReadonlySet<AssistantCapability["gate"]> = new Set([
  "loading",
  "not_entitled",
  "not_configured",
  "no_permission",
]);

const TITLE_RANK: Record<AssistantSession["titleSource"], number> = {
  generated: 0,
  object: 1,
  renamed: 2,
};

// One resize listener per page, shared by every store that reads the window's width.
const windowWidthRem = /* @__PURE__ */ ref(80);

let windowWidthTracked = false;

export type HeaderLightState = "needs_you" | "working" | "unread" | "open" | "idle";

/** This tab's light over the current user+org's sessions (`00` §12.2). */
export interface HeaderLight {
  state: HeaderLightState;
  sid: Sid | null;
  /** The unread answer failed: the light shows the failed glyph. */
  failed: boolean;
}

/** What a container renders beside the turn state (`00` §5.4); computed, never stored. */
export interface SessionView {
  running: boolean;
  elsewhere: boolean;
  doneNotSaved: boolean;
  needsYou: boolean;
  unread: boolean;
  visible: boolean;
}

export interface AssistantStoreIdentity {
  userOrgKey: string;
  org: string;
}

/** A one-shot request for the visible container to focus its composer (`95` §4). */
export interface FocusRequest {
  seq: number;
  target: "composer";
  /** The window that serves it; `null` is the primary container. */
  window: Sid | null;
  /** What held focus when the request was made; a container that mounts late serves it only while focus stays there. */
  from: WeakRef<Element> | null;
  /** A later open that asked for no focus voids this request for a container that has not served it yet. */
  superseded: boolean;
}

/** The turn region's next line (`95` §2). */
export interface AssistantAnnouncement {
  seq: number;
  sid: Sid;
  key: I18nKey;
  params?: Record<string, unknown>;
}

/** A window move the layer's status region speaks (`20` §6.1). */
export interface WindowAnnouncement {
  seq: number;
  key: I18nKey;
  title: I18nText | null;
  /** The chat a pin sent to the tray, named in the same sentence. */
  other?: I18nText | null;
}

/** `createSession`'s init; `messages` seeds a hand-off transcript on a new or reused blank session. */
export type SessionInit = Parameters<AssistantStoreApi["createSession"]>[0] & {
  messages?: ChatMessage[];
  /** A helper or analysis session: never saved, never listed, never the shell's active chat. */
  ephemeral?: boolean;
  /** A window's new chat: a real chat that leaves the primary container's alone. */
  detached?: boolean;
};

/** A chat read from history: its transcript, title and record fields as the server or this browser keeps them. */
export interface AdoptInit {
  chatId: number | null;
  title: I18nText | null;
  titleSource: AssistantSession["titleSource"];
  origin: SessionOrigin;
  messages: ChatMessage[];
  record: Partial<RecordMeta>;
}

/** `open`'s options; `sidebarCapRem` holds the sidebar's width for this open only. */
export type OpenOptions = Parameters<AssistantStoreApi["open"]>[1] & { sidebarCapRem?: number };

/** The store as the runtime and the doors see it: the binding API plus the seams later packages fill. */
export interface AssistantStoreInternal extends AssistantStoreApi {
  readonly drafts: DraftStore;
  readonly headerLight: ComputedRef<HeaderLight>;
  /** The cross-tab lock on starting a turn in `sid` (`null` for a chat not yet created). */
  turnLockOf(sid: Sid | null): TurnLockReason | null;
  readonly focusRequest: Readonly<Ref<FocusRequest | null>>;
  readonly announcement: Readonly<Ref<AssistantAnnouncement | null>>;
  readonly windowAnnouncement: Readonly<Ref<WindowAnnouncement | null>>;
  /** The window a chat is in, open or in the tray. */
  windowOf(sid: Sid | null | undefined): FloatingWindow | null;
  /** The chat in the most recently focused visible container, where a door lands. */
  frontSid(): Sid | null;
  /** Any chat shows: the primary container or an open window. */
  anyContainerVisible(): boolean;
  /** Open windows, most recently focused first. */
  windowsByRecency(): Sid[];
  raiseWindow(sid: Sid): void;
  setWindowGeometry(sid: Sid, geometry: WindowGeometry): void;
  /** A door or the Chats view puts another chat in this window; the one it held keeps running. */
  replaceWindowChat(windowSid: Sid, nextSid: Sid, opts?: { focus?: "composer" | "none" }): void;
  /** Opens a chat from a window's list in that window, or raises it where it already shows. */
  openInWindow(windowSid: Sid, target: { sid: Sid } | { chatId: number }): Promise<Sid>;
  /** Minimises the least recent windows over this width's cap; below 1024 px the values stay. */
  fitWindowsToViewport(): void;
  /** Focus goes to the next visible container's composer; false when none shows. */
  focusNextContainer(): boolean;
  noteFocusedContainer(container: FocusedContainer): void;
  createSession(init: SessionInit): Sid;
  open(target: Placement, opts: OpenOptions): void;
  setIdentity(identity: AssistantStoreIdentity | null): void;
  syncCapability(capability: AssistantCapability): void;
  /** The helper line a door left on the composer (`assistant.entry.*`); cleared by the next edit or send. */
  entryNotice(sid: Sid): I18nKey | null;
  setEntryNotice(sid: Sid, key: I18nKey | null): void;
  invokerOf(sid: Sid): HTMLElement | null;
  /** When the session's last turn ended, for the 30 min thread rule. */
  lastTurnAt(sid: Sid): number | null;
  /** Post-completion data on an immutable block (`00` §4.2 rule 10). */
  annotate(sid: Sid, blockId: string, patch: BlockAnnotation): void;
  /** A save in flight keeps the session from being released until it settles. */
  trackSave(sid: Sid, save: Promise<unknown>): void;
  /** Once per restore: the draft came back from storage and how many images it lost (CT-06 AC 3). */
  takeRestoredDraft(sid: Sid): { imageCount: number } | null;
  /** Resends the latest prompt as a new attempt; the composer draft is untouched (EB-09 AC 2). */
  regenerate(sid: Sid): Promise<TurnTerminal>;
  /** Sends an edited prompt as a new turn captioned "Edited from message {n}" (without B-12, EB-09 AC 4). */
  editResend(
    sid: Sid,
    edit: { text: string; chips: ContextChip[]; images: ImageAttachment[]; editedFrom: number },
  ): Promise<TurnTerminal>;
  /** The latest turn can still be retried with its snapshot (HT-03 AC 5). */
  canRetry(sid: Sid): boolean;
  /** Sends a prompt the user did not type in the composer (Re-run for now, a reply to a card); the draft is untouched. */
  resend(
    sid: Sid,
    snapshot: ComposerSnapshot,
    input: TurnInput,
    opts?: { replyToApproval?: string },
  ): Promise<TurnTerminal>;
  /** Cancels a turn this tab does not run, for `turn_busy`'s Stop it. */
  cancelTurn(sid: Sid, turnId: string | null): Promise<boolean>;
  /** Puts a chat read from history into the store, or refreshes its transcript when this tab is not running it. */
  adoptSession(sid: Sid, init: AdoptInit): void;
}

export interface AssistantStoreOptions {
  drafts?: DraftStore;
  /** Viewport width in rem, read reactively; defaults to the window's. */
  viewportRem?: () => number;
  /** The `userOrgKey` of every org of the signed-in user, so sign-out drops each org's recall. */
  signOutKeys?: () => Promise<string[]>;
  /** A session another tab of this browser runs or waits on; the light shows it when nothing here outranks it. */
  remoteLight?: () => { state: "needs_you" | "working"; sid: Sid } | null;
  /** The cross-tab lock on starting a turn in `sid`; every turn-starting entry point refuses while it holds. */
  turnLock?: (sid: Sid | null) => TurnLockReason | null;
}

export interface AssistantSessionView {
  session: ComputedRef<AssistantSession | null>;
  view: ComputedRef<SessionView | null>;
  composer: ComputedRef<ComposerState | null>;
  turn: ComputedRef<TurnState | null>;
  messages: ComputedRef<ChatMessage[]>;
  entryNotice: ComputedRef<I18nKey | null>;
  storageBlocked: Readonly<Ref<boolean>>;
  send(opts?: Parameters<AssistantStoreApi["send"]>[1]): Promise<TurnTerminal>;
  stop(): Promise<void>;
  retry(): Promise<TurnTerminal>;
  stage(payload: Parameters<AssistantStoreApi["stage"]>[1]): void;
  setDraft(patch: Partial<ComposerState>): void;
  addChip(chip: ContextChip): ReturnType<AssistantStoreApi["addChip"]>;
  removeChip(chipId: string): void;
  addImage(image: ImageAttachment): ReturnType<AssistantStoreApi["addImage"]>;
  removeImage(id: string): void;
  clearDraft(reason: "new_chat" | "org_switch"): string | null;
  undoClear(token: string): void;
  recall(direction: "older" | "newer"): void;
  toggleStep(callId: string): void;
  setFollow(follow: boolean): void;
  selectVersion(turnId: string, n: number): void;
  markRead(): void;
}

export interface AssistantPlacementView {
  placement: ComputedRef<Placement>;
  isVisible: ComputedRef<boolean>;
  container: ComputedRef<Container | null>;
  focusRequest: Readonly<Ref<FocusRequest | null>>;
  open: AssistantStoreInternal["open"];
  close: AssistantStoreApi["close"];
  moveTo: AssistantStoreApi["moveTo"];
}

interface UndoEntry {
  sid: Sid;
  userOrgKey: string;
  at: number;
  snapshot: ComposerSnapshot & { removedPageKeys: string[] };
}

/** Shared by the store's slices; never leaves this file. */
interface StoreCore {
  deps: AssistantStoreDeps;
  state: AssistantState;
  drafts: DraftStore;
  viewportRem(): number;
  turnLock(sid: Sid | null): TurnLockReason | null;
  /** Set by the window slice, so the viewport and identity paths announce the same way. */
  announceWindow(key: I18nKey, sid: Sid, other?: Sid): void;
  invokers: Map<Sid, WeakRef<HTMLElement>>;
  released: Set<Sid>;
  endedAt: Map<Sid, number>;
  savesPending: Map<Sid, number>;
  notices: Record<Sid, I18nKey>;
  /** Drafts restored from storage this page load, until the composer announces them once. */
  restoredDrafts: Map<Sid, { imageCount: number }>;
  focusRequest: Ref<FocusRequest | null>;
  /** Sids of this tab's windows, most recently focused first. */
  windowRecency: Sid[];
  /** Every user+org this store was bound to, for the sign-out purge. */
  identities: Set<string>;
  signOutKeys(): Promise<string[]>;
  session(sid: Sid | null | undefined): AssistantSession | undefined;
  writable(session: AssistantSession): boolean;
  persistDraft(session: AssistantSession): void;
  persistPlacement(): void;
  persistWindows(): void;
  setActive(sid: Sid | null): void;
  releaseIdle(): void;
}

/** The chat a mount renders in `sid`'s place after an HA restore moves a session to a new id. */
export function renameWindowSid(state: AssistantState, from: Sid, to: Sid): void {
  const { shell } = state;
  const win = shell.windows.find((w) => w.sid === from);
  if (win) win.sid = to;
  shell.trayOrder = shell.trayOrder.map((sid) => (sid === from ? to : sid));
  const focused = shell.lastFocusedContainer;
  if (focused && focused !== "sidebar" && focused.window === from)
    shell.lastFocusedContainer = { window: to };
}

export function createAssistantStore(
  deps: AssistantStoreDeps,
  options: AssistantStoreOptions = {},
): AssistantStoreInternal {
  const state = reactive<AssistantState>(initialState(options.viewportRem ?? windowRem));
  const core = createCore(deps, state, options);
  const sessions = createSessionSlice(core);
  const lifecycle = createLifecycleSlice(core, sessions.openSession);
  const store: AssistantStoreInternal = {
    state,
    drafts: core.drafts,
    headerLight: computed(() =>
      withRemoteLight(headerLightOf(state), options.remoteLight?.() ?? null),
    ),
    focusRequest: core.focusRequest,
    announcement: lifecycle.announcement,
    turnLockOf: (sid) => core.turnLock(sid),
    ...sessions,
    ...createPlacementSlice(core),
    ...createWindowSlice(core),
    ...createComposerSlice(core),
    ...createTurnSlice(core),
    ...lifecycle.api,
    ...createAgentActions(core, () => store.resend),
  };
  return store;
}

/** The inert services WP-02 ships; later packages replace them one by one in `runtime.ts`. */
export function inertAssistantDeps(
  overrides: Partial<AssistantStoreDeps> = {},
): AssistantStoreDeps {
  const refused: TurnTerminal = {
    state: "refused",
    error: { code: "unknown", phase: "pre_admission", retryable: false, action: "none" },
  };
  return {
    getOrg: () => null,
    getUser: () => null,
    now: () => Date.now(),
    uuid: () => getUUIDv7(),
    engine: {
      send: async () => refused,
      stop: async () => undefined,
      stopAll: async () => undefined,
      retry: async () => refused,
      continueTurn: () => undefined,
      retrySave: async () => undefined,
      setRequestBuilder: () => undefined,
      setConsentHandler: () => undefined,
    },
    history: inertHistory(),
    hints: {
      post: () => undefined,
      on: () => () => undefined,
      rebind: () => undefined,
      close: () => undefined,
    },
    approvals: {
      onConfirmationRequired: () => undefined,
      decide: async () => ({ status: "failed", items: [], resolvedBy: "", resolvedAt: Date.now() }),
      withdraw: async () => undefined,
      onResolved: () => undefined,
    },
    consent: {
      onConsentRequired: () => undefined,
      resolve: async () => undefined,
      cancel: () => undefined,
    },
    actions: { apply: async () => ({ ok: false, reason: "failed" }) },
    ...overrides,
  };
}

export function useAssistantStore(): AssistantStoreInternal {
  return getAssistantRuntime().store;
}

/** Computed slices and bound actions of one session; components never hold the session itself. */
export function useAssistantSession(
  sid: MaybeRefOrGetter<Sid | null>,
  store: AssistantStoreInternal = useAssistantStore(),
): AssistantSessionView {
  const current = () => toValue(sid);
  const session = computed(() => store.state.sessions[current() ?? ""] ?? null);
  const call = <R>(fallback: R, fn: (id: Sid) => R): R => {
    const id = current();
    return id ? fn(id) : fallback;
  };
  const refused = () => Promise.resolve(refusedUnknown());
  return {
    session,
    view: computed(() => (session.value ? sessionView(session.value, store.state.shell) : null)),
    composer: computed(() => session.value?.composer ?? null),
    turn: computed(() => session.value?.turn ?? null),
    messages: computed(() => session.value?.messages ?? []),
    entryNotice: computed(() => call(null, (id) => store.entryNotice(id))),
    storageBlocked: store.drafts.storageBlocked,
    send: (opts) => call(refused(), (id) => store.send(id, opts)),
    stop: () => call(Promise.resolve(), (id) => store.stop(id)),
    retry: () => call(refused(), (id) => store.retry(id)),
    stage: (payload) => call(undefined, (id) => store.stage(id, payload)),
    setDraft: (patch) => call(undefined, (id) => store.setDraft(id, patch)),
    addChip: (chip) => call({ ok: false, cap: "type" }, (id) => store.addChip(id, chip)),
    removeChip: (chipId) => call(undefined, (id) => store.removeChip(id, chipId)),
    addImage: (image) => call({ ok: false, cap: "type" }, (id) => store.addImage(id, image)),
    removeImage: (imageId) => call(undefined, (id) => store.removeImage(id, imageId)),
    clearDraft: (reason) => call(null, (id) => store.clearDraft(id, reason)),
    undoClear: (token) => call(undefined, (id) => store.undoClear(id, token)),
    recall: (direction) => call(undefined, (id) => store.recall(id, direction)),
    toggleStep: (callId) => call(undefined, (id) => store.toggleStep(id, callId)),
    setFollow: (follow) => call(undefined, (id) => store.setFollow(id, follow)),
    selectVersion: (turnId, n) => call(undefined, (id) => store.selectVersion(id, turnId, n)),
    markRead: () => call(undefined, (id) => store.markRead(id)),
  };
}

/** Placement as computed views; the breakpoint changes the rendering, never the value. */
export function useAssistantPlacement(
  store: AssistantStoreInternal = useAssistantStore(),
): AssistantPlacementView {
  const { lgUp } = useBreakpoint();
  const placement = computed(() => store.state.shell.placement);
  return {
    placement,
    isVisible: computed(() => store.anyContainerVisible()),
    container: computed(() => containerOf(placement.value, lgUp.value)),
    focusRequest: store.focusRequest,
    open: store.open,
    close: store.close,
    moveTo: store.moveTo,
  };
}

export function sessionView(session: AssistantSession, shell: ShellState): SessionView {
  const running = isRunning(session.turn);
  return {
    running,
    elsewhere: running && !session.turnMeta.ownedByThisTab,
    doneNotSaved: session.turn.state === "done" && session.turn.saved === "not_saved",
    needsYou: needsYou(session),
    unread: session.unread,
    visible:
      (shell.placement.kind !== "hidden" && shell.activeSid === session.sid) ||
      openWindowsOf(shell).some((w) => w.sid === session.sid),
  };
}

/** The windows on screen: the full view hides them all, and the tray is not visible. */
export function openWindowsOf(shell: ShellState): FloatingWindow[] {
  if (shell.placement.kind === "full") return [];
  return shell.windows.filter((w) => w.state === "open");
}

/** `needs_you > working > unread > open > idle` over this tab's sessions of the current user+org. */
export function headerLightOf(state: AssistantState): HeaderLight {
  // An ephemeral turn answers in its own surface (helper row, analysis tab), never through the header.
  const sessions = Object.values(state.sessions).filter(
    (s) => s.userOrgKey === state.userOrgKey && !s.record.ephemeral,
  );
  const waiting = sessions.find(needsYou);
  if (waiting) return { state: "needs_you", sid: waiting.sid, failed: false };
  const working = sessions.find((s) => isRunning(s.turn));
  if (working) return { state: "working", sid: working.sid, failed: false };
  const unread = sessions.find((s) => s.unread);
  if (unread) {
    const failed = unread.turn.state === "failed" || unread.turn.state === "refused";
    return { state: "unread", sid: unread.sid, failed };
  }
  if (state.shell.placement.kind !== "hidden")
    return { state: "open", sid: state.shell.activeSid, failed: false };
  const windowed = openWindowsOf(state.shell)[0];
  if (windowed) return { state: "open", sid: windowed.sid, failed: false };
  return { state: "idle", sid: null, failed: false };
}

/** Another tab's `needs_you` outranks this tab's `working`; its `working` outranks only `unread`, `open` and `idle`. */
export function withRemoteLight(
  local: HeaderLight,
  remote: { state: "needs_you" | "working"; sid: Sid } | null,
): HeaderLight {
  if (!remote || local.state === "needs_you") return local;
  if (remote.state === "needs_you" || local.state !== "working")
    return { state: remote.state, sid: remote.sid, failed: false };
  return local;
}

/** The telemetry and `context.client` container of a placement; below `lg` the sidebar and dock render as the sheet. */
export function containerOf(placement: Placement, lgUp: boolean): Container | null {
  if (placement.kind === "hidden") return null;
  if (placement.kind === "full") return "full_view";
  if (!lgUp) return "sheet";
  return placement.kind === "sidebar" ? "sidebar" : `docked.${placement.hostId}`;
}

export function isRunning(turn: TurnState): boolean {
  return turn.state !== "idle" && !isTerminal(turn);
}

function createCore(
  deps: AssistantStoreDeps,
  state: AssistantState,
  options: AssistantStoreOptions,
): StoreCore {
  const core: StoreCore = {
    deps,
    state,
    drafts: options.drafts ?? createDraftStore(),
    viewportRem: options.viewportRem ?? windowRem,
    turnLock: (sid) => options.turnLock?.(sid) ?? null,
    announceWindow: () => undefined,
    invokers: new Map(),
    released: new Set(),
    endedAt: new Map(),
    savesPending: new Map(),
    notices: reactive<Record<Sid, I18nKey>>({}),
    restoredDrafts: reactive(new Map<Sid, { imageCount: number }>()),
    focusRequest: shallowRef<FocusRequest | null>(null),
    windowRecency: [],
    identities: new Set(),
    signOutKeys: options.signOutKeys ?? (async () => []),
    session: (sid) => (sid ? state.sessions[sid] : undefined),
    // Rule 7: a write under another user+org than the session's captured key is refused.
    writable: (session) => state.ready && session.userOrgKey === state.userOrgKey,
    persistDraft(session) {
      // A helper or analysis request is never written anywhere, not even as a draft.
      if (!core.writable(session) || session.record.ephemeral) return;
      const { chips, timeOverride, removedPageKeys, images, mode, replyStash, homeStarter } = toRaw(
        session.composer,
      );
      const pendingAgent = session.nextAgentId ?? session.agentId;
      // A reply is not a draft: the one kept is the text Reply set aside.
      const text = mode === "reply" ? (replyStash ?? "") : session.composer.text;
      core.drafts.schedule(session.userOrgKey, session.sid, {
        text,
        chips,
        timeOverride,
        removedPageKeys,
        imageCount: images.length,
        ...(homeStarter && mode !== "reply" && { homeStarter: true }),
        ...(pendingAgent && { agentId: pendingAgent }),
      });
    },
    persistPlacement() {
      const { placement, previousPlacement } = state.shell;
      if (state.ready && state.userOrgKey)
        writePlacement(state.userOrgKey, { placement: { ...placement }, previousPlacement });
    },
    persistWindows() {
      if (state.ready && state.userOrgKey) writeWindows(state.userOrgKey, state.shell.windows);
    },
    setActive(sid) {
      if (sid && !state.sessions[sid]) return;
      state.shell.activeSid = sid;
      if (sid) {
        state.recent = [sid, ...state.recent.filter((id) => id !== sid)];
        if (state.shell.placement.kind !== "hidden") state.sessions[sid].unread = false;
      }
      if (state.ready && state.userOrgKey) rememberSelection(state.userOrgKey, sid);
      core.releaseIdle();
    },
    releaseIdle() {
      // A released transcript is re-read from history, so nothing is released while it cannot be.
      if (!deps.history.canReload.value) return;
      const holding = state.recent.filter((sid) => {
        const session = state.sessions[sid];
        return session && session.messages.length > 0 && isIdle(core, session);
      });
      for (const sid of holding.slice(IDLE_SESSION_LIMIT)) {
        state.sessions[sid].messages = [];
        core.released.add(sid);
      }
    },
  };
  return core;
}

function createSessionSlice(core: StoreCore) {
  const { state, deps } = core;
  const api: Pick<
    AssistantStoreInternal,
    | "createSession"
    | "openSession"
    | "dropSession"
    | "setTitle"
    | "setActive"
    | "markRead"
    | "lastTurnAt"
    | "annotate"
    | "trackSave"
    | "adoptSession"
  > = {
    createSession(init) {
      if (!state.ready || !state.userOrgKey) throw new Error("The assistant store is inert here");
      if (init.ephemeral) {
        const own = deps.uuid();
        state.sessions[own] = blankSession(own, state.userOrgKey, deps, init);
        return own;
      }
      if (init.detached) {
        const own = deps.uuid();
        state.sessions[own] = blankSession(own, state.userOrgKey, deps, init);
        state.recent = [own, ...state.recent];
        return own;
      }
      const active = core.session(state.shell.activeSid);
      if (active && active.userOrgKey === state.userOrgKey && isEmptySession(active)) {
        applyInit(active, init);
        return active.sid;
      }
      const sid = deps.uuid();
      state.sessions[sid] = blankSession(sid, state.userOrgKey, deps, init);
      core.setActive(sid);
      return sid;
    },
    async openSession(target, opts) {
      const known =
        "sid" in target
          ? core.session(target.sid)
          : Object.values(state.sessions).find((s) => s.chatId === target.chatId);
      // One chat, one container: a chat in a window comes forward there, unless the full view takes it.
      if (known && windowOf(state.shell, known.sid) && state.shell.placement.kind !== "full") {
        showWindow(core, known.sid, opts?.focus ? "composer" : "none");
        return known.sid;
      }
      if (known && !core.released.has(known.sid)) {
        removeWindow(core, known.sid);
        core.setActive(known.sid);
        if (opts?.focus) requestFocus(core);
        return known.sid;
      }
      try {
        const sid = await deps.history.open(target);
        core.released.delete(sid);
        restoreStoredDraft(core, sid);
        removeWindow(core, sid);
        core.setActive(sid);
        if (opts?.focus) requestFocus(core);
        return sid;
      } catch (err) {
        if (!known) throw err;
        known.record.historyUnavailable = true;
        core.setActive(known.sid);
        return known.sid;
      }
    },
    dropSession(sid) {
      const session = core.session(sid);
      if (!session) return;
      core.drafts.remove(session.userOrgKey, sid);
      delete state.sessions[sid];
      delete core.notices[sid];
      state.recent = state.recent.filter((id) => id !== sid);
      for (const map of [core.invokers, core.endedAt, core.savesPending]) map.delete(sid);
      core.released.delete(sid);
      removeWindow(core, sid);
      if (state.shell.activeSid === sid) core.setActive(null);
      if (state.shell.invoker?.sid === sid) state.shell.invoker = null;
    },
    adoptSession(sid, init) {
      const userOrgKey = state.userOrgKey;
      if (!userOrgKey) return;
      const known = core.session(sid);
      const session =
        known ?? blankSession(sid, userOrgKey, deps, { origin: init.origin, messages: [] });
      // A turn this tab streams owns the transcript; the history copy waits for its save.
      if (!known || !(isRunning(known.turn) && known.turnMeta.ownedByThisTab))
        session.messages = [...init.messages];
      Object.assign(session.record, init.record);
      if (init.chatId !== null) session.chatId = init.chatId;
      if (!known) session.origin = { ...init.origin };
      if (init.title !== null && TITLE_RANK[init.titleSource] >= TITLE_RANK[session.titleSource]) {
        session.title = init.title;
        session.titleSource = init.titleSource;
      } else if (session.title === null) session.title = init.title;
      if (!known) state.sessions[sid] = session;
    },
    setTitle(sid, title, source) {
      const session = core.session(sid);
      if (!session) return;
      if (session.title !== null && TITLE_RANK[source] < TITLE_RANK[session.titleSource]) return;
      session.title = title;
      session.titleSource = source;
    },
    setActive: (sid) => core.setActive(sid),
    markRead(sid) {
      const session = core.session(sid);
      if (session) session.unread = false;
    },
    lastTurnAt: (sid) => core.endedAt.get(sid) ?? core.session(sid)?.turnMeta.startedAt ?? null,
    annotate(sid, blockId, patch) {
      const session = core.session(sid);
      if (!session) return;
      const next = { ...session.annotations[blockId], ...patch };
      session.annotations[blockId] = next;
      writeAnnotation(session.userOrgKey, sid, blockId, next, deps.now());
    },
    trackSave(sid, save) {
      core.savesPending.set(sid, (core.savesPending.get(sid) ?? 0) + 1);
      void save
        .catch(() => undefined)
        .then(() => {
          const left = (core.savesPending.get(sid) ?? 1) - 1;
          if (left > 0) core.savesPending.set(sid, left);
          else core.savesPending.delete(sid);
          core.releaseIdle();
        });
    },
  };
  return api;
}

function createPlacementSlice(core: StoreCore) {
  const { state } = core;
  const apply = (target: Placement) => {
    const shell = state.shell;
    shell.previousPlacement = previousFor(shell.placement, target, shell.previousPlacement);
    shell.placement = { ...target };
    const active = core.session(shell.activeSid);
    if (active && target.kind !== "hidden") active.unread = false;
    if (target.kind === "sidebar") shell.lastFocusedContainer = "sidebar";
    core.persistPlacement();
  };
  const api: Pick<
    AssistantStoreInternal,
    "open" | "close" | "moveTo" | "setSidebarWidth" | "setSheetSnap" | "invokerOf"
  > = {
    open(target, opts) {
      if (!state.ready) return;
      if (target.kind === "hidden") return api.close("close");
      state.shell.sidebarCapRem = target.kind === "sidebar" ? (opts.sidebarCapRem ?? null) : null;
      if (opts.sid) {
        removeWindow(core, opts.sid);
        core.setActive(opts.sid);
      }
      const sid = state.shell.activeSid;
      if (opts.invoker && sid) {
        const el = new WeakRef(opts.invoker);
        core.invokers.set(sid, el);
        state.shell.invoker = markRaw({ el, sid });
      }
      apply(target);
      if (opts.focus === "composer") requestFocus(core);
      else supersedeFocus(core);
    },
    close(reason) {
      const { placement, previousPlacement } = state.shell;
      if (placement.kind === "hidden") return;
      const restore =
        placement.kind === "docked" || (placement.kind === "full" && reason === "route");
      // A docked chat closes with its editor, so its consent card goes too even when the chat lands in the sidebar.
      const sid = state.shell.activeSid;
      if (
        placement.kind === "docked" &&
        previousPlacement &&
        sid &&
        core.session(sid)?.pendingConsent
      )
        core.deps.consent.cancel(sid, "container_closed");
      state.shell.placement =
        restore && previousPlacement ? { ...previousPlacement } : { kind: "hidden" };
      state.shell.previousPlacement = null;
      state.shell.sidebarCapRem = null;
      if (
        state.shell.lastFocusedContainer === "sidebar" &&
        state.shell.placement.kind !== "sidebar"
      )
        state.shell.lastFocusedContainer = null;
      core.persistPlacement();
    },
    moveTo(target) {
      if (!state.ready) return;
      state.shell.sidebarCapRem = null;
      if (target.kind === "full" && state.shell.activeSid)
        removeWindow(core, state.shell.activeSid);
      apply(target);
    },
    setSidebarWidth(rem) {
      const max = Math.max(SIDEBAR_MIN_REM, core.viewportRem() / 2);
      const widthRem = Math.min(Math.max(rem, SIDEBAR_MIN_REM), max);
      state.shell.sidebarWidthRem = widthRem;
      if (state.ready && state.userOrgKey) writeSidebar(state.userOrgKey, { widthRem });
    },
    setSheetSnap(snap) {
      state.shell.sheetSnap = snap;
    },
    invokerOf: (sid) => core.invokers.get(sid)?.deref() ?? null,
  };
  return api;
}

function createWindowSlice(core: StoreCore) {
  const { state, deps } = core;
  const windowAnnouncement = shallowRef<WindowAnnouncement | null>(null);
  const announce = (key: I18nKey, sid: Sid, other?: Sid) => {
    windowAnnouncement.value = {
      seq: (windowAnnouncement.value?.seq ?? 0) + 1,
      key,
      title: core.session(sid)?.title ?? null,
      ...(other && { other: core.session(other)?.title ?? null }),
    };
  };
  core.announceWindow = announce;
  const api: Pick<
    AssistantStoreInternal,
    | "floatChat"
    | "pinChat"
    | "minimiseWindow"
    | "restoreWindow"
    | "closeWindow"
    | "raiseWindow"
    | "setWindowGeometry"
    | "replaceWindowChat"
    | "openInWindow"
    | "fitWindowsToViewport"
    | "focusNextContainer"
    | "noteFocusedContainer"
    | "windowOf"
    | "frontSid"
    | "anyContainerVisible"
    | "windowsByRecency"
    | "windowAnnouncement"
  > = {
    windowAnnouncement,
    floatChat(sid, opts = {}) {
      if (!state.ready) return { ok: false, reason: "no_room" };
      if (!core.session(sid)) return { ok: false, reason: "unknown_chat" };
      if (windowOf(state.shell, sid)) {
        showWindow(core, sid, opts.focus ?? "composer");
        return { ok: true };
      }
      if (openWindowCap(core.viewportRem()) === 0) return { ok: false, reason: "no_room" };
      if (state.shell.windows.length >= MAX_FLOATING_CHATS) return { ok: false, reason: "cap" };
      const geometry = opts.geometry ?? cascadeGeometry(state.shell.windows);
      if (state.shell.activeSid === sid) leavePrimary(core);
      state.shell.windows.push({ sid, state: "open", geometry: { ...geometry } });
      core.windowRecency = [sid, ...core.windowRecency];
      makeRoom(core, sid);
      state.shell.lastFocusedContainer = { window: sid };
      const session = core.session(sid);
      if (session) session.unread = false;
      core.persistWindows();
      announce("assistant.announce.floated", sid);
      if ((opts.focus ?? "composer") === "composer") requestFocus(core, sid);
      return { ok: true };
    },
    pinChat(sid) {
      if (!state.ready || !windowOf(state.shell, sid)) return;
      const shell = state.shell;
      const displaced = shell.placement.kind === "sidebar" ? shell.activeSid : null;
      const other = displaced && displaced !== sid ? core.session(displaced) : null;
      // A blank chat has nothing to keep, so the swap only moves a chat that has something in it.
      const swapped = other && !isEmptySession(other) ? other.sid : undefined;
      const geometry = windowOf(shell, sid)?.geometry;
      removeWindow(core, sid);
      if (swapped && geometry) {
        shell.windows.push({ sid: swapped, state: "minimised", geometry: { ...geometry } });
        shell.trayOrder.push(swapped);
      }
      core.setActive(sid);
      shell.previousPlacement = null;
      shell.placement = { kind: "sidebar" };
      shell.lastFocusedContainer = "sidebar";
      const session = core.session(sid);
      if (session) session.unread = false;
      core.persistPlacement();
      core.persistWindows();
      announce(
        swapped ? "assistant.announce.pinnedSwapped" : "assistant.announce.pinned",
        sid,
        swapped,
      );
      requestFocus(core);
    },
    minimiseWindow(sid, reason) {
      const win = windowOf(state.shell, sid);
      if (!win || win.state === "minimised") return;
      trayWindow(core, win);
      announce(
        reason === "make_room" ? "assistant.announce.madeRoom" : "assistant.announce.minimised",
        sid,
      );
      core.persistWindows();
    },
    restoreWindow(sid, opts = {}) {
      const win = windowOf(state.shell, sid);
      if (!win) return;
      const wasMinimised = win.state === "minimised";
      showWindow(core, sid, opts.focus ?? "composer");
      if (wasMinimised) announce("assistant.announce.restored", sid);
    },
    closeWindow(sid) {
      const session = core.session(sid);
      if (!windowOf(state.shell, sid)) return;
      if (session?.pendingConsent) deps.consent.cancel(sid, "container_closed");
      const running = !!session && isRunning(session.turn);
      announce(
        running ? "assistant.announce.windowClosedRunning" : "assistant.announce.windowClosed",
        sid,
      );
      removeWindow(core, sid);
    },
    raiseWindow(sid) {
      const win = windowOf(state.shell, sid);
      if (!win || win.state !== "open") return;
      core.windowRecency = [sid, ...core.windowRecency.filter((id) => id !== sid)];
      state.shell.lastFocusedContainer = { window: sid };
    },
    setWindowGeometry(sid, geometry) {
      const win = windowOf(state.shell, sid);
      if (!win) return;
      win.geometry = { ...geometry };
      core.persistWindows();
    },
    replaceWindowChat(windowSid, nextSid, opts = {}) {
      const win = windowOf(state.shell, windowSid);
      if (!win || !core.session(nextSid)) return;
      if (windowSid !== nextSid) {
        renameWindowSid(state, windowSid, nextSid);
        core.windowRecency = core.windowRecency.map((id) => (id === windowSid ? nextSid : id));
        core.persistWindows();
      }
      const session = core.session(nextSid);
      if (session) session.unread = false;
      if ((opts.focus ?? "composer") === "composer") requestFocus(core, nextSid);
      else supersedeFocus(core);
    },
    async openInWindow(windowSid, target) {
      const sid = await loadChat(core, target);
      if (sid === windowSid) return sid;
      if (windowOf(state.shell, sid)) {
        showWindow(core, sid, "composer");
        return sid;
      }
      if (state.shell.placement.kind !== "hidden" && state.shell.activeSid === sid) {
        requestFocus(core);
        return sid;
      }
      api.replaceWindowChat(windowSid, sid);
      return sid;
    },
    fitWindowsToViewport() {
      makeRoom(core, null);
      core.persistWindows();
    },
    focusNextContainer() {
      const nearest = nearestContainer(state.shell, core.windowRecency);
      if (!nearest) return false;
      state.shell.lastFocusedContainer = nearest;
      requestFocus(core, nearest === "sidebar" ? null : nearest.window);
      return true;
    },
    noteFocusedContainer(container) {
      state.shell.lastFocusedContainer = container;
    },
    windowOf: (sid) => windowOf(state.shell, sid),
    frontSid() {
      const nearest = nearestContainer(state.shell, core.windowRecency);
      return nearest && nearest !== "sidebar" ? nearest.window : state.shell.activeSid;
    },
    anyContainerVisible: () =>
      state.shell.placement.kind !== "hidden" || openWindowsOf(state.shell).length > 0,
    windowsByRecency() {
      const open = openWindowsOf(state.shell).map((w) => w.sid);
      const recent = core.windowRecency.filter((sid) => open.includes(sid));
      return [...recent, ...open.filter((sid) => !recent.includes(sid))];
    },
  };
  return api;
}

function createComposerSlice(core: StoreCore) {
  const { deps } = core;
  const undo = new Map<string, UndoEntry>();
  const edit = (sid: Sid, fn: (composer: ComposerState) => void) => {
    const session = core.session(sid);
    if (!session) return;
    fn(session.composer);
    core.persistDraft(session);
  };
  const api: Pick<
    AssistantStoreInternal,
    | "stage"
    | "setDraft"
    | "restoreDraft"
    | "addChip"
    | "removeChip"
    | "addBackChip"
    | "addImage"
    | "removeImage"
    | "setTimeOverride"
    | "startReply"
    | "cancelReply"
    | "clearDraft"
    | "undoClear"
    | "recall"
    | "toggleStep"
    | "setFollow"
    | "selectVersion"
    | "entryNotice"
    | "setEntryNotice"
    | "takeRestoredDraft"
  > = {
    stage(sid, payload) {
      edit(sid, (composer) => {
        for (const chip of payload.chips ?? []) {
          // The tray reads time from the override, so a door's Time chip becomes the composer's range.
          const range = doorRangeOf(chip);
          if (range) composer.timeOverride = range;
          else addChipTo(composer, chip);
        }
        if (payload.homeStarter) composer.homeStarter = true;
        else if (payload.text && payload.mode === "replace") composer.homeStarter = undefined;
        if (!payload.text) return;
        const keep = payload.mode === "append" && composer.text.trim() !== "";
        // A repeated door never doubles its prompt (`40` §4).
        if (keep && lastLine(composer.text) === payload.text.trim()) return;
        composer.text = keep ? `${composer.text}\n${payload.text}` : payload.text;
      });
    },
    setDraft(sid, patch) {
      if (patch.text !== undefined) delete core.notices[sid];
      edit(sid, (composer) => {
        Object.assign(composer, patch);
        if (patch.text !== undefined && !patch.text.trim()) composer.homeStarter = undefined;
      });
    },
    restoreDraft(sid, snapshot) {
      edit(sid, (composer) => {
        composer.text = snapshot.text;
        composer.chips = snapshot.chips.map((chip) => ({ ...chip }));
        composer.images = snapshot.images.map((image) => withImageId(image, deps.uuid));
        composer.timeOverride = snapshot.timeOverride ? { ...snapshot.timeOverride } : null;
        composer.homeStarter = snapshot.homeStarter;
      });
    },
    addChip(sid, chip) {
      const session = core.session(sid);
      if (!session) return { ok: false, cap: "type" };
      const result = addChipTo(session.composer, chip);
      core.persistDraft(session);
      return result;
    },
    removeChip(sid, chipId) {
      edit(sid, (composer) => {
        const chip = composer.chips.find((c) => c.id === chipId);
        if (!chip) return;
        composer.chips = composer.chips.filter((c) => c.id !== chipId);
        if (chip.provenance === "page" && !composer.removedPageKeys.includes(chip.kind))
          composer.removedPageKeys.push(chip.kind);
      });
    },
    addBackChip(sid, key) {
      edit(sid, (composer) => {
        composer.removedPageKeys = composer.removedPageKeys.filter((k) => k !== key);
      });
    },
    addImage(sid, image) {
      const composer = core.session(sid)?.composer;
      if (!composer) return { ok: false, cap: "type" };
      if (image.id && composer.images.some((i) => i.id === image.id)) return { ok: true };
      if (composer.images.length >= MAX_IMAGES) return { ok: false, cap: "images" };
      if (!ALLOWED_IMAGE_TYPES.includes(image.mimeType)) return { ok: false, cap: "type" };
      if (image.size > MAX_IMAGE_SIZE_BYTES) return { ok: false, cap: "size" };
      edit(sid, (current) => current.images.push(withImageId(image, deps.uuid)));
      return { ok: true };
    },
    removeImage(sid, id) {
      edit(sid, (composer) => {
        composer.images = composer.images.filter((i) => i.id !== id);
      });
    },
    setTimeOverride(sid, range) {
      edit(sid, (composer) => {
        composer.timeOverride = range ? { ...range } : null;
      });
    },
    // Reply takes an empty box; the draft under it comes back when Reply ends, whichever way.
    startReply(sid, approvalId) {
      edit(sid, (composer) => {
        if (composer.mode !== "reply") composer.replyStash = composer.text;
        composer.mode = "reply";
        composer.replyApprovalId = approvalId;
        composer.text = "";
      });
    },
    cancelReply(sid) {
      edit(sid, (composer) => {
        if (composer.mode === "reply") composer.text = composer.replyStash ?? "";
        composer.mode = "compose";
        delete composer.replyApprovalId;
        delete composer.replyStash;
      });
    },
    clearDraft(sid, reason) {
      const session = core.session(sid);
      if (!session) return null;
      const snapshot = {
        ...snapshotOf(session.composer),
        removedPageKeys: [...session.composer.removedPageKeys],
      };
      edit(sid, (composer) => Object.assign(composer, emptyComposer(deps.uuid())));
      delete core.notices[sid];
      // A draft never crosses orgs, so an org switch clears without Undo (`40` §9).
      if (reason === "org_switch") return null;
      for (const [stale, entry] of undo)
        if (deps.now() - entry.at > UNDO_WINDOW_MS) undo.delete(stale);
      const token = deps.uuid();
      undo.set(token, { sid, userOrgKey: session.userOrgKey, at: deps.now(), snapshot });
      return token;
    },
    undoClear(sid, token) {
      const entry = undo.get(token);
      undo.delete(token);
      const session = core.session(sid);
      if (!entry || !session || entry.userOrgKey !== session.userOrgKey) return;
      if (deps.now() - entry.at > UNDO_WINDOW_MS) return;
      edit(sid, (composer) => {
        composer.text = entry.snapshot.text;
        composer.chips = entry.snapshot.chips;
        composer.images = entry.snapshot.images;
        composer.timeOverride = entry.snapshot.timeOverride;
        composer.removedPageKeys = entry.snapshot.removedPageKeys;
      });
    },
    recall(sid, direction) {
      const session = core.session(sid);
      if (!session || !core.writable(session)) return;
      recallStep(session.composer, readRecall(session.userOrgKey), direction);
    },
    toggleStep(sid, callId) {
      const ui = core.session(sid)?.ui;
      if (!ui) return;
      ui.expandedSteps = ui.expandedSteps.includes(callId)
        ? ui.expandedSteps.filter((id) => id !== callId)
        : [...ui.expandedSteps, callId];
    },
    setFollow(sid, follow) {
      const ui = core.session(sid)?.ui;
      if (!ui) return;
      ui.follow = follow;
      if (follow) ui.unseen = 0;
    },
    selectVersion(sid, turnId, n) {
      const ui = core.session(sid)?.ui;
      if (ui) ui.activeVersion[turnId] = n;
    },
    entryNotice: (sid) => core.notices[sid] ?? null,
    takeRestoredDraft(sid) {
      const restored = core.restoredDrafts.get(sid) ?? null;
      core.restoredDrafts.delete(sid);
      return restored;
    },
    setEntryNotice(sid, key) {
      if (key) core.notices[sid] = key;
      else delete core.notices[sid];
    },
  };
  return api;
}

function createTurnSlice(core: StoreCore) {
  const { deps } = core;
  const inFlight = new Map<Sid, Promise<TurnTerminal>>();
  const settle = (
    sid: Sid,
    before: TurnState | undefined,
    sent: DraftPayload | null,
    terminal: TurnTerminal,
  ) => {
    const session = core.session(sid);
    core.endedAt.set(sid, deps.now());
    if (!session) return terminal;
    // A terminal the engine already wrote for this turn wins; one left from an earlier turn does not.
    if (!isTerminal(session.turn) || toRaw(session.turn) === before) session.turn = terminal;
    // Completed blocks are immutable; later changes go to `annotations` (`00` §4.2 rule 10).
    session.messages = session.messages.map((message) => markRaw(toRaw(message)));
    if (!shownNow(core, session)) session.unread = true;
    // A draft typed while the turn ran is not the one that was sent, so it stays.
    const stored = core.drafts.read(session.userOrgKey, sid);
    if (terminal.state !== "refused" && (!stored || isSentDraft(stored, sent)))
      core.drafts.remove(session.userOrgKey, sid);
    core.releaseIdle();
    return terminal;
  };
  // `send` and `retry` share one guard, so a second start of either joins the running one.
  const track = (sid: Sid, sent: DraftPayload | null, start: () => Promise<TurnTerminal>) => {
    const running = inFlight.get(sid);
    if (running) return running;
    const turn = core.session(sid)?.turn;
    const before = turn && toRaw(turn);
    const run = start()
      .then((terminal) => settle(sid, before, sent, terminal))
      .finally(() => inFlight.delete(sid));
    inFlight.set(sid, run);
    return run;
  };
  const api: Pick<
    AssistantStoreInternal,
    | "send"
    | "stop"
    | "retry"
    | "continueTurn"
    | "retrySave"
    | "decideApproval"
    | "resolveConsent"
    | "dispatch"
    | "markNotSaved"
    | "regenerate"
    | "editResend"
    | "resend"
    | "canRetry"
    | "cancelTurn"
  > = {
    send(sid, opts) {
      const session = core.session(sid);
      if (!session || !core.writable(session)) return Promise.resolve(refusedUnknown());
      const locked = refusedByLock(core.turnLock(sid));
      if (locked) return Promise.resolve(locked);
      const running = inFlight.get(sid);
      if (running) return running;
      // A new turn moves the conversation on, so a card still waiting is withdrawn first.
      if (session.pendingApproval) {
        session.turnMeta.withdrewApproval = true;
        void deps.approvals.withdraw(sid, "withdrawn");
      }
      delete core.notices[sid];
      rememberPrompt(core, session);
      const { text, chips, timeOverride, removedPageKeys } = toRaw(session.composer);
      const sent = { text, chips: [...chips], timeOverride, removedPageKeys: [...removedPageKeys] };
      return track(sid, sent, () => deps.engine.send(sid, opts));
    },
    // A card waiting on this turn is declined before the cancel, so no stale batch runs later.
    async stop(sid) {
      // An Enable on its way is answered first: a stop now could leave paid usage on behind a "not sent".
      if (deps.consent.busy?.(sid)) return deps.consent.cancel(sid, "stopped");
      if (core.session(sid)?.pendingApproval) await deps.approvals.withdraw(sid, "stopped");
      return deps.engine.stop(sid);
    },
    retry(sid) {
      const session = core.session(sid);
      if (!session || !core.writable(session)) return Promise.resolve(refusedUnknown());
      const locked = refusedByLock(core.turnLock(sid));
      if (locked) return Promise.resolve(locked);
      return track(sid, null, () => deps.engine.retry(sid));
    },
    continueTurn: (sid) => deps.engine.continueTurn(sid),
    retrySave: (sid, turnId) => deps.engine.retrySave(sid, turnId),
    regenerate(sid) {
      if (!core.session(sid)) return Promise.resolve(refusedUnknown());
      const locked = refusedByLock(core.turnLock(sid));
      if (locked) return Promise.resolve(locked);
      return track(sid, null, () => deps.engine.send(sid, { input: "regenerate" }));
    },
    editResend(sid, edit) {
      if (!core.session(sid)) return Promise.resolve(refusedUnknown());
      const locked = refusedByLock(core.turnLock(sid));
      if (locked) return Promise.resolve(locked);
      const snapshot: ComposerSnapshot = {
        text: edit.text,
        chips: edit.chips,
        images: edit.images,
        mentions: [],
        timeOverride: null,
      };
      return track(sid, null, () =>
        deps.engine.send(sid, { input: "edit_resend", snapshot, editedFrom: edit.editedFrom }),
      );
    },
    resend(sid, snapshot, input, opts) {
      if (!core.session(sid)) return Promise.resolve(refusedUnknown());
      const locked = refusedByLock(core.turnLock(sid));
      if (locked) return Promise.resolve(locked);
      const reply = opts?.replyToApproval;
      return track(sid, null, () =>
        deps.engine.send(sid, { input, snapshot, ...(reply && { replyToApproval: reply }) }),
      );
    },
    canRetry: (sid) => deps.engine.canRetry?.(sid) ?? false,
    cancelTurn: (sid, turnId) => deps.engine.cancelTurn?.(sid, turnId) ?? Promise.resolve(false),
    decideApproval: (sid, decision, approvalId) => deps.approvals.decide(sid, decision, approvalId),
    resolveConsent: (sid, accepted, acknowledged) =>
      deps.consent.resolve(sid, accepted, acknowledged),
    dispatch: (sid, action) => deps.actions.apply(sid, action),
    markNotSaved(sid) {
      const session = core.session(sid);
      if (session?.turn.state === "done") session.turn = { state: "done", saved: "not_saved" };
    },
  };
  return api;
}

function createLifecycleSlice(core: StoreCore, openSession: AssistantStoreApi["openSession"]) {
  const { state, deps } = core;
  const announcement = shallowRef<AssistantAnnouncement | null>(null);
  let announceSeq = 0;
  const restored = new Set<string>();
  let stopPrefsWatch: (() => void) | null = null;
  let windowsLoaded: string | null = null;

  const loadSidebarPrefs = () => {
    if (!state.userOrgKey) return;
    const stored = readSidebar(state.userOrgKey);
    if (typeof stored.widthRem === "number") state.shell.sidebarWidthRem = stored.widthRem;
  };

  // Sessions of the org switched back to are still here; only a reload needs them read again.
  const loadWindows = (userOrgKey: string) => {
    const stored = readWindows(userOrgKey).filter((win) => win.sid !== state.shell.activeSid);
    state.shell.windows = stored;
    state.shell.trayOrder = stored.filter((w) => w.state === "minimised").map((w) => w.sid);
    core.windowRecency = stored.filter((w) => w.state === "open").map((w) => w.sid);
    for (const { sid } of stored) {
      if (core.session(sid)) continue;
      void loadChat(core, { sid })
        .catch((err: unknown) => afterOpenFailed(core, sid, err))
        .finally(() => {
          if (state.userOrgKey === userOrgKey && !core.session(sid)) removeWindow(core, sid);
        });
    }
  };

  const restoreTab = (userOrgKey: string) => {
    if (restored.has(userOrgKey)) return;
    restored.add(userOrgKey);
    const tab = markTabAlive(userOrgKey);
    // A duplicated tab starts hidden with an empty draft; only a reload restores (SH-02 AC 7).
    if (tab.duplicated) {
      core.drafts.clearAllForUser(userOrgKey);
      writeWindows(userOrgKey, []);
      return;
    }
    const stored = readPlacement(userOrgKey);
    if (stored?.placement.kind === "sidebar") state.shell.placement = { ...stored.placement };
    else if (stored?.placement.kind === "docked" && stored.previousPlacement?.kind === "sidebar")
      state.shell.placement = { ...stored.previousPlacement };
    const selected = recallSelection(userOrgKey);
    if (selected)
      void openSession({ sid: selected }).catch((err: unknown) =>
        afterOpenFailed(core, selected, err),
      );
  };

  const updateReady = () => {
    const ready = !!state.userOrgKey && !INERT_GATES.has(state.capability.gate);
    state.ready = ready;
    if (!ready || !state.userOrgKey) return;
    restoreTab(state.userOrgKey);
    if (windowsLoaded === state.userOrgKey) return;
    windowsLoaded = state.userOrgKey;
    loadWindows(state.userOrgKey);
  };

  const api: Pick<
    AssistantStoreInternal,
    | "setIdentity"
    | "syncCapability"
    | "announce"
    | "applyHint"
    | "onOrgSwitch"
    | "onSignOut"
    | "reset"
  > = {
    setIdentity(identity) {
      if (identity?.userOrgKey === state.userOrgKey) return;
      stopPrefsWatch?.();
      stopPrefsWatch = null;
      state.userOrgKey = identity?.userOrgKey ?? null;
      // An org's windows leave with it and come back from its own stored list.
      clearWindows(core);
      windowsLoaded = null;
      if (identity) {
        core.identities.add(identity.userOrgKey);
        loadSidebarPrefs();
        stopPrefsWatch = watchPrefs(identity.userOrgKey, (name) => {
          if (name === "sidebar" && state.shell.placement.kind !== "sidebar") loadSidebarPrefs();
        });
      }
      updateReady();
    },
    syncCapability(capability) {
      state.capability = capability;
      updateReady();
    },
    announce(sid, key, params) {
      announceSeq += 1;
      announcement.value = { seq: announceSeq, sid, key, ...(params && { params }) };
    },
    applyHint(hint) {
      if (hint.type === "prefs_changed" && hint.key !== "prompt_history") loadSidebarPrefs();
    },
    async onOrgSwitch(next) {
      for (const sid of Object.keys(core.notices)) delete core.notices[sid];
      state.shell.activeSid = null;
      deps.hints.rebind(next.userOrgKey);
      return "proceed";
    },
    async onSignOut() {
      // Other tabs hear it first, so their own cancels race this tab's instead of following it.
      deps.hints.post({ v: 1, type: "signed_out", at: deps.now() });
      // The streams abort at once and the keepalive cancels are already posted; only the stopped states are awaited.
      const waited = new Promise((resolve) => setTimeout(resolve, SIGN_OUT_STOP_WAIT_MS));
      await Promise.race([deps.engine.stopAll("sign_out"), waited]);
      const orgKeys = await core.signOutKeys().catch(() => []);
      const keys = new Set([...core.identities, ...markedUserOrgKeys(), ...orgKeys]);
      forgetTabs(keys);
      restored.clear();
      for (const userOrgKey of keys) {
        core.drafts.clearAllForUser(userOrgKey);
        removeAllSessionKeys(userOrgKey);
        removeRecall(userOrgKey);
        removeAnnotations(userOrgKey);
      }
      core.identities.clear();
      api.reset();
      return "proceed";
    },
    reset() {
      for (const sid of Object.keys(state.sessions)) delete state.sessions[sid];
      for (const sid of Object.keys(core.notices)) delete core.notices[sid];
      state.recent = [];
      Object.assign(state.shell, {
        placement: { kind: "hidden" },
        previousPlacement: null,
        activeSid: null,
        invoker: null,
        sidebarCapRem: null,
      });
      clearWindows(core);
      windowsLoaded = null;
      for (const map of [core.invokers, core.endedAt, core.savesPending]) map.clear();
      core.released.clear();
    },
  };
  return { api, announcement };
}

function initialState(viewportRem: () => number): AssistantState {
  return {
    ready: false,
    userOrgKey: null,
    capability: initialCapability(),
    shell: {
      placement: { kind: "hidden" },
      previousPlacement: null,
      activeSid: null,
      sidebarWidthRem: defaultSidebarWidth(viewportRem()),
      sidebarCapRem: null,
      windows: [],
      trayOrder: [],
      lastFocusedContainer: null,
      sheetSnap: "half",
      invoker: null,
    },
    sessions: {},
    recent: [],
    history: {
      filter: { kind: "all", q: "" },
      cursor: null,
      hasMore: false,
      importState: "idle",
    },
    runs: { cap: DEFAULT_RUN_CAP, cleared: [] },
  };
}

function initialCapability(): AssistantCapability {
  return {
    gate: "loading",
    edition: "oss",
    configured: false,
    health: "unknown",
    canChat: "unknown",
    canWrite: "unknown",
    canShare: "unknown",
    canShareRead: "unknown",
    persistence: false,
    publicLinks: false,
    publicMaxExpiryDays: 0,
    isAdmin: false,
    rcaEnabled: false,
    source: "heuristic",
    reasonCode: "loading",
  };
}

function blankSession(
  sid: Sid,
  userOrgKey: string,
  deps: AssistantStoreDeps,
  init: SessionInit,
): AssistantSession {
  const annotations = readAnnotations(userOrgKey, sid);
  return {
    sid,
    chatId: chatIdOf(sid),
    userOrgKey,
    org: deps.getOrg()?.identifier ?? "",
    title: init.title ?? null,
    titleSource: init.title ? "object" : "generated",
    origin: { ...init.origin },
    messages: init.messages ? [...init.messages] : [],
    record: {
      serverBacked: false,
      cachedLastSeq: null,
      stateVersion: null,
      turnSpans: [],
      liveTurnId: null,
      liveSavedAt: null,
      forkedFromShare: null,
      historyUnavailable: false,
      ephemeral: init.ephemeral === true,
      pinned: false,
    },
    composer: emptyComposer(deps.uuid()),
    scroll: { top: "bottom" },
    ui: { expandedSteps: [], follow: true, unseen: 0, activeVersion: {} },
    turn: { state: "idle" },
    turnMeta: {
      turnId: null,
      serverTurnId: null,
      ownedByThisTab: true,
      startedAt: null,
      firstByteAt: null,
      traceId: null,
      lastSeq: null,
      usage: null,
      contextUsed: null,
    },
    pendingApproval: null,
    pendingConsent: null,
    // Votes, "Opened" lines, asked windows and approval records survive a reload in this browser.
    annotations,
    share: null,
    ledger: Object.values(annotations)
      .flatMap((annotation) => annotation.ledger ?? [])
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_LEDGER),
    unread: false,
  };
}

// A reused blank session takes the new door's origin and title, as a new one would.
function applyInit(session: AssistantSession, init: SessionInit): void {
  session.origin = { ...init.origin };
  session.title = init.title ?? null;
  session.titleSource = init.title ? "object" : "generated";
  if (init.messages?.length) session.messages = [...init.messages];
}

function emptyComposer(sendId: string): ComposerState {
  return {
    text: "",
    chips: [],
    images: [],
    recallIndex: -1,
    recallDraft: null,
    timeOverride: null,
    removedPageKeys: [],
    mode: "compose",
    sendId,
  };
}

function snapshotOf(composer: ComposerState): ComposerSnapshot {
  return {
    text: composer.text,
    chips: composer.chips.map((chip) => ({ ...toRaw(chip) })),
    images: [...composer.images],
    mentions: [],
    timeOverride: composer.timeOverride ? { ...composer.timeOverride } : null,
    removedPageKeys: [...composer.removedPageKeys],
    ...(composer.homeStarter && { homeStarter: true }),
  };
}

function doorRangeOf(chip: ContextChip): { from: number; to: number } | null {
  if (chip.kind !== "time" || chip.provenance !== "door") return null;
  const { from, to } = chip.ref ?? {};
  return typeof from === "number" && typeof to === "number" && to > from ? { from, to } : null;
}

function addChipTo(
  composer: ComposerState,
  chip: ContextChip,
): { ok: true } | { ok: false; cap: "rows" | "bytes" | "type" } {
  if (chip.kind === "image") return { ok: false, cap: "type" };
  if (composer.chips.some((c) => sameChip(c, chip))) return { ok: true };
  if (ROW_KINDS.has(chip.kind) && rowsOf(composer.chips) + rowsOf([chip]) > MAX_CHIP_ROWS)
    return { ok: false, cap: "rows" };
  const bytes = composer.chips.reduce((sum, c) => sum + c.sizeBytes, 0);
  if (bytes + chip.sizeBytes > MAX_CHIP_BYTES) return { ok: false, cap: "bytes" };
  composer.chips.push({ ...chip });
  if (chip.provenance === "page")
    composer.removedPageKeys = composer.removedPageKeys.filter((k) => k !== chip.kind);
  return { ok: true };
}

// A second activation of the same door is a no-op (`40` §4, round 1 X-21).
function sameChip(a: ContextChip, b: ContextChip): boolean {
  if (a.id === b.id) return true;
  if (a.kind !== b.kind || !a.ref?.id || !b.ref?.id) return false;
  return a.ref.type === b.ref.type && a.ref.id === b.ref.id && a.ref.org === b.ref.org;
}

function withImageId(image: ImageAttachment, uuid: () => string): ImageAttachment {
  return image.id ? { ...image } : { ...image, id: uuid() };
}

function lastLine(text: string): string {
  return text.slice(text.lastIndexOf("\n") + 1).trim();
}

function isSentDraft(stored: DraftPayload, sent: DraftPayload | null): boolean {
  const empty = !stored.text.trim() && stored.chips.length === 0;
  if (empty || !sent) return empty;
  const ids = (draft: DraftPayload) => draft.chips.map((chip) => chip.id).join("\n");
  return stored.text === sent.text && ids(stored) === ids(sent);
}

function rowsOf(chips: ContextChip[]): number {
  return chips
    .filter((chip) => ROW_KINDS.has(chip.kind))
    .reduce((sum, chip) => sum + (chip.count ?? 1), 0);
}

function recallStep(
  composer: ComposerState,
  entries: RecallEntry[],
  direction: "older" | "newer",
): void {
  const index = composer.recallIndex;
  if (direction === "older") {
    if (index + 1 >= entries.length) return;
    if (index === -1) composer.recallDraft = snapshotOf(composer);
    composer.recallIndex = index + 1;
    applyRecall(composer, entries[index + 1]);
    return;
  }
  if (index === -1) return;
  composer.recallIndex = index - 1;
  if (index - 1 >= 0) return applyRecall(composer, entries[index - 1]);
  const draft = composer.recallDraft;
  composer.recallDraft = null;
  if (!draft) return;
  applyRecall(composer, { text: draft.text, chips: draft.chips, at: 0 });
  composer.homeStarter = draft.homeStarter;
}

// A recalled prompt is the user's own question, so it never carries a Home starter's provenance.
function applyRecall(composer: ComposerState, entry: RecallEntry | undefined): void {
  if (!entry) return;
  composer.text = entry.text;
  composer.chips = entry.chips.map((chip) => ({ ...chip }));
  composer.homeStarter = undefined;
}

function rememberPrompt(core: StoreCore, session: AssistantSession): void {
  const text = session.composer.text.trim();
  if (!text || !core.writable(session)) return;
  const chips = toRaw(session.composer.chips).map((chip) => ({ ...chip }));
  pushRecall(session.userOrgKey, { text, chips, at: core.deps.now() });
}

function restoreStoredDraft(core: StoreCore, sid: Sid): void {
  const session = core.session(sid);
  if (!session || !core.writable(session) || session.composer.text) return;
  const draft = core.drafts.read(session.userOrgKey, sid);
  if (!draft) return;
  const { imageCount = 0, agentId, ...stored } = draft;
  Object.assign(session.composer, stored);
  // A pick survives a reload the way its draft does; on a chat with turns it is still only Next.
  if (agentId && session.messages.length === 0) session.agentId = agentId;
  else if (agentId && agentId !== currentAgent(session)) session.nextAgentId = agentId;
  session.composer.homeStarter = stored.homeStarter;
  core.restoredDrafts.set(sid, { imageCount });
}

// Only an unavailable history revives the chat; only a chat history calls gone (404) or forbidden (403) loses its draft (S9).
function afterOpenFailed(core: StoreCore, sid: Sid, err: unknown): void {
  // A chat that was never saved is not found, not deleted: its draft comes back on a blank chat.
  const notFound = (err as { code?: unknown } | null)?.code === "not_found";
  if (!core.deps.history.canReload.value || notFound) return reviveDraft(core, sid);
  const status = httpStatusOf(err);
  if ((status === 404 || status === 403) && core.state.userOrgKey)
    core.drafts.remove(core.state.userOrgKey, sid);
}

function httpStatusOf(err: unknown): number | undefined {
  const value = err as { status?: unknown; response?: { status?: unknown } } | null;
  const status = value?.status ?? value?.response?.status;
  return typeof status === "number" ? status : undefined;
}

// History cannot re-read this chat yet, so a stored draft comes back on a blank chat of the same id (CT-06 AC 3).
function reviveDraft(core: StoreCore, sid: Sid): void {
  const { state, deps } = core;
  const key = state.userOrgKey;
  if (!key || state.sessions[sid] || !core.drafts.read(key, sid)) return;
  state.sessions[sid] = blankSession(sid, key, deps, {
    origin: { entryKind: "empty_state", objectKind: "none", container: "sidebar" },
  });
  restoreStoredDraft(core, sid);
  core.setActive(sid);
}

function requestFocus(core: StoreCore, window: Sid | null = null): void {
  const active = typeof document === "undefined" ? null : document.activeElement;
  core.focusRequest.value = {
    seq: (core.focusRequest.value?.seq ?? 0) + 1,
    target: "composer",
    window,
    from: active ? new WeakRef(active) : null,
    superseded: false,
  };
}

// Keeps the seq, so a mounted container's seq watcher never fires for it.
function supersedeFocus(core: StoreCore): void {
  const request = core.focusRequest.value;
  if (request && !request.superseded) core.focusRequest.value = { ...request, superseded: true };
}

function windowOf(shell: ShellState, sid: Sid | null | undefined): FloatingWindow | null {
  return sid ? (shell.windows.find((w) => w.sid === sid) ?? null) : null;
}

function forgetWindowRefs(core: StoreCore, sid: Sid): void {
  const { shell } = core.state;
  core.windowRecency = core.windowRecency.filter((id) => id !== sid);
  const focused = shell.lastFocusedContainer;
  if (focused && focused !== "sidebar" && focused.window === sid)
    shell.lastFocusedContainer = nearestContainer(shell, core.windowRecency);
}

function removeWindow(core: StoreCore, sid: Sid): void {
  const { shell } = core.state;
  if (!windowOf(shell, sid)) return;
  shell.windows = shell.windows.filter((w) => w.sid !== sid);
  shell.trayOrder = shell.trayOrder.filter((id) => id !== sid);
  forgetWindowRefs(core, sid);
  core.persistWindows();
}

function clearWindows(core: StoreCore): void {
  const { shell } = core.state;
  shell.windows = [];
  shell.trayOrder = [];
  shell.lastFocusedContainer = null;
  core.windowRecency = [];
}

function trayWindow(core: StoreCore, win: FloatingWindow): void {
  const { shell } = core.state;
  win.state = "minimised";
  shell.trayOrder.push(win.sid);
  forgetWindowRefs(core, win.sid);
}

// The sidebar counts when it shows; else the most recently focused open window.
function nearestContainer(shell: ShellState, recency: readonly Sid[]): FocusedContainer {
  const open = openWindowsOf(shell);
  const focused = shell.lastFocusedContainer;
  if (focused && focused !== "sidebar" && open.some((w) => w.sid === focused.window))
    return focused;
  if (shell.placement.kind === "sidebar") return "sidebar";
  const recent = recency.find((sid) => open.some((w) => w.sid === sid)) ?? open[0]?.sid;
  return recent ? { window: recent } : null;
}

function leastRecentOpen(core: StoreCore, keep: Sid | null): FloatingWindow | undefined {
  const open = core.state.shell.windows.filter((w) => w.state === "open" && w.sid !== keep);
  const rank = (win: FloatingWindow) => {
    const at = core.windowRecency.indexOf(win.sid);
    return at < 0 ? Number.POSITIVE_INFINITY : at;
  };
  return [...open].sort((a, b) => rank(b) - rank(a))[0];
}

// Auto-minimise never moves focus (`95` §4); below 1024 px the values stay for when the window grows.
function makeRoom(core: StoreCore, keep: Sid | null): void {
  const cap = openWindowCap(core.viewportRem());
  if (cap === 0) return;
  const { shell } = core.state;
  while (shell.windows.filter((w) => w.state === "open").length > cap) {
    const win = leastRecentOpen(core, keep);
    if (!win) return;
    trayWindow(core, win);
    core.announceWindow("assistant.announce.madeRoom", win.sid);
  }
}

// Raises an open window or brings one back from the tray, keeping the cap.
function showWindow(core: StoreCore, sid: Sid, focus: "composer" | "none"): void {
  const { shell } = core.state;
  const win = windowOf(shell, sid);
  if (!win) return;
  if (win.state === "minimised") {
    win.state = "open";
    shell.trayOrder = shell.trayOrder.filter((id) => id !== sid);
  }
  core.windowRecency = [sid, ...core.windowRecency.filter((id) => id !== sid)];
  shell.lastFocusedContainer = { window: sid };
  makeRoom(core, sid);
  const session = core.session(sid);
  if (session) session.unread = false;
  core.persistWindows();
  if (focus === "composer") requestFocus(core, sid);
  else supersedeFocus(core);
}

// A move out of the primary container is not a close, so no consent card is cancelled and no focus returns.
function leavePrimary(core: StoreCore): void {
  const { shell } = core.state;
  shell.placement = { kind: "hidden" };
  shell.previousPlacement = null;
  shell.sidebarCapRem = null;
  core.setActive(null);
  core.persistPlacement();
}

async function loadChat(core: StoreCore, target: { sid: Sid } | { chatId: number }): Promise<Sid> {
  const known =
    "sid" in target
      ? core.session(target.sid)
      : Object.values(core.state.sessions).find((s) => s.chatId === target.chatId);
  if (known && !core.released.has(known.sid)) return known.sid;
  const sid = await core.deps.history.open(target);
  core.released.delete(sid);
  restoreStoredDraft(core, sid);
  return sid;
}

// Below `lg` only the chat in front shows, through the sheet.
function shownNow(core: StoreCore, session: AssistantSession): boolean {
  const { shell } = core.state;
  if (!sessionView(session, shell).visible) return false;
  if (openWindowCap(core.viewportRem()) > 0 || !windowOf(shell, session.sid)) return true;
  return shell.placement.kind === "hidden" && core.windowRecency[0] === session.sid;
}

function isIdle(core: StoreCore, session: AssistantSession): boolean {
  const { composer, turn } = session;
  return (
    session.sid !== core.state.shell.activeSid &&
    !windowOf(core.state.shell, session.sid) &&
    !isRunning(turn) &&
    !composer.text &&
    composer.chips.length === 0 &&
    composer.images.length === 0 &&
    !session.pendingApproval &&
    !session.pendingConsent &&
    !(turn.state === "done" && turn.saved === "not_saved") &&
    !core.savesPending.has(session.sid)
  );
}

function isEmptySession(session: AssistantSession): boolean {
  const { composer } = session;
  return (
    session.messages.length === 0 &&
    session.turn.state === "idle" &&
    !composer.text.trim() &&
    composer.chips.length === 0 &&
    composer.images.length === 0
  );
}

function needsYou(session: AssistantSession): boolean {
  const state = session.turn.state;
  return (
    state === "awaiting_approval" ||
    state === "awaiting_consent" ||
    !!session.pendingApproval ||
    !!session.pendingConsent
  );
}

function previousFor(from: Placement, to: Placement, previous: Placement | null): Placement | null {
  if (to.kind === "docked") return from.kind === "docked" ? previous : { ...from };
  if (to.kind !== "full") return null;
  return from.kind === "sidebar" || from.kind === "hidden" ? { ...from } : previous;
}

// The milliseconds prefix of a UUIDv7 is the IndexedDB chat id (`00` §4.1).
function chatIdOf(sid: Sid): number | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7/i.test(sid)) return null;
  return parseInt(sid.replace(/-/g, "").slice(0, 12), 16);
}

function defaultSidebarWidth(viewportRem: number): number {
  return Math.min(Math.max(viewportRem * 0.3, SIDEBAR_DEFAULT_MIN_REM), SIDEBAR_MAX_REM);
}

function windowRem(): number {
  if (typeof window === "undefined") return windowWidthRem.value;
  if (!windowWidthTracked) {
    windowWidthTracked = true;
    const read = () => {
      windowWidthRem.value = window.innerWidth / 16;
    };
    read();
    window.addEventListener("resize", read, { passive: true });
  }
  return windowWidthRem.value;
}

function refusedByLock(reason: TurnLockReason | null): TurnTerminal | null {
  if (!reason) return null;
  const code =
    reason === "signed_out"
      ? "session_expired"
      : reason === "account_changed"
        ? "account_changed"
        : "approval_elsewhere";
  return { state: "refused", error: { code, ...ERROR_LEDGER[code] } };
}

function refusedUnknown(): TurnTerminal {
  return {
    state: "refused",
    error: { code: "unknown", phase: "pre_admission", retryable: false, action: "none" },
  };
}

function inertHistory(): HistoryService {
  const none = computed<HistoryRow[]>(() => []);
  const unavailable = () => {
    throw new Error("History is not available yet");
  };
  return {
    open: async () => unavailable(),
    create: () => unavailable(),
    recent: () => none,
    save: async () => "not_saved" as const,
    rename: async () => ({ ok: true }) as const,
    pin: async () => ({ ok: true }) as const,
    remove: async () => ({ ok: true }) as const,
    clearAll: async () => ({ ok: true }) as const,
    importLocal: async function* () {
      yield* [];
    },
    rows: none,
    canReload: computed(() => false),
    mode: computed<"server" | "local">(() => "local"),
    hasMore: computed(() => false),
    loadOlder: async () => undefined,
  };
}
