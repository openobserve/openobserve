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

import config from "@/aws-exports";
import type { I18nText, TranslateFn } from "@/types/i18n";

/** Where an alert sends; an absent or null list and a blank on-call team count as none. */
export interface DeliveryTargets {
  destinations?: readonly string[] | null;
  workflows?: readonly string[] | null;
  oncall_team?: string | null;
}

/** Whether an alert names a destination, or (enterprise) a workflow or on-call team, to notify. */
export const hasDeliveryTarget = (alert: DeliveryTargets): boolean =>
  (alert.destinations?.length ?? 0) > 0 ||
  ((config.isEnterprise === "true" || config.isCloud === "true") &&
    ((alert.workflows?.length ?? 0) > 0 || !!alert.oncall_team?.trim()));

/** The org config fields that decide whether an incident pages anyone. */
export interface IncidentReachConfig {
  incidents_enabled?: boolean;
  oncall_enabled?: boolean;
  /** Both switches on and the org has an on-call team; absent on a server that predates it. */
  incidents_page_oncall?: boolean;
}

/** What keeps a new incident from paging on-call in this org, or null when it does. */
export type IncidentReachGap = "incidents" | "oncall" | "both" | "noTeam" | null;

export const incidentReachGap = (zo: IncidentReachConfig | null | undefined): IncidentReachGap => {
  const enterprise = config.isEnterprise === "true" || config.isCloud === "true";
  const incidents = enterprise && zo?.incidents_enabled === true;
  const oncall = enterprise && zo?.oncall_enabled === true;
  if (incidents && oncall) return zo?.incidents_page_oncall === false ? "noTeam" : null;
  if (!incidents && !oncall) return "both";
  return incidents ? "oncall" : "incidents";
};

/** Whether a firing reaches a person: a target of its own, or an incident that pages on-call. */
export const reachesSomeone = (
  alert: DeliveryTargets & { creates_incident?: boolean | null },
  zo: IncidentReachConfig | null | undefined,
): boolean =>
  hasDeliveryTarget(alert) || (!!alert.creates_incident && incidentReachGap(zo) === null);

const UNREACHABLE_KEYS = {
  incidents: "alerts.reach.incidentsOff",
  oncall: "alerts.reach.oncallOff",
  both: "alerts.reach.bothOff",
  noTeam: "alerts.reach.noTeam",
} as const;

/** The one red line for alerts that would reach no one: what is off, or (gap null) that the alert opens no incident. */
export const unreachableLine = (t: TranslateFn, gap: IncidentReachGap, count: number): I18nText =>
  gap === null
    ? t("alerts.reach.noIncident", { count }, count)
    : t(UNREACHABLE_KEYS[gap], { count }, count);

/** The neutral line for alerts with no destination whose incident pages on-call. */
export const viaIncidentLine = (t: TranslateFn, count: number): I18nText =>
  t("alerts.reach.viaIncident", { count }, count);
