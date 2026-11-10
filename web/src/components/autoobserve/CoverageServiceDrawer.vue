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
          <OTruncatedText
            class="text-text-heading block text-base font-semibold"
            data-test="autoobserve-coverage-drawer-title"
            >{{ row.service }}</OTruncatedText
          >
          <OTruncatedText
            class="text-text-secondary block text-xs"
            data-test="autoobserve-coverage-drawer-subtitle"
            >{{ subTitle }}</OTruncatedText
          >
        </div>
        <OTooltip
          v-if="!logsOnly"
          :content="tracesLock.lockedReason.value"
          :disabled="!tracesLock.locked.value"
        >
          <span class="inline-flex">
            <OButton
              variant="outline"
              size="sm-action"
              :icon-left="tracesLock.locked.value ? 'lock' : 'timeline'"
              :disabled="tracesLock.locked.value"
              :aria-label="t('autoobserve.coverage.openTraces')"
              data-test="autoobserve-coverage-drawer-traces"
              @click="openTraces()"
              ><span class="max-md:sr-only">{{
                t("autoobserve.coverage.openTraces")
              }}</span></OButton
            >
          </span>
        </OTooltip>
        <OButton
          v-else
          variant="outline"
          size="sm-action"
          icon-left="search"
          :aria-label="t('autoobserve.coverage.openLogs')"
          data-test="autoobserve-coverage-drawer-logs"
          @click="openTraces()"
          ><span class="max-md:sr-only">{{ t("autoobserve.coverage.openLogs") }}</span></OButton
        >
        <OTooltip
          v-if="!logsOnly"
          :content="tracesLock.lockedReason.value"
          :disabled="!tracesLock.locked.value"
        >
          <span class="inline-flex">
            <OButton
              variant="outline"
              size="sm-action"
              :icon-left="tracesLock.locked.value ? 'lock' : 'hub'"
              :disabled="tracesLock.locked.value"
              :aria-label="t('autoobserve.coverage.openCatalog')"
              data-test="autoobserve-coverage-drawer-catalog"
              @click="openTraces('services-catalog')"
              ><span class="max-md:sr-only">{{
                t("autoobserve.coverage.openCatalog")
              }}</span></OButton
            >
          </span>
        </OTooltip>
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
        <div v-if="liveChecks" class="flex flex-wrap gap-1.5">
          <button
            v-for="chip in liveChips"
            :key="chip.check"
            type="button"
            :class="[CHIP, 'hover:border-border-strong cursor-pointer']"
            :aria-pressed="chip.check === 'absence' ? undefined : chip.open"
            :aria-expanded="chip.check === 'absence' ? chip.open : undefined"
            :data-test="`autoobserve-coverage-drawer-chip-${chip.check}`"
            @click="openCheck(chip.check)"
          >
            <span
              class="size-2 shrink-0 rounded-full"
              :class="LIVE_DOT[chip.look]"
              aria-hidden="true"
            />
            <span class="text-text-heading">{{ chip.text }}</span>
          </button>
        </div>
        <CoverageSignalDetail
          v-if="liveChecks && absenceOpen"
          :cell="liveChecks.absence"
          :last-fired="lastFiredOf(liveChecks.absence)"
          :added="addedChecks.has('absence')"
          :service="row.service"
          signal="absence"
          :ledger="ledger"
          :insight="insightFor('absence', liveChecks.absence)"
          :pending="!!pendingId"
          data-test="autoobserve-coverage-drawer-absence-detail"
          @cta="(cta) => run('absence', cta)"
        />
        <div v-if="!liveChecks" class="flex flex-wrap gap-1.5">
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
        <div
          v-if="learning"
          class="text-text-secondary flex flex-col gap-1 text-xs"
          data-test="autoobserve-coverage-drawer-learning"
        >
          <p data-test="autoobserve-coverage-drawer-learning-summary">{{ learning.summary }}</p>
          <ul v-if="learning.rows.length" class="flex flex-col gap-0.5">
            <li
              v-for="stream in learning.rows"
              :key="stream.key"
              class="flex min-w-0 items-baseline gap-2"
              data-test="autoobserve-coverage-drawer-learning-stream"
            >
              <span class="text-text-body min-w-0 truncate" :title="stream.stream">{{
                stream.stream
              }}</span>
              <span class="ms-auto shrink-0">{{ stream.until }}</span>
            </li>
          </ul>
        </div>
        <div
          v-if="gapLines.length"
          class="flex flex-wrap items-center gap-x-3 gap-y-2"
          data-test="autoobserve-coverage-drawer-gap"
        >
          <ul class="text-text-body flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <li
              v-for="line in gapLines"
              :key="line"
              data-test="autoobserve-coverage-drawer-gap-line"
            >
              {{ line }}
            </li>
          </ul>
          <InsightBlock
            v-if="gapParts && (gapParts.cta || gapParts.ai)"
            :parts="gapParts"
            variant="details"
            flush
            class="basis-full"
            :pending="pendingId === gapParts.id"
            data-test="autoobserve-coverage-drawer-gap-actions"
            @cta="(cta) => run(gapParts!.id, cta)"
          />
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
              :no-data="!!chart.live && NO_DATA.has(chart.live.status)"
              :status="chart.live?.status"
              :reason="chart.live?.reason ?? undefined"
              :detail="chart.live?.detail ?? undefined"
              :partial="chart.live?.partial"
              :wide="chart.live?.wide"
              :added="addedChecks.has(LIVE_CELL[chart.def.signal as LiveChartSignal])"
              @toggle="toggle(chart.def.signal)"
              @retry="chart.live?.retry()"
            >
              <!-- One column on a phone keeps the detail under its own chart instead of under the row. -->
              <CoverageSignalDetail
                v-if="expanded === chart.def.signal"
                class="sm:hidden"
                :cell="chart.cell"
                :last-fired="lastFiredOf(chart.cell)"
                :added="addedChecks.has(LIVE_CELL[chart.def.signal as LiveChartSignal])"
                :service="row.service"
                :signal="chart.def.signal"
                :ledger="ledger"
                :insight="chartInsight(chart.def.signal, chart.cell)"
                :pending="!!pendingId"
                @cta="(cta) => run(chart.def.signal, cta)"
              />
            </CoverageMetricChart>
            <div
              v-if="r === openRow && openChart"
              class="border-accent bg-surface-base rounded-surface col-span-full border p-1 shadow-xs max-sm:hidden"
              data-test="autoobserve-coverage-drawer-detail-row"
            >
              <CoverageSignalDetail
                :cell="openChart.cell"
                :last-fired="lastFiredOf(openChart.cell)"
                :added="addedChecks.has(LIVE_CELL[openChart.def.signal as LiveChartSignal])"
                :service="row.service"
                :signal="openChart.def.signal"
                :ledger="ledger"
                :insight="chartInsight(openChart.def.signal, openChart.cell)"
                :pending="!!pendingId"
                @cta="(cta) => run(openChart!.def.signal, cta)"
              />
            </div>
          </template>
        </div>
      </section>

      <section v-if="!live" :class="CARD" data-test="autoobserve-coverage-drawer-logs">
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

      <section v-if="row.extra?.length" :class="CARD" data-test="autoobserve-coverage-drawer-extra">
        <h3 :class="HEADING">{{ t("autoobserveLive.drawer.moreChecks") }}</h3>
        <div class="flex flex-col gap-2">
          <template v-for="item in row.extra" :key="item.key">
            <button
              type="button"
              :class="ROW"
              :aria-expanded="extraOpen === item.key"
              :data-test="`autoobserve-coverage-drawer-row-${item.key}`"
              @click="extraOpen = extraOpen === item.key ? null : item.key"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="LIVE_DOT[liveCellLook(item.cell.engine?.stateKey ?? 'none')]"
              />
              <span class="text-text-heading text-sm font-medium">{{ item.label }}</span>
              <OTruncatedText class="text-text-body min-w-0 flex-1 text-sm">{{
                extraValue(item.cell)
              }}</OTruncatedText>
              <OIcon
                :name="extraOpen === item.key ? 'expand-less' : 'expand-more'"
                size="sm"
                class="text-text-secondary"
              />
            </button>
            <CoverageSignalDetail
              v-if="extraOpen === item.key"
              :cell="item.cell"
              :service="row.service"
              :signal="item.key"
              :ledger="ledger"
              :insight="insightFor(item.key, item.cell)"
              :pending="!!pendingId"
              @cta="(cta) => run(item.key, cta)"
            />
          </template>
        </div>
      </section>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, provide, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useLicenseLock } from "@/composables/useFeatureLock";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
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
  detectorsOf,
  LIVE_CHECKS,
  SIGNAL_LABEL,
  SIGNALS,
  type CellState,
  type CoverageCell,
  type CoverageRow,
  type LedgerEntry,
  type LiveCheck,
  type Scenario,
  type Signal,
} from "./fixtures";
import {
  detectorCountText,
  LIVE_DOT,
  liveCellLook,
  liveCellWord,
  liveCheckText,
  agoText,
  liveGapLines,
  streamLearning,
  userTimeZone,
} from "./live/liveCopy";
import { liveMetricDef, type LiveChartSignal } from "./live/serviceChartSql";
import { chartThreshold } from "./live/alertThreshold";
import { useServiceCharts, type ServiceChartStatus } from "./live/useServiceCharts";
import InsightBlock from "./insight/InsightBlock.vue";
import { useInsightActions } from "./insight/useInsightActions";
import {
  cantBuildKinds,
  cellInsight,
  gapInsight,
  justAdded,
  ownedAlertIds,
  probeScope,
  serviceRoute,
} from "./insight/coverageCta";
import { useServiceAddress } from "./insight/targets/serviceAddress";
import { loadOwnedAlerts, type OwnedAlert } from "./insight/targets/ownership";
import type { BulkKind } from "./insight/bulk/useBulkReview";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsLocation } from "@/types/synthetics";

