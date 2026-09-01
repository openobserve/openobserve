<!-- Copyright 2026 OpenObserve Inc.
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
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  Read-only configuration summary on the alert status page.

  Deliberately a summary, not an editor: it answers "what is this alert
  actually watching" at a glance, and the Edit action in the page header owns
  every change.
-->
<template>
  <div class="flex flex-col gap-4" data-test="alerts-alertconfigsummary">
    <OCard v-for="section in sections" :key="section.key">
      <OCardSection role="body">
        <h3 class="text-text-heading mb-3 text-lg">{{ section.title }}</h3>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div
            v-for="field in section.fields"
            :key="field.key"
            class="flex flex-col gap-1"
            :data-test="`alerts-alertconfigsummary-${field.key}`"
          >
            <dt class="text-text-secondary text-xs">
              {{ field.label }}
            </dt>
            <dd class="text-text-heading text-sm" :class="field.mono ? 'font-mono break-all' : ''">
              <OTag v-if="field.badge" :type="field.badge" :value="field.value" size="sm" />
              <!-- Unstyled on purpose: base-elements.css already gives every
                   `a` the link colour AND the darker hover shade. Re-declaring
                   `text-text-link` here would pin hover to the resting colour,
                   making this the one link in the app that does not respond. -->
              <router-link
                v-else-if="field.link"
                :to="field.link"
                :data-test="`alerts-alertconfigsummary-${field.key}-link`"
                >{{ field.value }}</router-link
              >
              <template v-else>{{ field.value }}</template>
            </dd>
          </div>
        </dl>
      </OCardSection>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";

import OCard from "@/lib/core/Card/OCard.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import {
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";
import { burnWindowLabel } from "@/utils/alerts/sloAlertPayload";
import { sloDetailRoute } from "@/utils/alerts/sloAlertRouting";
import { formatTimestampInTimezone } from "@/utils/date";

const props = defineProps<{
  alert: any;
  /** The SLO's human name. The single alert GET carries only `slo_id`, so the
   *  page resolves this separately and may legitimately not have it — the
   *  summary then shows the id rather than nothing. */
  sloName?: string;
}>();

const { t } = useI18nTyped();
const store = useStore();

const EMPTY = "—";

// The single-alert GET calls this `query_condition`; the list calls the same
// object `condition`. Accept either.
const queryCondition = computed(() => props.alert?.query_condition || props.alert?.condition);
const aggregation = computed(() => queryCondition.value?.aggregation);

const isBlank = (v: any) => v === undefined || v === null || v === "";

const conditionText = computed(() => {
  const qc = queryCondition.value;
  // PromQL keeps its threshold on promql_condition (the expression itself is the
  // query); render the comparison so it doesn't fall through to "—".
  if (qc?.type === "promql") {
    const pc = qc.promql_condition;
    return isBlank(pc?.value) ? EMPTY : `${pc.operator || ""} ${pc.value}`.trim();
  }
  const agg = aggregation.value;
  if (!agg) return qc?.sql || EMPTY;
  const fn = agg.function || "";
  const col = agg.having?.column || "";
  const op = agg.having?.operator || "";
  const val = agg.having?.value;
  return `${fn}(${col}) ${op} ${val}`;
});

const warningText = computed(() => {
  const qc = queryCondition.value;
  // PromQL warning lives on promql_warning_value and shares the critical operator.
  if (qc?.type === "promql") {
    return isBlank(qc.promql_warning_value)
      ? EMPTY
      : `${qc.promql_condition?.operator || ""} ${qc.promql_warning_value}`.trim();
  }
  const agg = aggregation.value;
  if (isBlank(agg?.warning_value)) {
    return EMPTY;
  }
  const fn = agg.function || "";
  const col = agg.having?.column || "";
  const op = agg.having?.operator || "";
  return `${fn}(${col}) ${op} ${agg.warning_value}`;
});

