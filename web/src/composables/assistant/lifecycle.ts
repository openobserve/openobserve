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

import { computed, ref, shallowReactive, watch, type ComputedRef } from "vue";

import { trackAssistant } from "@/services/assistantAnalytics";
import { b64DecodeUnicode } from "@/utils/formatters";

import { isRunning, type AssistantStoreInternal } from "./assistantStore";
import type { AssistantSession, Sid, TurnEngine } from "./assistantStore.types";
import type { AssistantHintChannel } from "./hints";
import { askLifecycle, releaseLeaveGuards, runLeaveGuards } from "./lifecycleQuestions";
import { getAssistantRuntime } from "./runtime";
import type { AssistantClient, StopTarget } from "./useAssistantClient";
import { discardProposals } from "./useEditorProposal";

/** Live-turn entries older than this are pruned on read: no turn runs that long. */
export const LIVE_TURN_TTL_MS = 60 * 60_000;

export const LIVE_TURNS_PREFIX = "o2.assistant.liveTurns:";

// The ledger never grows past this, whatever a broken tab wrote.
const MAX_LIVE_TURNS = 50;

const NEEDS_YOU: ReadonlySet<string> = new Set(["awaiting_approval", "awaiting_consent"]);

/** The tab holding an approval card re-announces it this often, so other tabs know it is still there. */
export const APPROVAL_HEARTBEAT_MS = 20_000;

/** Another tab's approval card counts as gone once its holder has been silent this long; a hidden tab's timers can run once a minute, so this spans more than two such beats. */
export const APPROVAL_STALE_MS = 150_000;

/** A holding tab that sends no beat back within this long is gone, and the waiting tab cancels the turn itself. */
export const STOP_RELAY_MS = 3_000;

/** One `{org, sid, origin, turnId, at}` of the user's live-turn ledger (ids only). */
export interface LiveTurn {
  org: string;
  sid: Sid;
  origin: "chat" | "rca";
  turnId: string;
  at: number;
}

/** How a sign-out or an org switch was started: the control that asked, and whether the user may still cancel. */
export interface LifecycleTrigger {
  invoker?: HTMLElement | null;
  /** A sign-out the app forces (a 403): nothing is asked, everything is still cancelled and purged. */
  forced?: boolean;
}

// A turn this tab runs, as the other tabs hear about it.
interface LiveMirror {
  turnId: string;
  org: string;
  userOrgKey: string;
  origin: "chat" | "rca";
}

// An approval card this tab shows, re-announced to the other tabs while it waits.
interface HeldCard {
  userOrgKey: string;
  turnId: string;
  callId: string;
  expiresAt?: number;
}

export interface AssistantLifecycle {
  onSignOut(trigger?: LifecycleTrigger): Promise<"proceed" | "cancel">;
  onOrgSwitch(
    next: { org: string; userOrgKey: string },
    trigger?: LifecycleTrigger,
  ): Promise<"proceed" | "cancel">;
  onSessionExpired(): void;
  /** The session is back: the lock lifts only when `userInfo` (by default the stored one) names this tab's own user. */
  onSignedIn(userInfo?: string | null): void;
}

/** The lifecycle the runtime builds once, with its view state. */
export interface AssistantLifecycleRuntime extends AssistantLifecycle {
  /** Another tab signed out: containers show the notice and Send stays off. */
  signedOutElsewhere: ComputedRef<boolean>;
  /** A different account signed in elsewhere while this tab was signed out: only a reload continues. */
  otherAccountSignedIn: ComputedRef<boolean>;
  /** Same-browser sessions another tab runs or waits on, for the header light. */
  remoteLight(): { state: "needs_you" | "working"; sid: Sid } | null;
  /** True while another tab holds this session's approval card. */
  approvalElsewhere(sid: Sid): boolean;
  /** Stop on a turn another tab's card holds: that tab declines the card first, then the turn is cancelled. */
  stopElsewhere(sid: Sid): Promise<void>;
  /** Why no turn may start in `sid` from this tab right now, or `null`. */
  turnLock(sid: Sid | null): TurnLockReason | null;
  dispose(): void;
}

