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
import { createSeededChat, type SeededChatRequest } from "@/services/ai_chat_seed";
import { gt, raw, type I18nKey } from "@/types/i18n";

import { defaultAgentFor, doorAgent } from "./agents";
import {
  MAIN_MIN_REM,
  SIDEBAR_MIN_REM,
  containerOf,
  isRunning,
  openWindowsOf,
  type AssistantStoreInternal,
} from "./assistantStore";
import type {
  AssistantCapability,
  AssistantSession,
  Container,
  GateCode,
  GateReason,
  HistoryRow,
  HostRegistry,
  OpenAssistantArgs,
  OpenAssistantResult,
  Placement,
  Sid,
} from "./assistantStore.types";
import type { TurnLockReason } from "./lifecycle";
import { projectRecord, type StoredTurn } from "./record";
import { getAssistantRuntime } from "./runtime";
import { turnLockKey } from "./runtimeHandle";

/** Layout-route query keys a deep link may carry: they stage and never send, and never carry text (DG-13). */
export const ASSISTANT_QUERY_KEYS = ["assistant", "object", "ref"] as const;

/** `thread: "auto"` appends to a chat whose last turn ended within this window (`10` §3.3). */
export const THREAD_APPEND_WINDOW_MS = 30 * 60_000;

export const DEFAULT_TITLE_CHARS = 40;

/** A second activation of the same door inside this window returns the first one's result. */
export const DOOR_REPEAT_MS = 1_000;

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

/** `intent: "send"` is legal only for the explicit verbs and the typed line of the Home launcher. */
export type OpenAssistantCall = (
  | (OpenAssistantArgs & { intent: "open" | "stage" })
  | (OpenAssistantArgs & { intent: "send"; entryVerb: SendVerb })
  | (OpenAssistantArgs & {
      intent: "send";
      entryKind: "home_launcher";
      entryVerb: "ask";
    })
) & {
  /** The `userOrgKey` the payload was built under; a stale tab's payload is refused. */
  userOrgKey?: string;
  /** A finished answer the door hands over; the new chat shows it and the server stores it. */
  seed?: StoredTurn[];
};

/** What the function reads besides its arguments, injected so the rule table is unit-tested. */
export interface OpenAssistantEnv {
  store: AssistantStoreInternal;
  capability(): AssistantCapability;
  hosts: HostRegistry;
  routeName(): string;
  pushRoute(to: RouteLocationRaw): void;
  lgUp(): boolean;
  currentOrg(): string | null;
  now(): number;
  notify?(message: I18nKey, action?: { label: I18nKey; handler: () => void }): void;
  /** The drawn rect of an open window, for the door's source check. */
  windowRect?(sid: Sid): DOMRect | null;
  /** The history rows of this user+org, so a reopened dock finds a chat no longer in memory. */
  historyRows?(): HistoryRow[];
  /** Stores a door's seeded chat on the server; `createSeededChat` when absent. */
  seedChat?(org: string, body: SeededChatRequest): Promise<unknown>;
  /** True while Home's Ask box is on screen, which takes the doors that would open the sidebar. */
  homeAsk?(): boolean;
  focusHomeAsk?(): void;
}

type DoorTarget = Placement | { kind: "window"; sid: Sid };

interface DoorPlan {
  target: DoorTarget;
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
  const routed: OpenAssistantCall = narrow ? { ...args, container: "sidebar" } : args;
  const home = homeDoor(env, routed);
  if (home === "focus") {
    trackAssistant("ai_entry_clicked", entryProps(args, null, gate));
    env.focusHomeAsk?.();
    return { ok: false, reason: "home_ask" };
  }
  const plan = planDoor(env, home === "full" ? { ...routed, container: "full" } : routed);
  trackAssistant("ai_entry_clicked", entryProps(args, plan, gate));
  const container = containerOfDoor(plan.target, env.lgUp());
  // A door names only a thread it starts; staging into a chat already in use keeps that chat's title.
  const fresh = !plan.session || isBlank(plan.session);
  const sid = plan.session?.sid ?? createSession(store, args, container, plan.target);
  applyDoorAgent(store, sid, args, !plan.session);
  const staged = stagePayload(store, sid, args, plan, fresh);
  if (!plan.session) storeSeed(env, sid, args);
  const wasVisible = store.anyContainerVisible();
  // Add to chat is non-destructive: it never opens a hidden container over the page; the door offers Open.
  if (!wasVisible && args.intent === "stage" && args.entryVerb === "add_to_chat") {
    store.setActive(sid);
    return { ok: true, sid, container, staged, sent: false, queued: false };
  }
  const stored = plan.target.kind === "docked" ? dockRow(env, args, plan) : null;
  const { sends, lock } = plan;
  // A send into a visible container leaves focus on the source page (`95` §4).
  const focus = sends && wasVisible ? "none" : "composer";
  showDoor(store, plan.target, sid, {
    focus,
    invoker: args.invoker,
    ...(narrow && { sidebarCapRem: SIDEBAR_MIN_REM }),
  });
  if (stored) void store.openSession({ sid: stored.sid }, { focus: true }).catch(() => undefined);
  if (plan.target.kind === "full" && env.routeName() !== "assistant")
    env.pushRoute({ name: "assistant", params: { chatId: sid } });
  if (lock) notify(env, turnLockKey(lock));
  if (sends) void store.send(sid, args.mode ? { mode: args.mode } : undefined);
  if (plan.carded && args.payload) notify(env, "assistant.entry.addedBehindCard", OPEN_ACTION);
  if (narrow) notify(env, "assistant.shell.dockTooNarrow");
  return { ok: true, sid, container, staged, sent: sends, queued: plan.queued };
}

