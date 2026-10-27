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

import { toRaw } from "vue";

import type { ChatDetail, ChatsPage, ChatSummaryWire } from "@/services/assistant";
import {
  assistantChatQuery,
  assistantChatsQuery,
  mergeChatDetail,
} from "@/services/assistant.queries";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { approvalAnnotationKey } from "./actions/appliers/approval";
import { toAssistantError } from "./assistantErrors";
import type { AdoptInit } from "./assistantStore";
import type { BlockAnnotation, EntryOrigin, SessionOrigin, Sid } from "./assistantStore.types";
import { goneElsewhere, originOf, readLocal, sidTime, type HistoryCtx } from "./historyContext";
import { LIVE_SAVE_GRACE_MS, messageGroups, type LocalRecord, type LocalTurn } from "./historyDb";
import { wireOrigin, type HistoryList } from "./historyList";
import { saveSession, writeCache } from "./historyLocalStore";
import { readAnnotations } from "./prefs";
import { projectRecord, type StoredTurn } from "./record";

export type HistoryRecords = ReturnType<typeof createHistoryRecords>;

/** Opens a chat from the server or the browser store, and builds what an export folds. */
export function createHistoryRecords(ctx: HistoryCtx, list: HistoryList) {
  const { deps } = ctx;
  const elsewhereHooks: {
    mark?: (sid: Sid, active: { turnId: string | null; approval: boolean }) => void;
    followLocal?: (sid: Sid) => void;
  } = {};

  const openServer = async (sid: Sid): Promise<Sid> => {
    const org = deps.org();
    if (!org) throw new Error("No org");
    const cached = await readLocal(sid, ctx);
    const known =
      cached?.cachedLastSeq !== undefined
        ? { seq: cached.cachedLastSeq, version: cached.cachedStateVersion }
        : undefined;
    const chatQuery = assistantChatQuery(org, sid, known);
    // After a reload the query cache is empty, so the server's answer to `known` is relative to the browser copy.
    const fromBrowser =
      !!known && !!cached?.turns && !deps.queryClient.getQueryData(chatQuery.queryKey);
    let detail: ChatDetail;
    try {
      detail = await deps.queryClient.fetchQuery({ ...chatQuery, staleTime: 0 });
      if (fromBrowser && cached?.turns) {
        detail = mergeChatDetail({ ...detail, turns: cached.turns }, detail);
        deps.queryClient.setQueryData(chatQuery.queryKey, detail);
      }
    } catch (err) {
      const error = toAssistantError(err, { phase: "read" });
      if (error.httpStatus === 404) {
        // Only a chat this browser saw saved can have been deleted; a reloaded unsent draft was never there.
        if (!cached && !ctx.session(sid)?.record.serverBacked && !listedOnServer(org, sid, ctx))
          throw Object.assign(new Error("not_found"), { code: "not_found" });
        await goneElsewhere(sid, ctx);
        throw Object.assign(new Error("deleted_elsewhere"), { code: "deleted_elsewhere" });
      }
      adoptUnavailable(sid, cached, ctx);
      return sid;
    }
    const turns = detail.turns ?? [];
    const ahead = cached && liveSaveAhead(cached, turns, deps.now());
    const messages = ahead
      ? cached.messages
      : withRecordedApprovals(
          projectRecord(patchCards(turns, cached?.turns), "owner", ownerOptions(ctx)),
          readAnnotations(ctx.key() ?? "", sid),
        );
    const settled = !detail.active_turn && !turns.some((turn) => turn.status === "running");
    ctx.deps.store().adoptSession(sid, {
      ...adoptBase(sid, detail.title, cached, detail),
      messages,
      record: {
        serverBacked: true,
        cachedLastSeq: settled ? detail.last_committed_seq : null,
        stateVersion: detail.state_version ?? null,
        historyUnavailable: false,
        forkedFromShare: detail.forked_from_share ?? null,
        pinned: detail.pinned ?? cached?.pinned ?? false,
      },
    });
    ctx.turnsBySid.set(sid, turns);
    void writeCache(sid, ctx, {
      ...(settled && { cachedLastSeq: detail.last_committed_seq }),
      ...(detail.state_version && { cachedStateVersion: detail.state_version }),
      turns,
    });
    if (detail.active_turn)
      elsewhereHooks.mark?.(sid, {
        turnId: detail.active_turn_id ?? null,
        approval: detail.pending_approval === true,
      });
    return sid;
  };

  const openLocal = async (sid: Sid): Promise<Sid> => {
    const record = await readLocal(sid, ctx);
    if (!record) throw Object.assign(new Error("not_found"), { code: "not_found" });
    ctx.deps.store().adoptSession(sid, {
      ...adoptBase(sid, record.title, record),
      messages: localMessages(record, sid, ctx),
      record: { serverBacked: false, pinned: record.pinned ?? false, historyUnavailable: false },
    });
    ctx.turnsBySid.set(sid, record.turns ?? []);
    elsewhereHooks.followLocal?.(sid);
    return sid;
  };

  // A browser chat by its row id, else a listed server chat whose id this browser derived.
  const sidOfChatId = (chatId: number): Sid | null =>
    ctx.localById.value.get(chatId)?.sessionId ?? list.sidOfChatId(chatId);

  const api = {
    async open(target: { sid: Sid } | { chatId: number }): Promise<Sid> {
      const sid = "sid" in target ? target.sid : sidOfChatId(target.chatId);
      if (!sid) throw Object.assign(new Error("not_found"), { code: "not_found" });
      return ctx.serverMode() ? openServer(sid) : openLocal(sid);
    },
    create(): Sid {
      return ctx.deps.store().createSession({
        origin: { entryKind: "thread_new", objectKind: "none", container: "sidebar" },
        thread: "new",
      });
    },
    async save(sid: Sid): Promise<"server" | "local" | "not_saved"> {
      return saveSession(sid, ctx);
    },
    notSaved: (sid: Sid | null) => !!sid && ctx.notSavedSids.has(sid),
    deletedNotice: ctx.deletedNotice,
    clearDeletedNotice: () => {
      ctx.deletedNotice.value = null;
    },
    async recordOf(sid: Sid) {
      const session = ctx.session(sid);
      const record = await readLocal(sid, ctx);
      const title = String(
        session?.title ?? record?.title ?? deps.t("assistant.thread.newChatTitle"),
      );
      const created = sidTime(sid) ?? record?.id ?? deps.now();
      const origin = record?.origin ?? originOf(session?.origin);
      let turns = ctx.turnsBySid.get(sid) ?? record?.turns ?? [];
      const serverChat = session?.record.serverBacked || list.serverSids.value.has(sid);
      if (ctx.serverMode() && serverChat && deps.org()) {
        const detail = await deps.queryClient
          .fetchQuery(assistantChatQuery(deps.org()!, sid))
          .catch(() => null);
        if (detail?.turns) turns = detail.turns;
      }
      const messages = session?.messages.length
        ? toRaw(session.messages)
        : (record?.messages ?? []);
      return { title, created, origin, turns, messages };
    },
  };

  return { api, hooks: elsewhereHooks, openServer, openLocal };
}

