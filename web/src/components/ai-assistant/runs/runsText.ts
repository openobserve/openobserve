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

import type { RunRow, RunsCounts } from "@/composables/assistant";
import { approvalClock, elapsedText, runAgentKey } from "@/composables/assistant";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

import type { AssistantSignal } from "../common/AssistantStatusDot.types";

/** The signal a row, or a button speaking for several, shows. */
export function runSignal(counts: RunsCounts): AssistantSignal {
  if (counts.needs) return "attention";
  if (counts.failed) return "failed";
  if (counts.ready) return "unread";
  return "working";
}

/** The one mark of a row; a stopped chat has no failure to show. */
export function rowSignal(row: RunRow): AssistantSignal {
  if (row.group === "needs_you") return "attention";
  if (row.group === "failed") return "failed";
  return row.group === "ready" ? "unread" : "working";
}

/** Non-zero parts in the order given, joined the way the list reads them. */
export function runsSummary(
  counts: RunsCounts,
  order: (keyof RunsCounts)[],
  t: TranslateFn,
): I18nText {
  const parts = order
    .filter((part) => counts[part] > 0)
    .map((part) => t(`assistant.runs.summary.${part}`, { count: counts[part] }, counts[part]));
  return raw(parts.join(" · "));
}

export function runTitle(row: RunRow, t: TranslateFn): I18nText {
  if (row.title) return row.title;
  return row.otherOrg
    ? t("assistant.runs.chatInOrg", { org: raw(row.org) })
    : t("assistant.thread.newChatTitle");
}

export function runAgent(row: RunRow, product: string, t: TranslateFn): I18nText {
  return t(`assistant.runs.agent.${runAgentKey(row.agent)}`, { product });
}

/** The run-status words of a row, with the elapsed time, countdown or finish time that belongs to them. */
export function runStatus(row: RunRow, now: number, t: TranslateFn): I18nText {
  const word = (status: I18nText, elapsed: string) =>
    t("assistant.turn.withElapsed", { status, elapsed: raw(elapsed) });
  switch (row.status) {
    case "working":
      return row.startedAt === null
        ? t("assistant.runs.state.answering")
        : t("assistant.runs.state.working", { elapsed: elapsedText(now - row.startedAt, t) });
    case "needsApproval": {
      const status = t("assistant.runs.state.needsApproval");
      return row.expiresAt === null ? status : word(status, approvalClock(row.expiresAt - now));
    }
    case "reconnecting":
    case "elsewhere":
      return t(`assistant.runs.state.${row.status}`);
    default:
      return word(t(`assistant.runs.state.${row.status}`), formatOrgTime(row.at));
  }
}
