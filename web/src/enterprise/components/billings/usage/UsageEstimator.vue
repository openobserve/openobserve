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

<!--
  What a month would cost, asked in the terms people actually plan in.

  The page opens on this org's own usage rather than an empty form, and every
  field carries the rate it is priced at, so a number reads against its price
  without leaving the field. The estimate is broken down by meter, because one
  total hides which meter a change moved.

  Nobody knows how many gigabytes a search will scan, so the two assumption
  fields convert planning units into billing units using this org's own history,
  and stay editable because a plan is not the past.

  Retention is priced from the org's own metered cost per stored megabyte per
  day rather than from `base_cost`, because that meter's unit is not a plain
  megabyte and a guessed conversion would quietly invent a number.
-->
<template>
  <div class="@container/estimator flex flex-col gap-3" data-test="billings-usageestimator-root">
    <OEmptyState
      v-if="!details"
      size="block"
      :title="t('billing.usageV2.noPricingTitle')"
      :description="t('billing.usageV2.noPricingSubtitle')"
      data-test="billings-usageestimator-no-pricing"
    />

    <template v-else>
      <!-- Presets, so the first view is a real scenario rather than a blank form. -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-text-secondary text-xs">{{ t("billing.usageV2.scenarioFrom") }}</span>
        <OToggleGroup
          :model-value="scenario"
          data-test="billings-usageestimator-scenario"
          @update:model-value="onScenarioChange"
        >
          <OToggleGroupItem
            v-for="option in SCENARIOS"
            :key="option.value"
            :value="option.value"
            size="sm"
          >
            {{ t(option.labelKey) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="refresh"
          class="ms-auto"
          data-test="billings-usageestimator-reset"
          @click="applyScenario('current')"
        >
          {{ t("billing.usageV2.resetEstimate") }}
        </OButton>
      </div>

      <div
        class="grid items-stretch gap-3 @min-[60rem]/estimator:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.95fr)]"
      >
        <!-- ── Inputs ───────────────────────────────────────── -->
        <section
          class="border-border-default rounded-default flex min-w-0 flex-col overflow-hidden border"
        >
          <UsagePaneHeader
            :title="t('billing.usageV2.expectedUsage')"
            :subtitle="t('billing.usageV2.expectedUsageHint')"
          />

          <div class="grid gap-x-5 gap-y-4 p-4 @min-[36rem]/estimator:grid-cols-2">
            <div v-for="field in fields" :key="field.key" class="flex min-w-0 flex-col gap-1.5">
              <OInput
                :model-value="inputs[field.key]"
                type="number"
                size="md"
                :label="t(field.labelKey)"
                :suffix="field.suffix"
                :help-text="field.key === 'searchMinutes' ? scanNote : field.rate"
                :data-test="`billings-usageestimator-${field.key}`"
                @update:model-value="setField(field.key, $event)"
              >
                <template v-if="field.rateHint" #tooltip>
                  <OTooltip :content="field.rateHint" max-width="18rem" />
                </template>
              </OInput>
              <OSlider
                :model-value="Math.min(inputs[field.key], field.max)"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                :aria-label="t(field.labelKey)"
                :data-test="`billings-usageestimator-${field.key}-slider`"
                @update:model-value="setField(field.key, $event)"
              />
            </div>
          </div>

          <!-- Conversions, not plans: quieter, and below the fields they feed. -->
          <div class="border-border-default bg-surface-subtle mt-auto border-t px-4 pt-2.5 pb-4">
            <div class="text-xs font-semibold">
              {{ t("billing.usageV2.assumptions") }}
              <span class="text-text-secondary font-normal">
                {{ t("billing.usageV2.assumptionsFrom") }}
              </span>
            </div>
            <div class="mt-2.5 grid gap-x-5 gap-y-4 @min-[36rem]/estimator:grid-cols-2">
              <OInput
                :model-value="inputs.avgStreamMb"
                type="number"
                size="md"
                :label="t('billing.usageV2.avgStreamSize')"
                :suffix="rawMb"
                data-test="billings-usageestimator-avg-stream"
                @update:model-value="setField('avgStreamMb', $event)"
              />
              <OInput
                :model-value="inputs.scanRateMbPerMin"
                type="number"
                size="md"
                :label="t('billing.usageV2.avgScanRate')"
                :suffix="rawMbPerMin"
                data-test="billings-usageestimator-scan-rate"
                @update:model-value="setField('scanRateMbPerMin', $event)"
              />
            </div>
          </div>
        </section>

        <!-- ── Estimate ─────────────────────────────────────── -->
        <section
          class="border-border-default rounded-default flex min-w-0 flex-col overflow-hidden border"
          data-test="billings-usageestimator-result"
        >
          <UsagePaneHeader :title="t('billing.usageV2.yourEstimate')" />

          <ul class="m-0 flex list-none flex-col p-0">
            <li
              v-for="line in sortedLines"
              :key="line.key"
              class="flex flex-col gap-1.5 px-4 py-2.5"
              :class="line.cost < CENT ? 'text-text-secondary' : ''"
              :data-test="`billings-usageestimator-line-${line.key}`"
            >
              <div class="flex items-center gap-2.5">
                <span
                  class="rounded-default h-2.5 w-2.5 shrink-0"
                  :style="{ backgroundColor: meterColorFor(line.key) }"
                />
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-sm font-medium">{{ line.label }}</span>
                  <span class="text-text-secondary text-xs">{{ line.quantityText }}</span>
                </span>
                <span class="ms-auto text-sm font-semibold">{{ formatCost(line.cost) }}</span>
              </div>
              <OProgressBar :value="shareOf(line)" :color="meterColorFor(line.key)" />
            </li>
          </ul>

          <div class="border-border-default bg-surface-subtle mt-auto border-t px-4 py-3">
            <div class="flex items-baseline gap-2">
              <span class="text-sm font-semibold">{{ t("billing.usageV2.estimatedTotal") }}</span>
              <span class="ms-auto text-2xl leading-none font-semibold">
                {{ formatCost(estimate.total) }}
              </span>
              <span class="text-text-secondary text-xs">{{ t("billing.usageV2.perMonth") }}</span>
            </div>
            <p class="text-text-secondary mt-1.5 text-xs">
              {{ t("billing.usageV2.estimateDisclaimer") }}
            </p>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSlider from "@/lib/forms/Slider/OSlider.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { formatSizeFromMB } from "@/utils/formatters";
import searchService from "@/services/search";
import UsagePaneHeader from "./UsagePaneHeader.vue";
import {
  estimateCost,
  formatCost,
  formatRate,
  METERS,
  type EstimateInputs,
  type EstimateLine,
  type MeteringDetails,
  type MeterKey,
} from "./meteringModel";
import { meterColorFor } from "./usageCharts";
import { averageStreamSizeSql, searchScanRateSql } from "./usageQueries";

type FieldKey = keyof EstimateInputs;

type ScenarioKey = "current" | "twice" | "fiveTimes";

interface FieldDef {
  key: FieldKey;
  labelKey: I18nKey;
  meter?: MeterKey;
  suffix: string;
  min: number;
  max: number;
  step: number;
}

const MB_PER_GB = 1024;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 86400;
const DAYS_PER_MONTH = 30;

/** Below a cent a line is noise, so it renders quietly rather than as a real cost. */
const CENT = 0.005;

const props = defineProps<{ details: MeteringDetails | null }>();

const { t } = useI18nTyped();
const store = useStore();

const rawMb = "MB";
const rawMbPerMin = "MB/min";

const SCENARIOS: { value: ScenarioKey; labelKey: I18nKey }[] = [
  { value: "current", labelKey: "billing.usageV2.scenarioCurrent" },
  { value: "twice", labelKey: "billing.usageV2.scenarioTwice" },
  { value: "fiveTimes", labelKey: "billing.usageV2.scenarioFiveTimes" },
];

/** Growth multiplies the volumes a plan grows by, never the conversion assumptions. */
const GROWN_FIELDS: FieldKey[] = ["ingestGb", "searchCount", "pipelineCount", "aiCredits"];

const FIELDS: FieldDef[] = [
  {
    key: "ingestGb",
    labelKey: "billing.usageV2.ingestPerMonth",
    meter: "ingestion",
    suffix: "GB",
    min: 0,
    max: 2000,
    step: 10,
  },
  {
    key: "searchCount",
    labelKey: "billing.usageV2.searchesPerMonth",
    meter: "query",
    suffix: "",
    min: 0,
    max: 1000,
    step: 5,
  },
  {
    key: "searchMinutes",
    labelKey: "billing.usageV2.searchDuration",
    suffix: "min",
    min: 1,
    max: 1440,
    step: 5,
  },
  {
    key: "pipelineCount",
    labelKey: "billing.usageV2.pipelineCount",
    meter: "pipeline",
    suffix: "",
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "retentionDays",
    labelKey: "billing.usageV2.retentionDays",
    meter: "retention",
    suffix: "days",
    min: 1,
    max: 365,
    step: 1,
  },
  {
    key: "aiCredits",
    labelKey: "billing.usageV2.aiCreditsPerMonth",
    meter: "ai",
    suffix: "",
    min: 0,
    max: 2000,
    step: 10,
  },
];

const DEFAULTS: EstimateInputs = {
  ingestGb: 100,
  searchCount: 50,
  searchMinutes: 60,
  pipelineCount: 5,
  retentionDays: 30,
  aiCredits: 0,
  avgStreamMb: 0,
  scanRateMbPerMin: 0,
};

const inputs = reactive<EstimateInputs>({ ...DEFAULTS });

const scenario = ref<ScenarioKey>("current");

const round = (value: number) => Number(value.toFixed(2));

const setField = (key: FieldKey, value: unknown) => {
  const next = Number(value);
  inputs[key] = Number.isFinite(next) && next > 0 ? next : 0;
};

/** Days in the billing cycle, so a cycle figure can be read as a month. */
const cycleDays = computed(() => {
  const days =
    ((props.details?.cycle_end ?? 0) - (props.details?.cycle_start ?? 0)) / SECONDS_PER_DAY;
  return days > 0 ? days : DAYS_PER_MONTH;
});

const perMonth = (amount: number | string | undefined) =>
  ((Number(amount) || 0) / cycleDays.value) * DAYS_PER_MONTH;

/**
 * This org's own cycle, restated as a month. Search and pipeline counts are not
 * metered, so they come from the metered volume through the same assumptions the
 * form uses, and fall back to the defaults while an assumption is still zero.
 */
const currentScenario = computed<EstimateInputs>(() => {
  const details = props.details;
  const assumptions = {
    avgStreamMb: inputs.avgStreamMb,
    scanRateMbPerMin: inputs.scanRateMbPerMin,
  };
  if (!details) return { ...DEFAULTS, ...assumptions };
  const scannedMb = perMonth(details.query?.metered_amount);
  const scanPerSearch = DEFAULTS.searchMinutes * assumptions.scanRateMbPerMin;
  const pipelineMb = perMonth(details.pipeline?.metered_amount);
  return {
    ...assumptions,
    ingestGb: round(perMonth(details.ingestion?.metered_amount) / MB_PER_GB),
    searchCount: scanPerSearch > 0 ? Math.round(scannedMb / scanPerSearch) : DEFAULTS.searchCount,
    searchMinutes: DEFAULTS.searchMinutes,
    pipelineCount:
      assumptions.avgStreamMb > 0
        ? Math.round(pipelineMb / assumptions.avgStreamMb)
        : DEFAULTS.pipelineCount,
    retentionDays: DEFAULTS.retentionDays,
    aiCredits: Math.round(perMonth(details.ai?.metered_amount)),
  };
});

const applyScenario = (key: ScenarioKey) => {
  scenario.value = key;
  const base = currentScenario.value;
  const factor = key === "twice" ? 2 : key === "fiveTimes" ? 5 : 1;
  Object.assign(inputs, base);
  for (const field of GROWN_FIELDS) inputs[field] = round(base[field] * factor);
};

const onScenarioChange = (value: unknown) => {
  if (typeof value === "string" && value) applyScenario(value as ScenarioKey);
};

const estimate = computed(() => estimateCost(props.details, inputs));

const meterLabel = (key: MeterKey) => {
  const def = METERS.find((entry) => entry.key === key);
  return def ? t(def.labelKey) : raw(key);
};

const scannedMb = computed(
  () => Number(inputs.searchCount) * Number(inputs.searchMinutes) * Number(inputs.scanRateMbPerMin),
);

const scannedText = computed(() => raw(formatSizeFromMB(scannedMb.value)));

/** Search is planned in minutes but billed on scanned volume, so the field states the conversion. */
const scanNote = computed(() => t("billing.usageV2.scanNote", { volume: scannedText.value }));

const quantityText = (line: EstimateLine): I18nText => {
  const volume = raw(formatSizeFromMB(line.quantity));
  switch (line.key) {
    case "query":
      return t("billing.usageV2.qtyScanned", { volume });
    case "pipeline":
      return t("billing.usageV2.qtyProcessed", { volume });
    case "retention":
      return t("billing.usageV2.qtyKeptFor", { volume, days: inputs.retentionDays });
    case "ai":
      return t("billing.usageV2.qtyCredits", { count: line.quantity });
    default:
      return volume;
  }
};

const sortedLines = computed(() =>
  [...estimate.value.lines]
    .map((line) => ({ ...line, label: meterLabel(line.key), quantityText: quantityText(line) }))
    .sort((a, b) => b.cost - a.cost),
);

/** Bars compare against the biggest line, so the shape survives a small total. */
const shareOf = (line: EstimateLine) => {
  const max = sortedLines.value[0]?.cost ?? 0;
  return max > 0 ? line.cost / max : 0;
};

/** A meter with no price of its own reads as included rather than as free. */
const fields = computed(() =>
  FIELDS.map((field) => {
    const def = field.meter ? METERS.find((entry) => entry.key === field.meter) : undefined;
    const meter = field.meter ? props.details?.[field.meter] : undefined;
    if (!def || !meter) return { ...field, rate: undefined, rateHint: undefined };
    const basis = t(def.billedAsKey);
    const priced = Number(meter.base_cost) > 0;
    const rate = priced ? formatRate(meter, def, t) : t("billing.usageV2.rateIncluded");
    const rateHint = priced
      ? t("billing.usageV2.rateTooltip", { rate, basis })
      : t("billing.usageV2.rateIncludedTooltip", { basis });
    return { ...field, rate, rateHint };
  }),
);

const runScalarQuery = async (sql: string) => {
  const response = await searchService.search({
    org_identifier: store.state.selectedOrganization.identifier,
    page_type: "logs",
    query: {
      query: {
        sql,
        start_time: (props.details?.cycle_start ?? 0) * 1_000_000,
        end_time: (props.details?.cycle_end ?? 0) * 1_000_000,
        from: 0,
        size: 1,
      },
    },
  });
  return (response?.data?.hits ?? [])[0] ?? {};
};

/** Defaults come from history; a failed query just leaves the field at zero for the user to fill. */
const loadDefaults = async () => {
  if (!props.details) return;
  try {
    const [streams, scan] = await Promise.all([
      runScalarQuery(averageStreamSizeSql(store.state.selectedOrganization.identifier)),
      runScalarQuery(searchScanRateSql(store.state.selectedOrganization.identifier)),
    ]);
    const streamCount = Number(streams.streams) || 0;
    inputs.avgStreamMb = streamCount > 0 ? round(Number(streams.total) / streamCount) : 0;
    const seconds = Number(scan.seconds) || 0;
    inputs.scanRateMbPerMin =
      seconds > 0 ? round((Number(scan.total) / seconds) * SECONDS_PER_MINUTE) : 0;
  } catch {
    inputs.avgStreamMb = inputs.avgStreamMb || 0;
    inputs.scanRateMbPerMin = inputs.scanRateMbPerMin || 0;
  }
  applyScenario("current");
};

onMounted(loadDefaults);
</script>