// A dock's chat that left memory is read back from history; a chat the server never saw has no row, so none is fetched (BUG-037).
function dockRow(
  env: OpenAssistantEnv,
  args: OpenAssistantCall,
  plan: DoorPlan,
): HistoryRow | null {
  const { target, session } = plan;
  if (target.kind !== "docked" || (session && !isBlank(session))) return null;
  if ((args.thread ?? defaultThread(args.entryVerb)) === "new") return null;
  const adapter = env.hosts.get(target.hostId);
  if (!adapter) return null;
  const title = String(adapter.objectTitle());
  const container = `docked.${target.hostId}`;
  const rows = env.historyRows?.() ?? [];
  return rows.find((r) => r.originContainer === container && String(r.title) === title) ?? null;
}

function planDoor(env: OpenAssistantEnv, args: OpenAssistantCall): DoorPlan {
  const target = resolveContainer(env, args);
  const session = resolveThread(env, args, target);
  const windowed = target.kind === "docked" ? session && env.store.windowOf(session.sid) : null;
  if (windowed) return planOf(env, args, { kind: "window", sid: windowed.sid }, session);
  return planOf(env, args, target, session);
}

function planOf(
  env: OpenAssistantEnv,
  args: OpenAssistantCall,
  target: DoorTarget,
  session: AssistantSession | null,
): DoorPlan {
  const composerEmpty = !session || session.composer.text.trim() === "";
  const running = !!session && isRunning(session.turn);
  const carded = !!session && (!!session.pendingApproval || !!session.pendingConsent);
  const wantsSend = args.intent === "send";
  const free = wantsSend && composerEmpty && !running && !carded;
  // A door never starts a turn this tab may not start; its prompt stays staged and the door says why.
  const lock = free ? env.store.turnLockOf(session?.sid ?? null) : null;
  return {
    target,
    session,
    sends: free && !lock,
    lock,
    queued: wantsSend && running,
    carded,
    drafted: wantsSend && !composerEmpty,
  };
}

/** The `10` §3.3 rule table. */
function resolveContainer(env: OpenAssistantEnv, args: OpenAssistantCall): DoorTarget {
  const { shell } = env.store.state;
  if (env.routeName() === "assistant") return { kind: "full" };
  const wanted = args.container ?? "auto";
  if (wanted === "full" || (wanted === "auto" && FULL_DOORS.has(args.entryKind)))
    return { kind: "full" };
  if (args.dockHost && wanted !== "sidebar" && env.hosts.has(args.dockHost))
    return { kind: "docked", hostId: args.dockHost };
  if (wanted === "auto" && shell.placement.kind === "docked" && FOCUS_DOORS.has(args.entryKind))
    return { ...shell.placement };
  if (wanted === "auto") {
    const window = doorWindow(env, args.invoker);
    if (window) return { kind: "window", sid: window };
  }
  return { kind: "sidebar" };
}

// Home's Ask box is the assistant there: a door bound for a closed sidebar shows its chat on Home, or focuses the box.
function homeDoor(env: OpenAssistantEnv, args: OpenAssistantCall): "full" | "focus" | null {
  if (!env.homeAsk?.() || env.store.state.shell.placement.kind === "sidebar") return null;
  const target = resolveContainer(env, args);
  if (target.kind !== "sidebar") return null;
  if (args.intent !== "open" || args.payload || args.seed?.length) return "full";
  const session = resolveThread(env, args, target);
  const live =
    !!session &&
    (isRunning(session.turn) ||
      session.unread ||
      !!session.pendingApproval ||
      !!session.pendingConsent);
  return live ? "full" : "focus";
}

