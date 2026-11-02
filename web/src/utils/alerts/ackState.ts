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
import type {
  AckAlertResponse,
  AlertActionPerson,
  AlertActionRefusal,
  AlertGroup,
} from "@/ts/interfaces/alert";
import type { ToastOptions } from "@/lib/feedback/Toast/OToast.types";
import { alertActionErrorOf } from "@/services/alerts";
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

/** The verb a refusal answers, which names its title. */
export type AckVerb = "ack" | "unack" | "takeOver" | "mute";

const REFUSAL_TITLES = {
  ack: "alerts.ack.refused.ack",
  unack: "alerts.ack.refused.unack",
  takeOver: "alerts.ack.refused.takeOver",
  mute: "alerts.ack.refused.mute",
} as const;

const personName = (p: AlertActionPerson) => p.name || p.email;

/** The refusal toast: the verb refused, then who is on call and who else can act. */
export function refusalToast(
  refusal: AlertActionRefusal,
  verb: AckVerb,
  t: TranslateFn,
): ToastOptions {
  const reason = t(REFUSAL_TITLES[verb]);
  const onCall = raw(refusal.on_call.map(personName).join(", "));
  const canAct = raw(refusal.can_act.map(personName).join(", "));
  const people: I18nText | null =
    onCall && canAct
      ? t("alerts.ack.refused.people", { onCall, canAct })
      : onCall
        ? t("alerts.ack.refused.onCall", { people: onCall })
        : canAct
          ? t("alerts.ack.refused.canAct", { people: canAct })
          : null;
  return people
    ? { variant: "error", title: reason, message: people }
    : { variant: "error", message: reason };
}

/** The distinct team names of some pages, or "" when there are none. */
export const teamsOf = (pages?: { team: string }[]): I18nText =>
  raw([...new Set((pages ?? []).map((p) => p.team).filter(Boolean))].join(", "));

/** A page's acknowledge words; a teamless page names no team, an incident page says incident. */
export function pageAckWords(
  team: string | null | undefined,
  subjectType: string,
  t: TranslateFn,
): { ackHint: I18nText; unackHint: I18nText; acked: I18nText; unacked: I18nText } {
  const incident = subjectType === "incident";
  if (!team) {
    return {
      ackHint: incident
        ? t("oncall.acknowledgeHintNoTeamIncident")
        : t("oncall.acknowledgeHintNoTeam"),
      unackHint: t("oncall.unacknowledgeHintNoTeam"),
      acked: t("oncall.acknowledgedNoTeam"),
      unacked: t("oncall.unacknowledgedNoTeam"),
    };
  }
  const named = { team: raw(team) };
  return {
    ackHint: incident
      ? t("oncall.acknowledgeHintIncident", named)
      : t("oncall.acknowledgeHint", named),
    unackHint: t("oncall.unacknowledgeHint", named),
    acked: t("oncall.acknowledged", named),
    unacked: t("oncall.unacknowledged", named),
  };
}

/** The toast for an acknowledge that changed nothing: who already holds it, if anyone. */
export function unchangedAckToast(
  holder: string | null | undefined,
  me: string | undefined,
  t: TranslateFn,
): ToastOptions {
  const message = !holder
    ? t("toastMessages.alerts.ack.alreadyAckedNoOne")
    : holder === me
      ? t("toastMessages.alerts.ack.alreadyYours")
      : t("toastMessages.alerts.ack.alreadyAcked", { who: raw(holder) });
  return { variant: "info", message };
}

/** The toast for an unacknowledge that changed nothing. */
export const notAckedToast = (title: string, t: TranslateFn): ToastOptions => ({
  variant: "info",
  message: t("toastMessages.alerts.ack.incidentNotAcked", { title: raw(title) }),
});

/** The toast after an incident acknowledge: who was faster, or the incident and the teams it stopped. */
export function incidentAckToast(
  ack: AckAlertResponse,
  title: string,
  me: string | undefined,
  t: TranslateFn,
): ToastOptions {
  if (!ack.changed) return unchangedAckToast(ack.acks[0]?.acked_by, me, t);
  const teams = teamsOf(ack.oncall?.stopped);
  return {
    variant: "success",
    message: teams
      ? t("toastMessages.alerts.ack.incidentAckedPaging", { title: raw(title), teams })
      : t("toastMessages.alerts.ack.incidentAcked", { title: raw(title) }),
  };
}

/** The toast after an incident status change; the one ack's routes answer with what they did. */
export function incidentStatusToast(
  status: "open" | "acknowledged" | "resolved",
  ack: AckAlertResponse | { changed: boolean } | undefined,
  title: string,
  me: string | undefined,
  t: TranslateFn,
): ToastOptions | null {
  if (!ack) return null;
  if (status === "acknowledged" && "acks" in ack) return incidentAckToast(ack, title, me, t);
  return ack.changed
    ? {
        variant: "success",
        message: t("toastMessages.alerts.ack.incidentUnacked", { title: raw(title) }),
      }
    : notAckedToast(title, t);
}

/** A refused incident acknowledge or unacknowledge says who can act; anything else is `null`. */
export function incidentRefusalToast(
  error: unknown,
  status: "open" | "acknowledged" | "resolved",
  t: TranslateFn,
): ToastOptions | null {
  const refused = alertActionErrorOf(error);
  if (refused?.code !== "ack_refused") return null;
  return refusalToast(refused, status === "acknowledged" ? "ack" : "unack", t);
}
