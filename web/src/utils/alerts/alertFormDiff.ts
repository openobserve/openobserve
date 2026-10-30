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
import {
  AGGREGATION_ENABLED_FIELD,
  sectionOfField,
  type AlertSectionId,
} from "@/components/alerts/alertFormSections";

/** One field whose value differs from the loaded alert. */
export interface AlertFieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

// Display-only form state; the fields it mirrors are compared instead.
const IGNORED_ROOTS = new Set(["_ui", "_meta", "uuid"]);

// A filter tree or a window list is one setting to a person, however many leaves it has.
const ATOMIC_PATHS = new Set([
  "query_condition.conditions",
  "query_condition.multi_time_range",
  "query_condition.promql_condition",
  "composite_condition",
  "deduplication",
]);

const FIELD_LABELS: Record<string, I18nKey> = {
  name: "alerts.editMode.unsaved.fields.name",
  description: "alerts.editMode.unsaved.fields.description",
  stream_type: "alerts.editMode.unsaved.fields.streamType",
  stream_name: "alerts.editMode.unsaved.fields.streamName",
  is_real_time: "alerts.editMode.unsaved.fields.alertType",
  "query_condition.conditions": "alerts.editMode.unsaved.fields.filters",
  "query_condition.sql": "alerts.editMode.unsaved.fields.sql",
  "query_condition.promql": "alerts.editMode.unsaved.fields.promql",
  "query_condition.promql_condition": "alerts.editMode.unsaved.fields.promqlCondition",
  "query_condition.type": "alerts.editMode.unsaved.fields.queryMode",
  "query_condition.vrl_function": "alerts.editMode.unsaved.fields.vrl",
  "query_condition.aggregation.function": "alerts.editMode.unsaved.fields.function",
  "query_condition.aggregation.having.column": "alerts.editMode.unsaved.fields.field",
  "query_condition.aggregation.having.operator": "alerts.editMode.unsaved.fields.operator",
  "query_condition.aggregation.having.value": "alerts.editMode.unsaved.fields.threshold",
  "query_condition.aggregation.warning_value": "alerts.editMode.unsaved.fields.warning",
  "query_condition.aggregation.group_by": "alerts.editMode.unsaved.fields.groupBy",
  "query_condition.promql_warning_value": "alerts.editMode.unsaved.fields.warning",
  "query_condition.multi_time_range": "alerts.editMode.unsaved.fields.compareWithPast",
  logGroupBy: "alerts.editMode.unsaved.fields.groupBy",
  "trigger_condition.threshold": "alerts.editMode.unsaved.fields.threshold",
  "trigger_condition.operator": "alerts.editMode.unsaved.fields.operator",
  "trigger_condition.warning_threshold": "alerts.editMode.unsaved.fields.warning",
  "trigger_condition.period": "alerts.editMode.unsaved.fields.lookBack",
  "trigger_condition.frequency": "alerts.editMode.unsaved.fields.checkEvery",
  "trigger_condition.frequency_type": "alerts.editMode.unsaved.fields.frequencyType",
  "trigger_condition.cron": "alerts.editMode.unsaved.fields.cron",
  "trigger_condition.timezone": "alerts.editMode.unsaved.fields.timezone",
  "trigger_condition.silence": "alerts.editMode.unsaved.fields.cooldown",
  pending_period_sec: "alerts.editMode.unsaved.fields.holdFor",
  destinations: "alerts.editMode.unsaved.fields.destinations",
  recovery_destinations: "alerts.editMode.unsaved.fields.recoveryDestinations",
  notify_on_recovery: "alerts.editMode.unsaved.fields.notifyOnRecovery",
  keep_firing_for: "alerts.editMode.unsaved.fields.keepFiring",
  creates_incident: "alerts.editMode.unsaved.fields.createsIncident",
  template: "alerts.editMode.unsaved.fields.template",
  context_attributes: "alerts.editMode.unsaved.fields.variables",
  oncall_team: "alerts.editMode.unsaved.fields.oncall",
  deduplication: "alerts.editMode.unsaved.fields.dedup",
  row_template: "alerts.editMode.unsaved.fields.rowTemplate",
  priority: "alerts.editMode.unsaved.fields.priority",
  tags: "alerts.editMode.unsaved.fields.tags",
  workflows: "alerts.editMode.unsaved.fields.workflows",
  composite_condition: "alerts.editMode.unsaved.fields.composite",
  children: "alerts.editMode.unsaved.fields.children",
  enabled: "alerts.editMode.unsaved.fields.enabled",
  [AGGREGATION_ENABLED_FIELD]: "alerts.editMode.unsaved.fields.aggregation",
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isEmpty = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (isPlainObject(v) && Object.keys(v).length === 0);

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_key, value) =>
    isPlainObject(value)
      ? Object.fromEntries(
          Object.keys(value as object)
            .sort()
            .map((k) => [k, value[k]]),
        )
      : value,
  ) ?? "";

