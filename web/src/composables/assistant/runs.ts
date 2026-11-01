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

import { computed, nextTick, ref, shallowRef, watch, type ComputedRef, type Ref } from "vue";

import assistantService, { type ChatSummaryWire } from "@/services/assistant";
import { raw, type I18nText } from "@/types/i18n";

import { isRunning, openWindowsOf, type AssistantStoreInternal } from "./assistantStore";
import type {
  AssistantSession,
  AssistantState,
  HintChannel,
  PendingApproval,
  Sid,
} from "./assistantStore.types";
import { isHelperChat } from "./historyContext";
import { HEARTBEAT_TRUST_MS } from "./historyElsewhere";
import type { RemoteTurn } from "./lifecycle";
import { runtimeHandle } from "./runtimeHandle";

/** The list shows the server's cap once a 429 named it; until then this default (`80` §1.3). */
export const RUN_CAP_DEFAULT = 3;

/** An unseen finished row older than this stays only in the rail and history (D2 §5.5). */
export const UNSEEN_RUN_MS = 30 * 60_000;

export const RUNS_CLEARED_PREFIX = "o2.assistant.runsCleared:";

// Old entries go first; a chat that finished again is listed regardless of its old entry.
const MAX_CLEARED = 200;

// Elapsed times and the heartbeat's 5 s window move on this tick while any row is listed.
const RUNS_TICK_MS = 1_000;

const GROUP_ORDER: Record<RunGroup, number> = { needs_you: 0, answering: 1, failed: 2, ready: 3 };

const FINISHED: Record<string, RunStatus> = {
  completed: "ready",
  failed: "failed",
  interrupted: "failed",
  cancelled: "stopped",
};

export type RunGroup = "needs_you" | "answering" | "failed" | "ready";

export type RunStatus =
  "working" | "reconnecting" | "elsewhere" | "needsApproval" | "ready" | "failed" | "stopped";

/** One row of Chats in progress. */
export interface RunRow {
  sid: Sid;
  org: string;
  /** `null`: no title is known here, so the row says "New chat" or "A chat in {org}". */
  title: I18nText | null;
  group: RunGroup;
  status: RunStatus;
  /** A wire agent id; `null` reads as the default agent. */
  agent: string | null;
  /** When it started or finished, for "newest first" and the row's time. */
  at: number;
  startedAt: number | null;
  turnId: string | null;
  /** Identifies the decision a needs-you row waits on; one consent request is one decision for every chat. */
  request: string | null;
  expiresAt: number | null;
  /** The card's user More time left, once the server said. */
  extendsLeft: number | null;
  /** The card this tab holds for the decision, which the notice names; `null` when only the server knows it. */
  card: PendingApproval | null;
  consent: boolean;
  /** Another org's chat: counted in the light, never opened in place (PO B51). */
  otherOrg: boolean;
  /** Past the 30 minutes: the list no longer counts it as new. */
  stale: boolean;
}

export interface RunsInput {
  sessions: AssistantSession[];
  chats: ChatSummaryWire[];
  remote: RemoteTurn[];
  cleared: Readonly<Record<Sid, number>>;
  org: string;
  userOrgKey: string | null;
  clientId: string;
  now: number;
}

export interface RunsCounts {
  needs: number;
  answering: number;
  failed: number;
  ready: number;
}

export interface RunsDeps {
  store(): AssistantStoreInternal;
  hints: Pick<HintChannel, "on" | "post">;
  remote(): RemoteTurn[];
  now(): number;
  org(): string | null;
  clientId(): string;
  serverMode(): boolean;
  /** Follows the `state=active` read; returns its stop. */
  watchActive(org: string, onChats: (chats: ChatSummaryWire[]) => void): () => void;
  invalidateActive(org: string): void;
  /** Shows the container on the active chat, wherever it lives. */
  reveal(invoker: HTMLElement | null): Promise<unknown>;
  focusCard(): boolean;
  stopElsewhere(sid: Sid): Promise<void>;
  approvalElsewhere(sid: Sid): boolean;
}

