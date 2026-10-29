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

import { watch } from "vue";

import type { ChatDetail } from "@/services/assistant";
import { assistantChatQuery } from "@/services/assistant.queries";
import { raw } from "@/types/i18n";

import { toAssistantError } from "./assistantErrors";
import type { Sid } from "./assistantStore.types";
import { goneElsewhere, type HistoryCtx, type HistoryDeps } from "./historyContext";
import { createElsewhere, type Elsewhere } from "./historyElsewhere";
import {
  cardEnding,
  ownerOptions,
  placeCard,
  type ElsewhereMark,
  type HistoryRecords,
} from "./historyRecords";
import { projectRecord } from "./record";
import type { ApprovalBlockData } from "./reducer";
import { isTerminal } from "./turnStates";

/** How long a tab that heard `turn_started` waits for the owner's turn lock to show up. */
export const LOCK_PROBE_MS = 1_500;
const LOCK_PROBE_STEPS = 3;

/** Follows turns other tabs and devices run, and applies other tabs' history changes here. */
export function createHistoryCrossTab(ctx: HistoryCtx, records: HistoryRecords) {
  const { deps } = ctx;
  const turnLocks = new Map<Sid, () => void>();
  const following = new Set<Sid>();
  // Cards a reload lost that this tab holds again, by chat, until the turn they belong to ends.
  const restored = new Map<Sid, { turnId: string; card: ApprovalBlockData }>();
  const cardLocks = new Set<() => void>();
  const elsewhere: Elsewhere = createElsewhere({
    now: deps.now,
    hidden: deps.hidden,
    onVisibility: deps.onVisibility,
    locks: deps.locks,
    poll: async (sid) => {
      const org = deps.org();
      if (!org) return { running: false, approval: false, turnId: null };
      let detail;
      try {
        detail = await deps.queryClient.fetchQuery({
          ...assistantChatQuery(org, sid),
          staleTime: 0,
        });
      } catch (err) {
        if (toAssistantError(err, { phase: "read" }).httpStatus === 404) return "gone";
        throw err;
      }
      const session = ctx.session(sid);
      if (session && !session.turnMeta.ownedByThisTab) {
        const messages = projectRecord(detail.turns ?? [], "owner", {
          ...ownerOptions(ctx),
          ...(detail.approvals && { approvals: detail.approvals }),
        });
        const kept = restored.get(sid);
        if (kept) placeCard(messages, kept.turnId, kept.card);
        session.messages = messages;
      }
      settleRestored(sid, detail);
      return {
        running: !!detail.active_turn,
        approval: detail.pending_approval === true,
        turnId: detail.active_turn_id ?? null,
      };
    },
    ended: (sid) => void endElsewhere(sid),
    gone: (sid) => void goneElsewhere(sid, ctx),
  });

  const ownsRunning = (sid: Sid) => {
    const session = ctx.session(sid);
    return (
      !!session?.turnMeta.ownedByThisTab &&
      session.turn.state !== "idle" &&
      !isTerminal(session.turn)
    );
  };

  const mark = (sid: Sid, active: ElsewhereMark) => {
    const session = ctx.session(sid);
    if (!session || ownsRunning(sid)) return;
    session.turn = { state: "responding.thinking" };
    session.turnMeta.ownedByThisTab = false;
    session.turnMeta.turnId = active.turnId;
    session.turnMeta.startedAt ??= deps.now();
    const view = { turnId: active.turnId, approval: active.approval };
    elsewhere.start(sid, view, { polls: ctx.serverMode() });
    if (!ctx.serverMode()) void waitForLocalOwner(sid, true);
    if (active.card && active.turnId) void holdRestored(sid, active.turnId, active.card);
  };

  // The tab that still streams the turn, or another tab that already holds the card again, keeps it; this one only follows.
  const holdRestored = async (sid: Sid, turnId: string, card: ApprovalBlockData) => {
    const locks = deps.locks;
    if (!locks) return void restore(sid, turnId, card);
    const snapshot = await locks.query().catch(() => null);
    if (snapshot?.held?.some((lock) => lock.name === `o2-assistant-turn:${sid}`)) return;
    await locks
      .request(`o2-assistant-card:${sid}`, { ifAvailable: true }, async (lock) => {
        if (lock && restore(sid, turnId, card)) await cardGone(sid, card.id);
      })
      .catch(() => undefined);
  };

  const restore = (sid: Sid, turnId: string, card: ApprovalBlockData): boolean => {
    const session = ctx.session(sid);
    if (!session || session.turnMeta.ownedByThisTab || session.turnMeta.turnId !== turnId)
      return false;
    if (!deps.approvals?.()?.restore(sid, card)) return false;
    restored.set(sid, { turnId, card });
    return true;
  };

  // Resolves once the card is no longer pending here, or the history is disposed.
  const cardGone = (sid: Sid, id: string) =>
    new Promise<void>((resolve) => {
      if (ctx.session(sid)?.pendingApproval?.id !== id) return resolve();
      const done = () => {
        stop();
        cardLocks.delete(done);
        resolve();
      };
      const stop = watch(
        () => ctx.session(sid)?.pendingApproval?.id,
        (current) => current !== id && done(),
      );
      cardLocks.add(done);
    });

  // The server ended a restored card without this tab (another device, its own expiry), so it leaves its record.
  const settleRestored = (
    sid: Sid,
    detail: Pick<ChatDetail, "active_turn" | "pending_approval" | "approvals" | "turns">,
  ) => {
    const kept = restored.get(sid);
    if (!kept) return;
    const ending = cardEnding(detail, kept.turnId, kept.card.id);
    if (ending) deps.approvals?.()?.release(sid, kept.card.id, ending);
  };

  // A browser-only chat has no server truth: the owner's turn lock is the live owner, and its release is the end.
  const waitForLocalOwner = async (sid: Sid, heard: boolean) => {
    const locks = deps.locks;
    if (!locks?.query || ownsRunning(sid)) return;
    const name = `o2-assistant-turn:${sid}`;
    if (!(await lockHeld(locks, name, heard ? LOCK_PROBE_STEPS : 1))) {
      if (heard && !following.has(sid) && elsewhere.views[sid]) void endElsewhere(sid);
      return;
    }
    if (following.has(sid)) return;
    following.add(sid);
    try {
      if (!elsewhere.views[sid]) mark(sid, { turnId: null, approval: false });
      await locks.request(name, { mode: "shared" }, () => undefined).catch(() => undefined);
      void endElsewhere(sid);
    } finally {
      following.delete(sid);
    }
  };
  records.hooks.mark = mark;
  records.hooks.followLocal = (sid) => void waitForLocalOwner(sid, false);

  // The turn ended in the other tab or device: hand Send back and read what it stored.
  const endElsewhere = async (sid: Sid) => {
    elsewhere.stop(sid);
    const session = ctx.session(sid);
    if (!session || session.turnMeta.ownedByThisTab) return void restored.delete(sid);
    session.turnMeta.ownedByThisTab = true;
    session.turn = { state: "done", saved: ctx.serverMode() ? "server" : "local" };
    await (ctx.serverMode() ? records.openServer(sid) : records.openLocal(sid)).catch(
      () => undefined,
    );
    const org = deps.org();
    const detail = org
      ? deps.queryClient.getQueryData<ChatDetail>(assistantChatQuery(org, sid).queryKey)
      : undefined;
    settleRestored(sid, detail ?? {});
    // The finished record may drop a card only this browser saw; it stays where it was, with its outcome.
    const kept = restored.get(sid);
    const shown = ctx.session(sid)?.messages;
    if (
      kept &&
      shown &&
      !shown.some((m) => m.contentBlocks?.some((b) => b.approval?.id === kept.card.id))
    )
      placeCard(shown, kept.turnId, kept.card);
    restored.delete(sid);
  };

  // Another tab deleted the chat: this tab drops it too, so nothing writes the row back.
  const deletedThere = (sid: Sid | null) => {
    const store = deps.store();
    const key = ctx.key();
    const sids = sid
      ? [sid]
      : Object.values(store.state.sessions)
          .filter((session) => session.userOrgKey === key)
          .map((session) => session.sid);
    const active = store.state.shell.activeSid;
    for (const gone of sids) {
      ctx.deleted.add(gone);
      ctx.notSavedSids.delete(gone);
      elsewhere.stop(gone);
      const session = ctx.session(gone);
      if (!session) continue;
      if (gone === active && session.messages.length)
        ctx.deletedNotice.value = { sid: gone, via: "tab" };
      if (ownsRunning(gone)) void store.stop(gone).catch(() => undefined);
      store.dropSession(gone, "deleted_elsewhere");
    }
  };

  // Another tab's rename or pin wins here once its row is read back.
  const changedThere = async (sid: Sid, op: "rename" | "pin") => {
    if (op === "pin") delete ctx.pins[sid];
    else delete ctx.titles[sid];
    await ctx.reloadLocal();
    const session = ctx.session(sid);
    const row = ctx.localBySid.value.get(sid);
    if (!session || !row) return;
    if (op === "pin") session.record.pinned = row.pinned ?? false;
    else if (row.titleSource === "renamed" && row.title) {
      session.title = raw(row.title);
      session.titleSource = "renamed";
    }
  };

  const offs = [
    deps.hints.on("turn_started", (hint) => {
      const session = ctx.session(hint.sid);
      if (session && (session.turn.state === "idle" || isTerminal(session.turn)))
        mark(hint.sid, { turnId: hint.turnId, approval: false });
      else if (session && elsewhere.views[hint.sid])
        elsewhere.start(hint.sid, { approval: false, turnId: hint.turnId });
    }),
    deps.hints.on("turn_ended", (hint) => void endElsewhere(hint.sid)),
    deps.hints.on("approval_pending", (hint) => {
      if (elsewhere.views[hint.sid]) elsewhere.start(hint.sid, { approval: true, turnId: null });
    }),
    deps.hints.on("history_changed", (hint) => {
      if (hint.op === "delete" || hint.op === "clear")
        deletedThere(hint.op === "clear" ? null : hint.sid);
      if (hint.op === "rename" || hint.op === "pin") void changedThere(hint.sid, hint.op);
      else void ctx.reloadLocal();
      ctx.invalidateList();
    }),
  ];

  // The running tab holds `o2-assistant-turn:{sid}` so a second tab sees the live owner.
  const stopLocks = watch(
    () =>
      Object.values(deps.store().state.sessions)
        .filter((s) => s.turnMeta.ownedByThisTab && s.turn.state !== "idle" && !isTerminal(s.turn))
        .map((s) => s.sid),
    (running) => {
      for (const [sid, release] of turnLocks)
        if (!running.includes(sid)) {
          release();
          turnLocks.delete(sid);
        }
      for (const sid of running) if (!turnLocks.has(sid)) holdTurnLock(sid, deps, turnLocks);
    },
  );

  return {
    elsewhere: (sid: Sid | null) => (sid ? (elsewhere.views[sid] ?? null) : null),
    refreshElsewhere: (sid: Sid) => elsewhere.refresh(sid),
    dispose() {
      stopLocks();
      for (const off of offs) off();
      for (const release of turnLocks.values()) release();
      for (const release of [...cardLocks]) release();
      elsewhere.dispose();
    },
  };
}

function holdTurnLock(sid: Sid, deps: HistoryDeps, held: Map<Sid, () => void>): void {
  if (!deps.locks) return;
  let release: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (release = resolve));
  held.set(sid, release);
  void deps.locks
    .request(`o2-assistant-turn:${sid}`, { mode: "exclusive", ifAvailable: true }, () => done)
    .catch(() => undefined);
}

// The hint can beat the owner's lock request, so a heard turn looks a few times before it lets go.
async function lockHeld(
  locks: Pick<LockManager, "query">,
  name: string,
  steps: number,
): Promise<boolean> {
  for (let step = 0; step < steps; step += 1) {
    if (step > 0) await new Promise((resolve) => setTimeout(resolve, LOCK_PROBE_MS / steps));
    const snapshot = await locks.query().catch(() => null);
    if (snapshot?.held?.some((lock) => lock.name === name)) return true;
  }
  return false;
}
