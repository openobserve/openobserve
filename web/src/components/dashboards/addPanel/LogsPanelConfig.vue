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

<template>
  <div class="flex flex-col gap-2.5">
    <template v-if="isOptionVisible('logs-fields')">
      <OCombobox
        v-for="field in fieldControls"
        :key="field.key"
        :label="field.label"
        :model-value="config[field.key] ?? ''"
        :items="queryFieldOptions"
        :placeholder="defaultFromData(t)"
        :data-test="`dashboard-config-${field.key}`"
        @update:model-value="(value: string) => setTextConfig(field.key, value)"
      >
        <template #tooltip>
          <OTooltip :content="t('dashboard.htmlPanelFieldTooltip')" max-width="15.625rem" />
        </template>
      </OCombobox>
    </template>
    <OSelect
      v-show="isOptionVisible('logs-order')"
      v-model="orderModel"
      :label="t('dashboard.logsOrder')"
      :options="orderOptions"
      data-test="dashboard-config-logs_order"
    >
      <template #tooltip>
        <OTooltip :content="t('dashboard.logsOrderTooltip')" max-width="15.625rem" />
      </template>
    </OSelect>
    <OSwitch
      v-show="isOptionVisible('logs-show-time')"
      :model-value="config.logs_show_time !== false"
      :label="t('dashboard.logsShowTime')"
      data-test="dashboard-config-logs_show_time"
      size="lg"
      @update:model-value="(value: any) => setDefaultOnFlag('logs_show_time', value)"
    />
    <OSwitch
      v-show="isOptionVisible('logs-wrap')"
      :model-value="config.logs_wrap === true"
      :label="t('dashboard.logsWrap')"
      data-test="dashboard-config-logs_wrap"
      size="lg"
      @update:model-value="(value: any) => setFlagConfig('logs_wrap', value)"
    />
    <OSwitch
      v-show="isOptionVisible('logs-prettify-json')"
      :model-value="config.logs_prettify_json !== false"
      :label="t('dashboard.logsPrettifyJson')"
      data-test="dashboard-config-logs_prettify_json"
      size="lg"
      @update:model-value="(value: any) => setDefaultOnFlag('logs_prettify_json', value)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { DEFAULT_CHOICE, useHtmlPanelConfig } from "@/composables/dashboard/useHtmlPanelConfig";
import { orderLogsStarter } from "@/composables/dashboard/usePanelAggregation";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import {
  DEFAULT_LOGS_ORDER,
  LOGS_ORDERS,
  type LogsOrder,
} from "@/utils/dashboard/convertLogsPanelData";
import { defaultFromData, withDefaultChoice } from "@/utils/dashboard/optionDefaults";

withDefaults(defineProps<{ isOptionVisible?: (optionId: string) => boolean }>(), {
  isOptionVisible: () => true,
});

const { t } = useI18nTyped();
const pageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { dashboardPanelData } = useDashboardPanelData(pageKey, t);
const { config, setTextConfig, setFlagConfig, setDefaultOnFlag, choiceModel, queryFieldOptions } =
  useHtmlPanelConfig(dashboardPanelData);

const fieldControls = computed<{ key: string; label: I18nText }[]>(() => [
  { key: "logs_message_field", label: t("dashboard.logsMessageField") },
  { key: "logs_level_field", label: t("dashboard.logsLevelField") },
  { key: "logs_time_field", label: t("dashboard.logsTimeField") },
]);
const storedOrder = choiceModel<LogsOrder>("logs_order", LOGS_ORDERS);
const orderModel = computed({
  get: () => storedOrder.value,
  set: (value: string) => {
    storedOrder.value = value;
    const stored = config.value.logs_order;
    const order: LogsOrder = LOGS_ORDERS.includes(stored) ? stored : DEFAULT_LOGS_ORDER;
    dashboardPanelData.data.queries?.forEach((query: any) => {
      if (query?.customQuery) orderLogsStarter(query, order);
    });
  },
});
const orderOptions = withDefaultChoice(
  t,
  DEFAULT_CHOICE,
  [
    { label: t("dashboard.logsOrderNewest"), value: "newest" as LogsOrder },
    { label: t("dashboard.logsOrderOldest"), value: "oldest" as LogsOrder },
  ],
  DEFAULT_LOGS_ORDER,
);
</script>
