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
    <OSwitch
      :model-value="model.enabled"
      size="lg"
      data-test="dashboard-config-sparkline-enable"
      @update:model-value="(v) => patch({ enabled: !!v })"
    >
      <template #label>{{ t("dashboard.sparklineEnable") }}</template>
    </OSwitch>

    <template v-if="model.enabled">
      <OSelect
        :model-value="model.type"
        :options="typeOptions"
        :label="t('dashboard.sparklineType')"
        data-test="dashboard-config-sparkline-type"
        @update:model-value="(v) => patch({ type: String(v) })"
      />
      <OSelect
        :model-value="model.layout"
        :options="layoutOptions"
        :label="t('dashboard.sparklineLayout')"
        data-test="dashboard-config-sparkline-layout"
        @update:model-value="(v) => patch({ layout: String(v) })"
      />
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <span
          class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
          >{{ t("dashboard.sparklineColor") }}</span
        >
        <ColorSwatchPicker
          :model-value="model.color"
          :swatches="TEXT_SWATCHES"
          data-test="dashboard-config-sparkline-color"
          @update:model-value="(v) => patch({ color: v })"
        />
      </div>
      <OInput
        v-if="model.type === 'area'"
        :model-value="String(model.fillOpacity ?? '')"
        type="number"
        :label="t('dashboard.sparklineFillOpacity')"
        data-test="dashboard-config-sparkline-fill-opacity"
        @update:model-value="onFillOpacityInput"
        @blur="normalizeFillOpacity"
      />
      <OInput
        v-if="model.type !== 'bar'"
        :model-value="String(model.lineWidth ?? '')"
        type="number"
        :label="t('dashboard.sparklineLineWidth')"
        data-test="dashboard-config-sparkline-line-width"
        @update:model-value="onLineWidthInput"
        @blur="normalizeLineWidth"
      />
    </template>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { computed, defineComponent, inject } from "vue";
import { useI18n } from "vue-i18n";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ColorSwatchPicker from "../ColorSwatchPicker.vue";
import { TEXT_SWATCHES } from "@/composables/dashboard/useColumnFormatting";

// Default sparkline shape; `config.sparkline` stays null until the user interacts.
const DEFAULTS = {
  enabled: false,
  type: "area",
  layout: "bottom",
  color: null as string | null,
  fillOpacity: 0.15,
  lineWidth: 1,
};

export default defineComponent({
  name: "SparklineConfig",
  components: { OSwitch, OSelect, OInput, ColorSwatchPicker },
  setup() {
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { dashboardPanelData } = useDashboardPanelData(dashboardPanelDataPageKey);
    const { t } = useI18n();

    const model = computed(() => dashboardPanelData.data.config.sparkline ?? DEFAULTS);
    const patch = (p: Record<string, any>) => {
      dashboardPanelData.data.config.sparkline = {
        ...(dashboardPanelData.data.config.sparkline ?? DEFAULTS),
        ...p,
      };
    };

    const typeOptions = [
      { label: t("dashboard.sparklineTypeLine"), value: "line" },
      { label: t("dashboard.sparklineTypeArea"), value: "area" },
      { label: t("dashboard.sparklineTypeBar"), value: "bar" },
    ];
    const layoutOptions = [
      { label: t("dashboard.sparklineLayoutBottom"), value: "bottom" },
      { label: t("dashboard.sparklineLayoutBackground"), value: "background" },
    ];
    const clamp01 = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0));

    // Live-apply while typing: a valid number is stored (and re-rendered)
    // immediately; an empty field is stored as "" so it shows blank while
    // editing (the renderer falls back to the default for a non-number).
    const onFillOpacityInput = (v: unknown) => {
      const s = String(v ?? "").trim();
      patch({ fillOpacity: s === "" ? "" : clamp01(s) });
    };
    const onLineWidthInput = (v: unknown) => {
      const s = String(v ?? "").trim();
      patch({ lineWidth: s === "" ? "" : Number(s) || DEFAULTS.lineWidth });
    };

    // Empty/invalid field → reset to the default on blur (mirrors the decimals
    // config), so the input shows AND stores the default instead of blank.
    const normalizeFillOpacity = () => {
      if (String(model.value.fillOpacity ?? "").trim() === "") {
        patch({ fillOpacity: DEFAULTS.fillOpacity });
      }
    };
    const normalizeLineWidth = () => {
      if (String(model.value.lineWidth ?? "").trim() === "") {
        patch({ lineWidth: DEFAULTS.lineWidth });
      }
    };

    return {
      t,
      model,
      patch,
      typeOptions,
      layoutOptions,
      TEXT_SWATCHES,
      onFillOpacityInput,
      onLineWidthInput,
      normalizeFillOpacity,
      normalizeLineWidth,
    };
  },
});
</script>
