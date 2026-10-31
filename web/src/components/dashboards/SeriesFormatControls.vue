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
  <div class="divide-border-strong/8 divide-y" data-test="dashboard-series-format-controls">
    <div class="flex items-start gap-2 px-3 py-2">
      <span :class="[LABEL_CLASS, 'min-h-8']">{{ t("dashboard.seriesOverrideMatch") }}</span>
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <OToggleGroup
          type="single"
          class="self-start"
          :model-value="override.matchBy"
          :aria-label="t('dashboard.seriesOverrideMatch')"
          data-test="dashboard-series-format-match-by"
          @update:model-value="onMatchBy"
        >
          <OToggleGroupItem value="name" size="sm" data-test="dashboard-series-format-match-name">{{
            t("dashboard.seriesOverrideMatchExact")
          }}</OToggleGroupItem>
          <OToggleGroupItem
            value="regex"
            size="sm"
            data-test="dashboard-series-format-match-regex"
            >{{ t("dashboard.seriesOverrideMatchRegex") }}</OToggleGroupItem
          >
        </OToggleGroup>
        <OInput
          :model-value="override.value"
          :placeholder="matchPlaceholder"
          :error="!!patternErrorText"
          :error-message="patternErrorText"
          autocomplete="off"
          data-test="dashboard-series-format-match-value"
          @update:model-value="patch({ value: String($event ?? '') })"
        />
        <div
          v-if="matchState === 'noSeries'"
          class="text-2xs text-text-secondary flex items-start gap-1 leading-tight"
          data-test="dashboard-series-format-match-line"
          data-state="no-series"
        >
          <OIcon name="info-outline" size="xs" class="shrink-0" />
          <span>{{ t("dashboard.seriesFormattingNoSeries") }}</span>
        </div>
        <div
          v-else-if="matchState === 'none'"
          class="text-2xs rounded-default border-banner-warning-border bg-banner-warning-bg text-banner-warning-text flex items-start gap-1 border px-1.5 py-1 leading-tight"
          data-test="dashboard-series-format-match-line"
          data-state="none"
        >
          <OIcon name="warning-amber" size="xs" class="shrink-0" />
          <span>{{ t("dashboard.seriesOverrideNoMatch", { total: seriesNames.length }) }}</span>
        </div>
        <div
          v-else-if="matchState === 'some'"
          class="text-2xs text-status-positive flex min-w-0 items-start gap-1 leading-tight"
          data-test="dashboard-series-format-match-line"
          data-state="some"
        >
          <OIcon name="check-circle" size="xs" class="shrink-0" />
          <OTruncatedText class="min-w-0 flex-1">{{
            t("dashboard.seriesOverrideMatches", {
              count: matchedNames.length,
              total: seriesNames.length,
              names: matchedNames.join(", "),
            })
          }}</OTruncatedText>
        </div>
      </div>
    </div>

    <div class="flex items-start gap-2 px-3 py-2">
      <label :for="displayNameId" :class="[LABEL_CLASS, 'min-h-8']">{{
        t("dashboard.seriesOverrideDisplayName")
      }}</label>
      <div class="min-w-0 flex-1">
        <OInput
          :id="displayNameId"
          :model-value="override.displayName"
          :placeholder="t('dashboard.seriesOverrideDisplayNamePlaceholder')"
          autocomplete="off"
          data-test="dashboard-series-format-display-name"
          @update:model-value="patch({ displayName: String($event ?? '') })"
        />
      </div>
    </div>

    <div v-if="!isStateTimeline" class="flex items-start gap-2 px-3 py-2">
      <span :class="[LABEL_CLASS, 'min-h-8']">{{ t("dashboard.sectionValueFormatting") }}</span>
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div class="min-w-0 flex-[1_1_10rem]">
            <OSelect
              :model-value="override.unit"
              :options="unitOptions"
              data-test="dashboard-series-format-unit"
              @update:model-value="patch({ unit: ($event as string | null) ?? null })"
            />
          </div>
          <div class="flex max-w-full min-w-0 items-center gap-2">
            <label
              :for="decimalsId"
              class="o-input-label text-compact text-input-label-text leading-tight font-medium"
              data-test="dashboard-series-format-decimals-label"
              >{{ t("dashboard.decimals") }}</label
            >
            <div class="w-20 min-w-12 shrink">
              <OInput
                :id="decimalsId"
                type="number"
                :min="0"
                :max="20"
                :model-value="override.decimals"
                :placeholder="decimalsPlaceholder"
                data-test="dashboard-series-format-decimals"
                @update:model-value="patch({ decimals: String($event ?? '') })"
              />
            </div>
          </div>
        </div>
        <OInput
          v-if="override.unit === 'custom'"
          :model-value="override.unitCustom"
          :label="t('dashboard.customunitLabel')"
          data-test="dashboard-series-format-custom-unit"
          @update:model-value="patch({ unitCustom: String($event ?? '') })"
        />
        <div
          v-if="axisNote"
          class="text-2xs text-text-secondary flex items-start gap-1 leading-tight"
          data-test="dashboard-series-format-axis-note"
        >
          <OIcon name="info-outline" size="xs" class="shrink-0" />
          <span>{{ axisNote }}</span>
        </div>
      </div>
    </div>

    <div v-if="!isStateTimeline" class="flex items-start gap-2 px-3 py-2">
      <span :class="[LABEL_CLASS, 'min-h-5']">{{ t("dashboard.seriesOverrideColor") }}</span>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <ColorSwatchPicker
          :model-value="override.color"
          :swatches="colorSwatches"
          data-test="dashboard-series-format-color"
          @update:model-value="patch({ color: $event ?? null })"
        />
        <span
          v-if="!override.color"
          class="text-text-secondary text-xs"
          data-test="dashboard-series-format-color-caption"
          >{{ t("dashboard.seriesOverrideColorNone") }}</span
        >
      </div>
    </div>

    <template v-if="showStyle">
      <div class="flex items-start gap-2 px-3 py-2" data-test="dashboard-series-format-draw-row">
        <span :class="[LABEL_CLASS, 'min-h-8']">{{ t("dashboard.seriesStyleDrawAs") }}</span>
        <div class="min-w-0 flex-1">
          <OSelect
            :model-value="override.style.drawStyle"
            :options="drawStyleOptions"
            data-test="dashboard-series-format-draw-style"
            @update:model-value="patchStyle({ drawStyle: ($event as any) ?? null })"
          />
        </div>
      </div>

      <div
        v-if="drawsLine"
        class="flex items-start gap-2 px-3 py-2"
        data-test="dashboard-series-format-line-row"
      >
        <span :class="[LABEL_CLASS, 'min-h-8']">{{ t("dashboard.seriesStyleLine") }}</span>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div class="min-w-0 flex-[1_1_8rem]">
            <OSelect
              :model-value="override.style.lineStyle"
              :options="lineStyleOptions"
              :aria-label="t('dashboard.seriesStyleLineStyle')"
              data-test="dashboard-series-format-line-style"
              @update:model-value="patchStyle({ lineStyle: ($event as any) ?? null })"
            />
          </div>
          <div class="flex min-w-0 items-center gap-2">
            <label :for="lineWidthId" :class="INLINE_LABEL_CLASS">{{
              t("dashboard.seriesStyleLineWidth")
            }}</label>
            <div class="w-20 min-w-12 shrink">
              <OInput
                :id="lineWidthId"
                type="number"
                :min="0"
                :max="20"
                :model-value="override.style.lineWidth"
                :placeholder="lineWidthPlaceholder"
                data-test="dashboard-series-format-line-width"
                @update:model-value="patchStyle({ lineWidth: String($event ?? '') })"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-start gap-2 px-3 py-2" data-test="dashboard-series-format-fill-row">
        <label :for="fillOpacityId" :class="[LABEL_CLASS, 'min-h-8']">{{
          t("dashboard.seriesStyleFillOpacity")
        }}</label>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div class="w-24 min-w-12 shrink">
            <OInput
              :id="fillOpacityId"
              type="number"
              :min="0"
              :max="100"
              :model-value="override.style.fillOpacity"
              :placeholder="t('dashboard.seriesStylePanelDefault')"
              data-test="dashboard-series-format-fill-opacity"
              @update:model-value="patchStyle({ fillOpacity: String($event ?? '') })"
            />
          </div>
          <div v-if="drawsLine" class="min-w-0 flex-[1_1_8rem]">
            <OSelect
              :model-value="showPointsValue"
              :options="showPointsOptions"
              :aria-label="t('dashboard.seriesStyleShowPoints')"
              data-test="dashboard-series-format-show-points"
              @update:model-value="onShowPoints"
            />
          </div>
        </div>
      </div>

      <div class="flex items-start gap-2 px-3 py-2" data-test="dashboard-series-format-layout-row">
        <label :for="stackGroupId" :class="[LABEL_CLASS, 'min-h-8']">{{
          t("dashboard.seriesStyleStackGroup")
        }}</label>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div class="min-w-0 flex-[1_1_8rem]">
            <OInput
              :id="stackGroupId"
              :model-value="override.style.stackGroup"
              :placeholder="t('dashboard.seriesStyleStackGroupPlaceholder')"
              autocomplete="off"
              data-test="dashboard-series-format-stack-group"
              @update:model-value="patchStyle({ stackGroup: String($event ?? '') })"
            />
          </div>
          <div v-if="!isHorizontal" class="min-w-0 flex-[1_1_8rem]">
            <OSelect
              :model-value="override.style.yAxis"
              :options="yAxisOptions"
              :aria-label="t('dashboard.seriesStyleYAxis')"
              data-test="dashboard-series-format-y-axis"
              @update:model-value="patchStyle({ yAxis: ($event as any) ?? null })"
            />
          </div>
        </div>
      </div>

      <div class="flex items-start gap-2 px-3 py-2" data-test="dashboard-series-format-hide-row">
        <span :class="[LABEL_CLASS, 'min-h-5']">{{ t("dashboard.seriesStyleHideFrom") }}</span>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
          <OCheckbox
            v-for="target in HIDE_TARGETS"
            :key="target"
            :model-value="override.style.hideFrom[target]"
            :label="hideLabels[target]"
            :data-test="`dashboard-series-format-hide-${target}`"
            @update:model-value="onHideFrom(target, $event === true)"
          />
        </div>
      </div>

      <div
        class="flex items-start gap-2 px-3 py-2"
        data-test="dashboard-series-format-transform-row"
      >
        <span :class="[LABEL_CLASS, 'min-h-5']">{{ t("dashboard.seriesOverrideTransform") }}</span>
        <div class="min-w-0 flex-1">
          <OSwitch
            :model-value="override.style.transform === 'negative_y'"
            :label="t('dashboard.seriesOverrideNegativeY')"
            data-test="dashboard-series-format-transform"
            @update:model-value="patchStyle({ transform: $event ? 'negative_y' : null })"
          />
        </div>
      </div>
    </template>

    <div
      v-if="showThresholds"
      class="flex items-start gap-2 px-3 py-2"
      data-test="dashboard-series-format-thresholds"
    >
      <div class="flex w-24 shrink-0 flex-col gap-0.5">
        <span :class="[LABEL_CLASS, 'min-h-8']">{{ t("dashboard.thresholds") }}</span>
        <span
          v-if="!hasSteps"
          class="text-2xs text-text-secondary"
          data-test="dashboard-series-format-thresholds-inherit"
          >{{ t("dashboard.seriesOverrideThresholdsInherit") }}</span
        >
      </div>
      <div class="min-w-0 flex-1">
        <!-- Keyed per override: the editor holds unsaved mode/base picks that must not carry to another series. -->
        <ThresholdsConfig
          :key="override.id"
          :model-value="override.thresholds"
          :chart-type="chartType"
          :unit="effectiveUnit"
          :unit-custom="effectiveUnitCustom"
          :decimals="effectiveDecimals"
          :has-coloured-value-mappings="hasColouredValueMappings"
          @update:model-value="patch({ thresholds: $event })"
        />
      </div>
    </div>

    <div
      v-if="isStateTimeline"
      class="flex items-start gap-2 px-3 py-2"
      data-test="dashboard-series-format-value-mappings"
    >
      <span :class="[LABEL_CLASS, 'min-h-8']">{{ t("dashboard.valueMappingsTitle") }}</span>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <ValueMappingList
          :model-value="override.valueMappings ?? []"
          :pattern-errors="mappingPatternErrors"
          data-test-prefix="dashboard-series-override-value-mapping"
          @update:model-value="patch({ valueMappings: $event })"
          @remove="
            (index: number) =>
              patch({ valueMappings: (override.valueMappings ?? []).filter((_, i) => i !== index) })
          "
        />
        <OButton
          variant="outline"
          size="sm"
          class="self-start"
          data-test="dashboard-series-format-value-mapping-add"
          @click="addValueMapping"
          >{{ t("dashboard.valueMappingAddNew") }}</OButton
        >
      </div>
    </div>

    <div class="text-text-secondary px-3 py-2 text-xs" data-test="dashboard-series-format-rule">
      {{ t("dashboard.seriesOverrideRule") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ColorSwatchPicker from "./ColorSwatchPicker.vue";
import ThresholdsConfig from "./addPanel/ThresholdsConfig.vue";
import ValueMappingList from "./addPanel/ValueMappingList.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { SERIES_STYLE_CHART_TYPES } from "@/utils/dashboard/seriesStyleOverrides";
import { valueMappingPatternErrors } from "./addPanel/valueMappingErrors";
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import { matchesSeriesOverride } from "@/utils/dashboard/seriesOverrides";
import { getUnitOptions, type UnitOption } from "@/composables/dashboard/useColumnFormatting";
import { THRESHOLD_CHART_TYPES } from "@/composables/dashboard/useConfigPanel";
import { isRowTimeline } from "@/utils/dashboard/chartTypeGroups";
import {
  parseDecimals,
  seriesPatternError,
  type SeriesOverrideDraft,
  type SeriesStyleDraft,
} from "@/composables/dashboard/useSeriesFormatting";

const props = withDefaults(
  defineProps<{
    override: SeriesOverrideDraft;
    seriesNames?: string[];
    chartType?: string;
    panelUnit?: string | null;
    panelUnitCustom?: string | null;
    panelDecimals?: number | null;
    /** The panel's line width, shown as the line width placeholder. */
    panelLineWidth?: number | null;
    hasColouredValueMappings?: boolean;
  }>(),
  {
    seriesNames: () => [],
    chartType: "line",
    panelUnit: null,
    panelUnitCustom: null,
    panelDecimals: null,
    panelLineWidth: null,
    hasColouredValueMappings: false,
  },
);

const emit = defineEmits<{ update: [patch: Partial<SeriesOverrideDraft>] }>();

const LABEL_CLASS =
  "o-input-label text-compact text-input-label-text flex w-24 shrink-0 items-center leading-tight font-medium";
const AXIS_CHART_TYPES = [
  "line",
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
  "scatter",
];
const INLINE_LABEL_CLASS =
  "o-input-label text-compact text-input-label-text leading-tight font-medium";
const HIDE_TARGETS = ["chart", "legend", "tooltip"] as const;
const BAR_CHART_TYPES = ["bar", "h-bar", "stacked", "h-stacked"];
const DEFAULT_LINE_WIDTH = 1.5;
const PALETTE_SWATCHES = 8;
const DEFAULT_DECIMALS = 2;

const { t } = useI18nTyped();
const store = useStore();
const displayNameId = useId();
const decimalsId = useId();
const lineWidthId = useId();
const fillOpacityId = useId();
const stackGroupId = useId();

const patch = (changes: Partial<SeriesOverrideDraft>) => emit("update", changes);

const patchStyle = (changes: Partial<SeriesStyleDraft>) =>
  patch({ style: { ...props.override.style, ...changes } });

const showStyle = computed(() => SERIES_STYLE_CHART_TYPES.has(props.chartType));
const isHorizontal = computed(() => props.chartType === "h-bar" || props.chartType === "h-stacked");
// Bar panels draw bars unless an override draws the series as a line.
const drawsLine = computed(() => {
  const draw = props.override.style.drawStyle;
  return draw ? draw === "line" : !BAR_CHART_TYPES.includes(props.chartType);
});

const panelDefaultOption = () => ({ label: t("dashboard.seriesStylePanelDefault"), value: null });

const drawStyleOptions = computed(() => [
  panelDefaultOption(),
  { label: t("dashboard.seriesStyleDrawLine"), value: "line" },
  { label: t("dashboard.seriesStyleDrawBars"), value: "bars" },
  { label: t("dashboard.seriesStyleDrawPoints"), value: "points" },
]);

const lineStyleOptions = computed(() => [
  panelDefaultOption(),
  { label: t("dashboard.seriesStyleLineSolid"), value: "solid" },
  { label: t("dashboard.seriesStyleLineDashed"), value: "dashed" },
  { label: t("dashboard.seriesStyleLineDotted"), value: "dotted" },
]);

const showPointsOptions = computed(() => [
  { label: t("dashboard.seriesStylePointsDefault"), value: null },
  { label: t("dashboard.seriesStylePointsShow"), value: "show" },
  { label: t("dashboard.seriesStylePointsHide"), value: "hide" },
]);

const showPointsValue = computed(() => {
  const value = props.override.style.showPoints;
  return value === null ? null : value ? "show" : "hide";
});

const onShowPoints = (value: unknown) =>
  patchStyle({ showPoints: value === "show" ? true : value === "hide" ? false : null });

const yAxisOptions = computed(() => [
  { label: t("dashboard.seriesStyleYAxisDefault"), value: null },
  { label: t("dashboard.seriesStyleYAxisLeft"), value: "left" },
  { label: t("dashboard.seriesStyleYAxisRight"), value: "right" },
  { label: t("dashboard.seriesOverrideAxisHidden"), value: "hidden" },
]);

const hideLabels = computed(() => ({
  chart: t("dashboard.seriesStyleHideChart"),
  legend: t("dashboard.seriesStyleHideLegend"),
  tooltip: t("dashboard.seriesStyleHideTooltip"),
}));

const onHideFrom = (target: (typeof HIDE_TARGETS)[number], value: boolean) =>
  patchStyle({ hideFrom: { ...props.override.style.hideFrom, [target]: value } });

const lineWidthPlaceholder = computed(() =>
  raw(String(props.panelLineWidth ?? DEFAULT_LINE_WIDTH)),
);

const onMatchBy = (value: unknown) => {
  if (value === "name" || value === "regex") patch({ matchBy: value });
};

const matchPlaceholder = computed(() =>
  props.override.matchBy === "regex"
    ? t("dashboard.seriesOverridePatternPlaceholder", { example: raw("^checkout|-canary$") })
    : t("dashboard.seriesOverrideNamePlaceholder"),
);

const patternErrorText = computed<I18nText | undefined>(() => {
  const error = seriesPatternError(props.override);
  if (error === "tooLong") return t("dashboard.valueMappingRegexTooLong");
  if (error === "unsupported") return t("dashboard.valueMappingRegexUnsupported");
  return undefined;
});

const matchedNames = computed(() =>
  props.seriesNames.filter((name) =>
    matchesSeriesOverride(name, { matchBy: props.override.matchBy, value: props.override.value }),
  ),
);

const matchState = computed<"noSeries" | "none" | "some" | null>(() => {
  if (patternErrorText.value || props.override.value === "") return null;
  if (!props.seriesNames.length) return "noSeries";
  return matchedNames.value.length ? "some" : "none";
});

const unitOptionsFor = (unit: string | null | undefined): UnitOption[] =>
  getUnitOptions(t, unit ?? null);

const isUnitOption = (option: UnitOption, unit: string | null | undefined) =>
  !option.header && !option.expandable && (option.value ?? null) === (unit || null);

const unitLabel = (unit: string | null | undefined, unitCustom: string | null | undefined) => {
  if (unit === "custom" && unitCustom) return raw(unitCustom);
  return unitOptionsFor(unit).find((o) => isUnitOption(o, unit))?.label ?? raw(unit ?? "");
};

// The group headers of the Unit list are the unit families.
const unitFamily = (unit: string | null | undefined): number => {
  let family = -1;
  for (const option of unitOptionsFor(unit)) {
    if (option.header) family++;
    else if (isUnitOption(option, unit)) return family;
  }
  return -1;
};

const panelUnitLabel = computed(() => unitLabel(props.panelUnit, props.panelUnitCustom));

const unitOptions = computed<UnitOption[]>(() =>
  unitOptionsFor(props.override.unit).map((option) =>
    !option.header && option.value === null
      ? {
          ...option,
          label: t("dashboard.seriesOverrideUnitInherit", { unit: panelUnitLabel.value }),
        }
      : option,
  ),
);

const axisNote = computed<I18nText | null>(() => {
  const unit = props.override.unit;
  if (!unit || !AXIS_CHART_TYPES.includes(props.chartType)) return null;
  const overrideFamily = unitFamily(unit);
  const panelFamily = unitFamily(props.panelUnit);
  if (overrideFamily < 0 || panelFamily < 0 || overrideFamily === panelFamily) return null;
  return t("dashboard.seriesOverrideAxisNote", { unit: panelUnitLabel.value });
});

const decimalsPlaceholder = computed(() =>
  raw(String(parseDecimals(props.panelDecimals) ?? DEFAULT_DECIMALS)),
);

const colorSwatches = computed(() => {
  void store.state.theme;
  return getColorPalette().slice(0, PALETTE_SWATCHES);
});

const showThresholds = computed(() => THRESHOLD_CHART_TYPES.includes(props.chartType));
// State timeline rows colour each value, so a row unit, decimals and colour do not apply.
const isStateTimeline = computed(() => isRowTimeline(props.chartType));

const addValueMapping = () =>
  patch({
    valueMappings: [
      ...(props.override.valueMappings ?? []),
      { type: "value", value: "", pattern: "", from: "", to: "", text: "", color: null },
    ],
  });

const mappingPatternErrors = computed(() =>
  valueMappingPatternErrors(props.override.valueMappings, t),
);
const hasSteps = computed(() => !!props.override.thresholds?.steps?.length);
const effectiveUnit = computed(() => props.override.unit ?? props.panelUnit ?? null);
const effectiveUnitCustom = computed(() =>
  props.override.unit ? props.override.unitCustom : (props.panelUnitCustom ?? null),
);
const effectiveDecimals = computed(
  () => parseDecimals(props.override.decimals) ?? props.panelDecimals ?? null,
);
</script>
