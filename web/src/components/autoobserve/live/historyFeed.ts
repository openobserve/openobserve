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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import type { DecisionAction, DecisionView } from "@/services/autoobserveDecisions";
import type { Incident } from "@/services/incidents";
import { formatWhen } from "./liveCopy";
import { statusLabel } from "./incidentsCopy";

export type LiveHistoryKind = "incident" | "decision" | "change";

export interface LiveHistoryRow {
  id: string;
  /** Milliseconds. */
  at: number;
  kind: LiveHistoryKind;
  when: I18nText;
  text: I18nText;
  status: { value: Incident["status"]; label: I18nText } | null;
  undone: boolean;
  incidentId: string | null;
}

/** Each source reads one page this size; the feed keeps the newest of both. */
export const HISTORY_PAGE = 50;

const ACTION_KEY: Record<DecisionAction, I18nKey> = {
  dismiss: "autoobserveLive.history.dismissed",
  accept: "autoobserveLive.history.accepted",
  apply: "autoobserveLive.history.changed",
};

const incidentRow = (
  t: TranslateFn,
  zone: { locale: string; timeZone: string },
  item: AutoObserveIncidentItem,
  now: number,
): LiveHistoryRow => {
  const at = item.incident.created_at / 1000;
  return {
    id: `incident:${item.incident.id}`,
    at,
    kind: "incident",
    when: formatWhen(at, zone.locale, zone.timeZone, now),
    text: t("autoobserveLive.history.incident", { title: raw(item.incident.title) }),
    status: { value: item.incident.status, label: statusLabel(t, item.incident.status) },
    undone: false,
    incidentId: item.incident.id,
  };
};

const decisionRow = (
  t: TranslateFn,
  zone: { locale: string; timeZone: string },
  view: DecisionView,
  now: number,
): LiveHistoryRow => {
  const at = view.decided_at / 1000;
  const title = view.change?.alert.title ?? view.subject?.title;
  return {
    id: `decision:${view.decision_id}`,
    at,
    kind: view.action === "apply" ? "change" : "decision",
    when: formatWhen(at, zone.locale, zone.timeZone, now),
    text: t(ACTION_KEY[view.action], {
      actor: raw(view.actor),
      title: title ? raw(title) : t("autoobserveLive.history.untitled"),
    }),
    status: null,
    undone: view.state === "undone",
    incidentId: null,
  };
};

export const toHistoryRows = (
  t: TranslateFn,
  zone: { locale: string; timeZone: string },
  incidents: readonly AutoObserveIncidentItem[],
  decisions: readonly DecisionView[],
  now = Date.now(),
): LiveHistoryRow[] =>
  [
    ...incidents.map((item) => incidentRow(t, zone, item, now)),
    ...decisions.map((view) => decisionRow(t, zone, view, now)),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_PAGE);
