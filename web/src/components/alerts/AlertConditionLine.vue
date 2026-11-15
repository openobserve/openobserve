<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!-- What the alert watches, on one line under the header: the Configuration tab holds the rest. -->
<template>
  <dl
    class="m-0 flex min-w-0 items-start gap-6 max-md:flex-wrap max-md:gap-x-4 max-md:gap-y-2"
    :aria-label="t('alerts.detail.conditionLabel')"
    data-test="alerts-alertdetail-condition"
  >
    <div
      v-for="item in items"
      :key="item.key"
      class="flex min-w-0 flex-col gap-0.5"
      :class="item.key === 'query' ? 'flex-1 max-md:basis-full' : 'shrink-0'"
      :data-test="`alerts-alertdetail-condition-${item.key}`"
    >
      <dt class="text-text-secondary text-xs">{{ item.label }}</dt>
      <dd class="text-compact text-text-heading m-0 min-w-0" :class="item.mono ? 'font-mono' : ''">
        <OTruncatedText>{{ item.value }}</OTruncatedText>
      </dd>
    </div>
    <div
      v-if="showIncident"
      class="flex min-w-0 shrink-0 flex-col gap-0.5"
      data-test="alerts-alertdetail-condition-incident"
    >
      <dt class="text-text-secondary text-xs">{{ t("alerts.firingState.incident") }}</dt>
      <dd class="text-compact m-0 max-w-60 min-w-0">
        <router-link
          v-if="incident"
          :to="incidentRoute"
          class="block min-w-0"
          data-test="alerts-alertdetail-incident-link"
        >
          <OTruncatedText>{{ incident.title || incident.id }}</OTruncatedText>
        </router-link>
        <span v-else class="text-text-muted" data-test="alerts-alertdetail-no-incident">{{
          t("alerts.detail.noIncident")
        }}</span>
      </dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import {
  alertFilterText,
  alertThresholdText,
  formatAlertMinutes,
} from "@/utils/alerts/alertCondition";

interface ConditionItem {
  key: string;
  label: I18nText;
  value: I18nText;
  mono?: boolean;
}

const props = defineProps<{
  alert: any;
  /** The alert's open incident, from its list row. */
  incident?: { id: string; title?: string | null } | null;
  /** Only a firing alert can have an incident, so the slot shows only then. */
  showIncident?: boolean;
  org: string;
}>();

const { t } = useI18nTyped();

const queryCondition = computed(() => props.alert?.query_condition ?? props.alert?.condition);

const queryText = computed<I18nText>(() => {
  const qc = queryCondition.value;
  if (qc?.type === "promql") return raw(qc.promql || "—");
  if (qc?.type === "sql") return raw(qc.sql || "—");
  return raw(alertFilterText(props.alert)) || t("alerts.detail.allRows");
});

const items = computed<ConditionItem[]>(() => {
  const trigger = props.alert?.trigger_condition ?? {};
  const list: ConditionItem[] = [
    { key: "query", label: t("common.query"), value: queryText.value, mono: true },
    {
      key: "threshold",
      label: t("alerts.detail.threshold"),
      value: raw(alertThresholdText(props.alert)),
      mono: true,
    },
  ];
  // A real-time alert runs on each event, so it has neither a window nor a cadence.
  if (String(props.alert?.is_real_time) === "true") return list;
  list.push({
    key: "window",
    label: t("alerts.period"),
    value: formatAlertMinutes(Number(trigger.period) || null, t),
  });
  list.push(
    trigger.frequency_type === "cron"
      ? {
          key: "frequency",
          label: t("alerts.frequency"),
          value: raw(trigger.cron || "—"),
          mono: true,
        }
      : {
          key: "frequency",
          label: t("alerts.frequency"),
          value: formatAlertMinutes(Number(trigger.frequency) || null, t),
        },
  );
  return list;
});

const incidentRoute = computed(() => ({
  name: "incidentDetail",
  params: { id: props.incident?.id ?? "" },
  query: { org_identifier: props.org },
}));
</script>
