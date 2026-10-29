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

import type { RouteLocationRaw } from "vue-router";

import { toast } from "@/lib/feedback/Toast/useToast";
import {
  trackAssistant,
  type AiEventProps,
  type LengthBucket,
} from "@/services/assistantAnalytics";
import { gt, raw, type I18nKey } from "@/types/i18n";

import {
  MAIN_MIN_REM,
  SIDEBAR_MIN_REM,
  containerOf,
  isRunning,
  type AssistantStoreInternal,
} from "./assistantStore";
import type {
  AssistantCapability,
  AssistantSession,
  Container,
  GateCode,
  GateReason,
  HostRegistry,
  OpenAssistantArgs,
  OpenAssistantResult,
  Placement,
  Sid,
} from "./assistantStore.types";
import type { TurnLockReason } from "./lifecycle";
import { getAssistantRuntime } from "./runtime";
import { turnLockKey } from "./runtimeHandle";
import { sidebarWidthFor } from "./sidebarWidth";

/** Layout-route query keys a deep link may carry: they stage and never send, and never carry text (DG-13). */
export const ASSISTANT_QUERY_KEYS = ["assistant", "object", "ref"] as const;

/** `thread: "auto"` appends to a chat whose last turn ended within this window (`10` §3.3). */
export const THREAD_APPEND_WINDOW_MS = 30 * 60_000;

export const DEFAULT_TITLE_CHARS = 40;

/** A second activation of the same door inside this window returns the first one's result. */
export const DOOR_REPEAT_MS = 1_000;

// The floating card's inset from the window edge and its top below the header, as `AssistantSidebarHost` draws it.
const FLOATING_GAP_REM = 0.5;

const FLOATING_TOP_REM = 2.75;

const SEND_VERBS: ReadonlySet<OpenAssistantArgs["entryVerb"]> = new Set([
  "explain",
  "troubleshoot",
  "fix",
]);

// Doors never hide on health: the next send tells the truth (`00` §9).
const OPEN_GATES: ReadonlySet<GateCode> = new Set(["available", "unhealthy"]);

const REPORTED_GATES: ReadonlySet<GateCode> = new Set([
  "not_entitled",
  "not_configured",
  "off_for_org",
  "no_permission",
]);

// Door kinds that focus whatever container is already open instead of choosing one.
const FOCUS_DOORS: ReadonlySet<OpenAssistantArgs["entryKind"]> = new Set([
  "header_button",
  "shortcut",
  "toast",
]);

const FULL_DOORS: ReadonlySet<OpenAssistantArgs["entryKind"]> = new Set([
  "home_launcher",
  "deep_link",
  "share_fork",
]);

const OPEN_ACTION = {
  label: "assistant.entry.open" as const,
  handler: () =>
    void openAssistant({
      entryKind: "toast",
      entryVerb: "ask",
      objectKind: "none",
      intent: "open",
      thread: "current",
    }),
};

type SendVerb = "explain" | "troubleshoot" | "fix";

/** `intent: "send"` is legal only for the explicit verbs and the Home launcher's typed line (DG-02 rule 3). */
export type OpenAssistantCall = (
  | (OpenAssistantArgs & { intent: "open" | "stage" })
  | (OpenAssistantArgs & { intent: "send"; entryVerb: SendVerb })
  | (OpenAssistantArgs & { intent: "send"; entryKind: "home_launcher"; entryVerb: "ask" })
) & {
  /** The `userOrgKey` the payload was built under; a stale tab's payload is refused. */
  userOrgKey?: string;
};

/** What the function reads besides its arguments, injected so the rule table is unit-tested. */
export interface OpenAssistantEnv {
  store: AssistantStoreInternal;
  capability(): AssistantCapability;
  hosts: HostRegistry;
  routeName(): string;
  routePrefersFloating(): boolean;
  pushRoute(to: RouteLocationRaw): void;
  lgUp(): boolean;
  viewportPx(): number;
  viewportHeightPx?(): number;
  currentOrg(): string | null;
  now(): number;
  notify?(message: I18nKey, action?: { label: I18nKey; handler: () => void }): void;
}

interface DoorPlan {
  target: Placement;
  /** Pinned for this open only, so the floating card does not cover the door's source. */
  forcePinned: boolean;
  session: AssistantSession | null;
  sends: boolean;
  /** Why a send door only stages: this tab may not start a turn in its chat. */
  lock: TurnLockReason | null;
  queued: boolean;
  carded: boolean;
  drafted: boolean;
}

/** The only way into the assistant (`00` §4.5); a door runs synchronously, so two doors in one tick see each other. */
export function openAssistant(args: OpenAssistantCall): Promise<OpenAssistantResult> {
  return getAssistantRuntime().openAssistant(args);
}

