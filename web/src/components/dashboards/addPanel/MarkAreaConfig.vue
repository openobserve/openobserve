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
  <div class="flex flex-col gap-2.5" data-test="dashboard-config-mark_area">
    <span class="text-compact text-input-label-text font-medium">{{
      t("dashboard.markAreas")
    }}</span>
    <div
      v-for="(area, index) in areas"
      :key="index"
      class="border-border-default flex justify-between gap-2 border-b pb-3"
      :data-test="`dashboard-config-mark-area-${index}`"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <OInput
          :model-value="area.name ?? ''"
          :label="t('dashboard.markLineLabel')"
          :data-test="`dashboard-config-mark-area-name-${index}`"
          @update:model-value="update(index, { name: String($event ?? '') })"
        />
        <OSelect
          :model-value="area.axis ?? 'x'"
          :label="t('dashboard.markAreaAxis')"
          :options="axisOptions"
          :data-test="`dashboard-config-mark-area-axis-${index}`"
          @update:model-value="update(index, { axis: ($event as string) ?? 'x' })"
        />
        <div class="flex gap-2">
          <OInput
            class="min-w-0 flex-1"
            :model-value="area.from ?? ''"
            :label="t('dashboard.markAreaFrom')"
            :data-test="`dashboard-config-mark-area-from-${index}`"
            @update:model-value="update(index, { from: String($event ?? '') })"
          />
          <OInput
            class="min-w-0 flex-1"
            :model-value="area.to ?? ''"
            :label="t('dashboard.markAreaTo')"
            :data-test="`dashboard-config-mark-area-to-${index}`"
            @update:model-value="update(index, { to: String($event ?? '') })"
          />
        </div>
        <ColorSwatchPicker
          :model-value="area.color ?? null"
          :swatches="swatches"
          :data-test="`dashboard-config-mark-area-color-${index}`"
          @update:model-value="update(index, { color: $event ?? null })"
        />
      </div>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="close"
        :aria-label="t('dashboard.markAreaRemove')"
        :data-test="`dashboard-config-mark-area-remove-${index}`"
        @click="remove(index)"
      />
    </div>
    <OButton
      variant="outline"
      size="sm"
      class="self-start"
      data-test="dashboard-config-mark-area-add"
      @click="add"
      >{{ t("dashboard.markAreaAdd") }}</OButton
    >
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ColorSwatchPicker from "../ColorSwatchPicker.vue";
import { getColorPalette } from "@/utils/dashboard/colorPalette";

interface MarkArea {
  name?: string | null;
  axis?: string | null;
  from?: string | null;
  to?: string | null;
  color?: string | null;
}

const PALETTE_SWATCHES = 8;

const { t } = useI18nTyped();
const store = useStore();
const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
const { dashboardPanelData } = useDashboardPanelData(dashboardPanelDataPageKey, t);

const axisOptions = [
  { label: t("dashboard.markLineXAxis"), value: "x" },
  { label: t("dashboard.markLineYAxis"), value: "y" },
];

const swatches = computed(() => {
  void store.state.theme;
  return getColorPalette().slice(0, PALETTE_SWATCHES);
});

const areas = computed<MarkArea[]>(() =>
  Array.isArray(dashboardPanelData.data.config.mark_area)
    ? dashboardPanelData.data.config.mark_area
    : [],
);

// The key is created on the first add, so a panel that never uses mark areas saves without it.
const write = (next: MarkArea[]) => {
  if (next.length) dashboardPanelData.data.config.mark_area = next;
  else delete dashboardPanelData.data.config.mark_area;
};

const add = () => write([...areas.value, { name: "", axis: "x", from: "", to: "", color: null }]);

const update = (index: number, patch: Partial<MarkArea>) =>
  write(areas.value.map((area, i) => (i === index ? { ...area, ...patch } : area)));

const remove = (index: number) => write(areas.value.filter((_, i) => i !== index));
</script>
