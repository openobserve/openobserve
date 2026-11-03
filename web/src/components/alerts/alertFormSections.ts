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

import type { I18nKey } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.types";

export type AlertSectionId = "watch" | "condition" | "notify" | "schedule" | "details";

/** Slots in the sectioned alert editor that step components teleport a slice of themselves into. */
export type AlertSectionSlot =
  | "queryCondition"
  | "querySchedule"
  | "settingsHold"
  | "settingsNotify"
  | "settingsNotifyMore"
  | "settingsSchedule"
  | "advancedMessage"
  | "advancedOncall"
  | "advancedDetails"
  | "anomalyCondition"
  | "anomalyTraining"
  | "anomalySchedule"
  | "compositeCondition"
  | "compositePreview";

/** Teleport targets a step renders its slices into; absent or null keeps the slice inline. */
export type AlertSectionTargets = Partial<Record<AlertSectionSlot, HTMLElement | null>>;

export interface AlertSectionDef {
  id: AlertSectionId;
  /** The question the section asks, as its heading. */
  titleKey: I18nKey;
  /** The same question in a few words, for the section list and the Next button. */
  navKey: I18nKey;
  /** One sentence under the heading that tells the user how little this step asks. */
  helpKey: I18nKey;
  icon: IconName;
}

export const ALERT_SECTIONS: readonly AlertSectionDef[] = [
  {
    id: "watch",
    titleKey: "alerts.sections.watch.title",
    navKey: "alerts.sections.watch.nav",
    helpKey: "alerts.sections.watch.help",
    icon: "visibility",
  },
  {
    id: "condition",
    titleKey: "alerts.sections.condition.title",
    navKey: "alerts.sections.condition.nav",
    helpKey: "alerts.sections.condition.help",
    icon: "notifications-active",
  },
  {
    id: "notify",
    titleKey: "alerts.sections.notify.title",
    navKey: "alerts.sections.notify.nav",
    helpKey: "alerts.sections.notify.help",
    icon: "send",
  },
  {
    id: "schedule",
    titleKey: "alerts.sections.schedule.title",
    navKey: "alerts.sections.schedule.nav",
    helpKey: "alerts.sections.schedule.help",
    icon: "schedule",
  },
  {
    id: "details",
    titleKey: "alerts.sections.details.title",
    navKey: "alerts.sections.details.nav",
    helpKey: "alerts.sections.details.help",
    icon: "label",
  },
];

/** Change-tracking key for the measure on/off switch, which lives beside the form values. */
export const AGGREGATION_ENABLED_FIELD = "aggregation_enabled";

const FIELD_SECTION_PREFIXES: ReadonlyArray<[string, AlertSectionId]> = [
  [AGGREGATION_ENABLED_FIELD, "condition"],
  ["stream_type", "watch"],
  ["stream_name", "watch"],
  ["is_real_time", "watch"],
  ["children", "watch"],
  ["query_condition.conditions", "watch"],
  ["query_condition.sql", "watch"],
  ["query_condition.promql_condition", "condition"],
  ["query_condition.promql_warning_value", "condition"],
  ["query_condition.promql_rule_mode", "condition"],
  ["query_condition.promql_multi_alert", "condition"],
  ["query_condition.promql", "watch"],
  ["query_condition.type", "watch"],
  ["query_condition.vrl_function", "watch"],
  ["query_condition.search_event_type", "watch"],
  ["query_condition", "condition"],
  ["logGroupBy", "condition"],
  ["composite_condition", "condition"],
  ["pending_period_sec", "condition"],
  ["trigger_condition.threshold", "condition"],
  ["trigger_condition.operator", "condition"],
  ["trigger_condition.warning", "condition"],
  ["_ui.forecast", "condition"],
  ["_ui.pendingPeriod", "condition"],
  ["trigger_condition", "schedule"],
  ["_ui", "schedule"],
  ["destinations", "notify"],
  ["workflows", "notify"],
  ["recovery_destinations", "notify"],
  ["notify_on_recovery", "notify"],
  ["keep_firing_for", "notify"],
  ["creates_incident", "notify"],
  ["template", "notify"],
  ["context_attributes", "notify"],
  ["oncall_team", "notify"],
  ["suppress_repeats", "notify"],
  ["name", "details"],
  ["description", "details"],
  ["row_template", "details"],
  ["priority", "details"],
  ["tags", "details"],
];

/** Which section owns a form field, by its `name=` path; unknown paths belong to the first section. */
export function sectionOfField(name: string): AlertSectionId {
  const hit = FIELD_SECTION_PREFIXES.find(
    ([prefix]) =>
      name === prefix ||
      name.startsWith(`${prefix}.`) ||
      name.startsWith(`${prefix}[`) ||
      name.startsWith(`${prefix}_`),
  );
  return hit ? hit[1] : "watch";
}