/** The owner's own reload folds unscrubbed, as the live stream showed it and `owner.json` pins it. */
export function ownerOptions(ctx: HistoryCtx) {
  return { timezone: ctx.deps.timezone(), scrubModels: false, t: ctx.deps.t };
}

/** Today's server history drops `confirmation_required`; the card this browser saw goes back where it was. */
export function patchCards(turns: StoredTurn[], cached: LocalTurn[] | undefined): StoredTurn[] {
  if (!cached?.length) return turns;
  return turns.map((turn) => {
    if (turn.frames.some((frame) => frame?.type === "confirmation_required")) return turn;
    const own = cached.find((candidate) => candidate.turn_id === turn.turn_id)?.frames ?? [];
    if (!own.some(isCardFrame)) return turn;
    const frames = [...turn.frames];
    let last = -1;
    own.forEach((frame, index) => {
      if (!isCardFrame(frame)) return;
      // A resolution follows its card; any other card finds its own place.
      last =
        last >= 0 && isCardFrame(own[index - 1])
          ? last + 1
          : anchorOf(frames, frame, own.slice(0, index));
      frames.splice(last, 0, frame);
    });
    return { ...turn, frames };
  });
}

function isCardFrame(frame: any): boolean {
  return frame?.type === "confirmation_required" || frame?.type === "confirmation_resolved";
}

// Before the result of the call it gated; else after the frame that preceded it; else before the first result.
function anchorOf(frames: any[], card: any, before: any[]): number {
  const callId = typeof card?.call_id === "string" ? card.call_id : null;
  if (callId) {
    const at = frames.findIndex((f) => f?.type === "tool_result" && f.call_id === callId);
    if (at >= 0) return at;
  }
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const previous = before[i];
    if (isCardFrame(previous)) continue;
    const at = frames.findIndex((f) => sameFrame(f, previous));
    if (at >= 0) return at + 1;
    break;
  }
  const at = frames.findIndex((f) => f?.type === "tool_result" || f?.type === "complete");
  return at < 0 ? frames.length : at;
}