/** A cross-tab reason that keeps this tab from starting a turn. */
export type TurnLockReason = "signed_out" | "account_changed" | "approval_elsewhere";

export interface LifecycleDeps {
  store: AssistantStoreInternal;
  hints: AssistantHintChannel;
  engine: TurnEngine;
  client: Pick<AssistantClient, "stop">;
  now(): number;
  /** The org being left, for the dialog's "{org}". */
  currentOrgName(): string;
  currentOrg(): string | null;
  /** The email this tab's sessions belong to. */
  currentEmail(): string | null;
  /** Purges chat data at rest on every sign-out. */
  purge?(): Promise<void>;
  /** A turn this tab ran ended; other tabs hear the `turn_ended` hint instead. */
  onTurnEnded?(org: string): void;
}

export {
  GUARD_RELEASE_MS,
  askLeaveGuard,
  askLifecycle,
  registerLifecycleDialogs,
  resetLifecycleForTests,
  runLeaveGuards,
  useAssistantLeaveGuard,
  useLifecycleQuestion,
  type LeaveGuard,
  type LifecycleChoice,
  type LifecycleQuestion,
  type OpenQuestion,
} from "./lifecycleQuestions";

/** The lifecycle the shell's sign-out and org selector call, built with the runtime on first use. */
export const assistantLifecycle: AssistantLifecycle = /* @__PURE__ */ lazyLifecycle();

/** The live-turn ledger, newest last; older than an hour is gone. */
export function readLiveTurns(userHash: string | null, now: number = Date.now()): LiveTurn[] {
  if (!userHash) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ledgerKey(userHash)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is LiveTurn => isLiveTurn(entry) && now - entry.at < LIVE_TURN_TTL_MS,
    );
  } catch {
    return [];
  }
}

/** Read-merge-write, so two tabs adding at once both keep their entry. */
export function writeLiveTurn(
  userHash: string | null,
  change: { add?: LiveTurn; remove?: { sid: Sid; turnId?: string } },
  now: number = Date.now(),
): void {
  if (!userHash) return;
  const entries = readLiveTurns(userHash, now).filter(
    (entry) =>
      !(
        change.remove &&
        entry.sid === change.remove.sid &&
        (!change.remove.turnId || entry.turnId === change.remove.turnId)
      ) && !(change.add && entry.sid === change.add.sid),
  );
  if (change.add) entries.push(change.add);
  try {
    if (entries.length)
      localStorage.setItem(ledgerKey(userHash), JSON.stringify(entries.slice(-MAX_LIVE_TURNS)));
    else localStorage.removeItem(ledgerKey(userHash));
  } catch {
    // Blocked storage: hints alone still reach the tabs that are awake.
  }
}

export function clearLiveTurns(userHash: string | null): void {
  if (!userHash) return;
  try {
    localStorage.removeItem(ledgerKey(userHash));
  } catch {
    // Blocked storage held no ledger.
  }
}

