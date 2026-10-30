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

import { computed, type ComputedRef, type Ref } from "vue";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type {
  SectionNavItem,
  SectionNavState,
} from "@/lib/navigation/SectionNav/OSectionNav.types";
import {
  ALERT_SECTIONS,
  sectionOfField,
  type AlertSectionId,
} from "@/components/alerts/alertFormSections";
import { alertConditionText } from "@/utils/alerts/alertCondition";
import type { ReadBackAlert } from "@/utils/alerts/alertReadBack";

export type FieldMetaMap = Record<string, { errors?: readonly unknown[] } | undefined>;

/** The slice of the alert form the section list reads. */
export interface AlertSectionsFormData extends Omit<ReadBackAlert, "is_real_time"> {
  is_real_time?: string | boolean;
  name?: string;
  children?: unknown[];
  composite_condition?: { expression?: string } | null;
}

/** The slice of the anomaly config the section list reads. */
export interface AlertSectionsAnomalyConfig {
  alert_enabled?: boolean;
  alert_destination_ids?: string[];
  schedule_interval_value?: number | string;
  schedule_interval_unit?: string;
}

/** The bits of the alert form the section list reads; `formData` is the form's read-view. */
export interface AlertFormSectionsInput {
  /** The form's per-field meta (`form.useStore((s) => s.fieldMeta)`). */
  fieldMeta: Readonly<Ref<FieldMetaMap | undefined>>;
  formData: Ref<AlertSectionsFormData>;
  anomalyConfig: Ref<AlertSectionsAnomalyConfig>;
  isAnomalyMode: Ref<boolean>;
  /** Builder/SQL threshold on an aggregate rather than on the event count. */
  isAggregationEnabled: Ref<boolean>;
  isEditing: Ref<boolean>;
  /** Sections holding unsaved edits; edit mode only. */
  changedSections?: Ref<ReadonlySet<AlertSectionId>>;
  t: TranslateFn;
}

const hasValue = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";

/** Label for the scheduled "How it checks" choice, from the stored frequency (always minutes). */
export function checkEveryLabel(formData: AlertSectionsFormData, t: TranslateFn): I18nText {
  const tc = formData?.trigger_condition ?? {};
  if (tc.frequency_type === "cron") return t("alerts.sections.onCron");
  const minutes = Number(tc.frequency ?? 10);
  if (minutes >= 60 && minutes % 60 === 0) {
    return t("alerts.sections.everyHours", { count: minutes / 60 });
  }
  return t("alerts.sections.everyMinutes", { count: minutes });
}

/** Status, a one-line phrase and the title of each section, for the section list. */
export function useAlertFormSections(input: AlertFormSectionsInput): {
  items: ComputedRef<SectionNavItem[]>;
  errorCounts: ComputedRef<Record<AlertSectionId, number>>;
} {
  const { t } = input;
  const { fieldMeta } = input;

  const mode = computed(() => String(input.formData.value?.is_real_time ?? "false"));

  const errorCounts = computed(() => {
    const counts: Record<AlertSectionId, number> = {
      watch: 0,
      condition: 0,
      notify: 0,
      schedule: 0,
      details: 0,
    };
    for (const [name, meta] of Object.entries(fieldMeta.value ?? {})) {
      if (meta?.errors?.some((e) => e !== null && e !== undefined && e !== "")) {
        counts[sectionOfField(name)] += 1;
      }
    }
    return counts;
  });

  const conditionPhrase = (fd: AlertSectionsFormData): I18nText => {
    if (mode.value === "true") return t("alerts.sections.condition.realtime");
    if (mode.value === "anomaly") return t("alerts.sections.condition.anomaly");
    if (mode.value === "composite") {
      const expression = fd.composite_condition?.expression;
      return hasValue(expression) ? raw(expression) : t("alerts.sections.condition.composite");
    }
    const qc = fd.query_condition ?? {};
    if (qc.type === "promql" || (qc.aggregation && input.isAggregationEnabled.value)) {
      return raw(alertConditionText(fd));
    }
    return t("alerts.sections.condition.countPhrase", {
      operator: fd.trigger_condition?.operator ?? ">=",
      threshold: fd.trigger_condition?.threshold ?? 1,
    });
  };

  const notifyCount = (fd: AlertSectionsFormData): number => {
    if (mode.value === "anomaly") {
      const anomaly = input.anomalyConfig.value ?? {};
      return anomaly.alert_enabled ? (anomaly.alert_destination_ids?.length ?? 0) : 0;
    }
    return (fd.destinations?.length ?? 0) + (fd.workflows?.length ?? 0);
  };

  const schedulePhrase = (fd: AlertSectionsFormData): I18nText => {
    if (mode.value === "true" || mode.value === "composite") {
      return t("alerts.sections.schedule.realtime");
    }
    if (mode.value === "anomaly") {
      const anomaly = input.anomalyConfig.value ?? {};
      const value = Number(anomaly.schedule_interval_value ?? 1);
      return anomaly.schedule_interval_unit === "m"
        ? t("alerts.sections.everyMinutes", { count: value })
        : t("alerts.sections.everyHours", { count: value });
    }
    if (fd.trigger_condition?.frequency_type === "cron") {
      return t("alerts.sections.schedule.cron", { cron: fd.trigger_condition?.cron ?? "" });
    }
    return checkEveryLabel(fd, t);
  };

  const sectionFacts = (id: AlertSectionId, fd: AlertSectionsFormData) => {
    switch (id) {
      case "watch": {
        if (mode.value === "composite") {
          const count = fd.children?.length ?? 0;
          return {
            missing: count === 0,
            summary: t("alerts.sections.watch.childCount", { count }, count),
          };
        }
        return {
          missing: !hasValue(fd.stream_name),
          summary: hasValue(fd.stream_name)
            ? raw(fd.stream_name)
            : t("alerts.sections.watch.pickStream"),
        };
      }
      case "condition":
        return { missing: false, summary: conditionPhrase(fd) };
      case "notify": {
        const count = notifyCount(fd);
        return {
          missing: false,
          empty: count === 0,
          summary:
            count === 0
              ? t("alerts.sections.notify.nobody")
              : t("alerts.sections.notify.destinationCount", { count }, count),
        };
      }
      case "schedule":
        return { missing: false, summary: schedulePhrase(fd) };
      default:
        return {
          missing: !hasValue(fd.name),
          summary: hasValue(fd.name) ? raw(fd.name) : t("alerts.sections.details.unnamed"),
        };
    }
  };

  const items = computed<SectionNavItem[]>(() => {
    const fd = input.formData.value ?? {};
    return ALERT_SECTIONS.map(({ id, titleKey }) => {
      const facts = sectionFacts(id, fd);
      const errors = errorCounts.value[id];
      let state: SectionNavState = "none";
      let stateLabel: I18nText | undefined;
      if (errors > 0) {
        state = "error";
        stateLabel = t("alerts.sections.needsFix", { count: errors });
      } else if (facts.missing) {
        state = "attention";
        stateLabel = t("alerts.sections.needsValue");
      } else if (input.changedSections?.value.has(id)) {
        state = "changed";
        stateLabel = t("alerts.editMode.unsaved.changed");
      } else if (!("empty" in facts && facts.empty)) {
        state = input.isEditing.value ? "saved" : "done";
      }
      return { id, title: t(titleKey), summary: facts.summary, state, stateLabel };
    });
  });

  return { items, errorCounts };
}
