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
  <div
    class="@container/estimator flex h-full flex-col gap-3"
    data-test="billings-usageestimator-root"
  >
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

      <!-- Side by side, the panes fill the page and only the form scrolls, so the estimate never leaves the screen. -->
      <div
        class="relative grid items-stretch gap-3 @min-[60rem]/estimator:min-h-0 @min-[60rem]/estimator:flex-1 @min-[60rem]/estimator:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.95fr)] @min-[60rem]/estimator:grid-rows-[minmax(0,1fr)]"
      >
        <!-- Until history lands the fields hold placeholders, not this org's usage. -->
        <OInnerLoading
          :showing="loadingHistory"
          size="sm"
          :label="t('billing.usageV2.loadingHistory')"
        />
        <!-- ── Inputs ───────────────────────────────────────── -->
        <section
          class="border-border-default rounded-default flex min-w-0 flex-col overflow-hidden border"
        >
          <UsagePaneHeader
            :title="t('billing.usageV2.expectedUsage')"
            :subtitle="t('billing.usageV2.expectedUsageHint')"
          >
            <template #actions>
              <OPopover align="end" :aria-label="t('billing.usageV2.assumptions')">
                <template #trigger>
                  <OButton
                    variant="outline"
                    size="xs"
                    icon-left="tune"
                    data-test="billings-usageestimator-assumptions"
                  >
                    {{ t("billing.usageV2.assumptions") }}
                  </OButton>
                </template>
                <div
                  class="flex w-80 flex-col gap-3 p-3"
                  data-test="billings-usageestimator-assumptions-panel"
                >
                  <p class="text-text-heading text-sm font-semibold">
                    {{ t("billing.usageV2.assumptions") }}
                    <span class="text-text-secondary text-xs font-normal">
                      {{ t("billing.usageV2.assumptionsFrom") }}
                    </span>
                  </p>
                  <OInput
                    :model-value="inputs.avgStreamMb"
                    type="number"
                    size="md"
                    :label="t('billing.usageV2.avgStreamSize')"
                    :suffix="rawMb"
                    data-test="billings-usageestimator-avg-stream"
                    @update:model-value="setField('avgStreamMb', $event)"
                  />
                </div>
              </OPopover>
            </template>
          </UsagePaneHeader>

          <div
            class="grid min-h-0 gap-x-5 gap-y-4 overflow-y-auto p-4 @min-[36rem]/estimator:grid-cols-2"
            data-test="billings-usageestimator-fields"
          >
            <div
              v-for="field in fields"
              :key="field.key"
              class="flex min-w-0 flex-col gap-1.5"
              :data-test="`billings-usageestimator-field-${field.key}`"
            >
              <div v-if="field.title" class="text-xs font-semibold">{{ field.title }}</div>
              <OInput
                :model-value="inputs[field.key]"
                type="number"
                size="md"
                :label="t(field.labelKey)"
                :suffix="field.suffix"
                :help-text="field.key === 'scanPerSearchMb' ? scanNote : field.rate"
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
              <!-- A check's shape only scales its count, so it takes small boxes rather than a slider each. -->
              <template v-if="field.shape">
                <div class="flex flex-wrap gap-x-3 gap-y-2 pt-1">
                  <OInput
                    v-for="part in field.shape"
                    :key="part.key"
                    :model-value="inputs[part.key]"
                    type="number"
                    size="sm"
                    width="xs"
                    :label="t(part.labelKey)"
                    :suffix="part.suffix"
                    :data-test="`billings-usageestimator-${part.key}`"
                    @update:model-value="setField(part.key, $event)"
                  />
                </div>
                <span class="text-text-secondary text-xs">{{ runNotes[field.key] }}</span>
              </template>
            </div>
          </div>
        </section>

        <!-- ── Estimate ─────────────────────────────────────── -->
        <section
          class="border-border-default rounded-default flex min-w-0 flex-col overflow-hidden border"
          data-test="billings-usageestimator-result"
        >
          <UsagePaneHeader :title="t('billing.usageV2.yourEstimate')" />

          <ul class="m-0 flex min-h-0 list-none flex-col overflow-y-auto p-0">
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
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { addCommasToNumber, formatSizeFromMB } from "@/utils/formatters";
import UsagePaneHeader from "./UsagePaneHeader.vue";
import { useUsageSearch } from "./useUsageSearch";
import {
  apiCheckRuns,
  browserStepRuns,
  estimateCost,
  formatCost,
  fitWholeCount,
  formatRate,
  METERS,
  monthlyPace,
  type BillingOrg,
  type EstimateInputs,
  type EstimateLine,
  type MeteringDetails,
  type MeterKey,
} from "./meteringModel";
import { meterColorFor } from "./usageCharts";
import { averageStreamSizeSql, searchScanSizeSql } from "./usageQueries";

type FieldKey = keyof EstimateInputs;

/** A field that only shapes a check: a small box under the check's count, with no slider. */
interface ShapeDef {
  key: FieldKey;
  labelKey: I18nKey;
  suffix: string;
}

