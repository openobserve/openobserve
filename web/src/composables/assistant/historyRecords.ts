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

import assistant, {
  type ChatActivityRow,
  type ChatApproval,
  type ChatDetail,
  type ChatsPage,
  type ChatSummaryWire,
  type ConfirmResponse,
} from "@/services/assistant";
import {
  assistantChatQuery,
  assistantChatsQuery,
  mergeChatDetail,
} from "@/services/assistant.queries";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { approvalAnnotationKey, MAX_LEDGER } from "./actions/appliers/approval";
import { approvalVerb } from "./approvalAnatomy";
import { toAssistantError } from "./assistantErrors";
import { periodMs } from "./context/contextChips";
import { turnAnnotationKey } from "./evidence";
import type { AdoptInit } from "./assistantStore";
import type {
  ActionLedgerEntry,
  ApprovalOutcome,
  ApprovalResultItem,
  BlockAnnotation,
  BranchedFromRef,
  EntryOrigin,
  ForkSeed,
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
import { isTerminal } from "./turnStates";

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

const CLOSING_FRAMES: ReadonlySet<unknown> = new Set(["follow_ups", "usage", "complete"]);

const LEDGER_OPS: ReadonlySet<string> = new Set(["create", "update", "delete", "run_command"]);

const LEDGER_STATES: ReadonlySet<string> = new Set(["done", "failed", "undone"]);

// The relative windows Home asks over, so a reopened Home chat keeps "Last 24 h" rather than a fixed span.
const HOME_PERIODS = ["15m", "1h", "6h", "24h", "7d"] as const;

// A ledger row is written after the approve it follows; this covers a server clock a little behind the browser's.
const DECISION_SLACK_MS = 60_000;

// A step that may have written; a reopened chat reads its ledger only then, since a standing grant leaves no card.
const WRITE_STEP =
  /^(o2_)?(create|update|delete|set|enable|disable|mute|unmute|cancel|pause|resume|snooze|silence)/i;

const GRANT_SCOPES: ReadonlySet<string> = new Set(["chat", "always"]);

export type HistoryRecords = ReturnType<typeof createHistoryRecords>;

/** How a card ended; `unknown` is answered with no evidence of the decision, so it keeps no outcome. */
export type CardEnding = ApprovalOutcome["state"] | "unknown";

/** A turn another tab, device or a reloaded page runs; `card` is the approval it still waits on here. */
export interface ElsewhereMark {
  turnId: string | null;
  approval: boolean;
  card?: ApprovalBlockData;
  /** The client the server says runs the turn, when it tracks one. */
  ownerClientId?: string | null;
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
    const key = ctx.key();
    // An answer for the org or account the user left must not be adopted or cached under the new one.
    const guard = () => {
      if (deps.org() !== org || ctx.key() !== key)
        throw Object.assign(new Error("identity_changed"), { code: "identity_changed" });
    };
    const cached = await readLocal(sid, ctx);
    guard();
    if (cached && browserOnly(cached, sid, org, ctx)) return openLocal(sid);
    // A `not_modified` answer carries no turns, so only a copy that holds them may claim to be current.
    const known =
      cached?.cachedLastSeq !== undefined && cached.turns
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
        detail = mergeChatDetail(
          {
            ...detail,
            turns: cached.turns,
            ...(cached.cachedSeed && { seed: cached.cachedSeed }),
            ...(cached.cachedApprovals && { approvals: cached.cachedApprovals }),
          },
          detail,
        );
        deps.queryClient.setQueryData(chatQuery.queryKey, detail);
      }
    } catch (err) {
      guard();
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
    guard();
    const turns = detail.turns ?? [];
    const ahead = cached && liveSaveAhead(cached, turns, deps.now());
    const annotations = readAnnotations(ctx.key() ?? "", sid);
    const messages = ahead
      ? cached.messages
      : withRecordedApprovals(
          withCachedCards(
            projectRecord(shownTurns(detail, patchCards(turns, cached?.turns)), "owner", {
              ...ownerOptions(ctx),
              ...(detail.approvals && { approvals: detail.approvals }),
            }),
            cached?.messages,
            annotations,
            detail,
          ),
          annotations,
        );
    markCarried(messages, detail);
    const turnId = detail.active_turn
      ? runningTurnOf(detail, cached?.messages)
      : detail.pending_approval
        ? (turns.at(-1)?.turn_id ?? null)
        : null;
    const waiting = turnId
      ? waitingCardsOf(detail, turnId, messages, cached?.messages, annotations, deps.now())
      : [];
    const cards = waiting.filter((open) => placeCard(messages, open.turnId, open.card));
    const card = cards[0]?.card ?? null;
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
        branchedFrom: branchedFromOf(detail.branched_from),
        pinned: detail.pinned ?? cached?.pinned ?? false,
        ...forkSeedField(detail, cached),
      },
    });
    ctx.turnsBySid.set(sid, turns);
    keepHomeWindow(sid, detail, messages, annotations, ctx);
    void restoreLedger(sid, org, detail.created_at, guard, ctx);
    void writeCache(sid, ctx, {
      ...(settled && { cachedLastSeq: detail.last_committed_seq }),
      ...(detail.state_version && { cachedStateVersion: detail.state_version }),
      turns,
      ...(detail.seed && { cachedSeed: detail.seed }),
      ...(detail.approvals && { cachedApprovals: detail.approvals }),
    });
    if (detail.active_turn)
      elsewhereHooks.mark?.(sid, {
        turnId: detail.active_turn_id ?? (card ? turnId : null),
        approval: detail.pending_approval === true,
        ownerClientId: detail.active_turn_client_id ?? null,
        ...(card && { card }),
      });
    else if (turnId) for (const open of cards) holdAfterTurn(sid, turnId, open.card);
    return sid;
  };

  // A queued write's card outlives its ended turn, so this tab answers it as the live tab did.
  const holdAfterTurn = (sid: Sid, turnId: string, card: ApprovalBlockData) => {
    const session = ctx.session(sid);
    if (!session || session.pendingApproval?.id === card.id) return;
    if (session.turn.state !== "idle" && !isTerminal(session.turn)) return;
    session.turnMeta.turnId = turnId;
    deps.approvals?.()?.restore(sid, card);
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
    joinGrantedLedger: (sid: Sid) => joinGrantedLedger(sid, ctx),
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

/** The ledger entries a reopened chat's approved writes made, matched to their cards by chat, target and time, with the server's id so Undo works again. */
export function ledgerFromActivity(
  messages: readonly ChatMessage[],
  rows: readonly ChatActivityRow[],
): ActionLedgerEntry[] {
  const used = new Set<string>();
  const byTime = [...rows].sort((a, b) => a.at - b.at);
  return approvedWrites(messages).flatMap(({ card, at, turnId }) =>
    (card.targets ?? []).flatMap((target) => {
      const row = byTime.find(
        (candidate) =>
          !used.has(candidate.id) &&
          candidate.at / 1000 >= at - DECISION_SLACK_MS &&
          (target.id ? candidate.target.id === target.id : candidate.target.name === target.name),
      );
      if (!row || !LEDGER_STATES.has(row.result.state)) return [];
      used.add(row.id);
      return [ledgerEntryOf(row, card, turnId, target)];
    }),
  );
}

/** The records of writes a standing grant let run, rebuilt from their ledger rows after the gated step, since the live frame is never stored; returns their ledger entries. */
export function withGrantedRecords(
  messages: ChatMessage[],
  rows: readonly ChatActivityRow[],
): ActionLedgerEntry[] {
  const shown = new Set(
    messages.flatMap((m) => (m.contentBlocks ?? []).map((block) => block.resolved?.id)),
  );
  const taken = new Set<ContentBlock>();
  const byTime = [...rows].sort((a, b) => a.at - b.at);
  return byTime.flatMap((row) => {
    const id = `grant_${row.id}`;
    if (row.approval?.kind !== "standing" || !row.tool || shown.has(id)) return [];
    const place = grantedStepOf(messages, row, taken);
    if (!place) return [];
    taken.add(place.step);
    const card = grantedCardOf(row, id);
    const target = card.targets[0];
    const blocks = place.answer.contentBlocks!;
    blocks.splice(blocks.indexOf(place.step) + 1, 0, {
      type: "approval_result",
      resolved: {
        id,
        approved: true,
        by: "grant",
        at: Math.floor(row.at / 1000),
        ...(GRANT_SCOPES.has(row.approval.scope ?? "") && {
          scope: row.approval.scope as "chat" | "always",
        }),
        ...(row.result.state === "failed" && {
          outcome: "failed" as const,
          ...(row.result.message && { detail: row.result.message }),
        }),
        grant: {
          tool: card.tool,
          operation: card.kind,
          targets: card.targets,
          ...(row.approval.grant_id && { id: row.approval.grant_id }),
        },
      },
    });
    return LEDGER_STATES.has(row.result.state)
      ? [ledgerEntryOf(row, card, place.turnId, target)]
      : [];
  });
}

/** The ledger entries of writes a standing grant let run in this tab, by the approval id their frame and ledger row share. */
export function grantedLedger(
  messages: readonly ChatMessage[],
  rows: readonly ChatActivityRow[],
): ActionLedgerEntry[] {
  let turnId = "";
  return messages.flatMap((message) => {
    if (message.role === "user") turnId = message.turnId ?? "";
    if (message.role !== "assistant") return [];
    return (message.contentBlocks ?? []).flatMap((block) => {
      const resolved = block.resolved;
      if (resolved?.by !== "grant" || !resolved.approved || !resolved.grant) return [];
      const row = rows.find(
        (candidate) =>
          candidate.approval?.kind === "standing" && candidate.approval.id === resolved.id,
      );
      if (!row || !LEDGER_STATES.has(row.result.state)) return [];
      const card = grantedCardOf(row, resolved.id);
      return [ledgerEntryOf(row, card, turnId, card.targets[0])];
    });
  });
}

// A granted write's frame comes before the call runs, so its ledger row is read once the answer ends.
export async function joinGrantedLedger(sid: Sid, ctx: HistoryCtx): Promise<void> {
  const shown = ctx.session(sid);
  if (!shown?.org) return;
  const joined = new Set(
    shown.ledger.flatMap((entry) => (entry.approvalId ? [entry.approvalId] : [])),
  );
  const since = grantedSince(shown.messages, joined);
  if (since === null) return;
  try {
    const rows = await assistant.chatActivity(shown.org, sid, since);
    const session = ctx.session(sid);
    if (!session) return;
    const kept = new Set(session.ledger.map(ledgerTargetKey));
    const added = grantedLedger(session.messages, rows).filter(
      (entry) => !kept.has(ledgerTargetKey(entry)),
    );
    if (!added.length) return;
    session.ledger = [...session.ledger, ...added].sort((a, b) => a.at - b.at).slice(-MAX_LEDGER);
  } catch {
    // Without its ledger row the record still reads right; only Undo stays away.
  }
}

/** The stored resolution names no target, so a reopened record reads each target's result from its ledger row. */
export function withTargetResults(
  messages: ChatMessage[],
  entries: readonly ActionLedgerEntry[],
): void {
  for (const message of messages)
    for (const block of message.contentBlocks ?? []) {
      const resolved = block.resolved;
      if (!resolved || resolved.items?.length) continue;
      const items = entries.filter((entry) => entry.approvalId === resolved.id).map(resultItemOf);
      if (items.length) block.resolved = { ...resolved, items };
    }
}

/** C1 `branched_from` of a stored chat; null on any other chat or a malformed value. */
export function branchedFromOf(value: unknown): BranchedFromRef | null {
  if (!value || typeof value !== "object") return null;
  const { session_id, turn_id, title } = value as Record<string, unknown>;
  if (typeof session_id !== "string" || !session_id || typeof turn_id !== "string") return null;
  return {
    sessionId: session_id.slice(0, 128),
    turnId: turn_id.slice(0, 128),
    title: typeof title === "string" ? title.slice(0, 200) : "",
  };
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

/** The turns a chat read shows: a branch's carried turns first, then its own with each pending card the turns never stored. */
export function shownTurns(
  detail: Pick<ChatDetail, "turns" | "seed" | "branched_from" | "approvals" | "active_turn_id">,
  turns: StoredTurn[] = detail.turns ?? [],
): StoredTurn[] {
  const own = withPendingCards(withDecidedCards(turns, detail.approvals), detail);
  // A share fork shows its seed above the divider instead; a branch continues it as its own turns.
  const carried = detail.branched_from ? (detail.seed?.turns ?? []) : [];
  return carried.length ? [...carried, ...own] : own;
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
  kind?: ApprovalBlockData["kind"],
  now = Date.now(),
): CardEnding | null {
  const known = decisionOf(detail, turnId, cardId, now);
  if (known !== undefined) return known;
  if (!detail.active_turn) return "withdrawn";
  // A question is never stored or marked pending, so only its turn's end can say it is over.
  if (kind !== "question" && detail.pending_approval === false) return "withdrawn";
  return null;
}

/** What a chat read says of one pending card, with the stored row's microseconds as the milliseconds `/confirm` answers in. */
export function serverCardOf(
  detail: Pick<ChatDetail, "active_turn" | "pending_approval" | "approvals" | "turns">,
  turnId: string,
  id: string,
  kind?: ApprovalBlockData["kind"],
): Pick<ConfirmResponse, "expires_at" | "user_extends_left"> & { ending: CardEnding | null } {
  const row = detail.approvals?.find((approval) => approval.id === id);
  return {
    ending: cardEnding(detail, turnId, id, kind),
    expires_at: row?.expires_at === undefined ? undefined : Math.floor(row.expires_at / 1000),
    user_extends_left: row?.user_extends_left,
  };
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
  return waitingCardsOf(detail, turnId, messages, cached, annotations, now)[0] ?? null;
}

/** Every card the turn still waits on, in the order asked: one turn can queue several writes. */
export function waitingCardsOf(
  detail: Pick<ChatDetail, "active_turn" | "pending_approval" | "approvals" | "turns">,
  turnId: string,
  messages: ChatMessage[],
  cached: ChatMessage[] | undefined,
  annotations: Record<string, BlockAnnotation>,
  now: number,
): { turnId: string; card: ApprovalBlockData }[] {
  const recorded = openCardsOf(answerOfTurn(messages, turnId));
  const cards = recorded.length ? recorded : openCardsOf(answerOfTurn(cached ?? [], turnId));
  return cards.flatMap((card) => {
    if (typeof card.expiresAt !== "number" || card.expiresAt <= now) return [];
    if (cardEnding(detail, turnId, card.id, card.kind, now) !== null) return [];
    if (annotations[approvalAnnotationKey(card.id)]?.approvalOutcome) return [];
    const open: ApprovalBlockData = { ...card };
    delete open.noDecision;
    delete open.recorded;
    return [{ turnId, card: open }];
  });
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
  detail: Pick<ChatDetail, "active_turn" | "pending_approval" | "approvals" | "turns">,
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

// `forked_from_share` is the share's id, not its token, and a server-held seed outlives the share, so it carries no token to probe.
function forkSeedField(
  detail: Pick<ChatDetail, "seed" | "forked_from_share" | "title">,
  cached: LocalRecord | null | undefined,
): { seed?: ForkSeed } {
  if (!detail.forked_from_share || !detail.seed) return cached?.seed ? { seed: cached.seed } : {};
  return {
    seed: {
      title: detail.seed.title ?? cached?.seed?.title ?? detail.title,
      ownerName: detail.seed.owner_name ?? cached?.seed?.ownerName ?? "",
      asOf: detail.seed.as_of ? detail.seed.as_of / 1000 : (cached?.seed?.asOf ?? 0),
      turns: detail.seed.turns,
      ...(cached?.seed?.redacted && { redacted: true }),
      ...(cached?.seed?.hidden && { hidden: cached.seed.hidden }),
    },
  };
}

function markCarried(messages: ChatMessage[], detail: Pick<ChatDetail, "seed" | "branched_from">) {
  if (!detail.branched_from) return;
  const carried = new Set(detail.seed?.turns.map((turn) => turn.turn_id) ?? []);
  for (const message of messages)
    if (message.role === "user" && message.turnId && carried.has(message.turnId))
      message.carried = true;
}

// Today's server keeps a card only in its approval row, so the turn waiting on it gets the card back before its closing frames.
function withPendingCards(
  turns: StoredTurn[],
  detail: Pick<ChatDetail, "approvals" | "active_turn_id">,
): StoredTurn[] {
  const target = detail.active_turn_id ?? turns.at(-1)?.turn_id;
  if (!target) return turns;
  const stored = new Set(
    turns.flatMap((turn) => turn.frames.filter(isCardFrame).map((frame) => frame?.id)),
  );
  const cards = (detail.approvals ?? []).flatMap((row) =>
    row.status === "pending" && row.card && !stored.has(row.id) ? [row.card] : [],
  );
  if (!cards.length) return turns;
  return turns.map((turn) => {
    if (turn.turn_id !== target) return turn;
    let at = turn.frames.length;
    while (at > 0 && CLOSING_FRAMES.has(turn.frames[at - 1]?.type)) at -= 1;
    return { ...turn, frames: [...turn.frames.slice(0, at), ...cards, ...turn.frames.slice(at)] };
  });
}

// A decided row's card goes back before the call it gated, its resolution right after it with what the approve came to, as the live stream showed them.
function withDecidedCards(
  turns: StoredTurn[],
  approvals: readonly ChatApproval[] | undefined,
): StoredTurn[] {
  const decided = (approvals ?? []).filter((row) => row.status !== "pending" && row.card);
  if (!decided.length) return turns;
  return turns.map((turn) => {
    let frames = turn.frames;
    for (const row of decided) frames = placeDecided(frames, row);
    return frames === turn.frames ? turn : { ...turn, frames };
  });
}

function placeDecided(frames: any[], row: ChatApproval): any[] {
  const isResolution = (f: any) => f?.type === "confirmation_resolved" && f.id === row.id;
  const resolvedAt = frames.findIndex(isResolution);
  const gatedAt = frames.findIndex((f) => f?.type === "tool_result" && f.approval_id === row.id);
  if (resolvedAt < 0 && gatedAt < 0) return frames;
  const resolution = Object.assign({}, ...frames.filter(isResolution), resolutionOf(row));
  const rest = frames.filter((f) => !isResolution(f));
  const cardAt = rest.findIndex((f) => f?.type === "confirmation_required" && f.id === row.id);
  if (cardAt >= 0) {
    rest.splice(cardAt + 1, 0, resolution);
    return rest;
  }
  const gated = (f: any) => f?.type === "tool_result" && f.approval_id === row.id;
  const at = rest.findIndex(gated);
  const last = rest.findLastIndex(gated);
  // A gathered card gates one call per target; its record goes after them all, so the proposal text follows it.
  const anchor = at < 0 ? resolvedAt : last > at ? last + 1 : at;
  rest.splice(anchor, 0, row.card, resolution);
  return rest;
}

// The row's decision as a `confirmation_resolved` frame; the turn's own copy only says approved or not.
function resolutionOf(row: ChatApproval): Record<string, unknown> {
  const status = row.status;
  return {
    type: "confirmation_resolved",
    id: row.id,
    approved: status === "approved",
    ...(row.at !== undefined && { at: row.at }),
    ...(status === "expired" && { expired: true }),
    ...(status === "withdrawn" && { withdrawn: true }),
    ...row.resolved,
  };
}

// Reads the chat's ledger rows after the chat shows, so a slow or refused read never holds the record back.
async function restoreLedger(
  sid: Sid,
  org: string,
  createdAt: number,
  guard: () => void,
  ctx: HistoryCtx,
): Promise<void> {
  const shown = ctx.session(sid);
  if (!shown || !(approvedWrites(shown.messages).length || hasWriteStep(shown.messages))) return;
  try {
    const rows = await assistant.chatActivity(org, sid, Math.max(0, createdAt));
    guard();
    const session = ctx.session(sid);
    if (!session) return;
    const found = [
      ...ledgerFromActivity(session.messages, rows),
      ...withGrantedRecords(session.messages, rows),
    ];
    withTargetResults(session.messages, found);
    const kept = new Set(session.ledger.map(ledgerTargetKey));
    const added = found.filter((entry) => !kept.has(ledgerTargetKey(entry)));
    if (!added.length) return;
    session.ledger = [...session.ledger, ...added].sort((a, b) => a.at - b.at).slice(-MAX_LEDGER);
  } catch {
    // Without the ledger the records still read right; only Undo stays away.
  }
}

// A Home chat asks over Home's relative window, which no page supplies once the chat is reopened.
function keepHomeWindow(
  sid: Sid,
  detail: Pick<ChatDetail, "origin" | "turns">,
  messages: readonly ChatMessage[],
  annotations: Record<string, BlockAnnotation>,
  ctx: HistoryCtx,
): void {
  const session = ctx.session(sid);
  if (!session || session.composer.timeOverride) return;
  const prompts = messages.filter((m) => m.role === "user" && !m.carried && m.turnId);
  const first = prompts[0];
  const last = prompts.at(-1);
  if (!first || !last) return;
  const windowOf = (m: ChatMessage) => annotations[turnAnnotationKey(m.turnId!, "window")];
  // A `not_modified` read carries no `origin`, but the cached first turn still says where it was asked.
  const firstEntry = detail.turns?.find((turn) => turn.turn_id === first.turnId)?.user?.entry_kind;
  const fromHome = detail.origin === "home" || firstEntry === "home_launcher";
  if (!fromHome && !windowOf(first)?.homeDefaultWindow) return;
  const asked = windowOf(last)?.window ?? last.sentWindow;
  if (!asked || !(asked.to > asked.from)) return;
  const period =
    HOME_PERIODS.find((p) => p === last.sentWindow?.period) ??
    HOME_PERIODS.find((p) => periodMs(p) === asked.to - asked.from);
  ctx.deps.store().setTimeOverride(sid, { ...asked, ...(period && { period }) });
}

// One entry per approval and target, so a reload adds each target this browser has no entry for.
function ledgerTargetKey(entry: ActionLedgerEntry): string {
  return `${entry.approvalId}\u0000${entry.resource.id ?? entry.resource.name}`;
}

function resultItemOf(entry: ActionLedgerEntry): ApprovalResultItem {
  const failed = entry.status === "failed";
  return {
    type: entry.resource.type,
    name: entry.resource.name,
    ...(entry.resource.id && { id: entry.resource.id }),
    status: failed ? "failed" : "done",
    ...(failed && entry.reason && { message: entry.reason }),
    ledgerId: entry.id,
    ...(entry.undoable && { undoable: true }),
  };
}

// Each approved write card with its decision time and turn, in transcript order.
function approvedWrites(
  messages: readonly ChatMessage[],
): { card: ApprovalBlockData; at: number; turnId: string }[] {
  let turnId = "";
  return messages.flatMap((message) => {
    if (message.role === "user") turnId = message.turnId ?? "";
    const blocks = message.role === "assistant" ? (message.contentBlocks ?? []) : [];
    return blocks.flatMap((block) => {
      const card = block.approval;
      const resolved = card && blocks.find((b) => b.resolved?.id === card.id)?.resolved;
      if (!card || !resolved?.approved || !LEDGER_OPS.has(card.kind)) return [];
      return [{ card, at: resolved.at ?? 0, turnId }];
    });
  });
}

// Microseconds to read the ledger from: the earliest granted record with no entry yet, else null.
function grantedSince(
  messages: readonly ChatMessage[],
  joined: ReadonlySet<string>,
): number | null {
  const times = messages.flatMap((message) =>
    (message.contentBlocks ?? []).flatMap((block) => {
      const resolved = block.resolved;
      const open = resolved?.by === "grant" && resolved.approved && !joined.has(resolved.id);
      return open ? [resolved.at ?? Date.now()] : [];
    }),
  );
  return times.length ? Math.max(0, Math.min(...times) - DECISION_SLACK_MS) * 1000 : null;
}

function hasWriteStep(messages: readonly ChatMessage[]): boolean {
  return messages.some((m) =>
    (m.contentBlocks ?? []).some(
      (block) => block.type === "tool_call" && WRITE_STEP.test(String(block.tool ?? "")),
    ),
  );
}

// The step a standing write ran in: its tool's first unclaimed step in the latest turn asked before the write.
function grantedStepOf(
  messages: ChatMessage[],
  row: ChatActivityRow,
  taken: ReadonlySet<ContentBlock>,
): { answer: ChatMessage; step: ContentBlock; turnId: string } | null {
  const tool = normalTool(row.tool ?? "");
  const writtenAt = row.at / 1000 + DECISION_SLACK_MS;
  let found: { answer: ChatMessage; step: ContentBlock; turnId: string } | null = null;
  let asker: ChatMessage | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      asker = message;
      continue;
    }
    const turnId = asker?.turnId ?? "";
    if ((asker?.sentAt ?? 0) > writtenAt) continue;
    const step = (message.contentBlocks ?? []).find(
      (block) =>
        block.type === "tool_call" && !taken.has(block) && normalTool(String(block.tool)) === tool,
    );
    if (step) found = { answer: message, step, turnId };
  }
  return found;
}

function normalTool(tool: string): string {
  return tool.replace(/^o2_/i, "").toLowerCase();
}

// The card a granted write would have had; its kind comes from the tool, as the ledger row names no operation.
function grantedCardOf(row: ChatActivityRow, id: string): ApprovalBlockData {
  const tool = (row.tool ?? "").replace(/^o2_/i, "");
  const kind = /^create/i.test(tool) ? "create" : /^delete/i.test(tool) ? "delete" : "update";
  const name = row.target.name || row.target.id || tool;
  return {
    id,
    kind,
    destructive: kind === "delete",
    operation: kind,
    tool,
    targets: [
      {
        type: (row.target.type || "object").toLowerCase(),
        name,
        ...(row.target.id && { id: row.target.id }),
      },
    ],
    grantable: false,
    editable: false,
    question: "",
    typed: true,
  };
}

function ledgerEntryOf(
  row: ChatActivityRow,
  card: ApprovalBlockData,
  turnId: string,
  target: ApprovalBlockData["targets"][number],
): ActionLedgerEntry {
  const status = row.result.state as ActionLedgerEntry["status"];
  const verb = approvalVerb(card);
  return {
    id: row.id,
    approvalId: card.id,
    turnId,
    tool: card.tool,
    op: card.kind as ActionLedgerEntry["op"],
    ...(verb && { verb }),
    resource: {
      type: row.target.type || target.type,
      name: row.target.name || target.name,
      ...((row.target.id || target.id) && { id: (row.target.id || target.id)! }),
    },
    status,
    undoable: status === "done" && row.undo.available,
    at: Math.floor(row.at / 1000),
    ...(status === "failed" && row.result.message && { reason: row.result.message }),
  };
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

// A local-mode chat still waiting for import: the server has no copy, so its 404 is not a deletion.
function browserOnly(record: LocalRecord, sid: Sid, org: string, ctx: HistoryCtx): boolean {
  return (
    !record.serverBacked &&
    !record.importedAs &&
    record.cachedLastSeq === undefined &&
    !ctx.session(sid)?.record.serverBacked &&
    !listedOnServer(org, sid, ctx)
  );
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
  detail: Pick<ChatDetail, "active_turn" | "pending_approval" | "approvals" | "turns">,
  turnId: string,
  cardId: string,
  now = Date.now(),
): CardEnding | null | undefined {
  const row = detail.approvals?.find((approval) => approval.id === cardId);
  if (row?.status === "pending" && !detail.active_turn)
    return pendingAfterTurn(detail, turnId, row, now);
  if (row) return row.status === "pending" ? null : ROW_ENDINGS[row.status];
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

// A pending row outlives its ended turn only while the server still calls the chat waiting and no later turn moved it on.
function pendingAfterTurn(
  detail: Pick<ChatDetail, "pending_approval" | "turns">,
  turnId: string,
  row: ChatApproval,
  now: number,
): CardEnding | null {
  if (row.expires_at !== undefined && row.expires_at <= now * 1000) return "expired";
  const newest = detail.turns?.at(-1)?.turn_id;
  if (detail.pending_approval !== true || (newest !== undefined && newest !== turnId))
    return "withdrawn";
  return null;
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
  detail: Pick<ChatDetail, "active_turn" | "pending_approval" | "approvals" | "turns">,
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

// An answer's cards that no resolution in the same answer already ended.
function openCardsOf(answer: ChatMessage | null): ApprovalBlockData[] {
  const blocks = answer?.contentBlocks ?? [];
  const ended = new Set(blocks.map((block) => block.resolved?.id));
  return blocks.flatMap((block) =>
    block.approval && !ended.has(block.approval.id) ? [block.approval] : [],
  );
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