// The most recently focused visible container, unless that window hides the door's source (X-14).
function doorWindow(env: OpenAssistantEnv, invoker?: HTMLElement | null): Sid | null {
  if (!env.lgUp()) return null;
  const { store } = env;
  const { shell } = store.state;
  const open = openWindowsOf(shell);
  const front = store.frontSid();
  const sid = open.some((w) => w.sid === front) ? front : null;
  if (!sid) return null;
  if (!invoker || !env.windowRect) return sid;
  const rect = env.windowRect(sid);
  return rect && overlaps(invoker.getBoundingClientRect(), rect) ? null : sid;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

function containerOfDoor(target: DoorTarget, lgUp: boolean): Container {
  if (target.kind === "window") return "window";
  return containerOf(target, lgUp) ?? "sidebar";
}

function showDoor(
  store: AssistantStoreInternal,
  target: DoorTarget,
  sid: Sid,
  opts: Parameters<AssistantStoreInternal["open"]>[1],
): void {
  if (target.kind !== "window") return store.open(target, { ...opts, sid });
  if (target.sid === sid || store.windowOf(sid))
    return store.restoreWindow(sid, { focus: opts.focus });
  store.replaceWindowChat(target.sid, sid, { focus: opts.focus });
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
  target: DoorTarget,
): AssistantSession | null {
  const { store } = env;
  const found = containerSession(store, target);
  // A dock's thread belongs to one object: the same editor on another alert starts its own chat.
  const current = found && sameObject(env, found, target) ? found : null;
  const thread = args.thread ?? defaultThread(args.entryVerb);
  if (thread === "current" || !current) return current;
  if (thread === "new") return isBlank(current) ? current : null;
  // A reopened editor shows its object's chat whatever its age; only New starts another (BUG-017).
  if (target.kind === "docked") return current;
  const last = store.lastTurnAt(current.sid);
  const fresh = last !== null && env.now() - last < THREAD_APPEND_WINDOW_MS;
  return fresh || isBlank(current) ? current : null;
}

// The session the target container shows: the visible one, else that container's latest (`10` §3.3).
function containerSession(
  store: AssistantStoreInternal,
  target: DoorTarget,
): AssistantSession | null {
  const { state } = store;
  const own = (sid: Sid | null) => {
    const session = sid ? state.sessions[sid] : undefined;
    return session && session.userOrgKey === state.userOrgKey ? session : null;
  };
  if (target.kind === "window") return own(target.sid);
  if (sameContainer(state.shell.placement, target)) return own(state.shell.activeSid);
  const dock = target.kind === "docked" ? `docked.${target.hostId}` : null;
  for (const sid of [state.shell.activeSid, ...state.recent]) {
    const session = own(sid);
    // A docked chat that floated stays its object's chat; any other window keeps its chat to itself.
    if (session && dockOf(session) === dock && (dock || !store.windowOf(session.sid)))
      return session;
  }
  return null;
}

function sameObject(env: OpenAssistantEnv, session: AssistantSession, target: DoorTarget): boolean {
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

// A door picks only for a chat nobody has spoken in or picked for; without a roster the server keeps routing.
function applyDoorAgent(
  store: OpenAssistantEnv["store"],
  sid: Sid,
  args: OpenAssistantArgs,
  created: boolean,
): void {
  const session = store.state.sessions[sid];
  // A transcript the door itself seeded into a chat it just made is not a turn anyone spoke in.
  if (!session || session.agentId || (!created && session.messages.length > 0)) return;
  const agent = doorAgent(args.agent ?? defaultAgentFor(args), store.state.capability.agents);
  if (agent) store.pickAgent(sid, agent, "door");
}

function defaultThread(verb: OpenAssistantArgs["entryVerb"]): "new" | "current" | "auto" {
  if (SEND_VERBS.has(verb)) return "new";
  return verb === "add_to_chat" ? "current" : "auto";
}

function createSession(
  store: AssistantStoreInternal,
  args: OpenAssistantCall,
  container: Container,
  target: DoorTarget,
): Sid {
  const transcript = args.payload?.transcript ?? [];
  // A seed renders through the same projection as the server's copy, so a reload shows what the door showed.
  const messages = args.seed?.length
    ? projectRecord(args.seed, "owner", { timezone: "", scrubModels: false })
    : transcript.map((m) => ({
        role: m.role,
        content: raw(m.text),
        ...(m.agent && { agentId: m.agent }),
      }));
  const sid = store.createSession({
    origin: { entryKind: args.entryKind, objectKind: args.objectKind, container },
    thread: "new",
    ...(target.kind === "window" && { detached: true }),
    ...(messages.length > 0 && { messages }),
  });
  const prompt = args.payload?.text?.trim();
  // The default title is the visible prompt, never the serialised chip (`00` §10.1).
  if (prompt && store.state.sessions[sid].title === null)
    store.setTitle(sid, raw(prompt.slice(0, DEFAULT_TITLE_CHARS)), "generated");
  return sid;
}

// Without this the seeded answer, title and agent live only in this tab; an older server just keeps them there.
function storeSeed(env: OpenAssistantEnv, sid: Sid, args: OpenAssistantCall): void {
  const org = env.currentOrg();
  const session = env.store.state.sessions[sid];
  if (!args.seed?.length || !org || !session) return;
  const seed = env.seedChat ?? createSeededChat;
  void seed(org, {
    session_id: sid,
    title: String(session.title ?? ""),
    ...((session.agentId ?? args.agent) && { agent_type: session.agentId ?? args.agent }),
    origin: args.entryKind,
    turns: args.seed,
  }).catch(() => undefined);
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
  if (payload.removedPageKeys?.length)
    store.setDraft(sid, { removedPageKeys: [...payload.removedPageKeys] });
  store.stage(sid, {
    chips: payload.chips,
    text: payload.text,
    mode: empty ? "replace" : "append",
    ...(payload.homeStarter && { homeStarter: true }),
  });
  for (const image of payload.images ?? []) store.addImage(sid, image);
  if (payload.timeOverride) store.setTimeOverride(sid, payload.timeOverride);
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
