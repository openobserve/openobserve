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
        @update:model-value="(v) => patch({ type: v ?? null })"
      />
      <OSelect
        :model-value="model.layout"
        :options="layoutOptions"
        :label="t('dashboard.sparklineLayout')"
        data-test="dashboard-config-sparkline-layout"
        @update:model-value="(v) => patch({ layout: v ?? null })"
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
      <div v-if="effectiveType !== 'bar'" class="flex gap-2.5">
        <div class="min-w-0 flex-1">
          <OInput
            :model-value="String(model.lineWidth ?? METRIC_SPARKLINE.lineWidth)"
            type="number"
            :label="t('dashboard.sparklineLineWidth')"
            data-test="dashboard-config-sparkline-line-width"
            @update:model-value="onLineWidthInput"
            @blur="normalizeLineWidth"
          />
        </div>
        <div v-if="effectiveType === 'area'" class="min-w-0 flex-1">
          <OInput
            :model-value="String(model.fillOpacity ?? METRIC_SPARKLINE.fillOpacity)"
            type="number"
            :label="t('dashboard.sparklineFillOpacity')"
            data-test="dashboard-config-sparkline-fill-opacity"
            @update:model-value="onFillOpacityInput"
            @blur="normalizeFillOpacity"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { computed, defineComponent, h, inject, markRaw } from "vue";
import { useI18n } from "vue-i18n";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import SparklineLayoutIcon from "./SparklineLayoutIcon.vue";
import SparklineTypeIcon from "./SparklineTypeIcon.vue";
import ColorSwatchPicker from "../ColorSwatchPicker.vue";
import { TEXT_SWATCHES } from "@/composables/dashboard/useColumnFormatting";
import { METRIC_SPARKLINE } from "@/utils/dashboard/sql/charts/convertSQLMetricChart";

// Default sparkline shape; `config.sparkline` stays null until the user interacts.
const DEFAULTS = {
  enabled: false,
  type: null as string | null,
  layout: null as string | null,
  color: null as string | null,
  fillOpacity: null as number | null,
  lineWidth: null as number | null,
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

    // "Auto" stores null; the renderer resolves it to the current default (area).
    const effectiveType = computed(() => model.value.type ?? "area");
    // Per-option preview icon (OSelect renders `iconComponent` without props).
    const typeIcon = (type: string | null) =>
      markRaw({ render: () => h(SparklineTypeIcon, { type }) });
    const typeOptions = [
      { label: t("dashboard.sparklineTypeAuto"), value: null, iconComponent: typeIcon(null) },
      { label: t("dashboard.sparklineTypeLine"), value: "line", iconComponent: typeIcon("line") },
      { label: t("dashboard.sparklineTypeArea"), value: "area", iconComponent: typeIcon("area") },
      { label: t("dashboard.sparklineTypeBar"), value: "bar", iconComponent: typeIcon("bar") },
    ];

    // Per-option preview icon: bind the layout into SparklineLayoutIcon (OSelect
    // renders `iconComponent` without props). Auto (null) resolves to bottom, so
    // it uses the same preview.
    const layoutIcon = (layout: string | null) =>
      markRaw({ render: () => h(SparklineLayoutIcon, { layout }) });
    const layoutOptions = [
      { label: t("dashboard.auto"), value: null, iconComponent: layoutIcon(null) },
      { label: t("dashboard.bottom"), value: "bottom", iconComponent: layoutIcon("bottom") },
      {
        label: t("dashboard.sparklineLayoutBackground"),
        value: "background",
        iconComponent: layoutIcon("background"),
      },
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
      effectiveType,
      patch,
      typeOptions,
      layoutOptions,
      METRIC_SPARKLINE,
      TEXT_SWATCHES,
      onFillOpacityInput,
      onLineWidthInput,
      normalizeFillOpacity,
      normalizeLineWidth,
    };
  },
});
</script>