export interface AssistantRuns {
  /** Everything the list shows, this org first and then other orgs' rows. */
  rows: ComputedRef<RunRow[]>;
  otherOrg: ComputedRef<RunRow[]>;
  cap: ComputedRef<number>;
  /** Running chats, a chat waiting on an approval included (D2 decision 10). */
  active: ComputedRef<number>;
  /** One per decision, however many chats wait on it; other orgs' count too, as in the light. */
  needsCount: ComputedRef<number>;
  /** Decisions no visible container shows, other orgs' included, expiring first; for the notice and its warnings. */
  decisions: ComputedRef<RunRow[]>;
  /** Set until a container takes the request, so one that mounts late still opens All chats. */
  openRequested: Readonly<Ref<boolean>>;
  /** Shows the container and asks it for All chats, In progress leading. */
  requestOpen(invoker?: HTMLElement | null): Promise<void>;
  takeOpenRequest(): void;
  stop(row: RunRow): Promise<void>;
  open(
    row: RunRow,
    opts?: { focus?: "composer" | "card"; invoker?: HTMLElement | null },
  ): Promise<void>;
  /** The chats no tab of this browser runs: the header light's last source. */
  light(): { state: "needs_you" | "working"; sid: Sid } | null;
  dispose(): void;
}

/** The rows of Chats in progress for one user+org, in the list's order (D2 §5.5). */
export function runsList(input: RunsInput): RunRow[] {
  const rows = new Map<Sid, RunRow>();
  let consentListed = false;
  for (const session of input.sessions) {
    const row = sessionRow(session, input);
    if (!row || (row.consent && consentListed)) continue;
    consentListed ||= row.consent;
    rows.set(session.sid, row);
  }
  for (const turn of input.remote) {
    const known = rows.get(turn.sid);
    if (known?.status === "working" && !turn.beatAt) continue;
    if (known?.group === "needs_you" && turn.state === "working") continue;
    const row = turn.org && turn.org !== input.org ? null : remoteRow(turn, input);
    if (row) rows.set(turn.sid, row);
  }
  const sessions = new Map(input.sessions.map((session) => [session.sid, session]));
  for (const chat of input.chats) {
    if (rows.has(chat.session_id)) continue;
    const row = serverRow(chat, sessions.get(chat.session_id), input);
    if (row) rows.set(chat.session_id, row);
  }
  return [...rows.values()]
    .filter((row) => !isCleared(row, input.cleared))
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || b.at - a.at);
}

/** Another org's chats this tab knows of, after every current-org row; they never count toward `active`. */
export function otherOrgRuns(
  input: Pick<RunsInput, "sessions" | "remote" | "org" | "userOrgKey" | "now">,
): RunRow[] {
  const rows = new Map<Sid, RunRow>();
  for (const session of input.sessions) {
    if (session.userOrgKey === input.userOrgKey || session.record.ephemeral) continue;
    if (!isRunning(session.turn) && !session.pendingApproval) continue;
    rows.set(session.sid, {
      ...baseRow(session.sid, session.org, input.now),
      title: session.title,
      group: session.pendingApproval ? "needs_you" : "answering",
      status: session.pendingApproval ? "needsApproval" : "working",
      request: session.pendingApproval?.id ?? null,
      expiresAt: session.pendingApproval?.expiresAt ?? null,
      card: session.pendingApproval ?? null,
      otherOrg: true,
    });
  }
  for (const turn of input.remote) {
    if (!turn.org || turn.org === input.org || rows.has(turn.sid)) continue;
    rows.set(turn.sid, {
      ...baseRow(turn.sid, turn.org, input.now),
      group: turn.state === "needs_you" ? "needs_you" : "answering",
      status: turn.state === "needs_you" ? "needsApproval" : "working",
      request: turn.state === "needs_you" ? turn.sid : null,
      expiresAt: turn.expiresAt ?? null,
      otherOrg: true,
    });
  }
  return [...rows.values()];
}