// ── SLO alerts (Feature 5, Phase 3.3) ───────────────────────────────────────
// This family has no stream, no SQL and no aggregation, so the generic source
// section answered "what is this alert watching?" with a column of em dashes.
// What it DOES have is an SLO, a condition kind, thresholds and burn windows.
const sloCondition = computed(() => queryCondition.value?.slo_condition);
const isSloAlertConfig = computed(() => queryCondition.value?.type === "slo");
const sloId = computed(() => sloCondition.value?.slo_id || "");

// `=== true`, not truthiness: `zoConfig` is empty until /config resolves, so
// "not false" is also "we have not been told yet" — and a link into a module
// this deployment may not serve is a dead link.
const sloLinkable = computed(() => !!sloId.value);

/** `operator` is part of the threshold, not decoration — `>` and `>=` are
 *  genuinely different alerts, and the backend stores it on every condition. */
const sloThreshold = (level: "critical" | "warning"): string => {
  const cond = sloCondition.value;
  const raw = cond?.[level];
  if (isBlank(raw)) return EMPTY;
  const budget = cond?.kind === "error_budget";
  const noun = budget ? t("slos.alert.budgetConsumed") : t("slos.alert.burnRate");
  const suffix = budget ? "%" : "";
  return `${noun} ${cond?.operator || ""} ${raw}${suffix}`.replace(/\s+/g, " ").trim();
};

const sloKindLabel = computed(() => {
  const kind = sloCondition.value?.kind;
  if (kind === "burn_rate") return t("slos.alert.kind.burnRate");
  if (kind === "error_budget") return t("slos.alert.kind.errorBudget");
  // A stored condition can be NULL while the discriminator says "slo". Naming a
  // kind here would be an invention, and "undefined" would be worse.
  return EMPTY;
});

const sloFields = computed(() => {
  const cond = sloCondition.value;
  const fields: Record<string, any>[] = [
    {
      key: "slo",
      label: t("alerts.sloColumn"),
      value: props.sloName || sloId.value || EMPTY,
      link: sloLinkable.value
        ? sloDetailRoute(sloId.value, store.state.selectedOrganization?.identifier)
        : undefined,
    },
    { key: "slo-kind", label: t("alerts.sloKind"), value: sloKindLabel.value },
    {
      key: "condition",
      label: t("alerts.groups.criticalCondition"),
      value: sloThreshold("critical"),
      mono: true,
    },
    {
      key: "warning",
      label: t("alerts.groups.warningCondition"),
      value: sloThreshold("warning"),
      mono: true,
    },
  ];
  // An error-budget condition carries no windows at all — the backend rejects
  // them — so rendering two more dashes would imply a knob that cannot exist.
  // Own labels rather than `slos.alert.long`/`.short`: those two read as inline
  // fragments in the SLO form's sentence ("in both windows — long … short …")
  // and land here as bare lowercase words next to "Critical condition".
  if (cond?.long_window_secs) {
    fields.push({
      key: "long-window",
      label: t("alerts.sloLongWindow"),
      value: burnWindowLabel(cond.long_window_secs) || EMPTY,
    });
  }
  if (cond?.short_window_secs) {
    fields.push({
      key: "short-window",
      label: t("alerts.sloShortWindow"),
      value: burnWindowLabel(cond.short_window_secs) || EMPTY,
    });
  }
  return fields;
});

// The GET falls back to the flat config row, which has none of the generic fields.
const isAnomalyConfig = computed(() => props.alert?.alert_type === "anomaly_detection");

const anomalyFiltersText = computed(() => {
  const filters = props.alert?.filters;
  if (!Array.isArray(filters)) return EMPTY;
  const parts = filters
    // Matches the SQL preview's guard, so the two agree on what counts as configured.
    .filter((f: any) => f?.field && (operatorNeedsValue(f.operator) ? f.value : true))
    .map((f: any) => buildAnomalyFilterExpression(f.field, f.operator, f.value))
    .filter(Boolean);
  return parts.length ? parts.join(" AND ") : EMPTY;
});

