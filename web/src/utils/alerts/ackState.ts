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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { ActiveDowntime, AlertGroupRef } from "@/services/downtimes";
import type { AlertGroup } from "@/ts/interfaces/alert";
import { normalizeKey } from "@/lib/core/Badge/badgeGroups";
import { isFiringOutcome } from "./runOutcome";

/** The ack fields a history row carries; absent on every run an ack did not touch. */
export interface AckHistoryFields {
  status?: unknown;
  acked_by?: string | null;
  ack_action?: string | null;
  ack_source?: string | null;
  taken_over_from?: string | null;
}

export const ackShortName = (email: string): string => email.split("@")[0] || email;

/** The words for where an ack came from; product names are not translated. */
export function ackSourceLabel(source: string | null | undefined, t: TranslateFn): I18nText {
  switch (source) {
    case "ui":
      return raw("OpenObserve");
    case "api":
      return raw("API");
    case "slack":
      return raw("Slack");
    case "oncall":
      return t("alerts.ack.sources.oncall");
    case "incident":
      return t("alerts.ack.sources.incident");
    default:
      return raw(source ?? "");
  }
}

export const isAckEventRow = (row: AckHistoryFields): boolean =>
  normalizeKey(row.status) === "ackevent";

/** The status a history row shows: an ack-suppressed run reads Acknowledged, not Suppressed. */
export function historyStatusOf(row: AckHistoryFields): unknown {
  if (isAckEventRow(row)) return "ack_event";
  return row.acked_by ? "acknowledged" : row.status;
}

/** Whose ack kept this run quiet, or null for a run no ack touched. */
export const ackSuppressedBy = (row: AckHistoryFields): string | null =>
  !isAckEventRow(row) && row.acked_by ? ackShortName(row.acked_by) : null;

export function ackEventText(row: AckHistoryFields, t: TranslateFn): I18nText {
  const who = raw(row.acked_by ?? "");
  const source = ackSourceLabel(row.ack_source, t);
  const action = normalizeKey(row.ack_action);
  if (action === "unack") return t("alerts.ack.history.unacked", { who, source });
  if (action === "takeover") {
    const previous = raw(row.taken_over_from ?? "");
    return t("alerts.ack.history.takenOver", { who, previous, source });
  }
  return t("alerts.ack.history.acked", { who, source });
}

/** The mute covering this group: a whole-alert mute covers every group, a group mute only its own. */
export function downtimeForGroup(
  downtime: ActiveDowntime | null | undefined,
  groupKey: string,
): ActiveDowntime | null {
  if (!downtime) return null;
  const groups = downtime.alert_groups;
  if (!groups?.length) return downtime;
  return groups.some((g) => g.group_key === groupKey) ? downtime : null;
}

export const unackedFiringCount = (groups: AlertGroup[]): number =>
  groups.filter((g) => isFiringOutcome(g.last_outcome) && !g.ack).length;

export const ackedCount = (groups: AlertGroup[]): number => groups.filter((g) => !!g.ack).length;

type LabelPair = { name: string; value: unknown };

/** A group ref's labels as `k=v` text; older nodes send none, so null means "say nothing". */
export function groupRefLabels(ref: AlertGroupRef): string | null {
  const labels = (ref as AlertGroupRef & { group_labels?: unknown }).group_labels;
  if (typeof labels === "string") return labels || null;
  if (Array.isArray(labels)) {
    const pairs = (labels as LabelPair[]).filter((p) => p && typeof p.name === "string");
    return pairs.length ? pairs.map((p) => `${p.name}=${String(p.value)}`).join(", ") : null;
  }
  if (labels && typeof labels === "object") {
    const entries = Object.entries(labels as Record<string, unknown>);
    return entries.length ? entries.map(([k, v]) => `${k}=${String(v)}`).join(", ") : null;
  }
  return null;
}