/** Counts per signal, for the Runs button and the list's summary line. */
export function runsCounts(rows: readonly RunRow[]): RunsCounts {
  const counts: RunsCounts = { needs: 0, answering: 0, failed: 0, ready: 0 };
  for (const row of rows) {
    if (row.group === "needs_you") counts.needs += 1;
    else counts[row.group] += 1;
  }
  return counts;
}

/** The chats a visible container shows; a tray bar is not visible. */
export function shownSids(state: Pick<AssistantState, "shell">): Sid[] {
  const { shell } = state;
  const active = shell.placement.kind !== "hidden" && shell.activeSid ? [shell.activeSid] : [];
  return [...active, ...openWindowsOf(shell).map((w) => w.sid)];
}

/** The display name of a wire agent id; `sre-rca` runs show as Investigator (D2 §4). */
export function runAgentKey(agent: string | null): "general" | "investigator" | "queryBuilder" {
  if (agent === "sre" || agent === "sre-rca") return "investigator";
  return agent === "generate-query" || agent === "generate_query" ? "queryBuilder" : "general";
}

/** `{ sid: when }` of the rows cleared in this browser; blocked storage clears nothing across tabs. */
export function readRunsCleared(userOrgKey: string | null): Record<Sid, number> {
  if (!userOrgKey) return {};
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(`${RUNS_CLEARED_PREFIX}${userOrgKey}`) ?? "{}",
    );
    return parsed && typeof parsed === "object" ? (parsed as Record<Sid, number>) : {};
  } catch {
    return {};
  }
}

/** Read-merge-write, so two tabs clearing at once both keep theirs. */
export function writeRunsCleared(
  userOrgKey: string | null,
  sids: readonly Sid[],
  at: number,
): Record<Sid, number> {
  const merged = { ...readRunsCleared(userOrgKey) };
  for (const sid of sids) merged[sid] = at;
  const kept = Object.entries(merged)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CLEARED);
  const next = Object.fromEntries(kept);
  try {
    if (userOrgKey)
      localStorage.setItem(`${RUNS_CLEARED_PREFIX}${userOrgKey}`, JSON.stringify(next));
  } catch {
    // Blocked storage: the row stays cleared in this tab until it reloads.
  }
  return next;
}

