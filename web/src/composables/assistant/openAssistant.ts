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

import { containerOf, isRunning, type AssistantStoreInternal } from "./assistantStore";
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
import { getAssistantRuntime } from "./runtime";

/** Layout-route query keys a deep link may carry: they stage and never send, and never carry text (DG-13). */
export const ASSISTANT_QUERY_KEYS = ["assistant", "object", "ref"] as const;

/** `thread: "auto"` appends to a chat whose last turn ended within this window (`10` §3.3). */
export const THREAD_APPEND_WINDOW_MS = 30 * 60_000;

export const DEFAULT_TITLE_CHARS = 40;

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
  | (OpenAssistantArgs & { intent: "send"; entryKind: "home_launcher" })
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
  currentOrg(): string | null;
  now(): number;
  notify?(message: I18nKey, action?: { label: I18nKey; handler: () => void }): void;
}

interface DoorPlan {
  target: Placement;
  session: AssistantSession | null;
  sends: boolean;
  queued: boolean;
  carded: boolean;
  drafted: boolean;
}

/** The only way into the assistant (`00` §4.5); calls are serialised so two doors in one tick see each other. */
export function openAssistant(args: OpenAssistantCall): Promise<OpenAssistantResult> {
  return getAssistantRuntime().openAssistant(args);
}

export function createOpenAssistant(
  env: OpenAssistantEnv,
): (args: OpenAssistantCall) => Promise<OpenAssistantResult> {
  let queue: Promise<unknown> = Promise.resolve();
  return (args) => {
    const run = queue.then(() => runDoor(env, args));
    queue = run.catch(() => undefined);
    return run;
  };
}

function runDoor(env: OpenAssistantEnv, args: OpenAssistantCall): OpenAssistantResult {
  const { store } = env;
  const gate = env.capability().gate;
  if (!OPEN_GATES.has(gate)) {
    if (isGateReason(gate)) trackAssistant("ai_gate_blocked", { reason: gate });
    return { ok: false, reason: gate };
  }
  if (!store.state.ready) return { ok: false, reason: "loading" };
  if (isForeignPayload(env, args)) {
    notify(env, "assistant.entry.orgChanged");
    return { ok: false, reason: "org_changed" };
  }
  const plan = planDoor(env, args);
  trackAssistant("ai_entry_clicked", entryProps(args, plan, gate));
  const container = containerOf(plan.target, env.lgUp()) ?? "sidebar";
  const sid = plan.session?.sid ?? createSession(store, args, container);
  const staged = stagePayload(store, sid, args, plan);
  const wasVisible = store.state.shell.placement.kind !== "hidden";
  // A send into a visible container leaves focus on the source page (`95` §4).
  const focus = plan.sends && wasVisible ? "none" : "composer";
  store.open(plan.target, { sid, focus, invoker: args.invoker });
  if (plan.target.kind === "full" && env.routeName() !== "assistant")
    env.pushRoute({ name: "assistant", params: { chatId: sid } });
  if (plan.sends) void store.send(sid, args.mode ? { mode: args.mode } : undefined);
  if (plan.carded && args.payload) notify(env, "assistant.entry.addedBehindCard", OPEN_ACTION);
  return { ok: true, sid, container, staged, sent: plan.sends, queued: plan.queued };
}

function planDoor(env: OpenAssistantEnv, args: OpenAssistantCall): DoorPlan {
  const target = resolveContainer(env, args);
  const session = resolveThread(env, args);
  const composerEmpty = !session || session.composer.text.trim() === "";
  const running = !!session && isRunning(session.turn);
  const carded = !!session && (!!session.pendingApproval || !!session.pendingConsent);
  const wantsSend = args.intent === "send";
  return {
    target,
    session,
    sends: wantsSend && composerEmpty && !running && !carded,
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
  return { kind: "sidebar", mode: sidebarMode(env, args.invoker) };
}

// A floating card that would hide the door's source opens pinned for this open only (`20` §2.1, round 1 X-14).
function sidebarMode(env: OpenAssistantEnv, invoker?: HTMLElement | null): "pinned" | "floating" {
  const { store } = env;
  const remembered = store.state.shell.sidebarMode;
  const mode =
    !store.hasStoredSidebarMode() && env.routePrefersFloating() ? "floating" : remembered;
  if (mode === "pinned" || !env.lgUp() || !invoker) return mode;
  const cardLeft = env.viewportPx() - store.state.shell.sidebarWidthRem * 16;
  return invoker.getBoundingClientRect().right > cardLeft ? "pinned" : "floating";
}

/** `new` for titled verbs, `current` for add-to-chat, else append within 30 min of the last turn. */
function resolveThread(env: OpenAssistantEnv, args: OpenAssistantCall): AssistantSession | null {
  const { store } = env;
  const active = store.state.shell.activeSid
    ? store.state.sessions[store.state.shell.activeSid]
    : undefined;
  const current = active && active.userOrgKey === store.state.userOrgKey ? active : null;
  const thread = args.thread ?? defaultThread(args.entryVerb);
  if (thread === "current" || !current) return current;
  if (thread === "new") return isBlank(current) ? current : null;
  const last = store.lastTurnAt(current.sid);
  const fresh = last !== null && env.now() - last < THREAD_APPEND_WINDOW_MS;
  return fresh || isBlank(current) ? current : null;
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
  const sid = store.createSession({
    origin: { entryKind: args.entryKind, objectKind: args.objectKind, container },
    thread: "new",
  });
  const session = store.state.sessions[sid];
  const prompt = args.payload?.text?.trim();
  // The default title is the visible prompt, never the serialised chip (`00` §10.1).
  if (prompt && session.title === null)
    store.setTitle(sid, raw(prompt.slice(0, DEFAULT_TITLE_CHARS)), "generated");
  if (args.payload?.transcript?.length && session.messages.length === 0)
    session.messages = args.payload.transcript.map((m) => ({ role: m.role, content: raw(m.text) }));
  return sid;
}

function stagePayload(
  store: AssistantStoreInternal,
  sid: Sid,
  args: OpenAssistantCall,
  plan: DoorPlan,
): number {
  const payload = args.payload;
  if (!payload) return 0;
  const session = store.state.sessions[sid];
  const before = session.composer.chips.length;
  const empty = session.composer.text.trim() === "";
  store.stage(sid, {
    chips: payload.chips,
    text: payload.text,
    mode: empty ? "replace" : "append",
  });
  if (payload.title) store.setTitle(sid, payload.title, "object");
  if (plan.queued) store.setEntryNotice(sid, "assistant.entry.queuedWhileRunning");
  else if (plan.drafted) store.setEntryNotice(sid, "assistant.entry.addedToDraft");
  return store.state.sessions[sid].composer.chips.length - before;
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

function entryProps(
  args: OpenAssistantCall,
  plan: DoorPlan,
  gate: GateCode,
): AiEventProps["ai_entry_clicked"] {
  return {
    entry_kind: args.entryKind,
    entry_verb: args.entryVerb,
    object_kind: args.objectKind,
    sends: plan.sends,
    gate,
    queued: plan.queued,
    ...(args.dockHost && { host: args.dockHost }),
    ...(args.payload?.text !== undefined && { text_len_bucket: lengthBucket(args.payload.text) }),
  };
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