type ScenarioKey = "current" | "twice" | "fiveTimes";

interface FieldDef {
  key: FieldKey;
  labelKey: I18nKey;
  meter?: MeterKey;
  /** Shows the meter's name above the field, for a count that heads its own block. */
  titled?: boolean;
  shape?: ShapeDef[];
  suffix: string;
  min: number;
  max: number;
  step: number;
}

const MB_PER_GB = 1024;

/** Below a cent a line is noise, so it renders quietly rather than as a real cost. */
const CENT = 0.005;

const props = withDefaults(
  defineProps<{
    details: MeteringDetails | null;
    /** A super org's orgs, itself first; empty for any other org. */
    billingOrgs?: BillingOrg[];
  }>(),
  { billingOrgs: () => [] },
);

const { t } = useI18nTyped();
const store = useStore();

const rawMb = "MB";

const SCENARIOS: { value: ScenarioKey; labelKey: I18nKey }[] = [
  { value: "current", labelKey: "billing.usageV2.scenarioCurrent" },
  { value: "twice", labelKey: "billing.usageV2.scenarioTwice" },
  { value: "fiveTimes", labelKey: "billing.usageV2.scenarioFiveTimes" },
];

/** Growth multiplies the volumes a plan grows by, never the conversion assumptions. */
const GROWN_FIELDS: FieldKey[] = [
  "ingestGb",
  "searchCount",
  "pipelineCount",
  "aiCredits",
  "browserChecks",
  "apiChecks",
];

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
    step: 1,
  },
  {
    key: "scanPerSearchMb",
    labelKey: "billing.usageV2.scanPerSearch",
    suffix: "MB",
    min: 0,
    max: 10240,
    step: 1,
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
    step: 1,
  },
  {
    key: "browserChecks",
    labelKey: "billing.usageV2.browserChecks",
    meter: "synthetics_browser",
    titled: true,
    suffix: "",
    min: 0,
    max: 200,
    step: 1,
    shape: [
      { key: "browserSteps", labelKey: "billing.usageV2.stepsPerCheck", suffix: "" },
      { key: "browserRegions", labelKey: "billing.usageV2.checkRegions", suffix: "" },
      { key: "browserDevices", labelKey: "billing.usageV2.checkDevices", suffix: "" },
      { key: "browserIntervalSec", labelKey: "billing.usageV2.checkInterval", suffix: "sec" },
    ],
  },
  {
    key: "apiChecks",
    labelKey: "billing.usageV2.apiChecks",
    meter: "synthetics_protocol",
    titled: true,
    suffix: "",
    min: 0,
    max: 500,
    step: 1,
    shape: [
      { key: "apiRegions", labelKey: "billing.usageV2.checkRegions", suffix: "" },
      { key: "apiIntervalSec", labelKey: "billing.usageV2.checkInterval", suffix: "sec" },
    ],
  },
];

const DEFAULTS: EstimateInputs = {
  ingestGb: 100,
  searchCount: 50,
  pipelineCount: 5,
  retentionDays: 30,
  aiCredits: 0,
  avgStreamMb: 0,
  scanPerSearchMb: 0,
  browserChecks: 0,
  browserSteps: 5,
  browserRegions: 1,
  browserDevices: 1,
  browserIntervalSec: 300,
  apiChecks: 0,
  apiRegions: 1,
  apiIntervalSec: 300,
};

/** Runs one check makes in a month at the default shape, which turns billed runs back into a check count. */
const BROWSER_RUNS_PER_CHECK = browserStepRuns({ ...DEFAULTS, browserChecks: 1 });
const API_RUNS_PER_CHECK = apiCheckRuns({ ...DEFAULTS, apiChecks: 1 });

const inputs = reactive<EstimateInputs>({ ...DEFAULTS });

const scenario = ref<ScenarioKey>("current");

const round = (value: number) => Number(value.toFixed(2));

/** Four significant digits, for a size that can be a fraction of a megabyte. */
const significant = (value: number) => Number(value.toPrecision(4));

/** Fields the user typed in; history that lands later must not overwrite them. */
const edited = new Set<FieldKey>();

const setField = (key: FieldKey, value: unknown) => {
  const next = Number(value);
  inputs[key] = Number.isFinite(next) && next > 0 ? next : 0;
  edited.add(key);
};

