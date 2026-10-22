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

import { QueryObserver } from "@tanstack/vue-query";
import { computed, ref, shallowRef, watch, type ComputedRef } from "vue";

import type { ChatsPage, ChatSummaryWire } from "@/services/assistant";
import { assistantChatsQuery } from "@/services/assistant.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { toAssistantError } from "./assistantErrors";
import type {
  AssistantError,
  AssistantSession,
  EntryOrigin,
  HistoryFilter,
  HistoryRow,
  Sid,
} from "./assistantStore.types";
import {
  MAX_TITLE,
  firstPromptOf,
  isHelperChat,
  originOf,
  rowHints,
  sidTime,
  type HistoryCtx,
} from "./historyContext";
import type { LocalRecord } from "./historyDb";
import { readHistoryFilter, writeHistoryFilter } from "./prefs";
import { isTerminal } from "./turnStates";

export const LIST_REREAD_MS = 15_000;

const MAX_SHARED_SIDS = 1_000;

/** The list's own load state; `cached` rows render beside a server error, never a silent empty list. */
export interface HistoryListState {
  status: "idle" | "loading" | "ready" | "error";
  offline: boolean;
  traceId?: string;
  /** The read that failed, for the details disclosure. */
  error?: AssistantError;
}

export type HistoryList = ReturnType<typeof createHistoryList>;