/** Builds the runtime's one list; the store and the hints exist by the time anything reads it. */
export function createRuns(deps: RunsDeps): AssistantRuns {
  const state = () => deps.store().state;
  const chats = shallowRef<ChatSummaryWire[]>([]);
  const cleared = shallowRef<Record<Sid, number>>({});
  const clock = ref(deps.now());
  const limit = ref<number | null>(null);
  const openRequested = ref(false);
  const key = computed(() => state().userOrgKey);

  const input = (): RunsInput => ({
    sessions: Object.values(state().sessions),
    chats: chats.value,
    remote: deps.remote(),
    cleared: cleared.value,
    org: deps.org() ?? "",
    userOrgKey: key.value,
    clientId: deps.clientId(),
    now: clock.value,
  });

  const all = computed(() => runsList(input()));
  const otherOrg = computed(() => otherOrgRuns(input()));
  const listed = computed(() => all.value.filter((row) => !row.stale));
  const rows = computed(() => [...listed.value, ...otherOrg.value]);
  const running = computed(() =>
    listed.value.filter(
      (row) => (row.group === "needs_you" && !row.consent) || row.group === "answering",
    ),
  );
  const decisions = computed(() => {
    const shown = shownSids(state());
    return rows.value
      .filter((row) => row.group === "needs_you" && !shown.includes(row.sid))
      .sort((a, b) => expiryOf(a) - expiryOf(b));
  });
  const finished = (row: RunRow) => row.group === "failed" || row.group === "ready";

  const clearAll = (sids: Sid[]) => {
    if (!sids.length) return;
    const store = deps.store();
    cleared.value = writeRunsCleared(key.value, sids, deps.now());
    for (const sid of sids) {
      store.markRead(sid);
      deps.hints.post({ v: 1, type: "runs_cleared", sid, at: deps.now() });
    }
  };

  // Seen means opened in any container (D2 §5.5), so a finished row the user is looking at leaves by itself.
  const stopSeen = watch(
    () =>
      listed.value
        .filter((row) => finished(row) && shownSids(state()).includes(row.sid))
        .map((row) => row.sid),
    clearAll,
  );

  // A 429 names the real cap, which an admin may have changed from the default.
  const stopLimit = watch(
    () => {
      const { shell, sessions } = state();
      for (const sid of [shell.activeSid, ...openWindowsOf(shell).map((w) => w.sid)]) {
        const turn = sid ? sessions[sid]?.turn : undefined;
        if (turn?.state === "refused" && turn.error.code === "run_limit_member")
          return turn.error.limit ?? null;
      }
      return null;
    },
    (value) => {
      if (value !== null) limit.value = value;
    },
  );

  const stopCleared = deps.hints.on("runs_cleared", () => {
    cleared.value = readRunsCleared(key.value);
  });
  const stopKey = watch(
    key,
    (value) => {
      cleared.value = readRunsCleared(value);
      chats.value = [];
    },
    { immediate: true },
  );

  let stopActive: (() => void) | null = null;
  const stopFollow = watch(
    () => (deps.serverMode() ? deps.org() : null),
    (org) => {
      stopActive?.();
      stopActive = null;
      if (org) stopActive = deps.watchActive(org, (next) => (chats.value = next));
    },
    { immediate: true },
  );

  let timer: ReturnType<typeof setInterval> | null = null;
  const stopTick = watch(
    () => all.value.length + otherOrg.value.length > 0,
    (any) => {
      if (timer) clearInterval(timer);
      timer = any ? setInterval(() => (clock.value = deps.now()), RUNS_TICK_MS) : null;
    },
    { immediate: true },
  );

  const stopRow = async (row: RunRow) => {
    const store = deps.store();
    const session = store.state.sessions[row.sid];
    if (session?.turnMeta.ownedByThisTab) await store.stop(row.sid);
    else if (deps.approvalElsewhere(row.sid)) await deps.stopElsewhere(row.sid);
    else if (session) await store.cancelTurn(row.sid, row.turnId);
    // A chat only the server lists has no session here; the cancel still reaches its turn (MA-10 AC 3).
    else if (row.turnId) await assistantService.cancelTurn(row.org, row.sid, row.turnId);
    deps.invalidateActive(row.org);
  };

  const openRow: AssistantRuns["open"] = async (row, opts = {}) => {
    const store = deps.store();
    const focus = opts.focus ?? "composer";
    await store
      .openSession({ sid: row.sid }, { focus: focus === "composer" })
      .catch(() => undefined);
    await deps.reveal(opts.invoker ?? null);
    if (finished(row)) clearAll([row.sid]);
    if (focus !== "card") return;
    // The card mounts with the chat, which can take a render after the container shows.
    await nextTick();
    if (!deps.focusCard()) await nextTick(() => deps.focusCard());
  };

  return {
    rows,
    otherOrg,
    cap: computed(() => limit.value ?? RUN_CAP_DEFAULT),
    active: computed(() => running.value.length),
    needsCount: computed(
      () =>
        new Set(rows.value.filter((row) => row.group === "needs_you").map((row) => row.request))
          .size,
    ),
    decisions,
    openRequested,
    async requestOpen(invoker = null) {
      await deps.reveal(invoker);
      openRequested.value = true;
    },
    takeOpenRequest: () => void (openRequested.value = false),
    stop: stopRow,
    open: openRow,
    light() {
      const sessions = state().sessions;
      const others = chats.value.filter(
        (chat) => !sessions[chat.session_id]?.turnMeta.ownedByThisTab,
      );
      const waiting = others.find((chat) => chat.pending_approval);
      if (waiting) return { state: "needs_you", sid: waiting.session_id };
      const working = others.find((chat) => chat.active_turn);
      return working ? { state: "working", sid: working.session_id } : null;
    },
    dispose() {
      if (timer) clearInterval(timer);
      stopActive?.();
      for (const stop of [stopSeen, stopLimit, stopKey, stopFollow, stopTick, stopCleared]) stop();
    },
  };
}

