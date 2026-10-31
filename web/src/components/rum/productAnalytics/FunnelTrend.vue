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
  <div class="flex min-w-0 flex-col" data-test="rum-analytics-funnel-trend">
    <OEmptyState
      v-if="issue"
      preset="no-search-results"
      size="block"
      :title="
        issue === 'tooShort'
          ? t('rum.analytics.funnel.trendTooShort')
          : t('rum.analytics.funnel.trendTooMany')
      "
      data-test="rum-analytics-funnel-trend-range-issue"
    />
    <AnalyticsPanelState
      v-else
      :state="state"
      data-test="rum-analytics-funnel-trend"
      class="px-4 py-2"
      @retry="emit('retry')"
    >
      <OEmptyState
        v-if="empty"
        preset="no-search-results"
        size="block"
        :title="t('rum.analytics.funnel.trendEmpty', { unit: unitNoun })"
        :description="t('rum.analytics.funnel.trendEmptyDescription', { step: pair.a })"
        data-test="rum-analytics-funnel-trend-empty"
      />
      <template v-else-if="periods">
        <!-- ChartRenderer, not PanelSchemaRenderer: the fixed bucket grid keeps empty buckets as banded gaps. -->
        <div class="h-64 w-full" data-test="rum-analytics-funnel-trend-chart">
          <ChartRenderer :data="{ options: chartOptions }" class="h-full w-full" />
        </div>
        <span
          class="text-text-secondary pb-2 text-xs"
          data-test="rum-analytics-funnel-trend-caption"
          >{{
            t("rum.analytics.funnel.trendCaption", { range: raw(range), tz: raw(timezone) })
          }}</span
        >
        <div class="-mx-4 min-w-0 overflow-x-auto" data-test="rum-analytics-funnel-trend-table">
          <OTable
            :data="rows"
            :columns="columns"
            :default-columns="false"
            row-key="id"
            pagination="none"
            sorting="none"
            dense
            :show-global-filter="false"
            :frame="false"
          >
            <template #cell-bucket="{ row }">
              <span
                class="flex flex-wrap items-center gap-1.5"
                :data-test="`${rowTest(row)}-label`"
              >
                <span :class="row.kind === 'bucket' ? 'text-text-body' : 'text-text-heading'">{{
                  row.label
                }}</span>
                <span v-for="tag in row.tags" :key="tag.id">
                  <OTag
                    :label="tag.label"
                    variant="default-soft"
                    size="xs"
                    :data-test="`${rowTest(row)}-${tag.id}`"
                  />
                  <OTooltip v-if="tag.tip" :content="tag.tip" />
                </span>
              </span>
            </template>
            <template #cell-entered="{ row }">
              <span
                class="flex justify-end tabular-nums"
                :class="row.entered === 0 ? 'text-text-secondary' : 'text-text-body'"
                >{{ formatCount(row.entered ?? 0, 1) }}</span
              >
            </template>
            <template #cell-reached="{ row }">
              <span
                class="flex justify-end tabular-nums"
                :class="row.reached === 0 ? 'text-text-secondary' : 'text-text-body'"
                >{{ formatCount(row.reached ?? 0, 1) }}</span
              >
            </template>
            <template #cell-conversion="{ row }">
              <span
                v-if="row.note"
                class="text-text-secondary flex justify-end"
                :data-test="`${rowTest(row)}-note`"
                >{{ row.note }}</span
              >
              <span v-else :data-test="`${rowTest(row)}-rate`">
                <ODataBarCell
                  :value="(row.rate ?? 0) * 100"
                  :max="100"
                  :display="pct(row.rate ?? 0)"
                />
                <OTooltip v-if="row.rateTip" :content="row.rateTip" />
              </span>
            </template>
            <template #cell-previous="{ row }">
              <span
                class="text-text-secondary flex justify-end tabular-nums"
                :data-test="`${rowTest(row)}-previous`"
                >{{ row.previous }}<OTooltip v-if="previousTip" :content="previousTip"
              /></span>
            </template>
            <template v-for="(c, i) in pivotColumns" :key="c" #[`cell-${c}`]="{ row }">
              <span
                class="flex justify-end tabular-nums"
                :class="row.pivot?.[i] == null ? 'text-text-secondary' : 'text-text-body'"
                :data-test="`${rowTest(row)}-${c}`"
                >{{ row.pivot?.[i] == null ? dash : pct(row.pivot[i]!) }}</span
              >
            </template>
          </OTable>
        </div>
      </template>
    </AnalyticsPanelState>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount } from "@/utils/rum/productAnalyticsModel";