const anomalyTimestamp = (us: unknown): string => {
  const n = Number(us);
  if (!Number.isFinite(n) || n <= 0) return EMPTY;
  try {
    // formatInTimeZone throws on a bad zone; inside a computed that blanks the tab.
    return formatTimestampInTimezone(n, "YYYY-MM-DD HH:mm:ss", store.state.timezone || "UTC");
  } catch {
    return EMPTY;
  }
};

const anomalySourceFields = computed(() => {
  const a = props.alert;
  const customSql = a?.query_mode === "custom_sql";
  const fields: Record<string, any>[] = [
    { key: "stream", label: t("alerts.streamName"), value: a?.stream_name || EMPTY },
    { key: "stream-type", label: t("alerts.streamType"), value: a?.stream_type || EMPTY },
    {
      key: "query-mode",
      label: t("alerts.anomaly.queryMode"),
      value: customSql ? t("alerts.customSql") : t("alerts.anomaly.filters"),
    },
  ];
  // The modes are exclusive: the unused one's dash reads as a missing setting.
  if (customSql) {
    fields.push({
      key: "custom-sql",
      label: t("alerts.customSql"),
      value: a?.custom_sql || EMPTY,
      mono: true,
    });
  } else {
    fields.push(
      {
        key: "detection-function",
        label: t("alerts.detectionFunction"),
        value: a?.detection_function || EMPTY,
        mono: true,
      },
      {
        key: "filters",
        label: t("alerts.anomaly.filters"),
        value: anomalyFiltersText.value,
        mono: true,
      },
    );
  }
  // Stored as the percentile scored against; the form shows its complement.
  const percentile = isBlank(a?.threshold) ? NaN : Number(a.threshold);
  fields.push({
    key: "sensitivity",
    label: t("alerts.sensitivity"),
    value: Number.isFinite(percentile)
      ? t("alerts.anomaly.summaryThresholdRate", { rate: 100 - percentile })
      : EMPTY,
  });
  return fields;
});

const anomalyScheduleFields = computed(() => {
  const a = props.alert;
  // Number(null) is 0, and 0 is the stored value for "retrain never".
  const retrainDays = isBlank(a?.retrain_interval_days) ? NaN : Number(a.retrain_interval_days);
  const trainingDays = isBlank(a?.training_window_days) ? NaN : Number(a.training_window_days);
  return [
    {
      key: "schedule-interval",
      label: t("alerts.anomaly.checkEvery"),
      value: a?.schedule_interval || EMPTY,
    },
    {
      key: "histogram-interval",
      label: t("alerts.anomaly.detectionResolution"),
      value: a?.histogram_interval || EMPTY,
    },
    {
      key: "detection-window",
      label: t("alerts.anomaly.lookBackWindow"),
      value: burnWindowLabel(a?.detection_window_seconds) || EMPTY,
    },
    {
      key: "training-window",
      label: t("alerts.trainingWindow"),
      value: Number.isFinite(trainingDays)
        ? t("alerts.anomaly.nDays", { days: trainingDays }, trainingDays)
        : EMPTY,
    },
    {
      key: "retrain-interval",
      label: t("alerts.anomaly.retrainEvery"),
      value: !Number.isFinite(retrainDays)
        ? EMPTY
        : retrainDays === 0
          ? t("alerts.anomaly.retrainNever")
          : t("alerts.anomaly.nDays", { days: retrainDays }, retrainDays),
    },
    {
      key: "notifications",
      label: t("alerts.anomaly.notifications"),
      value: a?.alert_enabled ? t("alerts.anomaly.enabled") : t("alerts.anomaly.disabled"),
    },
    {
      key: "destinations",
      // Anomaly configs deliver through `alert_destinations`, not `destinations`.
      label: t("alerts.destination"),
      value:
        Array.isArray(a?.alert_destinations) && a.alert_destinations.length
          ? a.alert_destinations.join(", ")
          : EMPTY,
    },
  ];
});

