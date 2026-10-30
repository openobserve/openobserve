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

import type { I18nKey, TranslateFn } from "@/types/i18n";
import type { AlertSectionId } from "./alertFormSections";
import {
  ALERT_SETTING_TIERS,
  type AlertSettingId,
  type AlertSettingTier,
} from "./alertSettingTiers";

/** Every control "Find a setting" can jump to: the tiered settings plus the always-shown ones. */
export type AlertFindId =
  | AlertSettingId
  | "howItChecks"
  | "streamType"
  | "stream"
  | "queryMode"
  | "filters"
  | "queryEditor"
  | "vrl"
  | "threshold"
  | "checkEvery"
  | "cron"
  | "timezone"
  | "lookBack"
  | "cooldown"
  | "name"
  | "folder"
  | "dedupFields"
  | "dedupWindow";

export interface AlertFindEntry {
  id: AlertFindId;
  labelKey: I18nKey;
  /** Older names and synonyms people search by; matched, never shown. */
  aliases: readonly string[];
  section: AlertSectionId;
  tier: AlertSettingTier;
  /** The block of the section the control sits in. */
  groupKey: I18nKey;
  /** The tiered setting that shows or hides this control, when it is not the entry itself. */
  setting?: AlertSettingId;
  /** data-test ids of the control in preference order; the first one on screen gets focus. */
  targets: readonly string[];
}

export interface AlertFindMatch {
  entry: AlertFindEntry;
  score: number;
}

const MORE: I18nKey = "alerts.find.groups.more";

