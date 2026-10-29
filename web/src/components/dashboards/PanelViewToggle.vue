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
  <OToggleGroup
    :model-value="modelValue"
    :aria-label="t('panel.previewView')"
    :data-test="`${dataTestPrefix}-preview-view-toggle`"
    @update:model-value="(v) => emit('update:modelValue', v as PanelPreviewView)"
  >
    <OToggleGroupItem
      value="chart"
      size="xs"
      icon-left="show-chart"
      :tooltip="iconOnly ? t('panel.previewChart') : undefined"
      :aria-label="iconOnly ? t('panel.previewChart') : undefined"
      :data-test="`${dataTestPrefix}-preview-view-chart`"
      ><template v-if="!iconOnly">{{ t("panel.previewChart") }}</template></OToggleGroupItem
    >
    <OToggleGroupItem
      value="data"
      size="xs"
      icon-left="table-chart"
      :tooltip="iconOnly ? t('panel.previewData') : undefined"
      :aria-label="iconOnly ? t('panel.previewData') : undefined"
      :data-test="`${dataTestPrefix}-preview-view-data`"
      ><template v-if="!iconOnly">{{ t("panel.previewData") }}</template></OToggleGroupItem
    >
  </OToggleGroup>
</template>

<script setup lang="ts">
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { PanelPreviewView } from "@/composables/dashboard/usePanelDataView";
import { useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    modelValue: PanelPreviewView;
    dataTestPrefix: string;
    iconOnly?: boolean;
  }>(),
  { iconOnly: false },
);

const emit = defineEmits<{ "update:modelValue": [value: PanelPreviewView] }>();

const { t } = useI18nTyped();
</script>