import type { FunnelPair } from "@/utils/rum/productAnalyticsQueries";
import {
  PIVOT_MAX_BUCKETS,
  TREND_LOW_VOLUME,
  bucketLabel,
  isTrendEmpty,
  trendAverage,
  type TrendBucket,
  type TrendPeriods,
  type TrendPreviousView,
  type TrendSeries,
} from "@/utils/rum/funnelTrend";
import { trendChartOptions } from "@/components/rum/productAnalytics/funnelParts/funnelTrendChart";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

interface Tag {
  id: string;
  label: I18nText;
  tip?: I18nText;
}

interface Row {
  id: string;
  kind: "bucket" | "value";
  label: I18nText;
  tags: Tag[];
  entered: number | null;
  reached: number | null;
  rate: number | null;
  rateTip?: I18nText;
  note: I18nText | null;
  previous?: string;
  pivot?: (number | null)[];
}

defineOptions({ name: "FunnelTrend" });

const props = withDefaults(
  defineProps<{
    state: PanelState<unknown>;
    series: TrendSeries[];
    periods: TrendPeriods | null;
    issue?: "tooShort" | "tooMany" | null;
    breakdown?: boolean;
    pair: FunnelPair;
    pairLabel: I18nText;
    dimLabel?: I18nText;
    previous?: TrendPreviousView | null;
    timezone: string;
    range: string;
    unitNoun: I18nText;
    dataStartUs?: number | null;
    today?: boolean;
  }>(),
  {
    issue: null,
    breakdown: false,
    dimLabel: () => raw(""),
    previous: null,
    dataStartUs: null,
    today: true,
  },
);
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18nTyped();

const dash = raw("—");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const g = computed(() => props.periods?.granularity ?? "day");
const label = (us: number) => bucketLabel(us, props.timezone, g.value);
const labels = computed(() => props.periods?.boundariesUs.map(label) ?? []);
const empty = computed(() => props.state.status === "ok" && isTrendEmpty(props.series));
const pivot = computed(() => props.breakdown && labels.value.length <= PIVOT_MAX_BUCKETS);
const pivotColumns = computed(() => (pivot.value ? labels.value.map((_, i) => `b${i}`) : []));
const intervalName = computed(() =>
  g.value === "week"
    ? t("rum.analytics.funnel.intervalNameWeek")
    : g.value === "month"
      ? t("rum.analytics.funnel.intervalNameMonth")
      : t("rum.analytics.funnel.intervalNameDay"),
);
const stillLabel = computed(() =>
  props.today && g.value === "day"
    ? t("rum.analytics.funnel.trendStillConvertingToday")
    : t("rum.analytics.funnel.trendStillConverting"),
);
const previousTip = computed<I18nText | undefined>(() =>
  props.previous?.status === "failed" ? t("rum.analytics.funnel.previousFailed") : undefined,
);

const rowTest = (row: Row) => `rum-analytics-funnel-trend-row-${row.id}`;

// Before the first data, empty is expected; after the last event, it may only be late.
const bandLabel = (b: TrendBucket): I18nText | null => {
  if (b.beforeData && props.dataStartUs !== null)
    return t("rum.analytics.funnel.trendNoDataBefore", { date: label(props.dataStartUs) });
  if (!b.empty) return null;
  return b.arriving
    ? t("rum.analytics.funnel.trendArriving")
    : t("rum.analytics.funnel.trendNoUnits", { unit: props.unitNoun });
};

const tagsOf = (b: TrendBucket): Tag[] => [
  ...(b.stillConverting
    ? [
        {
          id: "still",
          label: t("rum.analytics.funnel.trendStillConverting"),
          tip: t("rum.analytics.funnel.trendStillConvertingTooltip", {
            unit: props.unitNoun,
            step: props.pair.b,
          }),
        },
      ]
    : []),
  ...(b.partial && !b.stillConverting
    ? [
        {
          id: "partial",
          label: t("rum.analytics.funnel.trendPartial"),
          tip: t("rum.analytics.funnel.trendPartialTooltip", { interval: intervalName.value }),
        },
      ]
    : []),
  ...(b.arriving && !b.empty
    ? [{ id: "arriving", label: t("rum.analytics.funnel.trendArriving") }]
    : []),
  ...(b.lowVolume && !b.beforeData
    ? [
        {
          id: "low",
          label: t("rum.analytics.funnel.trendLowVolume"),
          tip: t("rum.analytics.funnel.trendLowVolumeTooltip", {
            n: TREND_LOW_VOLUME,
            unit: props.unitNoun,
          }),
        },
      ]
    : []),
];

const previousText = (i: number): string => {
  const p = props.previous;
  const b = p?.status === "ok" ? p.buckets[i] : null;
  if (!b) return "—";
  const date = label(b.startUs);
  return b.rate === null
    ? String(t("rum.analytics.funnel.trendPrevEmpty", { date, unit: props.unitNoun }))
    : String(t("rum.analytics.funnel.trendPrevCell", { date, rate: pct(b.rate) }));
};

