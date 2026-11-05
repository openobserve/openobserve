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

import type { QueryClient } from "@tanstack/vue-query";
import { computed, reactive, ref, shallowRef, toRaw, watch } from "vue";

import { assistantChatsQuery } from "@/services/assistant.queries";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";

import type { AssistantStoreInternal } from "./assistantStore";
import type {
  AssistantCapability,
  AssistantSession,
  EntryOrigin,
  HintChannel,
  SessionOrigin,
  Sid,
  TurnEngine,
} from "./assistantStore.types";
import { HELPER_REQUEST_STARTS } from "./helperPrefixes";
import type { HistoryDb, LocalRecord, LocalTurn } from "./historyDb";
import { rememberHistoryKey } from "./prefs";
import type { ApprovalsRuntime } from "./useAssistantApprovals";

export const MAX_TITLE = 200;

export type HistoryPending = "delete" | "rename" | "pin";

export interface HistoryAnnouncement {
  seq: number;
  text: I18nText;
}

export interface DeletedNotice {
  sid: Sid;
  via: "tab" | "server";
  /** The chat was being opened, so no container showed it yet. */
  opening?: boolean;
}

export interface HistoryDeps {
  store: () => AssistantStoreInternal;
  capability: () => AssistantCapability;
  org: () => string | null;
  db: HistoryDb;
  queryClient: QueryClient;
  engine: () => Pick<TurnEngine, "turnFrames">;
  /** Holds a card a reload lost again, and lets it go when the server ended it; absent in specs that never restore one. */
  approvals?: () => Pick<ApprovalsRuntime, "restore" | "release"> | null;
  hints: Pick<HintChannel, "post" | "on">;
  now(): number;
  t: TranslateFn;
  timezone(): string;
  /** The per-tab writer id of `rev` merges. */
  writer: string;
  locks: Pick<LockManager, "request" | "query"> | null;
  hidden(): boolean;
  onVisibility(cb: () => void): () => void;
  /** The user channel's hash, the key of the sign-out preferences. */
  userHash?(): string | null;
  toast(options: {
    variant: "default" | "error" | "warning";
    message: I18nText;
    action?: { label: I18nText; handler: () => void };
    timeout?: number;
    onDismiss?: () => void;
    /** Session replay masks a toast that names a chat. */
    mask?: boolean;
  }): void;
}

export type HistoryCtx = ReturnType<typeof createHistoryContext>;

/** The shared state every history module reads; one per runtime. */
export function createHistoryContext(deps: HistoryDeps) {
  const local = shallowRef<LocalRecord[]>([]);
  const localLoaded = ref(false);
  const deleted = new Set<Sid>();
  const titles = reactive<Record<Sid, string>>({});
  const pins = reactive<Record<Sid, boolean>>({});
  const pending = reactive<Record<Sid, HistoryPending>>({});
  const notSavedSids = reactive(new Set<Sid>());
  const announcement = ref<HistoryAnnouncement | null>(null);
  const storageBlocked = ref(false);
  const deletedNotice = ref<DeletedNotice | null>(null);
  const turnsBySid = new Map<Sid, LocalTurn[]>();
  let seq = 0;
  let warnedUnkeyed = false;
  const key = () => deps.store().state.userOrgKey;
  const serverMode = () => deps.capability().persistence;

  const localBySid = computed(() => {
    const map = new Map<Sid, LocalRecord>();
    for (const record of local.value) if (record.sessionId) map.set(record.sessionId, record);
    return map;
  });
  const localById = computed(() => new Map(local.value.map((record) => [record.id, record])));

  const reloadLocal = async () => {
    const userOrgKey = key();
    if (!userOrgKey) {
      local.value = [];
      localLoaded.value = true;
      return;
    }
    try {
      const rows = await deps.db.list(userOrgKey);
      if (key() === userOrgKey) local.value = rows.filter((row) => row.userOrgKey === userOrgKey);
    } catch {
      noteStorageFailure();
    }
    if (key() === userOrgKey) localLoaded.value = true;
    if (!warnedUnkeyed) {
      warnedUnkeyed = true;
      const unkeyed = await deps.db.countUnkeyed().catch(() => 0);
      if (unkeyed > 0)
        console.warn(
          `assistant history: ${unkeyed} browser chats without an owner are never listed`,
        );
    }
  };

  // Once per session of the page: private windows and full storage keep failing the same way.
  const noteStorageFailure = () => {
    if (storageBlocked.value) return;
    storageBlocked.value = true;
  };

  const announceText = (text: I18nText) => {
    seq += 1;
    announcement.value = { seq, text };
  };

  const announce = (i18nKey: I18nKey, params?: Record<string, unknown>, plural?: number) =>
    announceText(
      plural === undefined ? deps.t(i18nKey, params ?? {}) : deps.t(i18nKey, params ?? {}, plural),
    );

  const failToast = (i18nKey: I18nKey, retry: () => void) =>
    deps.toast({
      variant: "error",
      message: deps.t(i18nKey),
      action: { label: deps.t("common.retry"), handler: retry },
    });

  const stopIdentity = watch(key, () => {
    for (const map of [titles, pins, pending]) for (const sid of Object.keys(map)) delete map[sid];
    turnsBySid.clear();
    localLoaded.value = false;
    void reloadLocal();
  });

  return {
    deps,
    local,
    localLoaded,
    localBySid,
    localById,
    deleted,
    titles,
    pins,
    pending,
    notSavedSids,
    announcement,
    storageBlocked,
    deletedNotice,
    turnsBySid,
    key,
    serverMode,
    reloadLocal,
    noteStorageFailure,
    announce,
    announceText,
    failToast,
    session: (sid: Sid | null) =>
      (sid ? (deps.store().state.sessions[sid] as AssistantSession | undefined) : undefined) ??
      null,
    postChanged: (sid: Sid, op: "create" | "rename" | "pin" | "delete" | "clear") =>
      deps.hints.post({ v: 1, type: "history_changed", sid, op, at: deps.now() }),
    rememberKey: (userOrgKey: string) => {
      const hash = deps.userHash?.();
      if (hash) rememberHistoryKey(hash, userOrgKey);
    },
    invalidateList: () => {
      const org = deps.org();
      if (org)
        void deps.queryClient.invalidateQueries({
          queryKey: assistantChatsQuery(org).queryKey.slice(0, 3),
        });
    },
    dispose: () => stopIdentity(),
  };
}

