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
  <ODrawer
    :open="true"
    side="right"
    size="lg"
    seamless
    :modal="false"
    :anchor="anchor"
    :title="raw(row.service)"
    data-test="autoobserve-coverage-drawer"
    @update:open="(open: boolean) => !open && emit('close')"
  >
    <template #header>
      <div class="flex min-w-0 items-center gap-3">
        <svg class="size-8 shrink-0" viewBox="0 0 20 20" aria-hidden="true">
          <polygon :points="HEX_POINTS" :class="STATE_FILL[state]" />
        </svg>
        <div class="min-w-0 flex-1">
          <span
            class="text-text-heading block truncate text-base font-semibold"
            data-test="autoobserve-coverage-drawer-title"
            >{{ row.service }}</span
          >
          <span class="text-text-secondary block truncate text-xs">{{ subTitle }}</span>
        </div>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="timeline"
          :aria-label="t('autoobserve.coverage.openTraces')"
          data-test="autoobserve-coverage-drawer-traces"
          @click="openTraces()"
          ><span class="max-md:sr-only">{{ t("autoobserve.coverage.openTraces") }}</span></OButton
        >
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="hub"
          :aria-label="t('autoobserve.coverage.openCatalog')"
          data-test="autoobserve-coverage-drawer-catalog"
          @click="openTraces('services-catalog')"
          ><span class="max-md:sr-only">{{ t("autoobserve.coverage.openCatalog") }}</span></OButton
        >
      </div>
    </template>

    <div ref="body" class="flex flex-col gap-4">
      <p
        role="status"
        class="text-text-body flex items-start gap-1.5 text-xs empty:hidden"
        data-test="autoobserve-coverage-drawer-status"
      >
        <template v-if="message">
          <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />{{ message }}
        </template>
      </p>

      <section :class="CARD" data-test="autoobserve-coverage-drawer-watched">
        <div class="flex items-center gap-2">
          <h3 :class="HEADING">{{ t("autoobserve.coverage.signalsWatched") }}</h3>
          <OTag
            class="ms-auto"
            :variant="STATE_VARIANT[state]"
            size="sm"
            :label="stateLabel"
            data-test="autoobserve-coverage-drawer-state"
          />
        </div>
        <div class="flex flex-wrap gap-1.5">
          <template v-for="chip in chips" :key="chip.signal">
            <button
              v-if="chip.target"
              type="button"
              :class="[CHIP, 'hover:border-border-strong cursor-pointer']"
              :aria-pressed="expanded === chip.signal"
              :aria-label="chip.aria"
              :data-test="`autoobserve-coverage-drawer-chip-${chip.signal}`"
              @click="openSignal(chip.signal)"
            >
              <svg class="size-4 shrink-0" viewBox="0 0 20 20" aria-hidden="true">
                <polygon :points="HEX_POINTS" :class="CELL_FILL[chip.state]" stroke-width="1.5" />
              </svg>
              <span class="text-text-heading">{{ chip.label }}</span>
            </button>
            <span
              v-else
              role="img"
              :class="CHIP"
              :title="chip.aria"
              :aria-label="chip.aria"
              :data-test="`autoobserve-coverage-drawer-chip-${chip.signal}`"
            >
              <svg class="size-4 shrink-0" viewBox="0 0 20 20" aria-hidden="true">
                <polygon :points="HEX_POINTS" :class="CELL_FILL[chip.state]" stroke-width="1.5" />
              </svg>
              <span class="text-text-heading">{{ chip.label }}</span>
            </span>
          </template>
        </div>
        <p
          v-if="learningLine"
          class="text-text-secondary text-xs"
          data-test="autoobserve-coverage-drawer-learning"
        >
          {{ learningLine }}
        </p>
        <div
          v-if="gapReason"
          class="flex flex-wrap items-center gap-x-3 gap-y-2"
          data-test="autoobserve-coverage-drawer-gap"
        >
          <span class="text-text-body min-w-0 flex-1 text-sm">{{ gapReason }}</span>
          <OButton
            v-if="fix"
            variant="outline"
            size="sm-action"
            data-test="autoobserve-coverage-drawer-fix"
            @click="emit('fix')"
            >{{ fix }}</OButton
          >
        </div>
      </section>

      <section class="flex flex-col gap-3" data-test="autoobserve-coverage-drawer-signals">
        <div class="flex items-center gap-2">
          <h3 :class="HEADING">{{ t("autoobserve.coverage.signals") }}</h3>
          <OToggleGroup
            :model-value="range"
            class="ms-auto"
            :aria-label="t('autoobserve.coverage.rangeLabel')"
            data-test="autoobserve-coverage-drawer-range"
            @update:model-value="(v: unknown) => v && (range = v as ChartRange)"
          >
            <OToggleGroupItem
              v-for="r in RANGES"
              :key="r"
              :value="r"
              size="xs"
              :data-test="`autoobserve-coverage-drawer-range-${r}`"
              >{{ raw(r) }}</OToggleGroupItem
            >
          </OToggleGroup>
        </div>
        <div class="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <template v-for="(pair, r) in chartRows" :key="r">
            <CoverageMetricChart
              v-for="chart in pair"
              :key="`${row.service}-${chart.def.signal}`"
              :def="chart.def"
              :series="chart.series"
              :cell="chart.cell"
              :range="range"
              :start="timeWindow.start"
              :end="timeWindow.end"
              :expanded="expanded === chart.def.signal"
              :ready-on="readyOn"
              @toggle="toggle(chart.def.signal)"
            >
              <!-- One column on a phone keeps the detail under its own chart instead of under the row. -->
              <CoverageSignalDetail
                v-if="expanded === chart.def.signal"
                class="sm:hidden"
                :cell="chart.cell"
                :service="row.service"
                :signal="chart.def.signal"
                :ledger="ledger"
              />
            </CoverageMetricChart>
            <div
              v-if="r === openRow && openChart"
              class="border-accent bg-surface-base rounded-surface col-span-full border p-1 shadow-xs max-sm:hidden"
              data-test="autoobserve-coverage-drawer-detail-row"
            >
              <CoverageSignalDetail
                :cell="openChart.cell"
                :service="row.service"
                :signal="openChart.def.signal"
                :ledger="ledger"
              />
            </div>
          </template>
        </div>
      </section>

      <section :class="CARD" data-test="autoobserve-coverage-drawer-logs">
        <div class="flex flex-col gap-2">
          <button
            type="button"
            :class="ROW"
            :aria-expanded="expanded === 'logPatterns'"
            data-test="autoobserve-coverage-drawer-row-logPatterns"
            @click="toggle('logPatterns')"
          >
            <span
              class="size-2.5 shrink-0 rounded-full"
              :class="DOT[row.cells.logPatterns.state]"
            />
            <span class="text-text-heading text-sm font-medium">{{
              t(SIGNAL_LABEL.logPatterns)
            }}</span>
            <span class="text-text-body min-w-0 flex-1 truncate text-sm">{{ logValue }}</span>
            <OIcon
              :name="expanded === 'logPatterns' ? 'expand-less' : 'expand-more'"
              size="sm"
              class="text-text-secondary"
            />
          </button>
          <CoverageSignalDetail
            v-if="expanded === 'logPatterns'"
            :cell="row.cells.logPatterns"
            :service="row.service"
            signal="logPatterns"
            :ledger="ledger"
          />
        </div>
      </section>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import CoverageMetricChart from "./CoverageMetricChart.vue";
