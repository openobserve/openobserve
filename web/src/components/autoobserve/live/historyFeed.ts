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
import { dayKey, formatWhen } from "./liveCopy";
import { statusLabel } from "./incidentsCopy";
import { dayLabel } from "../v2/changes";

export type LiveHistoryKind = "incident" | "decision" | "change";

type Zone = { locale: string; timeZone: string };

/** One narrative entry: what AutoObserve did, or what a person decided about it. */
export interface LiveHistoryRow {
  id: string;
  /** Milliseconds. */
  at: number;
  kind: LiveHistoryKind;
  day: string;
  time: I18nText;
  text: I18nText;
  /** A person acted, not AutoObserve. */
  byPerson: boolean;
  status: { value: Incident["status"]; label: I18nText } | null;
  reason: I18nText | null;
  /** Who undid it and when, in the words the Activity page uses. */
  undone: I18nText | null;
  incidentId: string | null;
  /** The decision id the Activity page highlights. */
  changeId: string | null;
}

export interface LiveHistoryDay {
  key: string;
  label: I18nText;
  rows: LiveHistoryRow[];
}

/** Each source reads one page this size; the feed keeps the newest of both. */
export const HISTORY_PAGE = 50;

const ACTION_KEY: Record<DecisionAction, I18nKey> = {
  dismiss: "autoobserve.activityLive.history.dismissed",
  accept: "autoobserve.activityLive.history.accepted",
  apply: "autoobserve.activityLive.history.applied",
};

const KNOWN_REASONS = new Set([
  "not_needed",
  "planned_work",
  "false_positive",
  "will_fix_later",
  "other",
]);

const timeOf = (zone: Zone, at: number) =>
  raw(
    new Intl.DateTimeFormat(zone.locale, { timeStyle: "short", timeZone: zone.timeZone }).format(
      new Date(at),
    ),
  );

const incidentRow = (t: TranslateFn, zone: Zone, item: AutoObserveIncidentItem): LiveHistoryRow => {
  const at = item.incident.created_at / 1000;
  const title = raw(item.incident.title);
  const page = item.page;
  let text: I18nText;
  if (page?.outcome !== "paged") text = t("autoobserve.activityLive.history.opened", { title });
  else if (page.team_name)
    text = t("autoobserve.activityLive.history.paged", { title, team: raw(page.team_name) });
  else text = t("autoobserve.activityLive.history.pagedOnCall", { title });
  return {
    id: `incident:${item.incident.id}`,
    at,
    kind: "incident",
    day: dayKey(at, zone.timeZone),
    time: timeOf(zone, at),
    text,
    byPerson: false,
    status: { value: item.incident.status, label: statusLabel(t, item.incident.status) },
    reason: null,
    undone: null,
    incidentId: item.incident.id,
    changeId: null,
  };
};

const decisionRow = (
  t: TranslateFn,
  zone: Zone,
  view: DecisionView,
  me: string | undefined,
  now: number,
): LiveHistoryRow => {
  const who = (actor: string, start: boolean) =>
    actor === me
      ? t(start ? "autoobserve.activityLive.history.you" : "insight.decisions.applied.you")
      : raw(actor);
  const name = view.change?.alert.title ?? view.subject?.title;
  const title = name ? raw(name) : t("autoobserveLive.history.untitled");
  const undone = view.state === "undone";
  // Without undone_at the server moved decided_at and actor to the undo, so the entry is the undo.
  const undoOnly = undone && view.undone_at == null;
  const at = view.decided_at / 1000;
  const text = undoOnly
    ? t("autoobserve.activityLive.history.undid", { actor: who(view.actor, true), title })
    : t(ACTION_KEY[view.action], { actor: who(view.actor, true), title });
  const reason =
    view.action === "dismiss" && view.reason && KNOWN_REASONS.has(view.reason)
      ? t("autoobserve.activityLive.history.reason", {
          reason: t(`insight.decisions.reasons.${view.reason}` as I18nKey),
        })
      : null;
  return {
    id: `decision:${view.decision_id}`,
    at,
    kind: view.action === "apply" ? "change" : "decision",
    day: dayKey(at, zone.timeZone),
    time: timeOf(zone, at),
    text,
    byPerson: true,
    status: null,
    reason,
    undone:
      undone && !undoOnly
        ? t("autoobserve.activityLive.undoneBy", {
            actor: who(view.undone_by ?? view.actor, false),
            when: formatWhen((view.undone_at ?? 0) / 1000, zone.locale, zone.timeZone, now),
          })
        : null,
    incidentId: null,
    changeId: view.action === "apply" ? view.decision_id : null,
  };
};

export const toHistoryRows = (
  t: TranslateFn,
  zone: Zone,
  incidents: readonly AutoObserveIncidentItem[],
  decisions: readonly DecisionView[],
  me: string | undefined,
  now = Date.now(),
): LiveHistoryRow[] =>
  [
    ...incidents.map((item) => incidentRow(t, zone, item)),
    ...decisions.map((view) => decisionRow(t, zone, view, me, now)),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_PAGE);

/** Rows grouped by the reader's calendar day, newest day first, each day named as Activity names it. */
export const historyDays = (
  t: TranslateFn,
  zone: Zone,
  rows: readonly LiveHistoryRow[],
  now: number,
): LiveHistoryDay[] => {
  const days: LiveHistoryDay[] = [];
  for (const row of rows) {
    const last = days[days.length - 1];
    if (last?.key === row.day) last.rows.push(row);
    else days.push({ key: row.day, label: dayLabel(t, zone, row.at, now), rows: [row] });
  }
  return days;
};