type ServiceState = "watched" | "learning" | "gap";

const props = defineProps<{
  row: CoverageRow;
  serviceStates: Record<string, ServiceState>;
  scenario: Scenario;
  ledger: LedgerEntry[];
  expanded: Signal | LiveCheck | null;
  anchor: string;
  message: I18nText | "";
  live?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  expand: [signal: Signal | LiveCheck | null];
  select: [service: string];
}>();

const { t, locale } = useI18nTyped();
const router = useRouter();
const tracesLock = useLicenseLock("traces");
const store = useStore();

const HEX_POINTS = "18.23,14.75 10,19.5 1.77,14.75 1.77,5.25 10,0.5 18.23,5.25";
const CARD = "bg-surface-panel border-border-subtle rounded-surface flex flex-col gap-3 border p-3";
const HEADING = "text-text-heading text-sm font-semibold";
const CHIP =
  "bg-surface-base border-border-subtle focus-visible:outline-focus-ring-accent inline-flex items-center gap-1.5 rounded-full border py-1 ps-1.5 pe-2.5 text-xs focus-visible:outline-2";
const ROW =
  "hover:bg-surface-subtle-hover focus-visible:outline-focus-ring-accent rounded-default flex w-full cursor-pointer items-center gap-2 px-1 py-1.5 text-start focus-visible:outline-2";