/** The runtime's list, or an empty one before the runtime exists. */
export function useAssistantRuns(): AssistantRuns {
  return runtimeHandle().value?.runs ?? emptyRuns();
}

function emptyRuns(): AssistantRuns {
  const none = computed<RunRow[]>(() => []);
  const zero = computed(() => 0);
  return {
    rows: none,
    otherOrg: none,
    cap: computed(() => RUN_CAP_DEFAULT),
    active: zero,
    needsCount: zero,
    decisions: none,
    openRequested: ref(false),
    requestOpen: async () => undefined,
    takeOpenRequest: () => undefined,
    stop: async () => undefined,
    open: async () => undefined,
    light: () => null,
    dispose: () => undefined,
  };
}

function expiryOf(row: RunRow): number {
  return row.expiresAt ?? Number.POSITIVE_INFINITY;
}

function baseRow(sid: Sid, org: string, now: number): RunRow {
  return {
    sid,
    org,
    title: null,
    group: "answering",
    status: "working",
    agent: null,
    at: now,
    startedAt: null,
    turnId: null,
    request: null,
    expiresAt: null,
    extendsLeft: null,
    card: null,
    consent: false,
    otherOrg: false,
    stale: false,
  };
}

function isCleared(row: RunRow, cleared: Readonly<Record<Sid, number>>): boolean {
  if (row.group !== "failed" && row.group !== "ready") return false;
  return cleared[row.sid] !== undefined && cleared[row.sid] >= row.at;
}

function hasEvidence(
  session: AssistantSession,
  chat: ChatSummaryWire | undefined,
  input: RunsInput,
): boolean {
  const beatAt = input.remote.find((turn) => turn.sid === session.sid)?.beatAt;
  if (beatAt && input.now - beatAt < HEARTBEAT_TRUST_MS) return true;
  return !!chat?.active_turn_client_id && chat.active_turn_client_id !== input.clientId;
}

function sessionRow(session: AssistantSession, input: RunsInput): RunRow | null {
  if (session.userOrgKey !== input.userOrgKey || session.record.ephemeral) return null;
  const meta = session.turnMeta;
  const started = meta.startedAt ?? null;
  const base: RunRow = {
    ...baseRow(session.sid, session.org, input.now),
    title: session.title,
    agent: agentOf(session, input),
    at: started ?? input.now,
    startedAt: started,
    turnId: meta.turnId,
  };
  if (session.pendingConsent)
    return {
      ...base,
      group: "needs_you",
      status: "needsApproval",
      request: "consent",
      consent: true,
    };
  // A chat waiting on someone else's paid-usage card was never admitted, so that card's chat speaks for it.
  if (session.turn.state === "awaiting_consent") return null;
  const pending = session.pendingApproval;
  if (pending)
    return {
      ...base,
      group: "needs_you",
      status: "needsApproval",
      request: pending.id,
      expiresAt: pending.expiresAt ?? null,
      extendsLeft: pending.userExtendsLeft ?? null,
      card: pending,
    };
  if (isRunning(session.turn)) return { ...base, status: runningStatus(session, input) };
  return session.unread ? finishedRow(session, base, input) : null;
}

function runningStatus(session: AssistantSession, input: RunsInput): RunStatus {
  if (session.turn.state === "reconnecting") return "reconnecting";
  if (session.turnMeta.ownedByThisTab) return "working";
  const chat = input.chats.find((candidate) => candidate.session_id === session.sid);
  return hasEvidence(session, chat, input) ? "elsewhere" : "reconnecting";
}

