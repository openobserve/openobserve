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
  | "threshold"
  | "checkEvery"
  | "timezone"
  | "lookBack"
  | "cooldown"
  | "name"
  | "folder"
  | "destinations"
  | "recoveryDestinations"
  | "recoveryPlan"
  | AnomalyFindId;

/** Controls only the anomaly ("When unusual") editor has. */
export type AnomalyFindId =
  | "anomalyQuery"
  | "anomalyFunction"
  | "anomalyResolution"
  | "anomalyTraining"
  | "anomalyRetrain"
  | "anomalySensitivity"
  | "anomalyRecordOnly"
  | "anomalyDestination"
  | "anomalyTemplate"
  | "anomalyDirection"
  | "anomalyWindow"
  | "anomalyPriority"
  | "anomalyTags"
  | "anomalyCheckEvery"
  | "anomalyLookBack";

export interface AlertFindEntry {
  id: AlertFindId;
  labelKey: I18nKey;
  /** Older names and synonyms people search by; matched, never shown. */
  aliases: readonly string[];
  section: AlertSectionId;
  /** The control's tier, or "shown" for one that is always on screen. */
  tier: AlertSettingTier | "shown";
  /** The block of the section the control sits in. */
  groupKey: I18nKey;
  /** The tiered setting that shows or hides this control, when it is not the entry itself. */
  setting?: AlertSettingId;
  /** The setting this one sits under, shown after the group in the result's path. */
  parentKey?: I18nKey;
  /** data-test ids of the control in preference order; the first one on screen gets focus. */
  targets: readonly string[];
}

export interface AlertFindMatch {
  entry: AlertFindEntry;
  score: number;
  /** Set when the setting is offered only by another query mode, the one to switch to. */
  needsMode?: AlertFindMode;
}

/** A query mode Find can switch to so a setting becomes reachable. */
export type AlertFindMode = "sql" | "promql";

