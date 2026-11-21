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

import { computed, watch } from "vue";

import {
  approvalOutcomeOf,
  isRunning,
  useAssistantStore,
  type ActionLedgerEntry,
  type ApprovalBlockData,
  type ApprovalOutcome,
  type AssistantSession,
  type AssistantState,
} from "@/composables/assistant";

const APPLIED: ReadonlySet<ApprovalOutcome["state"]> = new Set([
  "approved",
  "done",
  "partial",
  "unconfirmed",
  "approved_elsewhere",
]);

const DASHBOARD_ARG_KEYS = ["dashboard_id", "dashboardId", "dashboard"];

/** One key per approved assistant write (or undo) on this dashboard whose turn has ended; a new key means the saved dashboard changed. */
export function settledDashboardWrites(
  state: Pick<AssistantState, "sessions">,
  dashboardId: string,
): string[] {
  if (!dashboardId) return [];
  return Object.values(state.sessions).flatMap((session) =>
    // An approved tool runs in the resumed turn, so the write has landed only once that turn ends.
    isRunning(session.turn) ? [] : sessionWrites(session, dashboardId).map((write) => write.key),
  );
}

/** Calls `reload` when an approved assistant write to the open dashboard lands. */
export function useAssistantDashboardWrites(
  dashboardId: () => string,
  reload: () => void | Promise<void>,
): void {
  const store = useAssistantStore();
  const writes = computed(() => settledDashboardWrites(store.state, dashboardId()));
  // Kept, not replaced: a chat's writes drop out while it runs a later turn and must not count as new on its return.
  let seen = new Set<string>();
  let known = new Set<string>();
  let seenFor = dashboardId();
  // A chat that arrives later (history, another tab) brings writes that landed before this page opened.
  const meet = () => {
    for (const session of Object.values(store.state.sessions)) {
      if (known.has(session.sid) || !session.messages.length) continue;
      known.add(session.sid);
      const running = isRunning(session.turn);
      for (const write of sessionWrites(session, seenFor))
        if (!running || !write.inFlight) seen.add(write.key);
    }
  };
  meet();
  watch([writes, () => Object.keys(store.state.sessions).length], ([keys]) => {
    if (seenFor !== dashboardId()) {
      seen = new Set(keys);
      known = new Set();
      seenFor = dashboardId();
      meet();
      return;
    }
    meet();
    const fresh = keys.filter((key) => !seen.has(key));
    for (const key of fresh) seen.add(key);
    if (fresh.length) void reload();
  });
}

interface DashboardWrite {
  key: string;
  /** From the turn the chat is on now, so it may still be landing. */
  inFlight: boolean;
}

function sessionWrites(session: AssistantSession, dashboardId: string): DashboardWrite[] {
  const messages = session.messages;
  let turnStart = messages.length;
  while (turnStart > 0 && messages[turnStart - 1].role !== "user") turnStart--;
  const cards = messages.flatMap((message, index) =>
    (message.contentBlocks ?? []).flatMap((block) =>
      block.approval ? [{ card: block.approval, inFlight: index >= turnStart }] : [],
    ),
  );
  const applied = cards.filter(({ card }) => {
    const { outcome } = approvalOutcomeOf(session, card.id);
    if (!outcome || !APPLIED.has(outcome.state)) return false;
    return !outcome.decision || outcome.decision.approved;
  });
  const approvals = applied
    .filter(({ card }) => namesDashboard(card, dashboardId))
    .map(({ card, inFlight }) => ({ key: `${session.sid}:approval:${card.id}`, inFlight }));
  const byId = new Map(cards.map(({ card }) => [card.id, card]));
  const undos = (session.ledger ?? [])
    .filter((entry) => entry.status === "undone" && undoNamesDashboard(entry, byId, dashboardId))
    .map((entry) => ({ key: `${session.sid}:undo:${entry.id}`, inFlight: false }));
  const unique = new Map([...approvals, ...undos].map((write) => [write.key, write]));
  return [...unique.values()];
}

// A panel's undo names the panel; its dashboard is in the link or the approval that made it.
function undoNamesDashboard(
  entry: ActionLedgerEntry,
  cards: Map<string, ApprovalBlockData>,
  dashboardId: string,
): boolean {
  if (targetNamesDashboard(entry.resource, dashboardId)) return true;
  const card = entry.approvalId ? cards.get(entry.approvalId) : undefined;
  return !!card && namesDashboard(card, dashboardId);
}

function namesDashboard(
  card: Pick<ApprovalBlockData, "targets" | "args">,
  dashboardId: string,
): boolean {
  const targeted = (card.targets ?? []).some((target) => targetNamesDashboard(target, dashboardId));
  const args = card.args ?? {};
  return targeted || DASHBOARD_ARG_KEYS.some((key) => argDashboardId(args[key]) === dashboardId);
}

// A `dashboard` arg may be the dashboard object itself rather than its id.
function argDashboardId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = record.dashboardId ?? record.dashboard_id ?? record.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function targetNamesDashboard(
  target: { id?: string; name?: string; link?: string },
  dashboardId: string,
): boolean {
  return (
    target.id === dashboardId ||
    target.name === dashboardId ||
    linkDashboard(target.link) === dashboardId
  );
}

function linkDashboard(link: string | undefined): string | null {
  if (!link) return null;
  try {
    return new URL(link, "http://local").searchParams.get("dashboard");
  } catch {
    return null;
  }
}