function finishedRow(session: AssistantSession, base: RunRow, input: RunsInput): RunRow {
  const at = session.turnMeta.endedAt ?? base.at;
  const stale = input.now - at >= UNSEEN_RUN_MS;
  const { state } = session.turn;
  if (state === "stopped") return { ...base, group: "ready", status: "stopped", at, stale };
  if (state === "failed" || state === "refused")
    return { ...base, group: "failed", status: "failed", at, stale };
  return { ...base, group: "ready", status: "ready", at, stale };
}

function remoteRow(turn: RemoteTurn, input: RunsInput): RunRow | null {
  const session = input.sessions.find((candidate) => candidate.sid === turn.sid);
  if (session?.userOrgKey !== undefined && session.userOrgKey !== input.userOrgKey) return null;
  if (session?.record.ephemeral) return null;
  const chat = input.chats.find((candidate) => candidate.session_id === turn.sid);
  const fresh = !!turn.beatAt && input.now - turn.beatAt < HEARTBEAT_TRUST_MS;
  const owned = !!chat?.active_turn_client_id && chat.active_turn_client_id !== input.clientId;
  const needs = turn.state === "needs_you";
  return {
    ...baseRow(turn.sid, input.org, input.now),
    title: session?.title ?? (chat ? raw(chat.title) : null),
    agent: session ? agentOf(session, input) : (chat?.agent_type ?? null),
    at: session?.turnMeta.startedAt ?? input.now,
    startedAt: session?.turnMeta.startedAt ?? null,
    turnId: session?.turnMeta.turnId ?? chat?.active_turn_id ?? null,
    group: needs ? "needs_you" : "answering",
    status: needs ? "needsApproval" : fresh || owned ? "elsewhere" : "reconnecting",
    request: needs ? turn.sid : null,
    expiresAt: turn.expiresAt ?? null,
  };
}

// Without an owner id the server's own word that a turn runs is all there is, so the row states that and no more (PO B3).
function serverRow(
  chat: ChatSummaryWire,
  session: AssistantSession | undefined,
  input: RunsInput,
): RunRow | null {
  if (isHelperChat({ agentType: chat.agent_type, title: chat.title })) return null;
  const startedAt = chat.updated_at ? Math.floor(chat.updated_at / 1000) : null;
  const base: RunRow = {
    ...baseRow(chat.session_id, input.org, input.now),
    title: chat.title ? raw(chat.title) : null,
    agent: chat.agent_type ?? null,
    at: startedAt ?? input.now,
    startedAt,
    turnId: chat.active_turn_id ?? null,
  };
  if (chat.pending_approval)
    return { ...base, group: "needs_you", status: "needsApproval", request: chat.session_id };
  if (chat.active_turn) {
    const other = !!chat.active_turn_client_id && chat.active_turn_client_id !== input.clientId;
    return { ...base, status: other ? "elsewhere" : "reconnecting" };
  }
  // A chat this tab has open was seen here; `seen` absent means a server that cannot say, so nothing is claimed.
  if (session || chat.seen !== false) return null;
  const status = FINISHED[chat.last_turn_status ?? ""];
  if (!status) return null;
  const at = chat.last_turn_ended_at ? Math.floor(chat.last_turn_ended_at / 1000) : base.at;
  const stale = input.now - at >= UNSEEN_RUN_MS;
  const group: RunGroup = status === "failed" ? "failed" : "ready";
  return { ...base, group, status, at, stale };
}

// `agentId` lands with the picker; until then the server's list says who answers.
function agentOf(session: AssistantSession, input: RunsInput): string | null {
  const chosen = (session as { agentId?: string }).agentId;
  return chosen ?? input.chats.find((chat) => chat.session_id === session.sid)?.agent_type ?? null;
}
