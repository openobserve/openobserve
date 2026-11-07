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

import type { AssistantState, Sid } from "./assistantStore.types";
import type { BackgroundExtend } from "./useAssistantApprovals";

/** More than one wake-up of a hidden tab under the browser's timer throttling (PO B57). */
export const BACKGROUND_EXTEND_AT_MS = 90_000;

/** A tab that could not act when due looks again this soon. */
export const KEEP_ALIVE_RETRY_MS = 15_000;

export interface ApprovalKeepAliveDeps {
  state(): AssistantState;
  /** The chats a visible container of this tab shows, while the page itself is visible. */
  shownHere(): Sid[];
  /** The server splits the budgets; without it nothing is ever posted out of view (PO A14). */
  budgets(): boolean;
  locks: Pick<LockManager, "request" | "query"> | null;
  extend(sid: Sid, approvalId: string): Promise<BackgroundExtend>;
  reconcile(sid: Sid): Promise<void>;
  now(): number;
  /** Fires on `visibilitychange` to visible, `pageshow` and `online`. */
  onReturn(cb: () => void): () => void;
}

export interface ApprovalKeepAlive {
  dispose(): void;
}

interface Card {
  sid: Sid;
  id: string;
  timer?: ReturnType<typeof setTimeout>;
  owner: boolean;
  requesting: boolean;
  spent: boolean;
  extending: boolean;
  release?: () => void;
}

/** Keeps a pending card alive while no tab of this browser shows its chat: one owner, ≤ 90 s left, background budget only. */
export function createApprovalKeepAlive(deps: ApprovalKeepAliveDeps): ApprovalKeepAlive {
  const cards = new Map<string, Card>();
  const shownLocks = new Map<Sid, () => void>();
  const keyOf = (sid: Sid, id: string) => `${sid}\u0001${id}`;
  const pendingOf = (card: Card) => {
    const pending = deps.state().sessions[card.sid]?.pendingApproval;
    return pending?.id === card.id ? pending : null;
  };

  const shownElsewhere = async (sid: Sid) => {
    const snapshot = await deps.locks?.query().catch(() => null);
    return !!snapshot?.held?.some((lock) => lock.name === `o2-assistant-shown:${sid}`);
  };

  const holdShown = (sid: Sid) => {
    if (!deps.locks || shownLocks.has(sid)) return;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    shownLocks.set(sid, release);
    void deps.locks
      .request(`o2-assistant-shown:${sid}`, { mode: "shared" }, () => held)
      .catch(() => undefined);
  };

  const takeOwnership = (card: Card) => {
    // Without the Locks API only the tab that got the card on its own stream extends it.
    if (!deps.locks) card.owner = pendingOf(card)?.askedIn === "here";
    if (card.owner || card.requesting || !deps.locks) return;
    card.requesting = true;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    void deps.locks
      .request(`o2-assistant-extend:${card.id}`, { ifAvailable: true }, (lock) => {
        card.requesting = false;
        if (!lock || !cards.has(keyOf(card.sid, card.id))) return undefined;
        card.owner = true;
        card.release = release;
        void deps.reconcile(card.sid);
        return held;
      })
      .catch(() => {
        card.requesting = false;
      });
  };

  const schedule = (card: Card, delay?: number) => {
    clearTimeout(card.timer);
    const pending = pendingOf(card);
    if (!pending || typeof pending.expiresAt !== "number" || card.spent) return;
    const due = pending.expiresAt - BACKGROUND_EXTEND_AT_MS - deps.now();
    card.timer = setTimeout(() => void tick(card), delay ?? Math.max(0, due));
  };

  const tick = async (card: Card) => {
    const pending = pendingOf(card);
    if (!pending || card.spent || card.extending) return;
    takeOwnership(card);
    if (!deps.budgets() || !card.owner) return schedule(card, KEEP_ALIVE_RETRY_MS);
    const shown = deps.shownHere().includes(card.sid) || (await shownElsewhere(card.sid));
    if (shown) return schedule(card, KEEP_ALIVE_RETRY_MS);
    const left = (pending.expiresAt ?? 0) - deps.now();
    if (left > BACKGROUND_EXTEND_AT_MS) return schedule(card);
    card.extending = true;
    const result = await deps.extend(card.sid, card.id);
    card.extending = false;
    if (result === "spent") card.spent = true;
    if (result === "failed") schedule(card, KEEP_ALIVE_RETRY_MS);
    else schedule(card);
  };

  const forget = (key: string, card: Card) => {
    clearTimeout(card.timer);
    card.release?.();
    cards.delete(key);
  };

  const syncCards = () => {
    const seen = new Set<string>();
    for (const session of Object.values(deps.state().sessions)) {
      const pending = session.pendingApproval;
      if (!pending) continue;
      const key = keyOf(session.sid, pending.id);
      seen.add(key);
      const known = cards.get(key);
      if (known) {
        schedule(known);
        continue;
      }
      const card: Card = {
        sid: session.sid,
        id: pending.id,
        owner: false,
        requesting: false,
        spent: false,
        extending: false,
      };
      cards.set(key, card);
      takeOwnership(card);
      schedule(card);
    }
    for (const [key, card] of cards) if (!seen.has(key)) forget(key, card);
  };

  const syncShown = (shown: Sid[], before: Sid[] = []) => {
    for (const sid of shown) holdShown(sid);
    for (const [sid, release] of shownLocks) {
      if (shown.includes(sid)) continue;
      release();
      shownLocks.delete(sid);
    }
    // A card a container starts showing is re-read before its countdown is trusted.
    for (const sid of shown) if (!before.includes(sid)) void deps.reconcile(sid);
  };

  const stopCards = watch(
    () =>
      Object.values(deps.state().sessions)
        .map((s) =>
          s.pendingApproval
            ? `${s.sid}:${s.pendingApproval.id}:${s.pendingApproval.expiresAt}`
            : "",
        )
        .join(),
    syncCards,
    { immediate: true },
  );
  const stopShown = watch(() => deps.shownHere(), syncShown, { immediate: true });
  const offReturn = deps.onReturn(() => {
    for (const card of cards.values()) void deps.reconcile(card.sid);
  });

  return {
    dispose() {
      stopCards();
      stopShown();
      offReturn();
      for (const [key, card] of cards) forget(key, card);
      for (const release of shownLocks.values()) release();
      shownLocks.clear();
    },
  };
}
