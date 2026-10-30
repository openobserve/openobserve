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
  <div v-show="isOptionVisible('flame-graph-fields')" class="flex flex-col gap-2.5">
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
        <OTooltip :content="field.tooltip" max-width="15.625rem" />
      </template>
    </OCombobox>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { useHtmlPanelConfig } from "@/composables/dashboard/useHtmlPanelConfig";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { defaultFromData } from "@/utils/dashboard/optionDefaults";

withDefaults(defineProps<{ isOptionVisible?: (optionId: string) => boolean }>(), {
  isOptionVisible: () => true,
});

const { t } = useI18nTyped();
const pageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { dashboardPanelData } = useDashboardPanelData(pageKey, t);
const { config, setTextConfig, queryFieldOptions } = useHtmlPanelConfig(dashboardPanelData);

const fieldControls = computed<{ key: string; label: I18nText; tooltip: I18nText }[]>(() => [
  {
    key: "flame_graph_stack_field",
    label: t("dashboard.flameGraphStackField"),
    tooltip: t("dashboard.flameGraphStackFieldTooltip"),
  },
  {
    key: "flame_graph_value_field",
    label: t("dashboard.flameGraphValueField"),
    tooltip: t("dashboard.flameGraphValueFieldTooltip"),
  },
]);
</script>
