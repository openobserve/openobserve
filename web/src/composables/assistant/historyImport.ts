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

import { computed, ref } from "vue";

import assistant, { type ChatImportItem } from "@/services/assistant";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ChatMessage } from "@/ts/interfaces/chat";
import type { TranslateFn } from "@/types/i18n";

import { toAssistantError } from "./assistantErrors";
import type { Sid } from "./assistantStore.types";
import { isHelperChat, rowHints, type HistoryCtx } from "./historyContext";
import { messageGroups, type LocalRecord } from "./historyDb";
import type { HistoryList } from "./historyList";
import {
  dismissImport as dismissImportPref,
  importSnoozedUntil,
  isImportDismissed,
  snoozeImport,
} from "./prefs";
import type { StoredTurn } from "./record";

export const IMPORT_BATCH = 10;
/** A batch also stops at this many serialized bytes, since images ride inline. */
export const IMPORT_BATCH_BYTES = 2 * 1024 * 1024;
export const IMPORT_SNOOZE_MS = 7 * 24 * 60 * 60_000;

export interface ImportView {
  /** `error`: the run stopped on a server or size failure before every chat was tried; Retry resumes. */
  state:
    "offer" | "moving" | "partial" | "error" | "unavailable" | "forbidden" | "offline" | "done";
  count: number;
  done: number;
  failed: { sid: Sid; id: number; title: string }[];
}

/** Moves browser-only chats to the account in bounded batches; a local row goes only once the server confirms it. */
export function createHistoryImport(ctx: HistoryCtx, list: HistoryList) {
  const { deps } = ctx;
  const view = ref<ImportView | null>(null);
  const eligible = () =>
    ctx.local.value.filter(
      (record) =>
        !record.serverBacked &&
        !record.importedAs &&
        record.cachedLastSeq === undefined &&
        !isHelperChat(rowHints(record)),
    );

  const offered = computed<ImportView | null>(() => {
    const userOrgKey = ctx.key();
    if (!ctx.serverMode() || !userOrgKey) return null;
    if (view.value && view.value.state !== "done") return view.value;
    const count = eligible().length;
    if (count === 0 || isImportDismissed(userOrgKey) || importSnoozedUntil(userOrgKey) > deps.now())
      return null;
    if (deps.capability().historyImport !== true)
      return { state: "unavailable", count, done: 0, failed: [] };
    return { state: "offer", count, done: 0, failed: [] };
  });

  async function* importLocal(): AsyncGenerator<{ done: number; total: number; failed: string[] }> {
    const org = deps.org();
    const userOrgKey = ctx.key();
    const records = eligible();
    const total = records.length;
    const failed: string[] = [];
    let done = 0;
    if (!org || !userOrgKey) return;
    for (const batch of batchesOf(
      records.map((record) => [record, importItemOf(record, deps.t)]),
    )) {
      const result = await assistant.importBrowserChats(
        org,
        batch.map(([, item]) => item),
      );
      const created = new Map(result.imported.map((entry) => [entry.client_id, entry.session_id]));
      for (const skipped of result.skipped)
        if (!created.has(skipped)) created.set(skipped, skipped);
      const gone = batch.map(([record]) => record).filter((r) => created.has(clientIdOf(r)));
      if (gone.length) await forgetMoved(gone, created, userOrgKey, ctx);
      for (const entry of result.failed) failed.push(entry.client_id);
      done += gone.length;
      yield { done, total, failed: [...failed] };
    }
  }

  const runImport = async () => {
    const start = offered.value;
    if (!start) return;
    const records = eligible();
    view.value = { state: "moving", count: start.count, done: 0, failed: [] };
    let last = { done: 0, total: start.count, failed: [] as string[] };
    try {
      for await (const step of importLocal()) {
        last = step;
        view.value = { ...view.value!, done: step.done };
        ctx.announce("assistant.history.import.moved", { done: step.done, count: step.total });
      }
    } catch (err) {
      const state = failureState(err);
      view.value = { ...view.value!, state };
      trackAssistant("ai_local_import", {
        result: state === "error" ? "failed" : state,
        count: last.done,
      });
      await ctx.reloadLocal();
      return;
    }
    await ctx.reloadLocal();
    list.invalidate();
    const failed = records
      .filter((record) => last.failed.includes(clientIdOf(record)))
      .map((record) => ({ sid: record.sessionId ?? "", id: record.id, title: record.title }));
    view.value = {
      state: failed.length ? "partial" : "done",
      count: start.count,
      done: last.done,
      failed,
    };
    trackAssistant("ai_local_import", {
      result: failed.length ? "partial" : "done",
      count: last.done,
    });
  };

  return {
    importLocal,
    importView: offered,
    runImport,
    dismissImport(kind: "not_now" | "never") {
      const userOrgKey = ctx.key();
      if (!userOrgKey) return;
      if (kind === "never") dismissImportPref(userOrgKey);
      else snoozeImport(userOrgKey, deps.now() + IMPORT_SNOOZE_MS);
      view.value = { state: "done", count: 0, done: 0, failed: [] };
    },
  };
}