const RANGES: ChartRange[] = ["1h", "24h", "7d"];
// One chart per check that decides a live state; absence is charted as the service's request volume.
const LIVE_CHARTED: Signal[] = ["requests", "errors", "latency"];
const LIVE_CELL: Record<LiveChartSignal, LiveCheck> = {
  requests: "absence",
  errors: "errors",
  latency: "latency",
};
const NO_DATA = new Set<ServiceChartStatus>(["noField", "noMatch", "empty"]);
const RANGE_MS: Record<ChartRange, number> = {
  "1h": 59 * 60_000,
  "24h": 95 * 15 * 60_000,
  "7d": 167 * 60 * 60_000,
};
const STATE_VARIANT: Record<ServiceState, BadgeVariant> = {
  watched: "success-soft",
  learning: "blue-soft",
  gap: "amber-soft",
};
const STATE_FILL: Record<ServiceState, string> = {
  watched: "fill-badge-success-soft-text",
  learning: "fill-status-info-text",
  gap: "fill-badge-amber-soft-text",
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
  watched: "bg-badge-success-soft-text",
  learning: "bg-status-info-text",
  gap: "bg-badge-amber-soft-text",
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
const extraOpen = ref<string | null>(null);
const absenceOpen = computed(() => props.expanded === "absence");

watch(
  () => props.row.service,
  () => {
    extraOpen.value = null;
    const scroller = body.value?.parentElement;
    if (scroller) scroller.scrollTop = 0;
  },
);

const serviceCharts = useServiceCharts(
  computed(() => (props.live ? props.row : null)),
  range,
);

const timeWindow = computed(() =>
  props.live
    ? serviceCharts.span.value
    : { start: DEMO_END - RANGE_MS[range.value], end: DEMO_END },
);

const state = computed<ServiceState>(() => props.serviceStates[props.row.service] ?? "watched");

const progress = computed(
  () => Object.values(props.row.cells).find((c) => c.progress)?.progress ?? null,
);

const stateLabel = computed(() => {
  if (props.row.status) return props.row.status.label;
  if (state.value === "gap") return t("autoobserve.coverage.stateGap");
  if (state.value === "learning" && progress.value)
    return t("autoobserve.coverage.stateLearning", {
      days: progress.value[0],
      total: progress.value[1],
    });
  return t("autoobserve.coverage.stateWatched");
});

const detectors = computed(() => detectorsOf(props.row));
const detectorText = computed(() => detectorCountText(t, detectors.value));
const library = computed(() => libraryOf(props.row));

const subTitle = computed(() =>
  t("autoobserve.coverage.drawerSubtitle", {
    stream: raw(props.row.stream),
    detectors: detectorText.value,
    library: props.row.where ?? raw(library.value),
  }),
);

const readyOn = computed(() => {
  if (!progress.value) return null;
  const days = progress.value[1] - progress.value[0];
  return raw(
    new Date(DEMO_END + days * 86_400_000).toLocaleDateString(undefined, { weekday: "long" }),
  );
});

const liveChecks = computed(() => (props.live ? (props.row.checks ?? null) : null));

const charts = computed(() =>
  metricsFor(props.row)
    .filter((def) => (props.live ? LIVE_CHARTED : CHART_SIGNALS).includes(def.signal))
    .map((def) => {
      const signal = def.signal as LiveChartSignal;
      const live = props.live ? serviceCharts.charts.value[signal] : null;
      const cell = liveChecks.value?.[LIVE_CELL[signal]] ?? props.row.cells[def.signal];
      return {
        def: live
          ? liveMetricDef(signal, live.unit, chartThreshold(signal, live.unit, cellAlerts(cell)))
          : def,
        cell,
        series: live ? live.series : seriesFor(props.scenario, props.row, def, range.value),
        live,
      };
    })
    .filter((chart) => chart.cell.state !== "na"),
);

const gapLines = computed<I18nText[]>(() => {
  if (state.value !== "gap") return [];
  if (liveChecks.value) return liveGapLines(t, locale.value, liveChecks.value, addedChecks.value);
  const reason = SIGNALS.map((s) => props.row.cells[s]).find((c) => c.state === "gap")?.reason;
  return reason ? [reason] : [];
});

const learning = computed(() => {
  const streams = props.row.identity?.streams;
  if (streams)
    return streamLearning(
      t,
      { locale: locale.value, timeZone: userTimeZone(store.state.timezone) },
      streams,
    );
  return fixtureLearningLine.value ? { summary: fixtureLearningLine.value, rows: [] } : null;
});

const fixtureLearningLine = computed(() =>
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
    const cell = props.row.cells[signal];
    const cellState = cell.state;
    const word =
      props.live && cell.engine ? liveCellWord(t, cell.engine.stateKey) : t(CELL_LABEL[cellState]);
    return {
      signal,
      label,
      state: cellState,
      // Only charted signals and log patterns have a section to open; dependencies is state only.
      target: charted.has(signal) || signal === "logPatterns",
      aria: t("autoobserve.coverage.chipAria", { signal: label, state: word }),
    };
  });
});

