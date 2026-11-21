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
  <OButton
    v-if="current"
    variant="ghost"
    size="icon-sm"
    :aria-label="label"
    data-test="panel-editor-collapsed-chart-type"
    :data-test-selected-value="current.id"
  >
    <img :src="chartTypeIconUrl(current)" alt="" class="size-5 scheme-light dark:scheme-dark" />
    <OTooltip :content="label" side="right" />
  </OButton>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { chartTypeIconUrl, findChartType } from "@/utils/dashboard/chartTypeCatalog";

const props = defineProps<{ chartType: string }>();

const { t } = useI18nTyped();

const current = computed(() => findChartType(props.chartType));

const label = computed(() =>
  t("dashboard.chartTypes.changeChartType", {
    name: current.value ? t(current.value.labelKey) : "",
  }),
);
</script>