/** A helper chat (`generate_query`, ephemeral, or a helper prefix) is never a history row. */
export function isHelperChat(row: {
  agentType?: string | null;
  ephemeral?: boolean;
  firstPrompt?: string;
  title?: string;
}): boolean {
  if (row.agentType === "generate_query" || row.ephemeral) return true;
  const texts = [row.firstPrompt, row.title].filter((text): text is string => !!text);
  return texts.some((text) => HELPER_REQUEST_STARTS.some((start) => text.startsWith(start)));
}

/** The origin tag a door's session carries. */
export function originOf(origin: SessionOrigin | undefined): EntryOrigin {
  if (!origin) return "none";
  if (origin.objectKind === "incident" || origin.container === "rca") return "incident";
  if (origin.objectKind === "alert" || origin.objectKind === "alert_firing") return "alert";
  if (origin.entryKind === "editor_toggle" || origin.entryKind === "editor_button") return "editor";
  if (origin.container.startsWith("docked.")) return "editor";
  return "none";
}

export async function readLocal(sid: Sid, ctx: HistoryCtx): Promise<LocalRecord | null> {
  const id = recordIdOf(sid, ctx);
  if (id === null) return null;
  const record = await ctx.deps.db.get(id).catch(() => null);
  // Isolation: a row of another user or org, or a v1 row without a key, is never read.
  if (!record || record.userOrgKey !== ctx.key()) return null;
  return record;
}

export function recordIdOf(sid: Sid, ctx: HistoryCtx): number | null {
  const listed = ctx.localBySid.value.get(sid);
  if (listed) return listed.id;
  const session = ctx.session(sid);
  return session?.chatId ?? sidTime(sid);
}

/** The creation time a v7 session id carries, which is also the browser row's id. */
export function sidTime(sid: Sid): number | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7/i.test(sid)) return null;
  return parseInt(sid.replace(/-/g, "").slice(0, 12), 16);
}

/** The server said 404: purge the cache, drop the session and say so once. */
export async function goneElsewhere(sid: Sid, ctx: HistoryCtx): Promise<void> {
  const store = ctx.deps.store();
  ctx.deleted.add(sid);
  const id = recordIdOf(sid, ctx);
  const userOrgKey = ctx.key();
  if (id !== null && userOrgKey) await ctx.deps.db.remove([id], userOrgKey).catch(() => undefined);
  await ctx.reloadLocal();
  ctx.announce("assistant.shell.deletedElsewhere");
  const active = store.state.shell.activeSid;
  if (store.state.sessions[sid]) {
    if (active === sid) ctx.deletedNotice.value = { sid, via: "server" };
    store.dropSession(sid, "deleted_elsewhere");
  } else ctx.deletedNotice.value = { sid, via: "server", opening: true };
  ctx.invalidateList();
}

export function firstPromptOf(record: LocalRecord | undefined): string | undefined {
  const first = record?.messages.find((message) => message.role === "user");
  return first ? String(first.content) : undefined;
}

export function rowHints(record: LocalRecord) {
  return {
    agentType: record.agentType,
    ephemeral: record.ephemeral,
    firstPrompt: firstPromptOf(record),
    title: record.title,
  };
}

export function sessionHints(session: AssistantSession) {
  const first = session.messages.find((message) => message.role === "user");
  return {
    ephemeral: session.record.ephemeral,
    firstPrompt: first ? String(first.content) : undefined,
  };
}

export function scopeOf(ctx: HistoryCtx): "server" | "browser" {
  return ctx.serverMode() ? "server" : "browser";
}

// Reactive proxies nest, so `structuredClone` cannot take them; JSON is the legacy chat's copy too.
export function plainCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T;
}