/** The server pages through TanStack, the browser rows, live sessions, the filter and the search. */
export function createHistoryList(ctx: HistoryCtx) {
  const { deps } = ctx;
  const pages = shallowRef<(ChatsPage | undefined)[]>([]);
  const cursors = ref<(string | undefined)[]>([]);
  const errors = shallowRef<unknown>(null);
  const fetching = ref(false);
  const observers: { observer: QueryObserver<ChatsPage>; stop: () => void }[] = [];
  const filterState = ref<HistoryFilter>({ kind: "all", q: "" });
  // The chats the owner's share links point at; a listed row carries no share of its own.
  const sharedSids = shallowRef<ReadonlySet<Sid>>(new Set());
  const loadedFor = ref<string | null>(null);

  const searchOnServer = () => deps.capability().historySearch === true;

  const observe = (org: string, cursor: string | undefined, index: number) => {
    const q = searchOnServer() ? filterState.value.q.trim() : "";
    const options = assistantChatsQuery(
      org,
      cursor,
      q || undefined,
    ) as unknown as ConstructorParameters<typeof QueryObserver<ChatsPage>>[1];
    const observer = new QueryObserver<ChatsPage>(deps.queryClient, options);
    const report = () => {
      const result = observer.getCurrentResult();
      fetching.value = result.isFetching;
      if (result.data) {
        const next = [...pages.value];
        next[index] = result.data;
        pages.value = next;
      }
      if (index === 0) errors.value = result.isError ? result.error : null;
    };
    const stop = observer.subscribe(report);
    report();
    observers.push({ observer, stop });
  };

  const reset = () => {
    for (const { stop } of observers.splice(0)) stop();
    pages.value = [];
    cursors.value = [];
    errors.value = null;
    loadedFor.value = null;
  };

  const ensureLoaded = () => {
    const org = deps.org();
    const userOrgKey = ctx.key();
    if (!org || !userOrgKey) return;
    if (!ctx.serverMode()) {
      if (loadedFor.value !== userOrgKey) {
        loadedFor.value = userOrgKey;
        void ctx.reloadLocal();
      }
      return;
    }
    if (loadedFor.value === userOrgKey) return;
    reset();
    loadedFor.value = userOrgKey;
    cursors.value = [undefined];
    observe(org, undefined, 0);
    void ctx.reloadLocal();
  };

  const serverRows = computed<HistoryRow[]>(() => {
    const seen = new Set<Sid>();
    const out: HistoryRow[] = [];
    for (const page of pages.value)
      for (const summary of page?.chats ?? []) {
        if (seen.has(summary.session_id) || ctx.deleted.has(summary.session_id)) continue;
        seen.add(summary.session_id);
        out.push(serverRow(summary, ctx));
      }
    return out;
  });
  const serverSids = computed(() => new Set(serverRows.value.map((row) => row.sid)));

  // Browser chats the server never had: the import card's rows, under "In this browser".
  const browserRows = computed<HistoryRow[]>(() =>
    ctx.local.value
      .filter((record) => !record.serverBacked && !record.importedAs)
      .map((record) => localRow(record, ctx, true)),
  );

  const rows = computed<HistoryRow[]>(() => {
    const base = ctx.serverMode()
      ? [...serverRows.value, ...browserRows.value.filter((row) => !serverSids.value.has(row.sid))]
      : ctx.local.value.map((record) => localRow(record, ctx, false));
    return withLiveSessions(base, ctx)
      .filter((row) => !isHelperChat(row))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });

  const rowsByChatId = computed(() => {
    const map = new Map<number, Sid>();
    for (const row of rows.value) if (row.chatId !== null) map.set(row.chatId, row.sid);
    return map;
  });

  const visible = computed(() => {
    const { kind, q } = filterState.value;
    const needle = q.trim().toLowerCase();
    return rows.value.filter((row) => {
      if (kind === "pinned" && !row.pinned) return false;
      if ((kind === "editor" || kind === "alert" || kind === "incident") && row.origin !== kind)
        return false;
      if (kind === "shared" && !row.share && !sharedSids.value.has(row.sid)) return false;
      if (!needle || (ctx.serverMode() && searchOnServer())) return true;
      return (
        String(row.title).toLowerCase().includes(needle) || contentMatches(row.sid, needle, ctx)
      );
    });
  });

  const hasMore = computed(() => ctx.serverMode() && !!pages.value.at(-1)?.next_cursor);

  // Never "No chats yet" before the app knows: a first read shows the skeleton.
  const listState = computed<HistoryListState>(() => {
    if (!ctx.serverMode())
      return { status: ctx.localLoaded.value ? "ready" : "loading", offline: false };
    if (errors.value) {
      const error = toAssistantError(errors.value, { phase: "read" });
      return {
        status: "error",
        offline: error.code === "offline",
        error,
        ...(error.traceId && { traceId: error.traceId }),
      };
    }
    if (!pages.value[0]) return { status: loadedFor.value ? "loading" : "idle", offline: false };
    return { status: "ready", offline: false };
  });

  // The server's total when it sends one; else only a single page with no more is a known count.
  const total = computed<number | null>(() => {
    if (!ctx.serverMode()) return rows.value.length;
    const reported = pages.value[0]?.total;
    if (typeof reported === "number" && Number.isFinite(reported)) return reported;
    return hasMore.value ? null : rows.value.length;
  });

  const stopIdentity = watch(
    () => [ctx.key(), ctx.serverMode()] as const,
    ([userOrgKey]) => {
      reset();
      filterState.value = (userOrgKey && readHistoryFilter(userOrgKey)) || { kind: "all", q: "" };
    },
  );

  const api = {
    rows,
    visible,
    hasMore,
    listState,
    total,
    mode: computed<"server" | "local">(() => (ctx.serverMode() ? "server" : "local")),
    canReload: computed(() => !!ctx.key()),
    filter: computed(() => filterState.value),
    searchPartial: computed(
      () => !!filterState.value.q.trim() && hasMore.value && !searchOnServer(),
    ),
    localCount: computed(
      () => ctx.local.value.filter((row) => !isHelperChat(rowHints(row))).length,
    ),
    retentionDays: computed(
      () => pages.value[0]?.retention_days ?? deps.capability().retentionDays,
    ),
    serverPins: computed(() => ctx.serverMode() && deps.capability().historyPins === true),
    pending: ctx.pending,
    announcement: ctx.announcement,
    announceText: ctx.announceText,
    storageBlocked: ctx.storageBlocked,
    ensureLoaded,
    recent: (n: number) => computed(() => rows.value.slice(0, n)),
    noteShared(sids: readonly Sid[]) {
      sharedSids.value = new Set(sids.slice(0, MAX_SHARED_SIDS));
    },
    setFilter(patch: Partial<HistoryFilter>) {
      const next = { ...filterState.value, ...patch };
      const searched = next.q !== filterState.value.q;
      filterState.value = next;
      const userOrgKey = ctx.key();
      if (userOrgKey) writeHistoryFilter(userOrgKey, next);
      if (searched && next.q.trim())
        trackAssistant("ai_history_search", {
          length_bucket: lengthBucket(next.q.trim()),
          server: ctx.serverMode() && searchOnServer(),
        });
      if (searched && searchOnServer() && ctx.serverMode()) {
        loadedFor.value = null;
        ensureLoaded();
      }
    },
    async retry() {
      if (!ctx.serverMode()) return void (await ctx.reloadLocal());
      await Promise.all(observers.map(({ observer }) => observer.refetch()));
    },
    async loadOlder() {
      const org = deps.org();
      const cursor = pages.value.at(-1)?.next_cursor ?? undefined;
      if (!org || !cursor || cursors.value.includes(cursor)) return;
      const before = serverRows.value.length;
      cursors.value = [...cursors.value, cursor];
      observe(org, cursor, cursors.value.length - 1);
      const observer = observers.at(-1)!.observer;
      await observer.refetch().catch(() => undefined);
      const added = serverRows.value.length - before;
      if (added > 0) ctx.announce("assistant.history.loadedOlder", { count: added }, added);
    },
  };

  // A tab coming back re-reads the first page, at most every 15 s, so markers from other devices catch up.
  let readAt = 0;
  const offVisibility = deps.onVisibility(() => {
    if (deps.hidden() || !ctx.serverMode() || !observers.length) return;
    if (deps.now() - readAt < LIST_REREAD_MS) return;
    readAt = deps.now();
    void observers[0]!.observer.refetch().catch(() => undefined);
  });

  return {
    api: { ...api, listLight: listLightOf(serverRows, ctx) },
    serverRows,
    serverSids,
    sidOfChatId: (chatId: number) => rowsByChatId.value.get(chatId) ?? null,
    invalidate: ctx.invalidateList,
    dispose() {
      offVisibility();
      stopIdentity();
      reset();
    },
  };
}