export function createOpenAssistant(
  env: OpenAssistantEnv,
): (args: OpenAssistantCall) => Promise<OpenAssistantResult> {
  let last: { key: string; at: number; result: OpenAssistantResult } | null = null;
  return async (args) => {
    const key = doorKey(env, args);
    // Closing in between makes the next press a new open, never a stale answer.
    const open = env.store.state.shell.placement.kind !== "hidden";
    if (open && last?.key === key && env.now() - last.at < DOOR_REPEAT_MS) return last.result;
    const result = runDoor(env, args);
    last = result.ok ? { key, at: env.now(), result } : null;
    return result;
  };
}

function runDoor(env: OpenAssistantEnv, args: OpenAssistantCall): OpenAssistantResult {
  const { store } = env;
  const gate = env.capability().gate;
  if (!OPEN_GATES.has(gate)) {
    if (isGateReason(gate)) trackAssistant("ai_gate_blocked", { reason: gate });
    else trackAssistant("ai_entry_clicked", entryProps(args, null, gate));
    return { ok: false, reason: gate };
  }
  if (!store.state.ready) {
    trackAssistant("ai_entry_clicked", entryProps(args, null, gate));
    return { ok: false, reason: "loading" };
  }
  if (isForeignPayload(env, args)) {
    trackAssistant("ai_entry_clicked", entryProps(args, null, gate));
    notify(env, "assistant.entry.orgChanged");
    return { ok: false, reason: "org_changed" };
  }
  // A host that cannot give the dock its minimum beside the editor opens the sidebar instead.
  const narrow = !!args.dockHost && args.container !== "sidebar" && !dockFits(env, args.dockHost);
  const plan = planDoor(env, narrow ? { ...args, container: "sidebar" } : args);
  trackAssistant("ai_entry_clicked", entryProps(args, plan, gate));
  const container = containerOf(plan.target, env.lgUp()) ?? "sidebar";
  // A door names only a thread it starts; staging into a chat already in use keeps that chat's title.
  const fresh = !plan.session || isBlank(plan.session);
  const sid = plan.session?.sid ?? createSession(store, args, container);
  const staged = stagePayload(store, sid, args, plan, fresh);
  const wasVisible = store.state.shell.placement.kind !== "hidden";
  // Add to chat is non-destructive: it never opens a hidden container over the page; the door offers Open.
  if (!wasVisible && args.intent === "stage" && args.entryVerb === "add_to_chat") {
    store.setActive(sid);
    return { ok: true, sid, container, staged, sent: false, queued: false };
  }
  const { sends, lock } = plan;
  // A send into a visible container leaves focus on the source page (`95` §4).
  const focus = sends && wasVisible ? "none" : "composer";
  store.open(plan.target, { sid, focus, invoker: args.invoker, forcePinned: plan.forcePinned });
  if (plan.target.kind === "full" && env.routeName() !== "assistant")
    env.pushRoute({ name: "assistant", params: { chatId: sid } });
  if (lock) notify(env, turnLockKey(lock));
  if (sends) void store.send(sid, args.mode ? { mode: args.mode } : undefined);
  if (plan.carded && args.payload) notify(env, "assistant.entry.addedBehindCard", OPEN_ACTION);
  if (narrow) notify(env, "assistant.editor.tooNarrow");
  return { ok: true, sid, container, staged, sent: sends, queued: plan.queued };
}

function planDoor(env: OpenAssistantEnv, args: OpenAssistantCall): DoorPlan {
  const target = resolveContainer(env, args);
  const session = resolveThread(env, args, target);
  const composerEmpty = !session || session.composer.text.trim() === "";
  const running = !!session && isRunning(session.turn);
  const carded = !!session && (!!session.pendingApproval || !!session.pendingConsent);
  const wantsSend = args.intent === "send";
  const free = wantsSend && composerEmpty && !running && !carded;
  // A door never starts a turn this tab may not start; its prompt stays staged and the door says why.
  const lock = free ? env.store.turnLockOf(session?.sid ?? null) : null;
  return {
    target,
    forcePinned: target.kind === "sidebar" && coversInvoker(env, target, args.invoker),
    session,
    sends: free && !lock,
    lock,
    queued: wantsSend && running,
    carded,
    drafted: wantsSend && !composerEmpty,
  };
}

/** The `10` §3.3 rule table. */
function resolveContainer(env: OpenAssistantEnv, args: OpenAssistantCall): Placement {
  const { shell } = env.store.state;
  if (env.routeName() === "assistant") return { kind: "full" };
  const wanted = args.container ?? "auto";
  if (wanted === "full" || (wanted === "auto" && FULL_DOORS.has(args.entryKind)))
    return { kind: "full" };
  if (args.dockHost && wanted !== "sidebar" && env.hosts.has(args.dockHost))
    return { kind: "docked", hostId: args.dockHost };
  if (wanted === "auto" && shell.placement.kind === "docked" && FOCUS_DOORS.has(args.entryKind))
    return { ...shell.placement };
  if (shell.placement.kind === "sidebar") return { ...shell.placement };
  return { kind: "sidebar", mode: sidebarMode(env) };
}

