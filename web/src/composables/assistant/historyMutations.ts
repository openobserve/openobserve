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
  deleteAllChatsMutation,
  deleteChatMutation,
  pinChatMutation,
  renameChatMutation,
} from "@/services/assistant.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { toAssistantError } from "./assistantErrors";
import type { MutationResult, Sid } from "./assistantStore.types";
import { MAX_TITLE, recordIdOf, scopeOf, type HistoryCtx } from "./historyContext";
import type { HistoryList } from "./historyList";
import { writeCache } from "./historyLocalStore";
import { isTerminal } from "./turnStates";

/** Rename, pin, delete and clear all: optimistic, restored on failure, announced once. */
export function createHistoryMutations(ctx: HistoryCtx, list: HistoryList) {
  const { deps } = ctx;
  const build = <V>(options: unknown, vars: V) =>
    deps.queryClient
      .getMutationCache()
      .build(deps.queryClient, options as never)
      .execute(vars as never) as Promise<unknown>;

  const fail = (err: unknown): MutationResult => ({
    ok: false,
    error: toAssistantError(err, { phase: "mutation" }),
  });

  const running = (sid: Sid) => {
    const turn = ctx.session(sid)?.turn;
    return !!turn && turn.state !== "idle" && !isTerminal(turn);
  };

  const rename = async (sid: Sid, title: string): Promise<MutationResult> => {
    const next = title.trim().slice(0, MAX_TITLE);
    const session = ctx.session(sid);
    const before = { title: session?.title ?? null, source: session?.titleSource ?? "generated" };
    const previous = ctx.titles[sid];
    if (!next) return { ok: true };
    ctx.titles[sid] = next;
    if (session) {
      session.title = raw(next);
      session.titleSource = "renamed";
    }
    try {
      if (ctx.serverMode() && isServerChat(sid, ctx, list)) {
        ctx.pending[sid] = "rename";
        await build(renameChatMutation(deps.org() ?? ""), { sid, title: next });
      }
      await writeCache(sid, ctx, { title: next, titleSource: "renamed" }, !ctx.serverMode());
      ctx.announce("assistant.thread.renamed");
      ctx.postChanged(sid, "rename");
      trackAssistant("ai_thread_action", { action: "rename", scope: scopeOf(ctx) });
      return { ok: true };
    } catch (err) {
      if (previous === undefined) delete ctx.titles[sid];
      else ctx.titles[sid] = previous;
      if (session) {
        session.title = before.title;
        session.titleSource = before.source;
      }
      ctx.failToast("assistant.thread.renameFailed", () => void rename(sid, next));
      return fail(err);
    } finally {
      if (ctx.pending[sid] === "rename") delete ctx.pending[sid];
    }
  };

  const pin = async (sid: Sid, pinned: boolean): Promise<MutationResult> => {
    const had = ctx.pins[sid];
    ctx.pins[sid] = pinned;
    const session = ctx.session(sid);
    if (session) session.record.pinned = pinned;
    const onServer = ctx.serverMode() && deps.capability().historyPins === true;
    try {
      if (onServer) {
        ctx.pending[sid] = "pin";
        await build(pinChatMutation(deps.org() ?? ""), { sid, pinned });
      }
      await writeCache(sid, ctx, { pinned }, !onServer);
      ctx.announce(pinned ? "assistant.history.pinned" : "assistant.history.unpinned");
      ctx.postChanged(sid, "pin");
      trackAssistant("ai_thread_action", {
        action: pinned ? "pin" : "unpin",
        scope: onServer ? "server" : "browser",
      });
      return { ok: true };
    } catch (err) {
      if (had === undefined) delete ctx.pins[sid];
      else ctx.pins[sid] = had;
      if (session) session.record.pinned = !pinned;
      ctx.failToast("assistant.history.pinFailed", () => void pin(sid, pinned));
      return fail(err);
    } finally {
      if (ctx.pending[sid] === "pin") delete ctx.pending[sid];
    }
  };

  // The answer stops only once the delete holds; a chat the server already lost counts as deleted.
  const remove = async (sid: Sid): Promise<MutationResult> => {
    const store = deps.store();
    const userOrgKey = ctx.key();
    ctx.deleted.add(sid);
    try {
      if (ctx.serverMode() && isServerChat(sid, ctx, list)) {
        ctx.pending[sid] = "delete";
        await build(deleteChatMutation(deps.org() ?? "", sid), undefined).catch((err) => {
          if (toAssistantError(err, { phase: "mutation" }).httpStatus !== 404) throw err;
        });
      }
      if (running(sid)) await store.stop(sid).catch(() => undefined);
      const id = recordIdOf(sid, ctx);
      if (id !== null && userOrgKey)
        await deps.db.remove([id], userOrgKey).catch(() => ctx.noteStorageFailure());
      await ctx.reloadLocal();
      if (store.state.sessions[sid]) store.dropSession(sid, "deleted");
      ctx.announce("assistant.history.deleted");
      ctx.postChanged(sid, "delete");
      trackAssistant("ai_thread_action", { action: "delete", scope: scopeOf(ctx) });
      return { ok: true };
    } catch (err) {
      ctx.deleted.delete(sid);
      ctx.failToast("assistant.history.deleteFailed", () => void remove(sid));
      return fail(err);
    } finally {
      if (ctx.pending[sid] === "delete") delete ctx.pending[sid];
    }
  };

  const clearAll = async (): Promise<MutationResult> => {
    const store = deps.store();
    const userOrgKey = ctx.key();
    if (!userOrgKey) return { ok: true };
    const count = list.api.total.value;
    const sids = Object.values(store.state.sessions)
      .filter((session) => session.userOrgKey === userOrgKey)
      .map((session) => session.sid);
    try {
      if (ctx.serverMode()) await build(deleteAllChatsMutation(deps.org() ?? ""), undefined);
      for (const sid of sids) ctx.deleted.add(sid);
      await Promise.all(sids.filter(running).map((sid) => store.stop(sid).catch(() => undefined)));
      await deps.db.removeAll([userOrgKey]).catch(() => ctx.noteStorageFailure());
      await ctx.reloadLocal();
      for (const sid of sids) store.dropSession(sid, "cleared");
      if (count === null) ctx.announce("assistant.history.clearAll.doneAll");
      else ctx.announce("assistant.history.clearAll.done", { count }, count);
      ctx.postChanged("*", "clear");
      trackAssistant("ai_thread_action", {
        action: "clear_all",
        scope: scopeOf(ctx),
        ...(count !== null && { count }),
      });
      return { ok: true };
    } catch (err) {
      ctx.failToast("assistant.history.clearAll.failed", () => void clearAll());
      return fail(err);
    }
  };

  return { rename, pin, remove, clearAll };
}

function isServerChat(sid: Sid, ctx: HistoryCtx, list: HistoryList): boolean {
  if (list.serverSids.value.has(sid)) return true;
  const session = ctx.session(sid);
  if (session) return session.record.serverBacked || session.messages.length > 0;
  const record = ctx.localBySid.value.get(sid);
  return !record || !!record.serverBacked;
}