/** Builds the lifecycle over the runtime's store, hints and engine; the runtime calls it once. */
export function createLifecycle(deps: LifecycleDeps): AssistantLifecycleRuntime {
  const { store, hints } = deps;
  const signedOut = ref(false);
  const otherAccount = ref(false);
  // Another tab's live sessions for the header light; a tab that closed mid-turn ages out with the ledger's TTL.
  const remote = shallowReactive(
    new Map<Sid, { org: string; state: "needs_you" | "working"; at: number; expiresAt?: number }>(),
  );
  const cardLive = (entry: { at: number; expiresAt?: number }, now: number) =>
    now - entry.at < APPROVAL_STALE_MS && (entry.expiresAt === undefined || now < entry.expiresAt);
  const offs: (() => void)[] = [];

  // An expired card leaves the map on time, so the computeds reading it update without other traffic.
  let expiry: ReturnType<typeof setTimeout> | null = null;
  const expireLater = () => {
    if (expiry) return;
    expiry = setTimeout(() => {
      expiry = null;
      const now = deps.now();
      for (const [sid, entry] of remote)
        if (entry.state === "needs_you" && !cardLive(entry, now)) remote.delete(sid);
      if ([...remote.values()].some((entry) => entry.state === "needs_you")) expireLater();
    }, APPROVAL_HEARTBEAT_MS);
  };

  const onSessionExpired = () => {
    if (signedOut.value) return;
    signedOut.value = true;
    discardProposals();
    void deps.engine.signedOutElsewhere?.();
  };

  offs.push(
    hints.on("signed_out", onSessionExpired),
    hints.on("turn_started", (hint) => {
      const local = store.state.sessions[hint.sid];
      // A card here is stale once another tab continues the same chat.
      if (local?.pendingApproval)
        void store.decideApproval(hint.sid, { approved: false, reason: "withdrawn" });
      if (!local || !isRunning(local.turn))
        remote.set(hint.sid, { org: hint.org, state: "working", at: deps.now() });
    }),
    hints.on("turn_ended", (hint) => void remote.delete(hint.sid)),
    hints.on("approval_pending", (hint) => {
      if (store.state.sessions[hint.sid]?.pendingApproval) return;
      remote.set(hint.sid, {
        org: deps.currentOrg() ?? "",
        state: "needs_you",
        at: deps.now(),
        ...(hint.expiresAt !== undefined && { expiresAt: hint.expiresAt }),
      });
      expireLater();
    }),
    hints.on("approval_resolved", (hint) => {
      if (remote.get(hint.sid)?.state === "needs_you") remote.delete(hint.sid);
    }),
    hints.on("approval_stop", (hint) => {
      if (!store.state.sessions[hint.sid]?.pendingApproval) return;
      mirror.beat();
      void store.stop(hint.sid);
    }),
    ...(["prefs_changed", "history_changed", "share_changed", "consent_granted"] as const).map(
      (type) => hints.on(type, (hint) => store.applyHint(hint)),
    ),
  );
  // A login by another account must not hand this tab's chats to it; that one needs a reload.
  const onSignedIn = (userInfo: string | null = readUserInfo()) => {
    if (!signedOut.value) return;
    const email = emailOfUserInfo(userInfo);
    if (!email) return;
    const same = email === deps.currentEmail();
    signedOut.value = !same;
    otherAccount.value = !same;
  };
  const mirror = mirrorTurns(deps);
  offs.push(
    mirror.stop,
    watchUserInfo(onSessionExpired, onSignedIn),
    () => expiry && clearTimeout(expiry),
  );

  const lifecycle: AssistantLifecycleRuntime = {
    signedOutElsewhere: computed(() => signedOut.value),
    otherAccountSignedIn: computed(() => otherAccount.value),
    remoteLight() {
      const org = deps.currentOrg();
      let working: Sid | null = null;
      for (const [sid, entry] of remote) {
        if (
          entry.state === "needs_you"
            ? !cardLive(entry, deps.now())
            : deps.now() - entry.at >= LIVE_TURN_TTL_MS
        )
          continue;
        if (org && entry.org && entry.org !== org) continue;
        if (entry.state === "needs_you") return { state: "needs_you", sid };
        working ??= sid;
      }
      return working ? { state: "working", sid: working } : null;
    },
    approvalElsewhere: (sid) => {
      const entry = remote.get(sid);
      return entry?.state === "needs_you" && cardLive(entry, deps.now());
    },
    async stopElsewhere(sid) {
      const userOrgKey = store.state.sessions[sid]?.userOrgKey ?? store.state.userOrgKey;
      const before = remote.get(sid);
      if (userOrgKey)
        hints.postFor(userOrgKey, { v: 1, type: "approval_stop", sid, at: deps.now() });
      // Only a fresh beat from a holder that still has the card means it declines and cancels itself; a release, a sweep or silence leaves the cancel to this tab.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let off = () => {};
      const answered = await new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), STOP_RELAY_MS);
        off = watch(
          () => remote.get(sid),
          (entry) => {
            if (entry === before) return;
            resolve(entry?.state === "needs_you");
          },
        );
      });
      clearTimeout(timer);
      off();
      if (answered) return;
      remote.delete(sid);
      await store.cancelTurn(sid, null);
    },
    turnLock(sid) {
      if (otherAccount.value) return "account_changed";
      if (signedOut.value) return "signed_out";
      return sid && lifecycle.approvalElsewhere(sid) ? "approval_elsewhere" : null;
    },
    onSessionExpired,
    onSignedIn,
    async onSignOut(trigger = {}) {
      if (trigger.forced) releaseLeaveGuards();
      else if (!(await runLeaveGuards())) return "cancel";
      const count = liveCount(store) + otherTabTurns(deps).length;
      if (count > 0 && !trigger.forced) {
        const choice = await askLifecycle({ kind: "sign_out", count, invoker: trigger.invoker });
        trackAssistant("ai_sign_out_with_turns", { count, choice });
        if (choice === "cancel") return "cancel";
      }
      discardProposals();
      const others = otherTabTurns(deps);
      // The store posts `signed_out` and aborts this tab's turns first; other tabs' turns are cancelled from the ledger.
      const stopped = store.onSignOut();
      for (const entry of others) cancelLiveTurn(deps, entry);
      await stopped;
      clearLiveTurns(hints.userHash());
      mirror.releaseCards();
      await deps.purge?.().catch(() => undefined);
      remote.clear();
      return "proceed";
    },
    async onOrgSwitch(next, trigger = {}) {
      if (!(await runLeaveGuards())) return "cancel";
      const affected = Object.values(store.state.sessions).filter(
        (s) => s.userOrgKey === store.state.userOrgKey && (isRunning(s.turn) || waiting(s)),
      );
      if (affected.length > 0) {
        const count = affected.length;
        const choice = await askLifecycle({
          kind: "org_switch",
          count,
          waiting: affected.filter((s) => !!s.pendingApproval).length,
          org: deps.currentOrgName(),
          invoker: trigger.invoker,
        });
        trackAssistant("ai_org_switch_with_turns", { count, choice });
        if (choice === "cancel") return "cancel";
        await settleOnSwitch(store, affected, choice);
      }
      // The dock closes only once the switch is certain; a Cancel leaves the chat where it was.
      if (store.state.shell.placement.kind === "docked") store.close("host_closed");
      discardProposals();
      mirror.releaseCards();
      remote.clear();
      return store.onOrgSwitch(next);
    },
    dispose() {
      offs.forEach((off) => off());
    },
  };
  return lifecycle;
}

