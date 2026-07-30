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
      <OCardSection>
        <h3 class="mb-3 text-lg text-text-heading">{{ section.title }}</h3>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div
            v-for="field in section.fields"
            :key="field.key"
            class="flex flex-col gap-1"
            :data-test="`alerts-alertconfigsummary-${field.key}`"
          >
            <dt class="text-2xs uppercase text-text-tertiary">
              {{ field.label }}
            </dt>
            <dd
              class="text-sm text-text-heading"
              :class="field.mono ? 'font-mono break-all' : ''"
            >
              {{ field.value }}
            </dd>
          </div>
        </dl>
      </OCardSection>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";

const props = defineProps<{ alert: any }>();

const { t } = useI18n();

const EMPTY = "—";

// The single-alert GET calls this `query_condition`; the list calls the same
// object `condition`. Accept either.
const queryCondition = computed(
  () => props.alert?.query_condition || props.alert?.condition,
);
const aggregation = computed(() => queryCondition.value?.aggregation);

const conditionText = computed(() => {
  const agg = aggregation.value;
  if (!agg) return queryCondition.value?.sql || EMPTY;
  const fn = agg.function || "";
  const col = agg.having?.column || "";
  const op = agg.having?.operator || "";
  const val = agg.having?.value;
  return `${fn}(${col}) ${op} ${val}`;
});

const warningText = computed(() => {
  const agg = aggregation.value;
  if (!agg || agg.warning_value === undefined || agg.warning_value === null) {
    return EMPTY;
  }
  const fn = agg.function || "";
  const col = agg.having?.column || "";
  const op = agg.having?.operator || "";
  return `${fn}(${col}) ${op} ${agg.warning_value}`;
});

const sections = computed(() => [
  {
    key: "source",
    title: t("alerts.configuration"),
    fields: [
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
        // Three shapes: per-series (PromQL opt-in), per-group (aggregation
        // opt-in), or simple.
        value: queryCondition.value?.promql_multi_alert
          ? t("alerts.multiAlert.perSeries")
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
      {
        key: "period",
        label: t("alerts.period"),
        value: props.alert?.trigger_condition?.period ?? EMPTY,
      },
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
        value: props.alert?.destinations?.length
          ? props.alert.destinations.join(", ")
          : EMPTY,
      },
    ],
  },
]);
</script>
