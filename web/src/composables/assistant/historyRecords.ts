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

import type { ChatApproval, ChatDetail, ChatsPage, ChatSummaryWire } from "@/services/assistant";
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
import type {
  ApprovalOutcome,
  BlockAnnotation,
  EntryOrigin,
  SessionOrigin,
  Sid,
} from "./assistantStore.types";
import { goneElsewhere, originOf, readLocal, sidTime, type HistoryCtx } from "./historyContext";
import { LIVE_SAVE_GRACE_MS, messageGroups, type LocalRecord, type LocalTurn } from "./historyDb";
import { wireOrigin, type HistoryList } from "./historyList";
import { saveSession, writeCache } from "./historyLocalStore";
import { readAnnotations } from "./prefs";
import { projectRecord, type StoredTurn } from "./record";
import type { ApprovalBlockData } from "./reducer";

// The record a server approval row leaves on a card this tab held.
const ROW_ENDINGS: Record<ChatApproval["status"], ApprovalOutcome["state"]> = {
  pending: "withdrawn",
  approved: "approved_elsewhere",
  denied: "declined_elsewhere",
  expired: "expired",
  withdrawn: "withdrawn",
};

// A server-derived ending as the record a card keeps; endings with no decision behind them keep none.
const RECORDED_STATUS: Partial<
  Record<CardEnding, NonNullable<ApprovalBlockData["recorded"]>["status"]>
> = {
  approved_elsewhere: "approved",
  declined_elsewhere: "denied",
  expired: "expired",
  withdrawn: "withdrawn",
};

export type HistoryRecords = ReturnType<typeof createHistoryRecords>;

/** How a card ended; `unknown` is answered with no evidence of the decision, so it keeps no outcome. */
export type CardEnding = ApprovalOutcome["state"] | "unknown";

/** A turn another tab, device or a reloaded page runs; `card` is the approval it still waits on here. */
export interface ElsewhereMark {
  turnId: string | null;
  approval: boolean;
  card?: ApprovalBlockData;
}

