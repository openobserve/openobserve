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

    <div class="flex items-start gap-2 px-3 py-2">
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

    <div class="flex items-start gap-2 px-3 py-2">
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
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import { matchesSeriesOverride } from "@/utils/dashboard/seriesOverrides";
import { getUnitOptions, type UnitOption } from "@/composables/dashboard/useColumnFormatting";
import { THRESHOLD_CHART_TYPES } from "@/composables/dashboard/useConfigPanel";
import {
  parseDecimals,
  seriesPatternError,
  type SeriesOverrideDraft,
} from "@/composables/dashboard/useSeriesFormatting";

const props = withDefaults(
  defineProps<{
    override: SeriesOverrideDraft;
    seriesNames?: string[];
    chartType?: string;
    panelUnit?: string | null;
    panelUnitCustom?: string | null;
    panelDecimals?: number | null;
    hasColouredValueMappings?: boolean;
  }>(),
  {
    seriesNames: () => [],
    chartType: "line",
    panelUnit: null,
    panelUnitCustom: null,
    panelDecimals: null,
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
const PALETTE_SWATCHES = 8;
const DEFAULT_DECIMALS = 2;

const { t } = useI18nTyped();
const store = useStore();
const displayNameId = useId();
const decimalsId = useId();

const patch = (changes: Partial<SeriesOverrideDraft>) => emit("update", changes);

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
const hasSteps = computed(() => !!props.override.thresholds?.steps?.length);
const effectiveUnit = computed(() => props.override.unit ?? props.panelUnit ?? null);
const effectiveUnitCustom = computed(() =>
  props.override.unit ? props.override.unitCustom : (props.panelUnitCustom ?? null),
);
const effectiveDecimals = computed(
  () => parseDecimals(props.override.decimals) ?? props.panelDecimals ?? null,
);
</script>
