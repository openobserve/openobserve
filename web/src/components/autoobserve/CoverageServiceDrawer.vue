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
      <div
        class="rounded-surface flex flex-wrap items-center gap-x-3 gap-y-2 border px-3 py-2.5"
        :class="BAND[state]"
        data-test="autoobserve-coverage-drawer-band"
      >
        <OTag
          :variant="STATE_VARIANT[state]"
          size="sm"
          :label="stateLabel"
          data-test="autoobserve-coverage-drawer-state"
        />
        <span class="text-text-body min-w-0 flex-1 text-sm">{{ bandLine }}</span>
        <OButton
          v-if="fix"
          variant="outline"
          size="sm-action"
          data-test="autoobserve-coverage-drawer-fix"
          @click="emit('fix')"
          >{{ fix }}</OButton
        >
      </div>
      <p
        role="status"
        class="text-text-body flex items-start gap-1.5 text-xs empty:hidden"
        data-test="autoobserve-coverage-drawer-status"
      >
        <template v-if="message">
          <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />{{ message }}
        </template>
      </p>

      <div class="grid grid-cols-4 gap-2 max-md:grid-cols-2" data-test="autoobserve-coverage-kpis">
        <CoverageKpiTile
          v-for="tile in tiles"
          :key="tile.signal"
          v-bind="tile"
          @open="focusSignal(tile.signal)"
        />
      </div>

      <section :class="CARD" data-test="autoobserve-coverage-drawer-watched">
        <h3 :class="HEADING">{{ t("autoobserve.coverage.signalsWatched") }}</h3>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="chip in chips"
            :key="chip.signal"
            type="button"
            class="bg-surface-base border-border-subtle hover:border-border-strong focus-visible:outline-focus-ring-accent inline-flex cursor-pointer items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-2.5 text-xs focus-visible:outline-2"
            :aria-pressed="expanded === chip.signal"
            :aria-label="chip.aria"
            :data-test="`autoobserve-coverage-drawer-chip-${chip.signal}`"
            @click="focusSignal(chip.signal)"
          >
            <svg class="size-4 shrink-0" viewBox="0 0 20 20" aria-hidden="true">
              <polygon :points="HEX_POINTS" :class="CELL_FILL[chip.state]" stroke-width="1.5" />
            </svg>
            <span class="text-text-heading">{{ chip.label }}</span>
          </button>
        </div>
      </section>

      <section :class="CARD" data-test="autoobserve-coverage-drawer-signals">
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
        <div
          class="divide-border-subtle flex flex-col divide-y [&>*]:py-2.5 [&>*:first-child]:pt-0"
        >
          <CoverageMetricChart
            v-for="(chart, i) in charts"
            :key="`${row.service}-${chart.def.signal}`"
            :def="chart.def"
            :series="chart.series"
            :cell="chart.cell"
            :range="range"
            :start="timeWindow.start"
            :end="timeWindow.end"
            :show-axis="i === lastPlotted"
            :expanded="expanded === chart.def.signal"
            :ready-on="readyOn"
            @toggle="toggle(chart.def.signal)"
          >
            <CoverageSignalDetail
              v-if="expanded === chart.def.signal"
              :cell="chart.cell"
              :service="row.service"
              :signal="chart.def.signal"
              :ledger="ledger"
            />
          </CoverageMetricChart>
          <div id="autoobserve-coverage-signal-logPatterns" class="flex scroll-mt-4 flex-col gap-2">
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
        </div>
      </section>

      <section
        id="autoobserve-coverage-signal-dependencies"
        :class="CARD"
        class="scroll-mt-4"
        data-test="autoobserve-coverage-drawer-deps"
      >
        <div class="flex items-center gap-2">
          <h3 :class="HEADING">{{ t(SIGNAL_LABEL.dependencies) }}</h3>
          <span class="inline-flex items-center gap-1 text-xs" :class="CELL_TONE[depsCell.state]">
            <span class="size-2 rounded-full" :class="DOT[depsCell.state]" />{{
              t(CELL_LABEL[depsCell.state])
            }}
          </span>
          <OButton
            variant="ghost"
            size="xs"
            class="ms-auto"
            :aria-expanded="expanded === 'dependencies'"
            :aria-label="
              t('autoobserve.coverage.detailsFor', { metric: t(SIGNAL_LABEL.dependencies) })
            "
            data-test="autoobserve-coverage-drawer-row-dependencies"
            @click="toggle('dependencies')"
          >
            {{ t("autoobserve.coverage.details") }}
            <OIcon :name="expanded === 'dependencies' ? 'expand-less' : 'expand-more'" size="xs" />
          </OButton>
        </div>
        <div class="flex items-center gap-2 max-md:flex-col max-md:items-stretch">
          <div class="flex min-w-0 flex-1 flex-col items-end gap-1.5 max-md:items-start">
            <span class="text-text-secondary text-2xs">{{
              t("autoobserve.coverage.callers")
            }}</span>
            <button
              v-for="name in flow.upstream"
              :key="name"
              type="button"
              :class="FLOW_CHIP"
              :data-test="`autoobserve-coverage-drawer-dep-${name}`"
              @click="emit('select', name)"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="SERVICE_DOT[serviceStates[name] ?? 'watched']"
              />{{ raw(name) }}
            </button>
            <span v-if="!flow.upstream.length" class="text-text-secondary text-xs">{{
              raw("—")
            }}</span>
          </div>
          <OIcon
            name="arrow-forward"
            size="sm"
            class="text-text-secondary shrink-0 max-md:hidden"
          />
          <span
            class="rounded-surface border-border-strong bg-surface-base text-text-heading inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 text-sm font-semibold max-md:self-center"
          >
            <svg class="size-4" viewBox="0 0 20 20" aria-hidden="true">
              <polygon :points="HEX_POINTS" :class="STATE_FILL[state]" /></svg
            >{{ row.service }}
          </span>
          <OIcon
            name="arrow-forward"
            size="sm"
            class="text-text-secondary shrink-0 max-md:hidden"
          />
          <div class="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            <span class="text-text-secondary text-2xs">{{ t("autoobserve.coverage.calls") }}</span>
            <button
              v-for="name in flow.downstream"
              :key="name"
              type="button"
              :class="FLOW_CHIP"
              :data-test="`autoobserve-coverage-drawer-dep-${name}`"
              @click="emit('select', name)"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="SERVICE_DOT[serviceStates[name] ?? 'watched']"
              />{{ raw(name) }}
            </button>
            <span v-if="!flow.downstream.length" class="text-text-secondary text-xs">{{
              t("autoobserve.coverage.noDownstream")
            }}</span>
          </div>
        </div>
        <CoverageSignalDetail
          v-if="expanded === 'dependencies'"
          :cell="depsCell"
          :service="row.service"
          signal="dependencies"
          :ledger="ledger"
        />
      </section>

      <section v-if="recent.length" :class="CARD" data-test="autoobserve-coverage-drawer-recent">
        <h3 :class="HEADING">{{ t("autoobserve.coverage.recent") }}</h3>
        <ol class="flex flex-col gap-2.5">
          <li v-for="(event, i) in recent" :key="i" class="flex items-start gap-2.5">
            <span
              class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
              :class="event.chip"
            >
              <OIcon :name="event.icon" size="xs" />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="text-text-body text-sm">{{ event.text }}</span>
              <span class="text-text-secondary text-xs">{{ event.meta }}</span>
            </span>
          </li>
        </ol>
      </section>

      <section :class="CARD" data-test="autoobserve-coverage-drawer-metadata">
        <h3 :class="HEADING">{{ t("autoobserve.coverage.metadata") }}</h3>
        <ODescriptionList dense>
          <ODescriptionItem :label="t('autoobserve.coverage.firstSeen')">{{
            firstSeen
          }}</ODescriptionItem>
          <ODescriptionItem :label="t('autoobserve.coverage.lastScanned')">{{
            row.lastScanned
          }}</ODescriptionItem>
          <ODescriptionItem :label="t('autoobserve.coverage.stream')">
            <OText variant="mono">{{ row.stream }}</OText>
          </ODescriptionItem>
          <ODescriptionItem :label="t('autoobserve.coverage.libraryEntry')">
            <OText variant="mono">{{ library }}</OText>
          </ODescriptionItem>
          <ODescriptionItem :label="t('autoobserve.coverage.detectors')">{{
            detectorText
          }}</ODescriptionItem>
          <ODescriptionItem :label="t('autoobserve.coverage.owner')">
            <template v-if="owner">{{ raw(owner) }}</template>
          </ODescriptionItem>
        </ODescriptionList>
      </section>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, provide, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import CoverageKpiTile, { type KpiHealth } from "./CoverageKpiTile.vue";