/** Opens a chat from the server or the browser store, and builds what an export folds. */
export function createHistoryRecords(ctx: HistoryCtx, list: HistoryList) {
  const { deps } = ctx;
  const elsewhereHooks: {
    mark?: (sid: Sid, active: ElsewhereMark) => void;
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
    const annotations = readAnnotations(ctx.key() ?? "", sid);
    const messages = ahead
      ? cached.messages
      : withRecordedApprovals(
          withCachedCards(
            projectRecord(patchCards(turns, cached?.turns), "owner", {
              ...ownerOptions(ctx),
              ...(detail.approvals && { approvals: detail.approvals }),
            }),
            cached?.messages,
            annotations,
            detail,
          ),
          annotations,
        );
    const turnId = detail.active_turn ? runningTurnOf(detail, cached?.messages) : null;
    const waiting =
      turnId && waitingCardOf(detail, turnId, messages, cached?.messages, annotations, deps.now());
    const card = waiting && placeCard(messages, waiting.turnId, waiting.card) ? waiting.card : null;
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
        turnId: detail.active_turn_id ?? (card ? turnId : null),
        approval: detail.pending_approval === true,
        ...(card && { card }),
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

/** The running turn's id: the server's marker when it sends one, else its running stored turn, else this browser's last prompt. */
export function runningTurnOf(
  detail: Pick<ChatDetail, "active_turn_id" | "turns">,
  cached: ChatMessage[] | undefined,
): string | null {
  if (detail.active_turn_id) return detail.active_turn_id;
  const running = detail.turns?.findLast((turn) => turn.status === "running")?.turn_id;
  if (running) return running;
  return cached?.findLast((message) => message.role === "user" && message.turnId)?.turnId ?? null;
}

/** How the server ended a card, or `null` while it still waits; `unknown` when it was answered but nothing says how. */
export function cardEnding(
  detail: Pick<ChatDetail, "active_turn" | "pending_approval" | "approvals" | "turns">,
  turnId: string,
  cardId: string,
): CardEnding | null {
  const known = decisionOf(detail, turnId, cardId);
  if (known !== undefined) return known;
  if (!detail.active_turn || detail.pending_approval === false) return "withdrawn";
  return null;
}

/** The card the running turn still waits on, from the record or this browser's copy; `null` once answered, decided here or past its own expiry. */
export function waitingCardOf(
  detail: Pick<ChatDetail, "active_turn" | "pending_approval" | "approvals" | "turns">,
  turnId: string,
  messages: ChatMessage[],
  cached: ChatMessage[] | undefined,
  annotations: Record<string, BlockAnnotation>,
  now: number,
): { turnId: string; card: ApprovalBlockData } | null {
  if (!detail.active_turn) return null;
  const card =
    openCardOf(answerOfTurn(messages, turnId)) ?? openCardOf(answerOfTurn(cached ?? [], turnId));
  if (!card || typeof card.expiresAt !== "number" || card.expiresAt <= now) return null;
  if (cardEnding(detail, turnId, card.id) !== null) return null;
  if (annotations[approvalAnnotationKey(card.id)]?.approvalOutcome) return null;
  const open: ApprovalBlockData = { ...card };
  delete open.noDecision;
  delete open.recorded;
  return { turnId, card: open };
}

/** Puts a waiting card back in its turn's answer, replacing the record a replay made of it; false when the turn has no prompt here. */
export function placeCard(
  messages: ChatMessage[],
  turnId: string,
  card: ApprovalBlockData,
): boolean {
  const start = messages.findIndex((m) => m.role === "user" && m.turnId === turnId);
  if (start < 0) return false;
  const answer = answerOfTurn(messages, turnId);
  const block: ContentBlock = { type: "approval", approval: card };
  if (!answer) {
    messages.splice(start + 1, 0, { role: "assistant", content: raw(""), contentBlocks: [block] });
    return true;
  }
  const known = answer.contentBlocks?.find((b) => b.approval?.id === card.id);
  if (known) known.approval = card;
  else answer.contentBlocks = [...(answer.contentBlocks ?? []), block];
  return true;
}

/** Puts back the cards only this browser saw, each with the outcome the server's record shows, so a history that drops them keeps them. */
export function withCachedCards(
  messages: ChatMessage[],
  cached: ChatMessage[] | undefined,
  annotations: Record<string, BlockAnnotation>,
  detail: Pick<ChatDetail, "active_turn" | "approvals" | "turns">,
): ChatMessage[] {
  let turnId: string | undefined;
  for (const message of cached ?? []) {
    if (message.role === "user") turnId = message.turnId;
    if (message.role !== "assistant" || !turnId) continue;
    for (const block of message.contentBlocks ?? []) {
      const card = block.approval;
      if (!card) continue;
      if (messages.some((m) => m.contentBlocks?.some((b) => b.approval?.id === card.id))) continue;
      const decided = !!annotations[approvalAnnotationKey(card.id)]?.approvalOutcome;
      placeCard(messages, turnId, decided ? card : serverRecordedCard(card, detail, turnId));
    }
  }
  return messages;
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

// The decision the server's rows or the turn's own frames show; `undefined` when they show none.
function decisionOf(
  detail: Pick<ChatDetail, "active_turn" | "approvals" | "turns">,
  turnId: string,
  cardId: string,
): CardEnding | null | undefined {
  const row = detail.approvals?.find((approval) => approval.id === cardId);
  if (row) return row.status === "pending" && detail.active_turn ? null : ROW_ENDINGS[row.status];
  const frames = detail.turns?.find((turn) => turn.turn_id === turnId)?.frames ?? [];
  const resolved = frames.find((f) => f?.type === "confirmation_resolved" && f.id === cardId);
  if (resolved)
    return resolved.expired
      ? "expired"
      : resolved.withdrawn
        ? "withdrawn"
        : resolved.approved
          ? "approved_elsewhere"
          : "declined_elsewhere";
  // A result proves the card was answered; only a successful one proves it was approved, since an approved call can still fail.
  const result = frames.find((f) => f?.type === "tool_result" && f.call_id === cardId);
  if (result) return result.success === false ? "unknown" : "approved_elsewhere";
  return undefined;
}

// When the server's row or resolution says the card was decided; a tool result carries no decision time.
function decisionAt(
  detail: Pick<ChatDetail, "approvals" | "turns">,
  turnId: string,
  cardId: string,
): number | undefined {
  const row = detail.approvals?.find((approval) => approval.id === cardId);
  if (row) return row.at;
  const frames = detail.turns?.find((turn) => turn.turn_id === turnId)?.frames ?? [];
  const at = frames.find((f) => f?.type === "confirmation_resolved" && f.id === cardId)?.at;
  return typeof at === "number" ? at : undefined;
}

// A cached card as the record the server's evidence supports; with none it says no answer was recorded.
function serverRecordedCard(
  card: ApprovalBlockData,
  detail: Pick<ChatDetail, "active_turn" | "approvals" | "turns">,
  turnId: string,
): ApprovalBlockData {
  const ending = decisionOf(detail, turnId, card.id);
  const status = ending ? RECORDED_STATUS[ending] : undefined;
  const at = decisionAt(detail, turnId, card.id);
  const base: ApprovalBlockData = { ...card };
  delete base.noDecision;
  delete base.recorded;
  if (status) return { ...base, recorded: { status, ...(at !== undefined && { at }) } };
  return ending === "unknown" ? base : { ...base, noDecision: true };
}

// The last card of an answer, unless a resolution in the same answer already ended it.
function openCardOf(answer: ChatMessage | null): ApprovalBlockData | null {
  const blocks = answer?.contentBlocks ?? [];
  const card = blocks.filter((block) => block.approval).at(-1)?.approval;
  return card && !blocks.some((block) => block.resolved?.id === card.id) ? card : null;
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
