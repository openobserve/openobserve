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
        :placeholder="t('dashboard.auto')"
        :data-test="`dashboard-config-${field.key}`"
        @update:model-value="(value: string) => setTextConfig(field.key, value)"
      >
        <template #tooltip>
          <OTooltip :content="t('dashboard.htmlPanelFieldTooltip')" max-width="15.625rem" />
        </template>
      </OCombobox>
    </template>
    <OToggleGroup
      v-show="isOptionVisible('logs-order')"
      type="single"
      label-position="top"
      :label="t('dashboard.logsOrder')"
      v-model="orderModel"
      data-test="dashboard-config-logs_order"
      :data-test-selected-value="orderModel"
    >
      <OToggleGroupItem
        v-for="opt in orderOptions"
        :key="opt.value"
        :value="opt.value"
        size="sm"
        data-test="dashboard-config-logs_order-option"
        :data-test-label="opt.label"
        >{{ opt.label }}</OToggleGroupItem
      >
    </OToggleGroup>
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
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { useHtmlPanelConfig } from "@/composables/dashboard/useHtmlPanelConfig";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { LOGS_ORDERS, type LogsOrder } from "@/utils/dashboard/convertLogsPanelData";

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
const orderModel = choiceModel<LogsOrder>("logs_order", LOGS_ORDERS, "newest");
const orderOptions: { label: I18nText; value: LogsOrder }[] = [
  { label: t("dashboard.logsOrderNewest"), value: "newest" },
  { label: t("dashboard.logsOrderOldest"), value: "oldest" },
];
</script>