function sameFrame(a: any, b: any): boolean {
  if (a?.type !== b?.type) return false;
  if (a?.call_id || b?.call_id) return a?.call_id === b?.call_id;
  return JSON.stringify(a) === JSON.stringify(b);
}

function listedOnServer(org: string, sid: Sid, ctx: HistoryCtx): boolean {
  const pages = ctx.deps.queryClient.getQueriesData<ChatsPage>({
    queryKey: assistantChatsQuery(org).queryKey.slice(0, 3),
  });
  return pages.some(([, page]) => !!page?.chats?.some((chat) => chat.session_id === sid));
}

function adoptUnavailable(sid: Sid, cached: LocalRecord | null, ctx: HistoryCtx): void {
  ctx.deps.store().adoptSession(sid, {
    ...adoptBase(sid, cached?.title ?? "", cached),
    messages: cached?.messages ?? [],
    record: { serverBacked: true, historyUnavailable: true },
  });
}

function adoptBase(
  sid: Sid,
  title: string,
  record: LocalRecord | null | undefined,
  summary?: ChatSummaryWire,
): Omit<AdoptInit, "messages" | "record"> {
  return {
    chatId: record?.id ?? sidTime(sid),
    title: title ? raw(title) : null,
    titleSource: record?.titleSource ?? "generated",
    origin: sessionOriginOf(record?.origin ?? wireOrigin(summary)),
  };
}

function sessionOriginOf(origin: EntryOrigin): SessionOrigin {
  if (origin === "alert")
    return { entryKind: "object_verb", objectKind: "alert", container: "sidebar" };
  if (origin === "incident")
    return { entryKind: "object_verb", objectKind: "incident", container: "rca" };
  if (origin === "editor")
    return { entryKind: "editor_button", objectKind: "query", container: "sidebar" };
  return { entryKind: "deep_link", objectKind: "none", container: "full_view" };
}

function localMessages(record: LocalRecord, sid: Sid, ctx: HistoryCtx): ChatMessage[] {
  const turns = record.turns ?? [];
  // A row a legacy tab also wrote has turns the stored turns lack, so its messages are the whole record.
  if (turns.length === 0 || messageGroups(record.messages).length > turns.length)
    return record.messages;
  const messages = projectRecord(turns, "owner", ownerOptions(ctx));
  return withRecordedApprovals(messages, readAnnotations(ctx.key() ?? "", sid));
}

// A decision this browser recorded whose card the server lost still shows, as a record and never as Ask again.
function withRecordedApprovals(
  messages: ChatMessage[],
  annotations: Record<string, BlockAnnotation>,
): ChatMessage[] {
  const prefix = approvalAnnotationKey("");
  const shown = new Set(
    messages.flatMap((m) => m.contentBlocks ?? []).map((b) => b.approval?.id ?? b.resolved?.id),
  );
  for (const [key, annotation] of Object.entries(annotations)) {
    if (!key.startsWith(prefix) || !annotation.approvalOutcome) continue;
    const id = key.slice(prefix.length);
    if (shown.has(id)) continue;
    const target = answerOfTurn(messages, id.split(":")[0]);
    if (!target) continue;
    target.contentBlocks = [...(target.contentBlocks ?? []), recordedCard(id, annotation)];
  }
  return messages;
}

function answerOfTurn(messages: ChatMessage[], turnId: string): ChatMessage | null {
  const start = messages.findIndex((m) => m.role === "user" && m.turnId === turnId);
  if (start < 0) return null;
  const answer = messages[start + 1];
  return answer?.role === "assistant" ? answer : null;
}

function recordedCard(id: string, annotation: BlockAnnotation): ContentBlock {
  const entry = annotation.ledger?.[0];
  const items = annotation.approvalResult?.items ?? [];
  const kind = entry?.op === "run_command" ? "run_command" : (entry?.op ?? "update");
  return {
    type: "approval",
    approval: {
      id,
      kind,
      destructive: true,
      operation: "",
      tool: entry?.tool ?? "",
      targets: items.map((item) => ({
        type: item.type,
        name: item.name,
        ...(item.id && { id: item.id }),
      })),
      grantable: false,
      editable: false,
      question: "",
      typed: false,
    },
  };
}

function liveSaveAhead(record: LocalRecord, turns: StoredTurn[], now: number): boolean {
  if (!record.serverBacked || record.cachedLastSeq !== undefined || !record.liveTurnId)
    return false;
  if (record.liveSavedAt !== undefined && now - record.liveSavedAt > LIVE_SAVE_GRACE_MS)
    return false;
  const turn = turns.find((stored) => stored.turn_id === record.liveTurnId);
  return !turn || turn.status === "running";
}
