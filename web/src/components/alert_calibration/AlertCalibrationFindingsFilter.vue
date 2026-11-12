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
    mobile-dropdown
    class="shrink-0"
    data-test="alert-calibration-dashboard-findings-filter"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <OToggleGroupItem value="open" size="xs" data-test="alert-calibration-filter-open">{{
      t("alertCalibration.dismiss.filterOpen")
    }}</OToggleGroupItem>
    <OToggleGroupItem value="dismissed" size="xs" data-test="alert-calibration-filter-dismissed">{{
      dismissedLabel
    }}</OToggleGroupItem>
  </OToggleGroup>
</template>

<script setup lang="ts">
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

defineProps<{ modelValue: "open" | "dismissed"; dismissedLabel: I18nText }>();
const emit = defineEmits<{ "update:modelValue": [value: unknown] }>();
const { t } = useI18nTyped();
</script>