const currentScenario = computed<EstimateInputs>(() => {
  const details = props.details;
  const assumptions = {
    avgStreamMb: inputs.avgStreamMb,
    scanPerSearchMb: inputs.scanPerSearchMb,
  };
  if (!details) return { ...DEFAULTS, ...assumptions };
  const perMonth = (amount: number | string | undefined) => monthlyPace(amount, details);
  const scannedMb = perMonth(details.query?.metered_amount);
  const pipelineMb = perMonth(details.pipeline?.metered_amount);
  const searchCount =
    assumptions.scanPerSearchMb > 0
      ? fitWholeCount(scannedMb / assumptions.scanPerSearchMb).count
      : scannedMb > 0
        ? DEFAULTS.searchCount
        : 0;
  const browser = fitWholeCount(
    perMonth(details.synthetics_browser?.metered_amount) / BROWSER_RUNS_PER_CHECK,
  );
  const api = fitWholeCount(
    perMonth(details.synthetics_protocol?.metered_amount) / API_RUNS_PER_CHECK,
  );
  return {
    ...assumptions,
    ingestGb: round(perMonth(details.ingestion?.metered_amount) / MB_PER_GB),
    searchCount,
    scanPerSearchMb:
      searchCount > 0 ? significant(scannedMb / searchCount) : assumptions.scanPerSearchMb,
    pipelineCount:
      assumptions.avgStreamMb > 0
        ? Math.round(pipelineMb / assumptions.avgStreamMb)
        : DEFAULTS.pipelineCount,
    retentionDays: DEFAULTS.retentionDays,
    aiCredits: Math.round(perMonth(details.ai?.metered_amount)),
    browserChecks: browser.count,
    browserSteps: DEFAULTS.browserSteps,
    browserRegions: DEFAULTS.browserRegions,
    browserDevices: DEFAULTS.browserDevices,
    browserIntervalSec: Math.round(DEFAULTS.browserIntervalSec / browser.scale),
    apiChecks: api.count,
    apiRegions: DEFAULTS.apiRegions,
    apiIntervalSec: Math.round(DEFAULTS.apiIntervalSec / api.scale),
  };
});

const applyScenario = (key: ScenarioKey) => {
  // A preset fills every field on purpose, so nothing typed before it is protected any more.
  edited.clear();
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

const scannedMb = computed(() => Number(inputs.searchCount) * Number(inputs.scanPerSearchMb));

const scannedText = computed(() => raw(formatSizeFromMB(scannedMb.value)));

/** Search is billed on the data it scans, so the size field states the month's total. */
const scanNote = computed(() => t("billing.usageV2.scanNote", { volume: scannedText.value }));

const runCount = (runs: number) => raw(addCommasToNumber(Math.round(runs)));

/** What a check's count and shape add up to, under its boxes. */
const runNotes = computed<Partial<Record<FieldKey, I18nText>>>(() => ({
  browserChecks: t("billing.usageV2.browserRunsNote", {
    runs: runCount(browserStepRuns(inputs)),
  }),
  apiChecks: t("billing.usageV2.apiRunsNote", { runs: runCount(apiCheckRuns(inputs)) }),
}));

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
    case "synthetics_browser":
      return t("billing.usageV2.qtyStepRuns", { count: runCount(line.quantity) });
    case "synthetics_protocol":
      return t("billing.usageV2.qtyRuns", { count: runCount(line.quantity) });
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
    const title = field.titled && field.meter ? meterLabel(field.meter) : undefined;
    if (!def || !meter) return { ...field, title, rate: undefined, rateHint: undefined };
    const basis = t(def.billedAsKey);
    const priced = Number(meter.base_cost) > 0;
    const rate = priced ? formatRate(meter, def, t) : t("billing.usageV2.rateIncluded");
    const rateHint = priced
      ? t("billing.usageV2.rateTooltip", { rate, basis })
      : t("billing.usageV2.rateIncludedTooltip", { basis });
    return { ...field, title, rate, rateHint };
  }),
);

const { search } = useUsageSearch();

const runScalarQuery = async (sql: string, key: string) => {
  const hits = await search(sql, {
    start: (props.details?.cycle_start ?? 0) * 1_000_000,
    end: (props.details?.cycle_end ?? 0) * 1_000_000,
    size: 1,
    key,
  });
  return hits[0] ?? {};
};

const loadingHistory = ref(false);

/** Defaults come from history; a failed query just leaves the field at zero for the user to fill. */
const loadDefaults = async () => {
  if (!props.details) return;
  loadingHistory.value = true;
  // A super org's bill covers its whole group, so the assumptions that turn it into counts do too.
  const orgId = props.billingOrgs.length ? null : store.state.selectedOrganization.identifier;
  try {
    const [streams, scan] = await Promise.all([
      runScalarQuery(averageStreamSizeSql(orgId), "streams"),
      runScalarQuery(searchScanSizeSql(orgId), "scan"),
    ]);
    const streamCount = Number(streams.streams) || 0;
    if (!edited.has("avgStreamMb")) {
      inputs.avgStreamMb = streamCount > 0 ? round(Number(streams.total) / streamCount) : 0;
    }
    // A search is priced by the data it scans; how long it ran does not enter the bill.
    const searches = Number(scan.searches) || 0;
    if (!edited.has("scanPerSearchMb")) {
      inputs.scanPerSearchMb = searches > 0 ? significant(Number(scan.total) / searches) : 0;
    }
  } catch {
    inputs.avgStreamMb = inputs.avgStreamMb || 0;
    inputs.scanPerSearchMb = inputs.scanPerSearchMb || 0;
  }
  loadingHistory.value = false;
  // The answers land a moment after the tab opens; a preset picked or a value typed by then stays.
  if (!edited.size) applyScenario(scenario.value);
};

onMounted(loadDefaults);
</script>
