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

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import type { AssistantSession, Sid } from "./assistantStore.types";
import {
  isHelperChat,
  originOf,
  plainCopy,
  readLocal,
  recordIdOf,
  sessionHints,
  type HistoryCtx,
} from "./historyContext";
import { LOCAL_CAP, type LocalRecord, type LocalTurn } from "./historyDb";
import type { StoredTurn } from "./record";
import { isTerminal } from "./turnStates";

export const PRUNE_UNDO_MS = 10_000;

/** Writes a session to the browser store: the whole record in local mode, the cache in server mode. */
export async function saveSession(
  sid: Sid,
  ctx: HistoryCtx,
): Promise<"server" | "local" | "not_saved"> {
  const session = ctx.session(sid);
  const server = ctx.serverMode();
  if (!session || ctx.deleted.has(sid)) return server ? "server" : "local";
  if (session.record.ephemeral || isHelperChat(sessionHints(session)))
    return server ? "server" : "local";
  // Captured before any await: the engine lets the turn's record go once the turn ends.
  const turns = server ? null : mergeCurrentTurn(sid, session, ctx);
  const record = recordFromSession(session, ctx, turns);
  if (!record) return server ? "server" : "not_saved";
  if (!server) {
    const room = await makeRoom(record, ctx);
    if (!room) {
      ctx.notSavedSids.add(sid);
      return "not_saved";
    }
  }
  const written = ctx.deleted.has(sid)
    ? null
    : await ctx.deps.db.merge(record, ctx.deps.writer).catch(() => {
        ctx.noteStorageFailure();
        return null;
      });
  if (!written) {
    if (!server && !ctx.deleted.has(sid)) ctx.notSavedSids.add(sid);
    return server ? "server" : "not_saved";
  }
  ctx.notSavedSids.delete(sid);
  if (record.userOrgKey) ctx.rememberKey(record.userOrgKey);
  const isNew = !ctx.localById.value.has(written.id);
  await ctx.reloadLocal();
  if (isNew && !server) ctx.postChanged(sid, "create");
  return server ? "server" : "local";
}

/** Patches the stored row of a chat; `required` throws when nothing could be written. */
export async function writeCache(
  sid: Sid,
  ctx: HistoryCtx,
  patch: Partial<LocalRecord>,
  required = false,
): Promise<void> {
  const session = ctx.session(sid);
  const stored = await readLocal(sid, ctx);
  const userOrgKey = session?.userOrgKey ?? ctx.key();
  if (!userOrgKey || (!stored && !session) || ctx.deleted.has(sid)) {
    if (required) throw new Error("Nothing stored for this chat");
    return;
  }
  const base: LocalRecord = stored ??
    recordFromSession(session!, ctx, null) ?? {
      id: recordIdOf(sid, ctx) ?? ctx.deps.now(),
      timestamp: new Date(ctx.deps.now()).toISOString(),
      title: String(session?.title ?? ""),
      messages: [],
      sessionId: sid,
      userOrgKey,
    };
  const next: LocalRecord = {
    ...plainCopy(base),
    ...plainCopy(patch),
    userOrgKey,
    sessionId: sid,
    ...(ctx.serverMode() && { serverBacked: true }),
  };
  if (!stored && next.messages.length === 0 && !required) return;
  const written = await ctx.deps.db.merge(next, ctx.deps.writer).catch(() => null);
  if (!written) {
    ctx.noteStorageFailure();
    if (required) throw new Error("Couldn't save to this browser");
    return;
  }
  ctx.rememberKey(userOrgKey);
  await ctx.reloadLocal();
}

