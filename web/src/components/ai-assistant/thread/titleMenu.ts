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

import type { HistoryRow, RunRow, Sid } from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";

import { chatStatusOf, type ChatStatus } from "../history/chatStatus";

/** The menu shows this many chats; the rest sit behind All chats. */
export const TITLE_MENU_ROWS = 3;

/** One chat row of the title menu; every row shares one left edge, and the word carries the state. */
export interface TitleMenuRow {
  sid: Sid;
  title: I18nText | null;
  status: ChatStatus | null;
  expiresAt: number | null;
  /** Another org's chat: the org is its second line, and it never opens in place. */
  org: string | null;
  /** A wire agent id; title-menu rows carry the agent in the accessible name only. */
  agent: string | null;
}

export interface TitleMenuInput {
  runs: readonly RunRow[];
  history: readonly HistoryRow[];
  drafts: readonly HistoryRow[];
  /** This tab's turn per chat, so a failed or expired chat reads as one before the list re-reads. */
  turnOf(sid: Sid): { state: string; error?: { code: string } } | undefined;
  current: Sid | null;
}

const STATUS_ORDER: Record<ChatStatus, number> = {
  needs_you: 0,
  answering: 1,
  failed: 2,
  expired: 3,
  draft: 4,
};

/** Waiting first, then answering, failed, expired, drafts and recent; the chat in view is never listed. */
export function titleMenuRows(input: TitleMenuInput): TitleMenuRow[] {
  const rows = new Map<Sid, TitleMenuRow>();
  for (const run of input.runs) {
    if (run.group !== "needs_you" && run.group !== "answering") continue;
    rows.set(run.sid, {
      sid: run.sid,
      title: run.title,
      status: run.group,
      expiresAt: run.expiresAt,
      org: run.otherOrg ? run.org : null,
      agent: run.agent,
    });
  }
  for (const draft of input.drafts) {
    if (!rows.has(draft.sid)) rows.set(draft.sid, fromHistory(draft, "draft"));
  }
  const failed = new Set(input.runs.filter((run) => run.group === "failed").map((run) => run.sid));
  for (const row of input.history) {
    if (rows.has(row.sid)) continue;
    const status = chatStatusOf(row, input.turnOf(row.sid));
    rows.set(row.sid, fromHistory(row, failed.has(row.sid) ? "failed" : status));
  }
  rows.delete(input.current ?? "");
  // A stable sort, so the rows of one status keep the list's newest-first order.
  return [...rows.values()].sort((a, b) => rank(a) - rank(b));
}

function fromHistory(row: HistoryRow, status: ChatStatus | null): TitleMenuRow {
  return {
    sid: row.sid,
    title: row.title,
    status,
    expiresAt: null,
    org: null,
    agent: row.agentType,
  };
}

function rank(row: TitleMenuRow): number {
  return row.status ? STATUS_ORDER[row.status] : Object.keys(STATUS_ORDER).length;
}