/** A legacy transcript as stored turns: one per prompt, the answer as its text. */
export function turnsFromMessages(messages: ChatMessage[]): StoredTurn[] {
  return messageGroups(messages).map((group) => {
    const user = group.messages[0]?.role === "user" ? group.messages[0] : null;
    const answer = group.messages
      .filter((message) => message.role === "assistant")
      .map((message) => String(message.content))
      .join("\n\n");
    return {
      ...(user?.turnId && { turn_id: user.turnId }),
      created: user?.sentAt ?? null,
      user: user ? { text: String(user.content) } : null,
      frames: answer ? [{ type: "message_delta", content: answer }, { type: "complete" }] : [],
      status: "completed" as const,
    };
  });
}

// A row whose delete fails keeps the server's id, so it never lists twice or is offered again.
async function forgetMoved(
  records: LocalRecord[],
  created: Map<string, string>,
  userOrgKey: string,
  ctx: HistoryCtx,
): Promise<void> {
  try {
    await ctx.deps.db.remove(
      records.map((record) => record.id),
      userOrgKey,
    );
  } catch {
    for (const record of records)
      await ctx.deps.db
        .merge({ ...record, importedAs: created.get(clientIdOf(record)) }, ctx.deps.writer)
        .catch(() => ctx.noteStorageFailure());
  }
}

function failureState(err: unknown): "forbidden" | "offline" | "unavailable" | "error" {
  const error = toAssistantError(err, { phase: "mutation" });
  if (error.httpStatus === 403) return "forbidden";
  if (error.code === "offline" || error.code === "unreachable") return "offline";
  if (error.httpStatus === 404 || error.httpStatus === 405) return "unavailable";
  return "error";
}

// Ten chats or 2 MiB, whichever comes first; a chat larger than the cap goes alone.
function batchesOf(entries: [LocalRecord, ChatImportItem][]): [LocalRecord, ChatImportItem][][] {
  const batches: [LocalRecord, ChatImportItem][][] = [];
  let current: [LocalRecord, ChatImportItem][] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = JSON.stringify(entry[1]).length;
    if (current.length && (current.length >= IMPORT_BATCH || bytes + size > IMPORT_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

function clientIdOf(record: LocalRecord): string {
  return record.sessionId ?? `local-${record.id}`;
}

// A turn that was running when the browser saved it imports as interrupted, never with a pending card.
function importItemOf(record: LocalRecord, t: TranslateFn): ChatImportItem {
  const turns: StoredTurn[] = record.turns?.length
    ? record.turns.map(({ startedAt: _startedAt, ...turn }) => ({
        ...turn,
        status: turn.status === "running" ? "interrupted" : turn.status,
      }))
    : turnsFromMessages(record.messages);
  return {
    client_id: clientIdOf(record),
    title: record.title || String(t("assistant.thread.newChatTitle")),
    created: record.id,
    origin: record.origin ?? "none",
    ...(record.pinned && { pinned: true }),
    turns,
  };
}
