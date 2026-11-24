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
  <OSelect
    ref="selectRef"
    :model-value="current?.id"
    :options="options"
    :label="t('dashboard.chartTypes.select')"
    label-position="inside"
    trigger-only
    :expanded="expanded"
    data-test="dashboard-addpanel-chart-type-select"
    :data-test-selected-value="chartType"
    @trigger-click="emit('toggle')"
  >
    <template v-if="current" #icon-left>
      <img
        :src="chartTypeIconUrl(current)"
        alt=""
        class="size-4 scheme-light dark:scheme-dark"
        data-test="dashboard-addpanel-chart-type-select-icon"
      />
    </template>
  </OSelect>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { chartTypeIconUrl, findChartType } from "@/utils/dashboard/chartTypeCatalog";

const props = defineProps<{
  chartType: string;
  /** The chart-type list this select toggles is showing. */
  expanded?: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();

const { t } = useI18nTyped();

const selectRef = ref<InstanceType<typeof OSelect> | null>(null);

const current = computed(() => findChartType(props.chartType));

const options = computed(() =>
  current.value ? [{ label: t(current.value.labelKey), value: current.value.id }] : [],
);

defineExpose({ focus: () => selectRef.value?.focus() });
</script>