const seriesLabel = (s: TrendSeries): I18nText => {
  if (s.kind === "other") return t("rum.analytics.funnel.other");
  if (s.kind === "notSet") return t("rum.analytics.funnel.notSet");
  return s.kind === "all" ? props.pairLabel : raw(s.value ?? "");
};

const bucketRows = computed<Row[]>(() =>
  (props.series[0]?.buckets ?? []).map((b, i) => ({
    id: String(i),
    kind: "bucket",
    label: raw(labels.value[i] ?? ""),
    tags: tagsOf(b),
    entered: b.entered,
    reached: b.reached,
    rate: b.rate,
    note: b.rate === null || b.beforeData ? bandLabel(b) : null,
    ...(props.previous ? { previous: previousText(i) } : {}),
  })),
);

const valueRows = computed<Row[]>(() =>
  props.series.map((s, k) => {
    const avg = trendAverage(s);
    return {
      id: `v${k}`,
      kind: "value",
      label: seriesLabel(s),
      tags: [],
      entered: avg.entered,
      reached: avg.reached,
      rate: avg.rate,
      rateTip: t("rum.analytics.funnel.trendAverageTooltip", { interval: intervalName.value }),
      note: avg.rate === null ? dash : null,
      pivot: s.buckets.map((b) => (b.beforeData ? null : b.rate)),
    };
  }),
);

const rows = computed<Row[]>(() => (props.breakdown ? valueRows.value : bucketRows.value));

const bucketHeader = computed(() =>
  g.value === "week"
    ? t("rum.analytics.funnel.intervalWeek")
    : g.value === "month"
      ? t("rum.analytics.funnel.intervalMonth")
      : t("rum.analytics.funnel.intervalDay"),
);

const previousHeader = computed(() =>
  g.value === "week"
    ? t("rum.analytics.funnel.trendPrevSameWeek")
    : g.value === "month"
      ? t("rum.analytics.funnel.trendPrevSameMonth")
      : t("rum.analytics.funnel.trendPrevSameDay"),
);

const countColumns = computed<OTableColumnDef<Row>[]>(() => [
  {
    id: "entered",
    header: t("rum.analytics.funnel.trendEntered", { n: props.pair.a }),
    accessorKey: "entered",
    size: 130,
    meta: { align: "right" },
  },
  {
    id: "reached",
    header: t("rum.analytics.funnel.trendReached", { n: props.pair.b }),
    accessorKey: "reached",
    size: 130,
    meta: { align: "right" },
  },
]);

const columns = computed<OTableColumnDef<Row>[]>(() => {
  const first: OTableColumnDef<Row> = {
    id: "bucket",
    header: props.breakdown ? props.dimLabel : bucketHeader.value,
    accessorKey: "label",
    size: 180,
    meta: { fillRemaining: true },
  };
  if (pivot.value) {
    const still = (i: number) => props.series.some((s) => s.buckets[i]?.stillConverting);
    return [
      first,
      ...labels.value.map((l, i) => ({
        id: `b${i}`,
        header: still(i) ? raw(`${l} · ${stillLabel.value}`) : raw(l),
        accessorFn: (r: Row) => r.pivot?.[i] ?? null,
        size: 100,
        meta: { align: "right" as const },
      })),
    ];
  }
  return [
    first,
    ...countColumns.value,
    {
      id: "conversion",
      header: props.breakdown
        ? t("rum.analytics.funnel.trendAverage")
        : t("rum.analytics.funnel.conversion"),
      accessorKey: "rate",
      size: 150,
      meta: { align: "right" },
    },
    ...(props.previous && !props.breakdown
      ? [
          {
            id: "previous",
            header: previousHeader.value,
            accessorKey: "previous" as const,
            size: 190,
            meta: { align: "right" as const },
          },
        ]
      : []),
  ];
});

const chartOptions = computed(() =>
  trendChartOptions(
    {
      labels: labels.value,
      series: props.series.map((s) => ({
        name:
          s.kind === "all" && props.previous
            ? `${props.pairLabel} · ${props.range}`
            : String(seriesLabel(s)),
        data: s,
      })),
      previous:
        props.previous?.status === "ok" && !props.breakdown
          ? {
              name: String(
                t("rum.analytics.funnel.trendPrevSeriesOf", {
                  range: raw(props.previous.range),
                  label: props.previous.label,
                }),
              ),
              buckets: props.previous.buckets,
              labels: props.previous.buckets.map((b) => (b ? label(b.startUs) : "")),
            }
          : null,
      stillConvertingName: stillLabel.value,
      bandLabel,
      unitNoun: props.unitNoun,
    },
    t,
  ),
);
</script>