// Prune-on-save: the oldest unpinned chat goes and Undo keeps it for 10 s; nothing is pruned on read.
async function makeRoom(record: LocalRecord, ctx: HistoryCtx): Promise<boolean> {
  const rows = ctx.local.value;
  if (ctx.localById.value.has(record.id) || rows.length < LOCAL_CAP) return true;
  const victim = [...rows]
    .filter((row) => !row.pinned && row.id !== record.id)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0];
  if (!victim) {
    if (!ctx.notSavedSids.size)
      ctx.deps.toast({ variant: "warning", message: ctx.deps.t("assistant.history.allPinned") });
    return false;
  }
  const kept = plainCopy(victim);
  await ctx.deps.db
    .remove([victim.id], victim.userOrgKey ?? "")
    .catch(() => ctx.noteStorageFailure());
  let undone = false;
  ctx.deps.toast({
    variant: "default",
    message: ctx.deps.t("assistant.history.pruned", { title: raw(victim.title) }),
    timeout: PRUNE_UNDO_MS,
    mask: true,
    action: {
      label: ctx.deps.t("assistant.actions.undo"),
      handler: () => {
        undone = true;
        void ctx.deps.db.merge(kept, ctx.deps.writer).then(() => ctx.reloadLocal());
      },
    },
    onDismiss: () => {
      if (!undone) void ctx.reloadLocal();
    },
  });
  return true;
}

function mergeCurrentTurn(sid: Sid, session: AssistantSession, ctx: HistoryCtx): LocalTurn[] {
  const turns = [...(ctx.turnsBySid.get(sid) ?? [])];
  const live = ctx.deps.engine().turnFrames?.(sid);
  const turnId = live?.turnId ?? session.turnMeta.turnId;
  if (!turnId || session.turn.state === "refused") return turns;
  const user = session.messages.find((m) => m.role === "user" && m.turnId === turnId);
  const previous = turns.find((turn) => turn.turn_id === turnId);
  const frames = live ? plainCopy(live.frames) : (previous?.frames ?? []);
  const next: LocalTurn = {
    turn_id: turnId,
    created: session.turnMeta.startedAt ?? ctx.deps.now(),
    startedAt: session.turnMeta.startedAt ?? ctx.deps.now(),
    user: user ? { text: String(user.content) } : (previous?.user ?? null),
    frames: frames as any[],
    status: turnStatusOf(session),
  };
  const merged = previous
    ? turns.map((turn) => (turn === previous ? next : turn))
    : [...turns, next];
  ctx.turnsBySid.set(sid, merged);
  return merged;
}

function turnStatusOf(session: AssistantSession): StoredTurn["status"] {
  const state = session.turn.state;
  if (state === "done") return "completed";
  if (state === "stopped") return "cancelled";
  if (state === "failed") return "failed";
  return "running";
}

// `pinned` is written only when this tab changed it, so the merge keeps another tab's pin.
function recordFromSession(
  session: AssistantSession,
  ctx: HistoryCtx,
  turns: LocalTurn[] | null,
): LocalRecord | null {
  const messages = serializable(session.messages);
  if (messages.length === 0) return null;
  const id = recordIdOf(session.sid, ctx) ?? session.chatId ?? ctx.deps.now();
  const firstPrompt = messages.find((m) => m.role === "user");
  const title =
    (session.title && String(session.title)) ||
    (firstPrompt
      ? String(firstPrompt.content).slice(0, 40)
      : String(ctx.deps.t("assistant.thread.newChatTitle")));
  const ended = isTerminal(session.turn);
  const server = ctx.serverMode();
  const pinned = ctx.pins[session.sid];
  return {
    id,
    timestamp: new Date(ctx.deps.now()).toISOString(),
    title,
    messages,
    sessionId: session.sid,
    userOrgKey: session.userOrgKey,
    titleSource: session.titleSource,
    origin: originOf(session.origin),
    ...(pinned !== undefined && { pinned }),
    ...(server && { serverBacked: true }),
    ...(server &&
      ended &&
      session.turnMeta.turnId && {
        liveTurnId: session.turnMeta.turnId,
        liveSavedAt: ctx.deps.now(),
      }),
    ...(turns && turns.length > 0 && { turns }),
    ...(session.record.seed && { seed: plainCopy(session.record.seed) }),
  };
}

// The legacy shape: ephemeral blocks are never stored, and a reply that held only them is dropped.
function serializable(messages: ChatMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    const blocks = (message.contentBlocks ?? []).filter((block) => !block.ephemeral);
    if (!message.content && blocks.length === 0 && message.contentBlocks?.length) return [];
    const plain = plainCopy({ ...message, contentBlocks: blocks }) as ChatMessage;
    if (!blocks.length) return [{ ...plain, contentBlocks: undefined }];
    return [plain];
  });
}
