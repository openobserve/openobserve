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

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

export type LatencyHeatmapColorBy = "spans" | "errors";

const props = withDefaults(defineProps<{ dataTest?: string }>(), {
  dataTest: "traces-latency-heatmap-color-toggle",
});
const colorBy = defineModel<LatencyHeatmapColorBy>({ default: "spans" });

const { t } = useI18nTyped();
</script>

<template>
  <OToggleGroup
    v-model="colorBy"
    :label="t('traces.latencyHeatmap.colorBy.label')"
    label-position="left"
    mobile-dropdown
    :data-test="props.dataTest"
  >
    <OToggleGroupItem value="spans" size="xs" :data-test="`${props.dataTest}-spans`">
      {{ t("traces.latencyHeatmap.colorBy.spans") }}
    </OToggleGroupItem>
    <OToggleGroupItem value="errors" size="xs" :data-test="`${props.dataTest}-errors`">
      {{ t("traces.latencyHeatmap.colorBy.errors") }}
    </OToggleGroupItem>
  </OToggleGroup>
</template>