/** Equal as a person reads them: blank equals absent, and 5 equals "5". */
export const sameValue = (a: unknown, b: unknown): boolean => {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (typeof a !== "object" && typeof b !== "object") return String(a) === String(b);
  return stableJson(a) === stableJson(b);
};

const walk = (before: unknown, after: unknown, path: string, out: AlertFieldChange[]): void => {
  const atomic = path !== "" && ATOMIC_PATHS.has(path);
  if (!atomic && (isPlainObject(before) || isPlainObject(after))) {
    const left = isPlainObject(before) ? before : {};
    const right = isPlainObject(after) ? after : {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (path === "" && IGNORED_ROOTS.has(key)) continue;
      walk(left[key], right[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (!sameValue(before, after)) out.push({ path, before, after });
};

const isCron = (values: Record<string, unknown>): boolean =>
  (values.trigger_condition as Record<string, unknown> | undefined)?.frequency_type === "cron";

// The schedule the alert does not run on is carried along but changes nothing.
const scheduleIgnored = (before: Record<string, unknown>, after: Record<string, unknown>) => {
  const cron = isCron(before) || isCron(after);
  const minutes = !isCron(before) || !isCron(after);
  return new Set([
    ...(cron ? [] : ["trigger_condition.cron", "trigger_condition.timezone"]),
    ...(minutes ? [] : ["trigger_condition.frequency"]),
  ]);
};

/** Fields of the form whose value differs from the loaded alert, one entry per setting. */
export function diffAlertValues(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AlertFieldChange[] {
  const out: AlertFieldChange[] = [];
  walk(before, after, "", out);
  const ignored = scheduleIgnored(before, after);
  return out.filter((change) => !ignored.has(change.path));
}

/** The setting's name as the editor shows it; an unmapped path reads as itself. */
export function changeLabel(path: string, t: TranslateFn): I18nText {
  const key = FIELD_LABELS[path];
  return key ? t(key) : raw(path);
}

const MAX_VALUE_CHARS = 40;

/** One side of "old → new"; trees are named as edited rather than dumped. */
export function changeValueText(value: unknown, t: TranslateFn, path = ""): I18nText {
  if (isEmpty(value)) return t("alerts.editMode.unsaved.empty");
  if (ATOMIC_PATHS.has(path) && typeof value === "object") {
    return t("alerts.editMode.unsaved.edited");
  }
  const text = Array.isArray(value)
    ? value.map((v) => (typeof v === "object" ? stableJson(v) : String(v))).join(", ")
    : typeof value === "object"
      ? stableJson(value)
      : String(value);
  return raw(text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text);
}

/** Sections that hold at least one unsaved change. */
export function changedSections(changes: AlertFieldChange[]): Set<AlertSectionId> {
  return new Set(changes.map((c) => sectionOfField(c.path)));
}