// Stop cancels every affected turn; Keep withdraws what the new org could not show and lets the rest run under the old key.
async function settleOnSwitch(
  store: AssistantStoreInternal,
  sessions: AssistantSession[],
  choice: "stop" | "keep",
): Promise<void> {
  await Promise.all(
    sessions.map((session) => {
      if (choice === "stop") return store.stop(session.sid);
      // The deny goes out with keepalive and records its own answer; the switch never waits on it.
      if (session.pendingApproval)
        return void store.decideApproval(session.sid, { approved: false, reason: "withdrawn" });
      return session.pendingConsent || session.turn.state === "awaiting_consent"
        ? store.stop(session.sid)
        : undefined;
    }),
  );
}

// This tab's chats that run or wait on the user, of every org it holds.
function liveCount(store: AssistantStoreInternal): number {
  return Object.values(store.state.sessions).filter((s) => isRunning(s.turn) || waiting(s)).length;
}

function waiting(session: AssistantSession): boolean {
  return NEEDS_YOU.has(session.turn.state) || !!session.pendingApproval || !!session.pendingConsent;
}

function otherTabTurns(deps: LifecycleDeps): LiveTurn[] {
  const mine = deps.store.state.sessions;
  return readLiveTurns(deps.hints.userHash(), deps.now()).filter(
    (entry) => !mine[entry.sid] || !isRunning(mine[entry.sid].turn),
  );
}

// A cancel of a turn that already ended is a harmless 200/404; the incident route needs the incident id the ledger does not hold.
function cancelLiveTurn(deps: LifecycleDeps, entry: LiveTurn): void {
  const target: StopTarget = {
    sid: entry.sid,
    turnId: entry.turnId,
    origin: {
      entryKind: "header_button",
      objectKind: "none",
      container: entry.origin === "rca" ? "rca" : "sidebar",
    },
    record: {} as StopTarget["record"],
  };
  void deps.client.stop(entry.org, target).catch(() => undefined);
}