function sidebarMode(env: OpenAssistantEnv): "pinned" | "floating" {
  const { store } = env;
  const remembered = store.state.shell.sidebarMode;
  return !store.hasStoredSidebarMode() && env.routePrefersFloating() ? "floating" : remembered;
}

// A floating card that would hide the door's source opens pinned for this open only.
function coversInvoker(
  env: OpenAssistantEnv,
  target: Extract<Placement, { kind: "sidebar" }>,
  invoker?: HTMLElement | null,
): boolean {
  const { shell } = env.store.state;
  if (target.mode === "pinned" || shell.placement.kind === "sidebar" || !env.lgUp() || !invoker)
    return false;
  const viewport = env.viewportPx();
  const gap = FLOATING_GAP_REM * 16;
  const width = sidebarWidthFor(shell.sidebarWidthRem, viewport / 16, true) * 16;
  const card = {
    left: viewport - gap - width,
    right: viewport - gap,
    top: FLOATING_TOP_REM * 16,
    bottom: (env.viewportHeightPx?.() ?? Number.POSITIVE_INFINITY) - gap,
  };
  const rect = invoker.getBoundingClientRect();
  return (
    rect.right > card.left &&
    rect.left < card.right &&
    rect.bottom > card.top &&
    rect.top < card.bottom
  );
}

// Below `lg` the dock is a sheet over a full-width host, so only a desktop row is measured.
function dockFits(
  env: OpenAssistantEnv,
  hostId: NonNullable<OpenAssistantArgs["dockHost"]>,
): boolean {
  const adapter = env.hosts.get(hostId);
  const placement = env.store.state.shell.placement;
  if (!adapter || !env.lgUp()) return true;
  if (placement.kind === "docked" && placement.hostId === hostId) return true;
  const slot = adapter.dockSlot.value;
  const rowRem = adapter.dockRowRem?.() ?? (slot ? slot.getBoundingClientRect().width / 16 : 0);
  if (rowRem <= 0) return true;
  return rowRem - MAIN_MIN_REM >= (adapter.minWidthRem ?? SIDEBAR_MIN_REM);
}

/** `new` for titled verbs, `current` for add-to-chat, else append within 30 min of the last turn. */
function resolveThread(
  env: OpenAssistantEnv,
  args: OpenAssistantCall,
  target: Placement,
): AssistantSession | null {
  const { store } = env;
  const found = containerSession(store, target);
  // A dock's thread belongs to one object: the same editor on another alert starts its own chat.
  const current = found && sameObject(env, found, target) ? found : null;
  const thread = args.thread ?? defaultThread(args.entryVerb);
  if (thread === "current" || !current) return current;
  if (thread === "new") return isBlank(current) ? current : null;
  const last = store.lastTurnAt(current.sid);
  const fresh = last !== null && env.now() - last < THREAD_APPEND_WINDOW_MS;
  return fresh || isBlank(current) ? current : null;
}

// The session the target container shows: the visible one, else that container's latest (`10` §3.3).
function containerSession(
  store: AssistantStoreInternal,
  target: Placement,
): AssistantSession | null {
  const { state } = store;
  const own = (sid: Sid | null) => {
    const session = sid ? state.sessions[sid] : undefined;
    return session && session.userOrgKey === state.userOrgKey ? session : null;
  };
  if (sameContainer(state.shell.placement, target)) return own(state.shell.activeSid);
  const dock = target.kind === "docked" ? `docked.${target.hostId}` : null;
  for (const sid of [state.shell.activeSid, ...state.recent]) {
    const session = own(sid);
    if (session && dockOf(session) === dock) return session;
  }
  return null;
}

function sameObject(env: OpenAssistantEnv, session: AssistantSession, target: Placement): boolean {
  if (target.kind !== "docked" || session.titleSource !== "object" || session.title === null)
    return true;
  const adapter = env.hosts.get(target.hostId);
  return !adapter || String(adapter.objectTitle()) === String(session.title);
}

function sameContainer(current: Placement, target: Placement): boolean {
  if (current.kind === "hidden" || current.kind !== target.kind) return false;
  return (
    current.kind !== "docked" || (target.kind === "docked" && current.hostId === target.hostId)
  );
}

function dockOf(session: AssistantSession): string | null {
  return session.origin.container.startsWith("docked.") ? session.origin.container : null;
}