/** Group label key for a row: pinned first, then calendar days in the org zone. */
export function groupOf(
  row: Pick<HistoryRow, "pinned" | "updatedAt" | "local">,
  now: number,
  dayDistance: (ts: number, now: number) => number,
  serverMode: boolean,
): "pinned" | "today" | "yesterday" | "week" | "older" | "browser" {
  if (row.pinned) return "pinned";
  if (serverMode && row.local) return "browser";
  const days = dayDistance(row.updatedAt, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "older";
}

export function wireOrigin(summary?: ChatSummaryWire): EntryOrigin {
  const value = summary?.origin;
  return value === "editor" || value === "alert" || value === "incident" ? value : "none";
}

// The list's own markers for chats this tab does not run; this tab's sessions light the header themselves.
function listLightOf(rows: ComputedRef<HistoryRow[]>, ctx: HistoryCtx) {
  return computed<{ state: "needs_you" | "working"; sid: Sid } | null>(() => {
    const sessions = ctx.deps.store().state.sessions;
    const remote = rows.value.filter((row) => !sessions[row.sid]?.turnMeta.ownedByThisTab);
    const waiting = remote.find((row) => row.pendingApproval);
    if (waiting) return { state: "needs_you", sid: waiting.sid };
    const working = remote.find((row) => row.activeTurn);
    return working ? { state: "working", sid: working.sid } : null;
  });
}

function serverRow(summary: ChatSummaryWire, ctx: HistoryCtx): HistoryRow {
  const sid = summary.session_id;
  const cached = ctx.localBySid.value.get(sid);
  const title = ctx.titles[sid] ?? summary.title ?? cached?.title ?? "";
  const origin = wireOrigin(summary) !== "none" ? wireOrigin(summary) : (cached?.origin ?? "none");
  return {
    sid,
    chatId: cached?.id ?? sidTime(sid),
    title: raw(title),
    titleSource: cached?.titleSource ?? "generated",
    createdAt: Math.floor(summary.created_at / 1000),
    updatedAt: Math.floor(summary.updated_at / 1000),
    origin,
    originContainer: "sidebar",
    pinned: ctx.pins[sid] ?? summary.pinned ?? cached?.pinned ?? false,
    activeTurn: summary.active_turn === true,
    pendingApproval: summary.pending_approval === true,
    share: null,
    local: false,
    ephemeral: false,
    agentType: summary.agent_type ?? null,
    ...({ firstPrompt: firstPromptOf(cached) } as object),
  } as HistoryRow;
}

function localRow(record: LocalRecord, ctx: HistoryCtx, browserOnly: boolean): HistoryRow {
  const sid = record.sessionId ?? String(record.id);
  const updated = Date.parse(record.timestamp);
  return {
    sid,
    chatId: record.id,
    title: raw(ctx.titles[sid] ?? record.title),
    titleSource: record.titleSource ?? "generated",
    createdAt: record.id,
    updatedAt: Number.isFinite(updated) ? updated : record.id,
    origin: record.origin ?? "none",
    originContainer: "sidebar",
    pinned: ctx.pins[sid] ?? record.pinned ?? false,
    activeTurn: false,
    pendingApproval: false,
    share: null,
    local: browserOnly || !record.serverBacked,
    ephemeral: record.ephemeral === true,
    agentType: record.agentType ?? null,
    ...({ firstPrompt: firstPromptOf(record) } as object),
  } as HistoryRow;
}

// Markers come from this tab's sessions until the list payload carries them; a chat not saved yet still lists.
function withLiveSessions(rows: HistoryRow[], ctx: HistoryCtx): HistoryRow[] {
  const sessions = ctx.deps.store().state.sessions;
  const listed = new Set(rows.map((row) => row.sid));
  const merged = rows.map((row) => {
    const session = sessions[row.sid] as AssistantSession | undefined;
    if (!session) return row;
    const running = session.turn.state !== "idle" && !isTerminal(session.turn);
    return {
      ...row,
      title: session.title && session.titleSource === "renamed" ? session.title : row.title,
      activeTurn: row.activeTurn || running,
      pendingApproval: row.pendingApproval || !!session.pendingApproval,
      share: session.share ?? row.share,
    };
  });
  const key = ctx.key();
  for (const session of Object.values(sessions) as AssistantSession[]) {
    if (listed.has(session.sid) || ctx.deleted.has(session.sid)) continue;
    if (session.userOrgKey !== key || session.messages.length === 0 || session.record.ephemeral)
      continue;
    merged.push(liveRow(session, ctx));
  }
  return merged;
}

function liveRow(session: AssistantSession, ctx: HistoryCtx): HistoryRow {
  const first = session.messages.find((message) => message.role === "user");
  const sent = session.messages
    .map((message) => message.sentAt)
    .filter((at): at is number => typeof at === "number");
  const at = sent.length ? Math.max(...sent) : ctx.deps.now();
  return {
    sid: session.sid,
    chatId: session.chatId,
    title: session.title ?? raw(first ? String(first.content).slice(0, MAX_TITLE) : ""),
    titleSource: session.titleSource,
    createdAt: sent[0] ?? at,
    updatedAt: at,
    origin: originOf(session.origin),
    originContainer: session.origin.container,
    pinned: ctx.pins[session.sid] ?? session.record.pinned,
    activeTurn: session.turn.state !== "idle" && !isTerminal(session.turn),
    pendingApproval: !!session.pendingApproval,
    share: session.share ?? null,
    local: !ctx.serverMode(),
    ephemeral: false,
    agentType: null,
    ...({ firstPrompt: first ? String(first.content) : undefined } as object),
  } as HistoryRow;
}

function contentMatches(sid: Sid, needle: string, ctx: HistoryCtx): boolean {
  const record = ctx.localBySid.value.get(sid);
  return !!record?.messages.some(
    (message) => message.role === "user" && String(message.content).toLowerCase().includes(needle),
  );
}

function lengthBucket(text: string): "0" | "1_20" | "21_100" | "101_500" | "500_plus" {
  const n = text.length;
  if (n === 0) return "0";
  if (n <= 20) return "1_20";
  if (n <= 100) return "21_100";
  if (n <= 500) return "101_500";
  return "500_plus";
}