import CoverageMetricChart from "./CoverageMetricChart.vue";
import CoverageSignalDetail from "./CoverageSignalDetail.vue";
import { DAY_DATE, problemsIn } from "./data/facts";
import {
  ACCENT,
  CHART_SIGNALS,
  DEMO_END,
  RISE_IS_BAD,
  formatValue,
  kindOf,
  libraryOf,
  metricsFor,
  seed,
  seriesFor,
  type ChartRange,
  type MetricDef,
  type MetricSeries,
} from "./coverageSeries";
import {
  LEDGER_STATUS,
  SIGNAL_LABEL,
  SIGNALS,
  type CellState,
  type CoverageCell,
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
const ROW =
  "hover:bg-surface-subtle-hover focus-visible:outline-focus-ring-accent rounded-default flex w-full cursor-pointer items-center gap-2 px-1 py-1.5 text-start focus-visible:outline-2";
const FLOW_CHIP =
  "bg-surface-base border-border-subtle hover:border-border-strong focus-visible:outline-focus-ring-accent rounded-full text-text-heading inline-flex max-w-full cursor-pointer items-center gap-1.5 border px-2.5 py-1 text-xs focus-visible:outline-2";
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
const CELL_FILL: Record<CellState, string> = {
  ...STATE_FILL,
  na: "fill-transparent stroke-border-strong",
};
const BAND: Record<ServiceState, string> = {
  watched: "bg-status-success-bg border-status-success-text/25",
  learning: "bg-status-info-bg border-status-info-text/25",
  gap: "bg-status-warning-bg border-status-warning-text/25",
};
const CELL_LABEL: Record<CellState, I18nKey> = {
  watched: "autoobserve.coverage.watched",
  learning: "autoobserve.coverage.learning",
  gap: "autoobserve.coverage.gap",
  na: "autoobserve.coverage.na",
};
const CELL_TONE: Record<CellState, string> = {
  watched: "text-status-success-text",
  learning: "text-status-info-text",
  gap: "text-status-warning-text",
  na: "text-text-secondary",
};
const DOT: Record<CellState, string> = {
  watched: "bg-badge-success-soft-text dark:bg-status-positive",
  learning: "bg-status-info-text",
  gap: "bg-status-warning-text",
  na: "border border-border-strong",
};
const SERVICE_DOT: Record<ServiceState, string> = {
  watched: DOT.watched,
  learning: DOT.learning,
  gap: DOT.gap,
};
const KPI_ARIA: Record<KpiHealth, I18nKey> = {
  ok: "autoobserve.coverage.kpiHealth.ok",
  drift: "autoobserve.coverage.kpiHealth.drift",
  learning: "autoobserve.coverage.kpiHealth.learning",
  gap: "autoobserve.coverage.kpiHealth.gap",
};
const OWNERS = ["team-payments", "team-storefront", "team-platform", "team-growth", null];

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

const seenDays = computed(() =>
  props.row.addedThisWeek
    ? 0
    : (progress.value?.[0] ?? 20 + (seed(`${props.row.service}:seen`) % 180)),
);

const bandLine = computed(() => {
  if (state.value === "gap")
    return SIGNALS.map((s) => props.row.cells[s]).find((c) => c.state === "gap")?.reason ?? "";
  if (state.value === "learning" && progress.value)
    return t("autoobserve.coverage.bandLearning", {
      days: progress.value[0],
      total: progress.value[1],
      day: readyOn.value ?? "",
    });
  return t("autoobserve.coverage.bandWatched", { count: seenDays.value }, seenDays.value);
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

const lastPlotted = computed(() => {
  const plotted = charts.value.map((c, i) => (c.cell.state === "gap" ? -1 : i));
  return Math.max(...plotted);
});

const healthOf = (cell: CoverageCell, def: MetricDef, series: MetricSeries): KpiHealth => {
  if (cell.state === "gap") return "gap";
  if (cell.state === "learning") return "learning";
  if (cell.method !== "anomaly")
    return series.current >= (def.threshold ?? Infinity) ? "drift" : "ok";
  const { current, low, high } = series;
  return (high != null && current > high) || (low != null && current < low) ? "drift" : "ok";
};

const deltaOf = (def: MetricDef, series: MetricSeries) => {
  if (!series.previous) return null;
  const change = (series.current - series.previous) / series.previous;
  if (Math.abs(change) < 0.005) return null;
  const up = change > 0;
  const bad = RISE_IS_BAD[def.signal];
  const tone =
    bad == null
      ? "text-text-secondary"
      : up === bad
        ? "text-status-warning-text"
        : "text-status-success-text";
  return { up, tone, text: raw(`${Math.round(Math.abs(change) * 100)}%`) };
};

const tiles = computed(() =>
  charts.value.map(({ def, cell, series }) => {
    const label = t(def.titleKey);
    const health = healthOf(cell, def, series);
    const value = health === "gap" ? raw("—") : raw(formatValue(def, series.current));
    return {
      signal: def.signal,
      label,
      value,
      health,
      accent: ACCENT[def.signal],
      points: series.points.map(([, v]) => v),
      delta: health === "gap" ? null : deltaOf(def, series),
      ariaLabel: t(KPI_ARIA[health], { metric: label, value }),
    };
  }),
);

const chips = computed(() =>
  SIGNALS.map((signal) => {
    const label = t(SIGNAL_LABEL[signal]);
    const cellState = props.row.cells[signal].state;
    return {
      signal,
      label,
      state: cellState,
      aria: t("autoobserve.coverage.chipAria", { signal: label, state: t(CELL_LABEL[cellState]) }),
    };
  }),
);

const logValue = computed(() => {
  if (props.row.cells.logPatterns.state === "gap") return raw("—");
  const known = 12 + (seed(`${props.row.service}:patterns`) % 60);
  return t("autoobserve.coverage.logPatternsValue", { known, fresh: 0 });
});

const depsCell = computed(() => props.row.cells.dependencies);

const flow = computed(() => {
  const self = props.row.service;
  const all = Object.keys(props.serviceStates).filter((s) => s !== self);
  const stores = all.filter((s) => /-db$|-cache$|-queue$/.test(s));
  const callers = all.filter((s) => !stores.includes(s));
  const h = seed(`${self}:deps`);
  const pick = (list: string[], k: number) => list[(h >>> k) % Math.max(1, list.length)];
  const upstream = [...new Set([pick(callers, 2), pick(callers, 5)].filter(Boolean))];
  const downstream =
    kindOf(props.row) === "http"
      ? [...new Set([pick(stores, 0), pick(callers, 8)].filter((s) => s && !upstream.includes(s)))]
      : [];
  return { upstream, downstream };
});

const dayLabel = (date: string, time?: string) =>
  raw(
    new Date(`${date}T${time ?? "00:00"}:00`).toLocaleString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
    }),
  );

const recent = computed(() => {
  const service = props.row.service;
  const events: { icon: IconName; chip: string; text: I18nText; meta: I18nText }[] = [];
  for (const p of problemsIn(props.scenario, "month").filter((p) => p.service === service)) {
    events.push({
      icon: "warning-amber",
      chip: "bg-status-warning-bg text-status-warning-text",
      text: raw(p.title),
      meta: raw(`${p.incidentId} · ${dayLabel(DAY_DATE[p.day], p.time)}`),
    });
  }
  for (const e of props.ledger.filter((e) => String(e.target).includes(service))) {
    events.push({
      icon: "auto-awesome",
      chip: "bg-status-info-bg text-status-info-text",
      text: t("autoobserve.coverage.recentAction", {
        action: raw(e.actionClass),
        status: t(LEDGER_STATUS[e.status].key),
      }),
      meta: e.when,
    });
  }
  if (state.value === "learning" && readyOn.value)
    events.push({
      icon: "psychology",
      chip: "bg-status-info-bg text-status-info-text",
      text: t("autoobserve.coverage.recentLearning", { day: readyOn.value }),
      meta: t("autoobserve.coverage.recentLearningMeta", {
        days: progress.value?.[0] ?? 0,
        total: progress.value?.[1] ?? 0,
      }),
    });
  if (state.value === "watched" && seenDays.value >= 7) {
    const learnedAt = new Date(DEMO_END - (seenDays.value - 7) * 86_400_000);
    events.push({
      icon: "check-circle",
      chip: "bg-status-success-bg text-status-success-text",
      text: t("autoobserve.coverage.recentBaseline"),
      meta: dayLabel(learnedAt.toISOString().slice(0, 10)),
    });
  }
  return events.slice(0, 3);
});

const firstSeen = computed(() =>
  props.row.addedThisWeek
    ? t("autoobserve.coverage.firstSeenToday")
    : t("autoobserve.coverage.daysAgo", { count: seenDays.value }, seenDays.value),
);

const owner = computed(() => OWNERS[seed(`${props.row.service}:owner`) % OWNERS.length]);

const toggle = (signal: Signal) => emit("expand", props.expanded === signal ? null : signal);

// Chips and tiles always open their signal and bring it into view, unlike the toggles beside it.
const focusSignal = (signal: Signal) => {
  emit("expand", signal);
  void nextTick(() =>
    document
      .getElementById(`autoobserve-coverage-signal-${signal}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" }),
  );
};

const openTraces = (tab?: string) => {
  const org = store.state.selectedOrganization?.identifier;
  void router.push({ name: "traces", query: { org_identifier: org, ...(tab ? { tab } : {}) } });
};
</script>