export const ALERT_FIND_ENTRIES: readonly AlertFindEntry[] = [
  {
    id: "howItChecks",
    labelKey: "alerts.sections.howItChecks",
    aliases: ["alert type", "scheduled", "real time", "realtime", "anomaly", "composite"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.type",
    targets: ["add-alert-type-tabs"],
  },
  {
    id: "streamType",
    labelKey: "alerts.streamType",
    aliases: ["logs", "metrics", "traces", "data type"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.data",
    targets: ["add-alert-stream-type-select-dropdown"],
  },
  {
    id: "stream",
    labelKey: "alerts.stream_name",
    aliases: ["stream", "index", "source", "dataset"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.data",
    targets: ["add-alert-stream-name-select-dropdown"],
  },
  {
    id: "queryMode",
    labelKey: "alerts.find.labels.queryMode",
    aliases: ["builder", "sql", "promql", "query type", "custom"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.query",
    targets: ["step2-query-tabs"],
  },
  {
    id: "filters",
    labelKey: "alerts.find.labels.filters",
    aliases: ["filter", "where", "conditions"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.query",
    targets: ["alert-conditions-add-condition-btn"],
  },
  {
    id: "queryEditor",
    labelKey: "alerts.find.labels.queryEditor",
    aliases: ["sql query", "promql query", "query", "editor"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.query",
    targets: ["step2-view-editor-btn"],
  },
  {
    id: "vrl",
    labelKey: "alerts.find.labels.vrl",
    aliases: ["vrl", "function", "transform"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.query",
    targets: ["step2-view-editor-btn"],
  },
  {
    id: "threshold",
    labelKey: "alerts.find.labels.threshold",
    aliases: ["critical", "limit", "trigger", "condition", "operator", "value"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.condition",
    targets: [
      "alert-trigger-threshold-input",
      "alert-threshold-value-input",
      "alert-sql-agg-value-input",
    ],
  },
  {
    id: "warning",
    labelKey: "alerts.find.labels.warning",
    aliases: ["warn", "warning threshold", "severity"],
    section: "condition",
    tier: "tucked",
    groupKey: MORE,
    targets: [
      "alert-warning-threshold-input-136",
      "alert-warning-threshold-input-381",
      "alert-warning-threshold-input-1020",
      "alert-aggregation-warning-value-input-182",
      "alert-aggregation-warning-value-input-413",
      "alert-sql-agg-warning-value-input",
      "alert-promql-warning-value-input",
      "alert-add-warning-button",
    ],
  },
  {
    id: "holdFor",
    labelKey: "alerts.find.labels.holdFor",
    aliases: ["hold", "pending", "pending period", "for at least", "sustained"],
    section: "condition",
    tier: "tucked",
    groupKey: MORE,
    targets: ["alert-settings-pending-period-input"],
  },
  {
    id: "groupBy",
    labelKey: "alerts.find.labels.groupBy",
    aliases: ["group", "multi", "multi alert", "per", "split by", "simple"],
    section: "condition",
    tier: "tucked",
    groupKey: MORE,
    targets: ["alert-group-by-select-0", "alert-group-by-add-btn"],
  },
  {
    id: "compareWithPast",
    labelKey: "alerts.plain.compareTitle",
    aliases: ["compare", "multi time range", "past", "previous", "baseline", "offset"],
    section: "condition",
    tier: "tucked",
    groupKey: MORE,
    targets: ["multi-time-range-alerts-add-btn"],
  },
  {
    id: "destinations",
    labelKey: "alerts.destination",
    aliases: ["destination", "notify", "notification", "channel", "recipients", "workflow"],
    section: "notify",
    tier: "shown",
    groupKey: "alerts.find.groups.destinations",
    targets: ["alert-destinations-select"],
  },
  {
    id: "createsIncident",
    labelKey: "alerts.plain.openIncident",
    aliases: ["incident", "incidents", "creates incident"],
    section: "notify",
    tier: "one",
    groupKey: "alerts.tiers.rowFires",
    targets: ["alert-creates-incident-toggle"],
  },
  {
    id: "template",
    labelKey: "alerts.plain.messageTemplate",
    aliases: ["template", "template override", "message", "body", "payload"],
    section: "notify",
    tier: "one",
    groupKey: "alerts.tiers.rowMessage",
    targets: ["advanced-template-override-select"],
  },
  {
    id: "variables",
    labelKey: "alerts.plain.variables",
    aliases: ["variable", "context attributes", "vars"],
    section: "notify",
    tier: "one",
    groupKey: "alerts.tiers.rowMessage",
    targets: ["alert-variables-key-input", "alert-variables-add-btn"],
  },
  {
    id: "recovery",
    labelKey: "alerts.plain.notifyOnRecovery",
    aliases: ["recovery", "recover", "resolved", "notify on recovery"],
    section: "notify",
    tier: "tucked",
    groupKey: MORE,
    targets: ["alert-notify-on-recovery-toggle"],
  },
  {
    id: "oncall",
    labelKey: "alerts.oncallTeam",
    aliases: ["oncall", "on call", "rotation", "escalation", "pager"],
    section: "notify",
    tier: "tucked",
    groupKey: MORE,
    targets: ["alert-oncall-team-select"],
  },
  {
    id: "dedup",
    labelKey: "alerts.plain.dedupTitle",
    aliases: ["dedup", "deduplication", "duplicates", "fingerprint", "suppress"],
    section: "notify",
    tier: "tucked",
    groupKey: MORE,
    targets: ["alert-dedup-fingerprint-fields", "alert-dedup-time-window"],
  },
  {
    id: "dedupFields",
    labelKey: "alerts.deduplication.fingerprintFields",
    aliases: ["fingerprint fields", "similar alerts", "dedup fields"],
    section: "notify",
    tier: "tucked",
    groupKey: "alerts.plain.dedupTitle",
    setting: "dedup",
    targets: ["alert-dedup-fingerprint-fields"],
  },
  {
    id: "dedupWindow",
    labelKey: "alerts.deduplication.timeWindow",
    aliases: ["dedup window", "time window", "identical within"],
    section: "notify",
    tier: "tucked",
    groupKey: "alerts.plain.dedupTitle",
    setting: "dedup",
    targets: ["alert-dedup-time-window"],
  },
  {
    id: "keepFiring",
    labelKey: "alerts.plain.keepFiringFor",
    aliases: ["keep firing", "keep firing for", "flapping"],
    section: "notify",
    tier: "tucked",
    groupKey: MORE,
    targets: ["alert-settings-keep-firing-for-input"],
  },
  {
    id: "checkEvery",
    labelKey: "alerts.queryConfig.checkEvery",
    aliases: ["frequency", "interval", "how often", "run every"],
    section: "schedule",
    tier: "shown",
    groupKey: "alerts.find.groups.schedule",
    targets: ["alert-check-every-input", "alert-check-every-unit-select"],
  },
  {
    id: "cron",
    labelKey: "alerts.find.labels.cron",
    aliases: ["cron", "cron expression", "crontab"],
    section: "schedule",
    tier: "shown",
    groupKey: "alerts.find.groups.schedule",
    targets: ["alert-cron-input", "alert-check-every-unit-select"],
  },
  {
    id: "timezone",
    labelKey: "alerts.downtimes.scheduleForm.timezone",
    aliases: ["timezone", "time zone", "tz", "utc"],
    section: "schedule",
    tier: "shown",
    groupKey: "alerts.find.groups.schedule",
    targets: ["alert-cron-timezone-select", "alert-check-every-unit-select"],
  },
  {
    id: "lookBack",
    labelKey: "alerts.plain.lookBack",
    aliases: ["lookback", "look back", "period", "window", "time range"],
    section: "schedule",
    tier: "shown",
    groupKey: "alerts.find.groups.schedule",
    targets: ["alert-settings-period-input"],
  },
  {
    id: "cooldown",
    labelKey: "alerts.plain.cooldown",
    aliases: ["cooldown", "silence", "silence notification", "throttle", "snooze"],
    section: "schedule",
    tier: "shown",
    groupKey: "alerts.find.groups.schedule",
    targets: ["alert-settings-silence-duration-input"],
  },
  {
    id: "name",
    labelKey: "alerts.sections.details.name",
    aliases: ["alert name", "title", "rename"],
    section: "details",
    tier: "shown",
    groupKey: "alerts.find.groups.details",
    targets: ["add-alert-details-rename-btn"],
  },
  {
    id: "folder",
    labelKey: "alerts.sections.details.folder",
    aliases: ["folder", "directory", "move"],
    section: "details",
    tier: "shown",
    groupKey: "alerts.find.groups.details",
    targets: ["inline-select-folder-dropdown"],
  },
  {
    id: "description",
    labelKey: "alerts.description",
    aliases: ["notes", "summary", "about"],
    section: "details",
    tier: "shown",
    groupKey: "alerts.find.groups.details",
    targets: ["add-alert-description-textarea"],
  },
  {
    id: "rowTemplate",
    labelKey: "alerts.plain.rowTemplate",
    aliases: ["row template", "row", "per row", "row format"],
    section: "details",
    tier: "shown",
    groupKey: "alerts.find.groups.details",
    targets: ["add-alert-row-input-textarea"],
  },
  {
    id: "priority",
    labelKey: "alerts.priority",
    aliases: ["urgency", "severity", "p1"],
    section: "details",
    tier: "tucked",
    groupKey: MORE,
    targets: ["alert-priority-select"],
  },
  {
    id: "tags",
    labelKey: "alerts.tags",
    aliases: ["tag", "labels", "label"],
    section: "details",
    tier: "tucked",
    groupKey: MORE,
    targets: ["alert-tags-input"],
  },
];

/** Whether the id is one of the tiered settings, so it may need revealing first. */
export function isTieredSetting(id: AlertFindId): id is AlertSettingId {
  return ALERT_SETTING_TIERS.some((d) => d.id === id);
}

/** The tiered setting that gates the entry's control, if any. */
export function gatingSetting(entry: AlertFindEntry): AlertSettingId | undefined {
  if (entry.setting) return entry.setting;
  return isTieredSetting(entry.id) ? entry.id : undefined;
}

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** 100 exact, 80 prefix, 60 word prefix, 40 substring, 30 every query word starts a word; 0 none. */
export function matchScore(text: string, query: string): number {
  const hay = normalize(text);
  const needle = normalize(query);
  if (!hay || !needle) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 80;
  if (hay.includes(` ${needle}`)) return 60;
  if (hay.includes(needle)) return 40;
  const words = hay.split(" ");
  const parts = needle.split(" ");
  return parts.every((p) => words.some((w) => w.startsWith(p))) ? 30 : 0;
}

/** Ranked settings for the typed text; a label beats an equal alias match, then registry order. */
export function searchAlertSettings(
  query: string,
  t: TranslateFn,
  available: (id: AlertFindId) => boolean,
): AlertFindMatch[] {
  if (!normalize(query)) return [];
  const matches: AlertFindMatch[] = [];
  for (const entry of ALERT_FIND_ENTRIES) {
    if (!available(gatingSetting(entry) ?? entry.id)) continue;
    const label = matchScore(t(entry.labelKey), query);
    const alias = Math.max(0, ...entry.aliases.map((a) => matchScore(a, query) - 5));
    const score = Math.max(label, alias);
    if (score > 0) matches.push({ entry, score });
  }
  return matches.sort((a, b) => b.score - a.score);
}