// Checks this page just added alerts for; they read Added until a newer pass counts them.
const addedChecks = computed(
  () =>
    new Set(
      props.live
        ? LIVE_CHECKS.filter((check) =>
            justAdded(String(store.state.selectedOrganization?.identifier ?? ""), props.row, check),
          )
        : [],
    ),
);

const liveChips = computed(() =>
  LIVE_CHECKS.map((check) => {
    const stateKey = liveChecks.value?.[check].engine?.stateKey ?? "none";
    const added = addedChecks.value.has(check);
    return {
      check,
      look: liveCellLook(stateKey, added),
      open: props.expanded === check,
      text: liveCheckText(t, check, stateKey, added),
    };
  }),
);

const logValue = computed(() => {
  if (props.live || props.row.cells.logPatterns.state === "gap") return raw("—");
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

// Absence's chip opens its detail in the watched card, so the chip toggles it open and shut.
const openCheck = (check: LiveCheck) => {
  if (check === "absence") emit("expand", props.expanded === "absence" ? null : "absence");
  else openSignal(check);
};

const extraValue = (cell: CoverageCell): I18nText =>
  cell.detector ? raw(cell.detector) : liveCellWord(t, cell.engine?.stateKey ?? "none");

// A logs-only service has no spans and no catalog entry, so its one way out is Logs.
const logsOnly = computed(
  () =>
    !!props.live &&
    !!props.row.identity?.streams.length &&
    !props.row.identity.streams.some((s) => s.type === "traces"),
);

// Open in Traces (or Logs) lands on the scope the charts read; the catalog opens filtered to the service.
const openTraces = (tab?: string) => {
  const org = store.state.selectedOrganization?.identifier;
  const to =
    !tab && props.row.identity
      ? serviceRoute(
          props.row,
          String(org ?? ""),
          Date.now() * 1000,
          props.live ? serviceCharts.scopes.value : {},
        )
      : null;
  if (to) {
    void router.push(to);
    return;
  }
  const service = props.row.identity?.serviceName;
  void router.push({
    name: "traces",
    query: {
      org_identifier: org,
      ...(tab ? { tab } : {}),
      ...(tab === "services-catalog" && service ? { service } : {}),
    },
  });
};

const { run, pendingId } = useInsightActions();
const orgId = computed(() => String(store.state.selectedOrganization?.identifier ?? ""));
// Drafts land where the service's own alerts live and notify whom they notify; none read means the org default.
const owned = shallowRef<OwnedAlert[]>([]);
const ownedKey = computed(() =>
  props.live ? `${orgId.value}|${ownedAlertIds(props.row).join(",")}` : "",
);
watch(
  ownedKey,
  async (key) => {
    owned.value = [];
    const ids = props.live ? ownedAlertIds(props.row) : [];
    if (!ids.length) return;
    const found = await loadOwnedAlerts(orgId.value, ids);
    if (key === ownedKey.value) owned.value = found;
  },
  { immediate: true },
);
// The CTA counts only drafts the stream fields allow, so it never promises a list of alerts it can't build.
const cant = shallowRef<Set<BulkKind>>(new Set());
const cantKey = computed(() =>
  props.live && state.value === "gap" ? `${orgId.value}|${props.row.service}` : "",
);
watch(
  cantKey,
  async (key) => {
    cant.value = new Set();
    if (!key) return;
    const found = await cantBuildKinds(orgId.value, props.row);
    if (key === cantKey.value) cant.value = found;
  },
  { immediate: true },
);
const gapParts = computed(() =>
  props.live && state.value === "gap"
    ? gapInsight(t, locale.value, props.row, owned.value, orgId.value, cant.value)
    : null,
);
// The address query and the locations read run only once Synthetic check is open, not per drawer.
const probeOpen = computed(() => !!props.live && extraOpen.value === "external_probe");
const { address } = useServiceAddress(() => (probeOpen.value ? probeScope(props.row) : null));
const locations = shallowRef<SyntheticsLocation[]>([]);
let locationsOrg: string | null = null;
watch(probeOpen, async (open) => {
  if (!open || locationsOrg === orgId.value) return;
  const org = orgId.value;
  locationsOrg = org;
  try {
    const res = await syntheticsService.getLocations(org);
    if (org === orgId.value) locations.value = (res.data as any)?.locations ?? [];
  } catch {
    locationsOrg = null;
  }
});
const insightFor = (key: string, cell: CoverageCell) =>
  props.live && props.row.identity
    ? cellInsight(
        t,
        locale.value,
        props.row,
        key as LiveCheck,
        cell,
        orgId.value,
        { address: address.value, locations: locations.value },
        owned.value,
      )
    : null;
// The cell's own alerts, from the alert list the drawer already read.
function cellAlerts(cell: CoverageCell): OwnedAlert[] {
  if (!props.live || !cell.engine) return [];
  const ids = new Set(cell.engine.monitors.filter((m) => m.kindKey === "alert").map((m) => m.id));
  return owned.value.filter((a) => a.id && ids.has(a.id));
}

// last_triggered_at moves on every evaluation; last_satisfied_at moves only when the alert fires.
const lastFiredOf = (cell: CoverageCell): I18nText | null => {
  const at = Math.max(0, ...cellAlerts(cell).map((a) => a.last_satisfied_at ?? 0));
  if (!at) return null;
  return agoText(t, locale.value, Math.max(0, Math.floor((Date.now() - at / 1000) / 60_000)));
};
const chartInsight = (signal: Signal, cell: CoverageCell) =>
  insightFor(LIVE_CELL[signal as LiveChartSignal] ?? signal, cell);
</script>