const anomalyModelFields = computed(() => {
  const a = props.alert;
  const fields: Record<string, any>[] = [
    {
      key: "status",
      label: t("alerts.status"),
      value: a?.status || EMPTY,
      // The same badge the list renders, so one status does not read two ways.
      badge: a?.status ? "alertStatus" : undefined,
    },
    {
      key: "last-trained",
      label: t("alerts.anomaly.lastTrained"),
      value: anomalyTimestamp(a?.training_completed_at),
    },
    {
      key: "model-version",
      label: t("alerts.anomaly.modelVersion"),
      // The column is NOT NULL and created as 0, so a never-trained config has
      // a version number without having a model.
      value: Number(a?.current_model_version) > 0 ? String(a.current_model_version) : EMPTY,
    },
  ];
  // A permanent empty row implies an error slot worth watching on a healthy model.
  if (a?.last_error) {
    fields.push({ key: "last-error", label: t("alerts.anomaly.lastError"), value: a.last_error });
  }
  return fields;
});

const anomalySections = computed(() => [
  { key: "source", title: t("alerts.configuration"), fields: anomalySourceFields.value },
  { key: "schedule", title: t("alerts.groups.schedule"), fields: anomalyScheduleFields.value },
  { key: "model", title: t("alerts.anomaly.model"), fields: anomalyModelFields.value },
]);

const genericSections = computed(() => [
  {
    key: "source",
    title: t("alerts.configuration"),
    fields: isSloAlertConfig.value
      ? sloFields.value
      : [
          {
            key: "stream",
            label: t("alerts.streamName"),
            value: props.alert?.stream_name || EMPTY,
          },
          {
            key: "stream-type",
            label: t("alerts.streamType"),
            value: props.alert?.stream_type || EMPTY,
          },
          {
            key: "condition",
            label: t("alerts.groups.criticalCondition"),
            value: conditionText.value,
            mono: true,
          },
          {
            key: "warning",
            label: t("alerts.groups.warningCondition"),
            value: warningText.value,
            mono: true,
          },
          {
            key: "group-by",
            label: t("alerts.groups.groupBy"),
            value: aggregation.value?.group_by?.length
              ? aggregation.value.group_by.join(", ")
              : EMPTY,
            mono: true,
          },
          {
            key: "evaluation-mode",
            label: t("alerts.multiAlert.evaluationMode"),
            // Type-scoped like the backend `multi_alert_enabled()`: PromQL reads
            // promql_multi_alert (→ per-series), every other type reads
            // aggregation.multi_alert (→ per-group); otherwise simple. Branching on
            // type avoids a stale flag from the other family mislabelling the mode.
            value:
              queryCondition.value?.type === "promql"
                ? queryCondition.value?.promql_multi_alert
                  ? t("alerts.multiAlert.perSeries")
                  : t("alerts.multiAlert.simple")
                : aggregation.value?.multi_alert
                  ? t("alerts.multiAlert.perGroup")
                  : t("alerts.multiAlert.simple"),
          },
        ],
  },
  {
    key: "schedule",
    title: t("alerts.groups.schedule"),
    fields: [
      // `period` parameterizes a query time range. `evaluate_slo_alert` never
      // reads it and the SLO form does not offer it — the value stored is a
      // filler the request model demands — so showing it would advertise a
      // look-back window this family does not have.
      ...(isSloAlertConfig.value
        ? []
        : [
            {
              key: "period",
              label: t("alerts.period"),
              value: props.alert?.trigger_condition?.period ?? EMPTY,
            },
          ]),
      {
        key: "frequency",
        label: t("alerts.frequency"),
        value: props.alert?.trigger_condition?.frequency ?? EMPTY,
      },
      {
        key: "silence",
        label: t("alerts.silence"),
        value: props.alert?.trigger_condition?.silence ?? EMPTY,
      },
      {
        key: "destinations",
        label: t("alerts.destination"),
        value: props.alert?.destinations?.length ? props.alert.destinations.join(", ") : EMPTY,
      },
    ],
  },
]);

const sections = computed(() =>
  isAnomalyConfig.value ? anomalySections.value : genericSections.value,
);
</script>