function defaultThread(verb: OpenAssistantArgs["entryVerb"]): "new" | "current" | "auto" {
  if (SEND_VERBS.has(verb)) return "new";
  return verb === "add_to_chat" ? "current" : "auto";
}

function createSession(
  store: AssistantStoreInternal,
  args: OpenAssistantCall,
  container: Container,
): Sid {
  const transcript = args.payload?.transcript ?? [];
  const sid = store.createSession({
    origin: { entryKind: args.entryKind, objectKind: args.objectKind, container },
    thread: "new",
    ...(transcript.length > 0 && {
      messages: transcript.map((m) => ({ role: m.role, content: raw(m.text) })),
    }),
  });
  const prompt = args.payload?.text?.trim();
  // The default title is the visible prompt, never the serialised chip (`00` §10.1).
  if (prompt && store.state.sessions[sid].title === null)
    store.setTitle(sid, raw(prompt.slice(0, DEFAULT_TITLE_CHARS)), "generated");
  return sid;
}

function stagePayload(
  store: AssistantStoreInternal,
  sid: Sid,
  args: OpenAssistantCall,
  plan: DoorPlan,
  fresh: boolean,
): number {
  const payload = args.payload;
  if (!payload) return 0;
  const session = store.state.sessions[sid];
  const before = session.composer.chips.length;
  const textBefore = session.composer.text;
  const empty = textBefore.trim() === "";
  store.stage(sid, {
    chips: payload.chips,
    text: payload.text,
    mode: empty ? "replace" : "append",
  });
  if (payload.title && fresh) store.setTitle(sid, payload.title, "object");
  const staged = store.state.sessions[sid].composer.chips.length - before;
  // A repeated prompt the store skipped adds nothing, so the helper line would claim a change that did not happen.
  const changed = staged > 0 || store.state.sessions[sid].composer.text !== textBefore;
  if (!changed) return staged;
  if (plan.queued) store.setEntryNotice(sid, "assistant.entry.queuedWhileRunning");
  else if (plan.drafted) store.setEntryNotice(sid, "assistant.entry.addedToDraft");
  return staged;
}

function isForeignPayload(env: OpenAssistantEnv, args: OpenAssistantCall): boolean {
  if (args.userOrgKey && args.userOrgKey !== env.store.state.userOrgKey) return true;
  const org = env.currentOrg();
  return (args.payload?.chips ?? []).some((chip) => !!chip.ref?.org && chip.ref.org !== org);
}

function isGateReason(gate: GateCode): gate is Extract<GateCode, GateReason> {
  return REPORTED_GATES.has(gate);
}

function isBlank(session: AssistantSession): boolean {
  return (
    session.messages.length === 0 &&
    session.turn.state === "idle" &&
    session.composer.text.trim() === "" &&
    session.composer.chips.length === 0
  );
}

// A refused door (`plan` null) still reports the click, with nothing sent or queued.
function entryProps(
  args: OpenAssistantCall,
  plan: DoorPlan | null,
  gate: GateCode,
): AiEventProps["ai_entry_clicked"] {
  return {
    entry_kind: args.entryKind,
    entry_verb: args.entryVerb,
    object_kind: args.objectKind,
    sends: plan?.sends ?? false,
    gate,
    queued: plan?.queued ?? false,
    ...(args.dockHost && { host: args.dockHost }),
    ...(args.payload?.text !== undefined && { text_len_bucket: lengthBucket(args.payload.text) }),
  };
}

// Same door, same payload, same user+org; the invoker element is not part of it.
function doorKey(env: OpenAssistantEnv, args: OpenAssistantCall): string {
  const chips = (args.payload?.chips ?? []).map(
    (chip) => `${chip.kind}:${chip.ref?.type ?? ""}:${chip.ref?.id ?? chip.id}`,
  );
  return JSON.stringify([
    env.store.state.userOrgKey,
    args.entryKind,
    args.entryVerb,
    args.objectKind,
    args.intent,
    args.thread ?? null,
    args.container ?? null,
    args.dockHost ?? null,
    args.payload?.text ?? null,
    args.payload?.title ?? null,
    chips,
  ]);
}

function lengthBucket(text: string): LengthBucket {
  const n = text.length;
  if (n === 0) return "0";
  if (n <= 20) return "1_20";
  if (n <= 100) return "21_100";
  return n <= 500 ? "101_500" : "500_plus";
}

function notify(
  env: OpenAssistantEnv,
  message: I18nKey,
  action?: { label: I18nKey; handler: () => void },
): void {
  if (env.notify) return env.notify(message, action);
  toast({
    variant: "default",
    message: gt(message),
    ...(action && { action: { label: gt(action.label), handler: action.handler } }),
  });
}