// Every turn this tab starts is announced on its own org's channel and the user channel, and kept in the ledger until it ends.
function mirrorTurns(deps: LifecycleDeps): { stop(): void; releaseCards(): void; beat(): void } {
  const { store, hints } = deps;
  const live = new Map<Sid, LiveMirror>();
  const pendingCards = new Map<Sid, HeldCard>();
  const announceCard = (sid: Sid, card: HeldCard) =>
    hints.postFor(card.userOrgKey, {
      v: 1,
      type: "approval_pending",
      sid,
      turnId: card.turnId,
      callId: card.callId,
      ...(card.expiresAt !== undefined && { expiresAt: card.expiresAt }),
      at: deps.now(),
    });
  const announceTurn = (sid: Sid, known: LiveMirror) =>
    hints.postFor(known.userOrgKey, {
      v: 1,
      type: "turn_started",
      org: known.org,
      sid,
      turnId: known.turnId,
      origin: known.origin,
      at: deps.now(),
    });
  const beatNow = () => pendingCards.forEach((card, sid) => announceCard(sid, card));
  // A card whose chat is gone here (a reset, a sign-out) is let go at once, or other tabs would stay locked.
  const releaseCard = (sid: Sid) => {
    const card = pendingCards.get(sid);
    if (!card) return;
    pendingCards.delete(sid);
    hints.postFor(card.userOrgKey, {
      v: 1,
      type: "approval_resolved",
      sid,
      approved: false,
      at: deps.now(),
    });
  };
  // While a card waits here, other tabs hear about it on a heartbeat; silence means this tab is gone.
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const beat = () => {
    if (pendingCards.size && !heartbeat) heartbeat = setInterval(beatNow, APPROVAL_HEARTBEAT_MS);
    else if (!pendingCards.size && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  // A closing tab lets the others go at once instead of after the silence.
  const onPageHide = () => {
    const at = deps.now();
    pendingCards.forEach((card, sid) =>
      hints.postFor(card.userOrgKey, { v: 1, type: "approval_resolved", sid, approved: false, at }),
    );
    live.forEach((known, sid) =>
      hints.postFor(known.userOrgKey, {
        v: 1,
        type: "turn_ended",
        org: known.org,
        sid,
        turnId: known.turnId,
        status: "interrupted",
        at,
      }),
    );
  };
  // A page restored from the back-forward cache said goodbye on its way out, so it says hello again.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    beatNow();
    live.forEach((known, sid) => announceTurn(sid, known));
  };
  const listeners: [string, EventListener][] = [
    ["pagehide", onPageHide],
    ["pageshow", onPageShow as EventListener],
  ];
  if (typeof window !== "undefined")
    listeners.forEach(([type, listener]) => window.addEventListener(type, listener));
  // A tab that goes hidden is throttled, and one that comes back may have missed beats; both send one at once.
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", beatNow);
  const stop = watch(
    () =>
      Object.values(store.state.sessions).map((s) => ({
        sid: s.sid,
        org: s.org,
        userOrgKey: s.userOrgKey,
        turnId: s.turnMeta.turnId,
        mine: s.turnMeta.ownedByThisTab,
        running: isRunning(s.turn) && s.turn.state !== "queued",
        state: s.turn.state,
        origin: s.origin.container === "rca" ? ("rca" as const) : ("chat" as const),
        card: s.pendingApproval?.id ?? null,
        cardExpiresAt: s.pendingApproval?.expiresAt,
      })),
    (rows) => {
      const at = deps.now();
      const seen = new Set<Sid>();
      for (const row of rows) {
        seen.add(row.sid);
        const known = live.get(row.sid);
        if (row.running && row.mine && row.turnId && known?.turnId !== row.turnId) {
          const mirror: LiveMirror = {
            turnId: row.turnId,
            org: row.org,
            userOrgKey: row.userOrgKey,
            origin: row.origin,
          };
          live.set(row.sid, mirror);
          announceTurn(row.sid, mirror);
          writeLiveTurn(
            hints.userHash(),
            { add: { org: row.org, sid: row.sid, origin: row.origin, turnId: row.turnId, at } },
            at,
          );
        } else if (!row.running && known) {
          endTurn(deps, row.sid, known, statusOf(row.state), at);
          live.delete(row.sid);
        }
        if (row.card && row.mine && !pendingCards.has(row.sid)) {
          const card: HeldCard = {
            userOrgKey: row.userOrgKey,
            turnId: row.turnId ?? "",
            callId: row.card,
            ...(row.cardExpiresAt !== undefined && { expiresAt: row.cardExpiresAt }),
          };
          pendingCards.set(row.sid, card);
          announceCard(row.sid, card);
        } else if (!row.card && pendingCards.delete(row.sid)) {
          hints.postFor(row.userOrgKey, {
            v: 1,
            type: "approval_resolved",
            sid: row.sid,
            approved: row.running,
            at,
          });
        }
      }
      for (const [sid, known] of live) {
        if (seen.has(sid)) continue;
        endTurn(deps, sid, known, "cancelled", at);
        live.delete(sid);
      }
      for (const sid of pendingCards.keys()) if (!seen.has(sid)) releaseCard(sid);
      beat();
    },
    { deep: true },
  );
  return {
    releaseCards: () => {
      [...pendingCards.keys()].forEach(releaseCard);
      beat();
    },
    beat: beatNow,
    stop: () => {
      stop();
      if (heartbeat) clearInterval(heartbeat);
      if (typeof window !== "undefined")
        listeners.forEach(([type, listener]) => window.removeEventListener(type, listener));
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", beatNow);
    },
  };
}

function endTurn(
  deps: LifecycleDeps,
  sid: Sid,
  known: { turnId: string; org: string; userOrgKey: string },
  status: "completed" | "cancelled" | "failed" | "interrupted",
  at: number,
): void {
  deps.hints.postFor(known.userOrgKey, {
    v: 1,
    type: "turn_ended",
    org: known.org,
    sid,
    turnId: known.turnId,
    status,
    at,
  });
  deps.onTurnEnded?.(known.org);
  writeLiveTurn(deps.hints.userHash(), { remove: { sid, turnId: known.turnId } }, at);
}

function statusOf(state: string): "completed" | "cancelled" | "failed" | "interrupted" {
  if (state === "done") return "completed";
  if (state === "stopped") return "cancelled";
  return state === "failed" ? "failed" : "interrupted";
}

// A tab that missed the hint still sees the login data go and come back: logout removes `userInfo`, a login writes it.
function watchUserInfo(
  onExpired: () => void,
  onSignedIn: (userInfo: string | null) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: StorageEvent) => {
    if (event.key !== "userInfo") return;
    if (event.oldValue && !event.newValue) onExpired();
    else if (event.newValue) onSignedIn(event.newValue);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

function readUserInfo(): string | null {
  try {
    return localStorage.getItem("userInfo");
  } catch {
    return null;
  }
}

/** The email in the app's stored login data (base64 JSON), or `null` when it names nobody. */
export function emailOfUserInfo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const decoded: unknown = JSON.parse(b64DecodeUnicode(raw) ?? "");
    const email = (decoded as { email?: unknown } | null)?.email;
    return typeof email === "string" && email ? email : null;
  } catch {
    return null;
  }
}

function ledgerKey(userHash: string): string {
  return `${LIVE_TURNS_PREFIX}${userHash}`;
}

function isLiveTurn(value: unknown): value is LiveTurn {
  const entry = value as Partial<LiveTurn> | null;
  return (
    !!entry &&
    typeof entry.org === "string" &&
    typeof entry.sid === "string" &&
    typeof entry.turnId === "string" &&
    (entry.origin === "chat" || entry.origin === "rca") &&
    typeof entry.at === "number"
  );
}

function lazyLifecycle(): AssistantLifecycle {
  return {
    onSignOut: (trigger) => getAssistantRuntime().lifecycle.onSignOut(trigger),
    onOrgSwitch: (next, trigger) => getAssistantRuntime().lifecycle.onOrgSwitch(next, trigger),
    onSessionExpired: () => getAssistantRuntime().lifecycle.onSessionExpired(),
    onSignedIn: (userInfo) => getAssistantRuntime().lifecycle.onSignedIn(userInfo),
  };
}