/** Settings only one query mode offers; Find lists them from the other modes with the way there. */
export const FIND_MODE_OF: Partial<Record<AlertFindId, AlertFindMode>> = {
  compareWithPast: "sql",
  vrl: "sql",
  ruleExpression: "promql",
  forecast: "promql",
};

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
    labelKey: "alerts.sections.rows.streamTypeLabel",
    aliases: ["logs", "metrics", "traces", "data type", "stream type"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.data",
    targets: ["add-alert-stream-type-select-dropdown"],
  },
  {
    id: "stream",
    labelKey: "alerts.sections.rows.streamLabel",
    aliases: ["stream name", "index", "source", "dataset"],
    section: "watch",
    tier: "shown",
    groupKey: "alerts.find.groups.data",
    targets: ["add-alert-stream-name-select-dropdown"],
  },
  {
    id: "queryMode",
    labelKey: "alerts.find.labels.queryMode",
    aliases: ["builder", "sql", "promql", "query type", "custom"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.query",
    targets: ["step2-query-tabs"],
  },
  {
    id: "filters",
    labelKey: "alerts.find.labels.filters",
    aliases: ["filter", "where", "conditions"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.query",
    targets: ["alert-conditions-add-condition-btn"],
  },
  {
    id: "queryEditor",
    labelKey: "alerts.find.labels.queryEditor",
    aliases: ["sql query", "promql query", "query", "editor"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.query",
    targets: ["step2-view-editor-btn"],
  },
  {
    id: "vrl",
    labelKey: "alerts.tiers.names.vrl",
    aliases: ["vrl", "function", "transform"],
    section: "condition",
    tier: "more",
    groupKey: MORE,
    targets: ["alert-vrl-toggle", "step2-view-editor-btn"],
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
    tier: "add",
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
    labelKey: "alerts.tiers.names.holdFor",
    aliases: ["hold", "pending", "pending period", "for at least", "sustained"],
    section: "condition",
    tier: "smart",
    groupKey: MORE,
    targets: ["alert-settings-pending-period-input"],
  },
  {
    id: "groupBy",
    labelKey: "alerts.find.labels.groupBy",
    aliases: [
      "group",
      "multi",
      "multi alert",
      "per",
      "one per",
      "split by",
      "by",
      "each",
      "simple",
      "aggregation",
    ],
    section: "condition",
    tier: "more",
    groupKey: MORE,
    targets: ["alert-group-by-select-0", "alert-group-by-add-btn", "add-alert-group-question"],
  },
  {
    id: "compareWithPast",
    labelKey: "alerts.plain.compareTitle",
    aliases: [
      "compare",
      "multi time range",
      "past",
      "previous",
      "baseline",
      "offset",
      "last week",
      "yesterday",
    ],
    section: "condition",
    tier: "more",
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
    tier: "add",
    groupKey: "alerts.form.incident.label",
    targets: ["alert-creates-incident-toggle", "add-alert-incident-row"],
  },
  {
    id: "template",
    labelKey: "alerts.plain.messageTemplate",
    aliases: ["template", "template override", "message", "body", "payload"],
    section: "notify",
    tier: "add",
    groupKey: "alerts.form.messageRow",
    targets: ["advanced-template-override-select"],
  },
  {
    id: "variables",
    labelKey: "alerts.plain.variables",
    aliases: ["variable", "context attributes", "vars"],
    section: "notify",
    tier: "add",
    groupKey: "alerts.form.messageRow",
    targets: ["alert-variables-key-input", "alert-variables-add-btn"],
  },
  {
    id: "recovery",
    labelKey: "alerts.plain.notifyOnRecovery",
    aliases: ["recovery", "recover", "resolved", "notify on recovery"],
    section: "notify",
    tier: "smart",
    groupKey: MORE,
    targets: ["alert-notify-on-recovery-toggle"],
  },
  {
    id: "recoveryDestinations",
    labelKey: "alerts.alertSettings.recoveryDestinations",
    aliases: ["recovery destinations", "resolved destination", "recovery channel"],
    section: "notify",
    tier: "smart",
    groupKey: MORE,
    setting: "recovery",
    parentKey: "alerts.plain.notifyOnRecovery",
    targets: ["alert-settings-recovery-destinations", "alert-notify-on-recovery-toggle"],
  },
  {
    id: "recoveryPlan",
    labelKey: "alerts.find.labels.recoveryPlan",
    aliases: ["recovery message", "resolved message", "resolve", "close ticket"],
    section: "notify",
    tier: "smart",
    groupKey: MORE,
    setting: "recovery",
    parentKey: "alerts.plain.notifyOnRecovery",
    targets: ["alert-notify-on-recovery-toggle"],
  },
  {
    id: "oncall",
    labelKey: "alerts.oncallTeam",
    aliases: ["oncall", "on call", "rotation", "escalation", "pager"],
    section: "notify",
    tier: "smart",
    groupKey: MORE,
    targets: ["alert-oncall-team-select"],
  },
  {
    id: "suppressRepeats",
    labelKey: "alerts.alertSettings.suppressRepeats",
    aliases: ["suppress", "repeat", "once per state", "dedup", "deduplication", "duplicates"],
    section: "notify",
    tier: "more",
    groupKey: MORE,
    targets: ["alert-suppress-repeats-toggle"],
  },
  {
    id: "keepFiring",
    labelKey: "alerts.form.keepFiring.label",
    aliases: ["keep firing", "keep firing for", "flapping"],
    section: "notify",
    tier: "smart",
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
    tier: "add",
    groupKey: "alerts.find.groups.schedule",
    targets: ["add-alert-add-cron", "alert-cron-input"],
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
    labelKey: "alerts.form.remind.label",
    aliases: [
      "cooldown",
      "repeat every",
      "remind",
      "silence",
      "silence notification",
      "throttle",
      "snooze",
      "at most once",
    ],
    section: "notify",
    tier: "shown",
    groupKey: "alerts.find.groups.destinations",
    targets: ["alert-settings-silence-duration-input"],
  },
  {
    id: "name",
    labelKey: "alerts.sections.details.name",
    aliases: ["alert name", "title", "rename"],
    section: "details",
    tier: "shown",
    groupKey: "alerts.find.groups.details",
    targets: ["add-alert-details-name-input"],
  },
  {
    id: "folder",
    labelKey: "alerts.sections.details.folder",
    aliases: ["folder", "directory", "move"],
    section: "details",
    tier: "shown",
    groupKey: "alerts.find.groups.details",
    targets: ["add-alert-details-folder-select"],
  },
  {
    id: "description",
    labelKey: "alerts.description",
    aliases: ["notes", "summary", "about"],
    section: "details",
    tier: "add",
    groupKey: "alerts.find.groups.details",
    targets: ["add-alert-description-textarea"],
  },
  {
    id: "rowTemplate",
    labelKey: "alerts.plain.rowTemplate",
    aliases: ["row template", "row", "per row", "row format"],
    section: "notify",
    tier: "add",
    groupKey: "alerts.form.messageRow",
    targets: ["add-alert-row-input-textarea"],
  },
  {
    id: "priority",
    labelKey: "alerts.priority",
    aliases: ["urgency", "severity", "p1"],
    section: "details",
    tier: "smart",
    groupKey: MORE,
    targets: ["alert-priority-select"],
  },
  {
    id: "tags",
    labelKey: "alerts.tags",
    aliases: ["tag", "labels", "label"],
    section: "details",
    tier: "more",
    groupKey: MORE,
    targets: ["alert-tags-input"],
  },
  {
    id: "generatedSql",
    labelKey: "alerts.tiers.names.generatedSql",
    aliases: ["generated sql", "view query", "sql preview"],
    section: "condition",
    tier: "more",
    groupKey: MORE,
    targets: ["add-alert-generated-sql"],
  },
  {
    id: "ruleExpression",
    labelKey: "alerts.tiers.names.queryComparison",
    aliases: ["rule mode", "rule expression", "recording rule"],
    section: "condition",
    tier: "smart",
    groupKey: MORE,
    targets: ["alert-prom-rule-mode"],
  },
  {
    id: "forecast",
    labelKey: "alerts.forecast.modeForecast",
    aliases: ["forecast", "predict", "trend"],
    section: "condition",
    tier: "add",
    groupKey: "alerts.find.groups.condition",
    targets: ["add-alert-add-forecast", "alert-promql-mode-forecast"],
  },
  {
    id: "anomalySql",
    labelKey: "alerts.tiers.add.anomalySql",
    aliases: ["custom sql", "sql"],
    section: "condition",
    tier: "add",
    groupKey: "alerts.find.groups.query",
    targets: ["add-alert-add-anomalySql", "anomaly-custom-sql", "anomaly-query-tabs"],
  },
  {
    id: "anomalySqlPreview",
    labelKey: "alerts.tiers.names.anomalySqlPreview",
    aliases: ["generated sql", "sql preview"],
    section: "condition",
    tier: "more",
    groupKey: MORE,
    targets: ["anomaly-sql-preview", "anomaly-sql-preview-row"],
  },
  {
    id: "compositeExpression",
    labelKey: "alerts.tiers.add.compositeExpression",
    aliases: ["expression", "advanced expression", "fire when"],
    section: "condition",
    tier: "add",
    groupKey: "alerts.find.groups.condition",
    targets: ["add-alert-add-compositeExpression", "alerts-composite-expression-advanced"],
  },
  {
    id: "compositeWarningCounts",
    labelKey: "alerts.tiers.names.compositeWarningCounts",
    aliases: ["warning counts", "warning as firing"],
    section: "condition",
    tier: "more",
    groupKey: MORE,
    targets: ["alerts-composite-warning-counts-as-firing", "alerts-composite-warning-row"],
  },
  {
    id: "compositeStalePolicy",
    labelKey: "alerts.tiers.names.compositeStalePolicy",
    aliases: ["stale", "stale policy", "stops reporting"],
    section: "condition",
    tier: "more",
    groupKey: MORE,
    targets: ["alerts-composite-stale-policy", "alerts-composite-stale-policy-row"],
  },
  {
    id: "anomalyQuery",
    labelKey: "alerts.sections.rows.whichEvents",
    aliases: ["filters", "filter", "sql", "query", "where", "events"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.query",
    targets: ["anomaly-query-tabs", "add-alert-filter-sentence", "anomaly-custom-sql"],
  },
  {
    id: "anomalyFunction",
    labelKey: "alerts.form.anomaly.measure",
    aliases: ["function", "detection function", "count", "avg", "sum", "field", "metric"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.condition",
    targets: ["anomaly-detection-function", "anomaly-measure-row"],
  },
  {
    id: "anomalyResolution",
    labelKey: "alerts.find.labels.anomalyResolution",
    aliases: ["detection resolution", "per", "histogram", "interval", "bucket"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.condition",
    parentKey: "alerts.form.anomaly.measure",
    targets: ["anomaly-histogram-interval-value", "anomaly-measure-row"],
  },
  {
    id: "anomalyTraining",
    labelKey: "alerts.form.anomaly.trainingWindow",
    aliases: ["training", "train", "learn from", "history", "baseline"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.condition",
    targets: ["anomaly-training-window", "anomaly-training-window-row"],
  },
  {
    id: "anomalyRetrain",
    labelKey: "alerts.anomaly.retrainEvery",
    aliases: ["retrain", "retraining", "refresh model"],
    section: "condition",
    tier: "add",
    groupKey: "alerts.find.groups.condition",
    targets: ["anomaly-retrain-interval", "anomaly-retrain-every-row"],
  },
  {
    id: "anomalySensitivity",
    labelKey: "alerts.sensitivity",
    aliases: ["sensitivity", "threshold", "band", "budget", "noise", "how unusual"],
    section: "condition",
    tier: "shown",
    groupKey: "alerts.find.groups.condition",
    targets: ["anomaly-budget-tiers", "anomaly-sensitivity-tier", "anomaly-sensitivity-row"],
  },
  {
    id: "anomalyRecordOnly",
    labelKey: "alerts.tiers.names.anomalyRecordOnly",
    aliases: [
      "notify",
      "notification",
      "notifications",
      "alerting",
      "enable alerts",
      "record only",
    ],
    section: "notify",
    tier: "more",
    groupKey: MORE,
    targets: ["anomaly-alert-enabled", "anomaly-notifications-row", "anomaly-record-only-row"],
  },
  {
    id: "anomalyDestination",
    labelKey: "alerts.destination",
    aliases: ["destination", "channel", "recipients", "notify"],
    section: "notify",
    tier: "shown",
    groupKey: "alerts.find.groups.destinations",
    targets: ["anomaly-destination", "anomaly-destination-row", "anomaly-notifications-row"],
  },
  {
    id: "anomalyTemplate",
    labelKey: "alerts.templateOverride.label",
    aliases: ["template", "message", "body", "payload"],
    section: "notify",
    tier: "add",
    groupKey: "alerts.form.messageRow",
    targets: ["anomaly-template-row", "anomaly-notifications-row"],
  },
  {
    id: "anomalyDirection",
    labelKey: "alerts.anomaly.alertDirection",
    aliases: ["direction", "spike", "drop", "above", "below", "both"],
    section: "condition",
    tier: "smart",
    groupKey: MORE,
    targets: ["anomaly-alert-direction", "anomaly-alert-direction-row"],
  },
  {
    id: "anomalyWindow",
    labelKey: "alerts.tiers.names.anomalyWindow",
    aliases: ["window share", "window", "share", "fire", "recover", "percent", "flapping"],
    section: "condition",
    tier: "more",
    groupKey: MORE,
    targets: ["anomaly-window-buckets", "anomaly-window-share-row"],
  },
  {
    id: "anomalyPriority",
    labelKey: "alerts.priority",
    aliases: ["urgency", "severity", "p1"],
    section: "details",
    tier: "more",
    groupKey: MORE,
    targets: ["anomaly-priority-select", "anomaly-priority-row"],
  },
  {
    id: "anomalyTags",
    labelKey: "alerts.tags",
    aliases: ["tag", "labels", "label"],
    section: "details",
    tier: "more",
    groupKey: MORE,
    targets: ["anomaly-tags-input", "anomaly-tags-row"],
  },
  {
    id: "anomalyCheckEvery",
    labelKey: "alerts.anomaly.checkEvery",
    aliases: ["frequency", "interval", "how often", "run every", "schedule"],
    section: "schedule",
    tier: "shown",
    groupKey: "alerts.find.groups.schedule",
    targets: ["anomaly-schedule-interval-value", "anomaly-check-every-row"],
  },
  {
    id: "anomalyLookBack",
    labelKey: "alerts.anomaly.lookBackWindow",
    aliases: ["lookback", "look back", "period", "window", "time range"],
    section: "schedule",
    tier: "shown",
    groupKey: "alerts.find.groups.schedule",
    targets: ["anomaly-detection-window-value", "anomaly-look-back-row"],
  },
];

/** Settings the anomaly editor shares with the other alert types. */
const ANOMALY_SHARED_FIND_IDS: ReadonlySet<AlertFindId> = new Set<AlertFindId>([
  "howItChecks",
  "streamType",
  "stream",
  "name",
  "folder",
]);

const ANOMALY_ONLY_FIND_IDS: ReadonlySet<AlertFindId> = new Set<AnomalyFindId>([
  "anomalyQuery",
  "anomalyFunction",
  "anomalyResolution",
  "anomalyTraining",
  "anomalyRetrain",
  "anomalySensitivity",
  "anomalyRecordOnly",
  "anomalyDestination",
  "anomalyTemplate",
  "anomalyDirection",
  "anomalyWindow",
  "anomalyPriority",
  "anomalyTags",
  "anomalyCheckEvery",
  "anomalyLookBack",
]);

/** Whether the entry belongs only to the anomaly editor. */
export function isAnomalyOnlyFindId(id: AlertFindId): id is AnomalyFindId {
  return ANOMALY_ONLY_FIND_IDS.has(id);
}

/** Whether the entry has a control in the anomaly editor. */
export function isAnomalyFindId(id: AlertFindId): boolean {
  return isAnomalyOnlyFindId(id) || ANOMALY_SHARED_FIND_IDS.has(id);
}

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

/**
 * Ranked settings for the typed text; a label beats an equal alias match, then registry order.
 * A setting this alert lacks is still listed when `modeFor` names a mode that offers it, after equal matches.
 */
export function searchAlertSettings(
  query: string,
  t: TranslateFn,
  available: (id: AlertFindId) => boolean,
  modeFor: (id: AlertFindId) => AlertFindMode | undefined = () => undefined,
): AlertFindMatch[] {
  if (!normalize(query)) return [];
  const matches: AlertFindMatch[] = [];
  for (const entry of ALERT_FIND_ENTRIES) {
    const usable = available(gatingSetting(entry) ?? entry.id);
    const needsMode = usable ? undefined : modeFor(entry.id);
    if (!usable && !needsMode) continue;
    const label = matchScore(t(entry.labelKey), query);
    const alias = Math.max(0, ...entry.aliases.map((a) => matchScore(a, query) - 5));
    const score = Math.max(label, alias);
    if (score > 0) matches.push(needsMode ? { entry, score, needsMode } : { entry, score });
  }
  return matches.sort((a, b) => b.score - a.score || Number(!!a.needsMode) - Number(!!b.needsMode));
}