import CoverageSignalDetail from "./CoverageSignalDetail.vue";
import {
  CHART_SIGNALS,
  DEMO_END,
  libraryOf,
  metricsFor,
  seed,
  seriesFor,
  type ChartRange,
} from "./coverageSeries";
import {
  SIGNAL_LABEL,
  SIGNALS,
  type CellState,
  type CoverageRow,
  type LedgerEntry,
  type Scenario,
  type Signal,
} from "./fixtures";

type ServiceState = "watched" | "learning" | "gap";

const props = defineProps<{
  row: CoverageRow;
  serviceStates: Record<string, ServiceState>;
  scenario: Scenario;
  ledger: LedgerEntry[];
  expanded: Signal | null;
  anchor: string;
  fix: I18nText | null;
  message: I18nText | "";
}>();

const emit = defineEmits<{
  close: [];
  expand: [signal: Signal | null];
  fix: [];
  select: [service: string];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const HEX_POINTS = "18.23,14.75 10,19.5 1.77,14.75 1.77,5.25 10,0.5 18.23,5.25";
const CARD = "bg-surface-panel border-border-subtle rounded-surface flex flex-col gap-3 border p-3";
const HEADING = "text-text-heading text-sm font-semibold";
const CHIP =
  "bg-surface-base border-border-subtle focus-visible:outline-focus-ring-accent inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-2.5 text-xs focus-visible:outline-2";
const ROW =
  "hover:bg-surface-subtle-hover focus-visible:outline-focus-ring-accent rounded-default flex w-full cursor-pointer items-center gap-2 px-1 py-1.5 text-start focus-visible:outline-2";
const RANGES: ChartRange[] = ["1h", "24h", "7d"];
const RANGE_MS: Record<ChartRange, number> = {
  "1h": 59 * 60_000,
  "24h": 95 * 15 * 60_000,
  "7d": 167 * 60 * 60_000,
};
const STATE_VARIANT: Record<ServiceState, BadgeVariant> = {
  watched: "success-soft",
  learning: "blue-soft",
  gap: "warning-soft",
};
const STATE_FILL: Record<ServiceState, string> = {
  watched: "fill-badge-success-soft-text dark:fill-status-positive",
  learning: "fill-status-info-text",
  gap: "fill-status-warning-text",
};
const CELL_LABEL: Record<CellState, I18nKey> = {
  watched: "autoobserve.coverage.watched",
  learning: "autoobserve.coverage.learning",
  gap: "autoobserve.coverage.gap",
  na: "autoobserve.coverage.na",
};
const CELL_FILL: Record<CellState, string> = {
  ...STATE_FILL,
  na: "fill-transparent stroke-border-strong",
};
const DOT: Record<CellState, string> = {
  watched: "bg-badge-success-soft-text dark:bg-status-positive",
  learning: "bg-status-info-text",
  gap: "bg-status-warning-text",
  na: "border border-border-strong",
};

// Every chart reads this state, so hovering one draws the crosshair and tooltip on all four.
const hoveredSeriesState = ref({
  hoveredSeriesName: "",
  panelId: -1 as number | string,
  dataIndex: -1,
  seriesIndex: -1,
  hoveredTime: null as unknown,
  setHoveredSeriesName(name: string) {
    hoveredSeriesState.value.hoveredSeriesName = name ?? "";
  },
  setIndex(dataIndex: number, seriesIndex: number, panelId: number | string, time?: unknown) {
    hoveredSeriesState.value.dataIndex = dataIndex ?? -1;
    hoveredSeriesState.value.seriesIndex = seriesIndex ?? -1;
    hoveredSeriesState.value.panelId = panelId ?? -1;
    hoveredSeriesState.value.hoveredTime = time ?? null;
  },
});
provide("hoveredSeriesState", hoveredSeriesState);

const range = ref<ChartRange>("24h");
const body = ref<HTMLElement | null>(null);

watch(
  () => props.row.service,
  () => {
    const scroller = body.value?.parentElement;
    if (scroller) scroller.scrollTop = 0;
  },
);

const timeWindow = computed(() => ({ start: DEMO_END - RANGE_MS[range.value], end: DEMO_END }));

const state = computed<ServiceState>(() => props.serviceStates[props.row.service] ?? "watched");

const progress = computed(
  () => Object.values(props.row.cells).find((c) => c.progress)?.progress ?? null,
);

const stateLabel = computed(() => {
  if (state.value === "gap") return t("autoobserve.coverage.stateGap");
  if (state.value === "learning" && progress.value)
    return t("autoobserve.coverage.stateLearning", {
      days: progress.value[0],
      total: progress.value[1],
    });
  return t("autoobserve.coverage.stateWatched");
});

const detectors = computed(() => Object.values(props.row.cells).filter((c) => c.detector).length);
const detectorText = computed(() =>
  t("autoobserve.coverage.detectorCount", { count: detectors.value }, detectors.value),
);
const library = computed(() => libraryOf(props.row));

const subTitle = computed(() =>
  t("autoobserve.coverage.drawerSubtitle", {
    stream: raw(props.row.stream),
    detectors: detectorText.value,
    library: raw(library.value),
  }),
);

const readyOn = computed(() => {
  if (!progress.value) return null;
  const days = progress.value[1] - progress.value[0];
  return raw(
    new Date(DEMO_END + days * 86_400_000).toLocaleDateString(undefined, { weekday: "long" }),
  );
});

const charts = computed(() =>
  metricsFor(props.row)
    .filter((def) => CHART_SIGNALS.includes(def.signal))
    .map((def) => ({
      def,
      cell: props.row.cells[def.signal],
      series: seriesFor(props.scenario, props.row, def, range.value),
    }))
    .filter((chart) => chart.cell.state !== "na"),
);

const gapReason = computed(() =>
  state.value === "gap"
    ? (SIGNALS.map((s) => props.row.cells[s]).find((c) => c.state === "gap")?.reason ?? "")
    : "",
);

const learningLine = computed(() =>
  state.value === "learning" && progress.value
    ? t("autoobserve.coverage.bandLearning", {
        days: progress.value[0],
        total: progress.value[1],
        day: readyOn.value ?? "",
      })
    : "",
);

const chips = computed(() => {
  const charted = new Set(charts.value.map((c) => c.def.signal));
  return SIGNALS.map((signal) => {
    const label = t(SIGNAL_LABEL[signal]);
    const cellState = props.row.cells[signal].state;
    return {
      signal,
      label,
      state: cellState,
      // Only charted signals and log patterns have a section to open; dependencies is state only.
      target: charted.has(signal) || signal === "logPatterns",
      aria: t("autoobserve.coverage.chipAria", { signal: label, state: t(CELL_LABEL[cellState]) }),
    };
  });
});

const logValue = computed(() => {
  if (props.row.cells.logPatterns.state === "gap") return raw("—");
  const known = 12 + (seed(`${props.row.service}:patterns`) % 60);
  return t("autoobserve.coverage.logPatternsValue", { known, fresh: 0 });
});

const chartRows = computed(() =>
  charts.value.reduce<(typeof charts.value)[]>(
    (rows, chart, i) => (i % 2 ? rows[rows.length - 1].push(chart) : rows.push([chart]), rows),
    [],
  ),
);

const openChart = computed(() => charts.value.find((c) => c.def.signal === props.expanded));
const openRow = computed(() =>
  chartRows.value.findIndex((pair) => pair.some((c) => c.def.signal === props.expanded)),
);

// A chip only ever opens its signal; the Details toggles beside each chart can also close it.
const openSignal = (signal: Signal) => emit("expand", signal);

const toggle = (signal: Signal) => emit("expand", props.expanded === signal ? null : signal);

const openTraces = (tab?: string) => {
  const org = store.state.selectedOrganization?.identifier;
  void router.push({ name: "traces", query: { org_identifier: org, ...(tab ? { tab } : {}) } });
};
</script>
