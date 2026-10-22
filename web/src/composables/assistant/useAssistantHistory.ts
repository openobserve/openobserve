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

import type { ComputedRef, Ref } from "vue";

import type { ChatMessage } from "@/ts/interfaces/chat";
import type { I18nText } from "@/types/i18n";

import type {
  EntryOrigin,
  HistoryFilter,
  HistoryRow,
  HistoryService,
  Sid,
} from "./assistantStore.types";
import {
  createHistoryContext,
  type DeletedNotice,
  type HistoryAnnouncement,
  type HistoryDeps,
  type HistoryPending,
} from "./historyContext";
import { createHistoryCrossTab } from "./historyCrossTab";
import type { LocalRecord } from "./historyDb";
import type { ElsewhereView } from "./historyElsewhere";
import { createHistoryImport, type ImportView } from "./historyImport";
import { createHistoryList, type HistoryListState } from "./historyList";
import { createHistoryMutations } from "./historyMutations";
import { createHistoryRecords } from "./historyRecords";
import { readClearOnSignOut, takeKeptOnSignOut, writeClearOnSignOut } from "./prefs";
import type { StoredTurn } from "./record";
import { getAssistantRuntime } from "./runtime";

export { isHelperChat, originOf } from "./historyContext";
export { HELPER_REQUEST_STARTS } from "./helperPrefixes";
export type {
  DeletedNotice,
  HistoryAnnouncement,
  HistoryDeps,
  HistoryPending,
} from "./historyContext";
export {
  IMPORT_BATCH,
  IMPORT_BATCH_BYTES,
  IMPORT_SNOOZE_MS,
  type ImportView,
} from "./historyImport";
export { LIST_REREAD_MS, groupOf, type HistoryListState } from "./historyList";
export { PRUNE_UNDO_MS } from "./historyLocalStore";

/** `HistoryService` plus the view state the list, header and shell read. */
export interface AssistantHistory extends HistoryService {
  listState: ComputedRef<HistoryListState>;
  /** Another tab's or device's answering or waiting chat, from the list markers; the header light merges it. */
  listLight: ComputedRef<{ state: "needs_you" | "working"; sid: Sid } | null>;
  /** Mounting a list starts the server read; nothing loads before a list or a recent row asks. */
  ensureLoaded(): void;
  retry(): Promise<void>;
  filter: ComputedRef<HistoryFilter>;
  setFilter(patch: Partial<HistoryFilter>): void;
  /** The chats the user's share links point at, for the Shared filter. */
  noteShared(sids: readonly Sid[]): void;
  /** `rows` after the filter chip and the search; client-side unless the server advertises search. */
  visible: ComputedRef<HistoryRow[]>;
  /** Loaded pages only, so the list says it searched those. */
  searchPartial: ComputedRef<boolean>;
  /** How many chats a clear-all deletes; `null` when more pages exist and the server sends no total. */
  total: ComputedRef<number | null>;
  pending: Readonly<Record<Sid, HistoryPending>>;
  announcement: Readonly<Ref<HistoryAnnouncement | null>>;
  /** Speaks a finished action once from the visible shell's status region. */
  announceText(text: I18nText): void;
  storageBlocked: Readonly<Ref<boolean>>;
  localCount: ComputedRef<number>;
  retentionDays: ComputedRef<number | undefined>;
  serverPins: ComputedRef<boolean>;
  /** The open chat that was deleted: by another tab (hint) or on the server (404); the shell shows its state. */
  deletedNotice: Readonly<Ref<DeletedNotice | null>>;
  clearDeletedNotice(): void;
  elsewhere(sid: Sid | null): ElsewhereView | null;
  refreshElsewhere(sid: Sid): void;
  /** Local mode, all 100 pinned: the chat keeps going in memory with "· not saved". */
  notSaved(sid: Sid | null): boolean;
  importView: ComputedRef<ImportView | null>;
  runImport(): Promise<void>;
  dismissImport(kind: "not_now" | "never"): void;
  /** Every `o2ChatDB` row of these user+org keys. */
  purge(userOrgKeys: string[]): Promise<void>;
  /** What an export folds: stored turns, else the saved messages. */
  recordOf(sid: Sid): Promise<{
    title: string;
    created: number;
    origin: EntryOrigin;
    turns: StoredTurn[];
    messages: ChatMessage[];
  } | null>;
  localRecords(): LocalRecord[];
  /** Once after a sign-out that kept the browser chats, so the list can say so. */
  takeKeptNotice(): boolean;
  /** The local-only "Delete my browser chats when I sign out" preference. */
  clearOnSignOut(): boolean;
  setClearOnSignOut(on: boolean): void;
  dispose(): void;
}

export function useAssistantHistory(): AssistantHistory {
  return getAssistantRuntime().history;
}

/** Server truth with the IndexedDB cache, or the browser store alone in local-only mode. */
export function createAssistantHistory(deps: HistoryDeps): AssistantHistory {
  const ctx = createHistoryContext(deps);
  const list = createHistoryList(ctx);
  const records = createHistoryRecords(ctx, list);
  const mutations = createHistoryMutations(ctx, list);
  const importer = createHistoryImport(ctx, list);
  const crossTab = createHistoryCrossTab(ctx, records);
  return {
    ...list.api,
    ...records.api,
    ...mutations,
    ...importer,
    ...crossTab,
    async purge(keys) {
      if (keys.length === 0) return;
      await deps.db.removeAll(keys).catch(() => 0);
      ctx.local.value = [];
    },
    localRecords: () => ctx.local.value,
    takeKeptNotice() {
      const hash = deps.userHash?.();
      return !!hash && takeKeptOnSignOut(hash);
    },
    clearOnSignOut() {
      const hash = deps.userHash?.();
      return !!hash && readClearOnSignOut(hash);
    },
    setClearOnSignOut(on) {
      const hash = deps.userHash?.();
      if (hash) writeClearOnSignOut(hash, on);
    },
    dispose() {
      crossTab.dispose();
      list.dispose();
      ctx.dispose();
    },
  };
}
