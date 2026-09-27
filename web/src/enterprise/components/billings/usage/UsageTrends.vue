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

<!-- Cost over any range the metering data covers, each day priced by the cycle it fell in. -->
<template>
  <div class="flex flex-col gap-2.5" data-test="billings-usagetrends-root">
    <OEmptyState
      v-if="!usageStreamEnabled"
      size="block"
      :title="t('billing.usageTrends.enableTitle')"
      :description="t('billing.usageTrends.enableSubtitle')"
      :action-label="t('billing.usageTrends.enableButton')"
      data-test="billings-usagetrends-enable"
      @action="showEnableConfirm = true"
    />

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <OToggleGroup
          :model-value="preset"
          data-test="billings-usagetrends-range"
          @update:model-value="onPresetChange"
        >
          <OToggleGroupItem
            v-for="option in presetOptions"
            :key="option.value"
            :value="option.value"
            size="sm"
          >
            {{ t(option.labelKey) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <!-- A super org reads the whole group by default; one org narrows every figure below. -->
        <div v-if="billingOrgs.length" class="w-56">
          <OSelect
            :model-value="selectedOrg?.id ?? ALL_ORGS"
            :options="orgOptions"
            label-key="label"
            value-key="value"
            size="sm"
            searchable
            :aria-label="t('billing.usageV2.orgFilter')"
            data-test="billings-usagetrends-org"
            @update:model-value="selectOrg"
          />
        </div>
        <!-- The logs search bar's picker; absolute-only is the mode in which it greys out days before `min-date`. -->
        <DateTime
          auto-apply
          disable-relative
          menu-align="end"
          class="ms-auto"
          default-type="absolute"
          :default-absolute-time="pickerDefault"
          :min-date="minDate"
          :query-range-restriction-msg="historyNote"
          :query-range-restriction-in-hour="historyHours"
          data-test="billings-usagetrends-picker"
          @on:date-change="onPickerChange"
        />
        <ORefreshButton
          :last-run-at="lastLoadedAt"
          :loading="loading"
          data-test="billings-usagetrends-refresh"
          @click="refresh"
        />
      </div>

      <KpiCardRow :columns="4" class="shrink-0" data-test="billings-usagetrends-kpis">
        <UsageKpiCard
          v-for="card in kpiCards"
          :key="card.key"
          :label="card.label"
          :icon="card.icon"
          :value="card.value"
          :hint="card.hint"
          :loading="loading"
          :data-test="`billings-usagetrends-kpi-${card.key}`"
        />
      </KpiCardRow>

      <section
        class="border-border-default rounded-surface @container/usage-trends overflow-hidden border"
      >
        <div
          class="grid @min-[56.25rem]/usage-trends:grid-cols-[minmax(0,1.6fr)_minmax(17.5rem,0.9fr)]"
        >
          <div class="flex min-w-0 flex-col" data-test="billings-usagetrends-chart-pane">
            <UsagePaneHeader
              :title="
                forecast ? t('billing.usageV2.spendToDate') : t('billing.usageV2.costOverTime')
              "
              :subtitle="t('billing.usageV2.estimatedAtCyclePrice')"
            >
              <template v-if="canForecast" #actions>
                <OSwitch
                  v-model="showForecast"
                  size="sm"
                  :label="t('billing.usageV2.forecast')"
                  data-test="billings-usagetrends-forecast-toggle"
                />
              </template>
            </UsagePaneHeader>
            <OEmptyState
              v-if="streamMissing"
              size="inline"
              :title="t('billing.usageTrends.waitingTitle')"
              :description="t('billing.usageTrends.waitingForData')"
              data-test="billings-usagetrends-empty"
            />
            <!-- The renderer sizes itself with h-full, so its parent needs a definite height. -->
            <div v-else class="relative h-90 w-full p-2">
              <UsageChartSkeleton
                v-if="loading"
                class="absolute inset-0 z-10 p-4"
                data-test="billings-usagetrends-chart-loading"
              />
              <ChartRenderer
                class="h-full w-full"
                :data="{ options: chartOption }"
                data-test="billings-usagetrends-chart"
              />
            </div>
          </div>

          <aside
            class="border-border-default flex min-w-0 flex-col border-t @min-[56.25rem]/usage-trends:border-s @min-[56.25rem]/usage-trends:border-t-0"
            :aria-label="t('billing.usageV2.costByMeter')"
          >
            <UsagePaneHeader :title="t('billing.usageV2.costByMeter')" :subtitle="rangeLabel" />
            <OTable
              :data="meterRows"
              :columns="meterColumns"
              row-key="key"
              pagination="none"
              sorting="none"
              :show-global-filter="false"
              :loading="loading"
              :error="loadError ? t('billing.usageV2.trendsLoadFailed') : null"
              :row-class="meterRowClass"
              class="min-h-0 flex-1"
              data-test="billings-usagetrends-meters"
              @row-click="toggleMeter"
            >
              <template #cell-label="{ row }">
                <span class="flex min-w-0 items-center gap-2" :title="isolateHint(row)">
                  <span
                    class="rounded-default h-2.5 w-2.5 shrink-0"
                    :style="{ backgroundColor: meterColorFor(row.key) }"
                  />
                  <span class="truncate font-medium">{{ row.label }}</span>
                </span>
              </template>
              <template #cell-cost="{ row }">
                <div class="flex w-full min-w-28 flex-col gap-1">
                  <span class="font-semibold">{{ formatCost(row.cost, precise) }}</span>
                  <OProgressBar :value="row.share" :color="meterColorFor(row.key)" />
                </div>
              </template>
              <template #error>
                <span class="text-text-secondary p-4 text-sm">
                  {{ t("billing.usageV2.trendsLoadFailed") }}
                </span>
              </template>
            </OTable>
          </aside>
        </div>
      </section>
    </template>

    <ConfirmDialog
      v-model="showEnableConfirm"
      data-test="billings-usagetrends-enable-confirm"
      :title="t('billing.usageTrends.enableConfirmTitle')"
      :message="t('billing.usageTrends.enableConfirmMessage')"
      :ok-label="t('billing.usageTrends.enableButton')"
      @update:ok="enableUsageReporting"
      @update:cancel="showEnableConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import DateTime from "@/components/DateTime.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import { timestampToTimezoneDate } from "@/utils/timezone";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import organizations from "@/services/organizations";
import searchService from "@/services/search";
import { toast } from "@/lib/feedback/Toast/useToast";
import UsageKpiCard from "./UsageKpiCard.vue";
import UsagePaneHeader from "./UsagePaneHeader.vue";
import UsageChartSkeleton from "./UsageChartSkeleton.vue";
import {
  formatCost,
  METERS,
  type BillingOrg,
  type MeterKey,
  type MeteringDetails,
} from "./meteringModel";
import { buildTrendsChartOption, meterColorFor } from "./usageCharts";
import { trendsCostSql } from "./usageQueries";
import {
  bucketSeconds,
  cyclePrices,
  forecastCycle,
  PRICED_EVENTS,
  summarizeTrend,
  toEpochSeconds,
  trendBucket,
  type CostRow,
} from "./trendsModel";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

type Preset = "current" | "last" | "last90" | "custom";

interface Window {
  /** Unix seconds. */
  start: number;
  end: number;
}

interface MeterRow {
  key: MeterKey;
  label: I18nText;
  cost: number;
  /** Share of the largest meter, for the bar. */
  share: number;
}

const SECONDS_PER_DAY = 86_400;

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const FULL_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const props = withDefaults(
  defineProps<{
    details: MeteringDetails | null;
    /** Current cycle first, then closed cycles, newest first. */
    cycles: MeteringDetails[];
    /** The oldest moment the picker may reach; seconds or microseconds, the backend sends both. */
    oldestTs?: number | null;
    /** A super org's orgs, itself first; empty for any other org. */
    billingOrgs?: BillingOrg[];
  }>(),
  { billingOrgs: () => [] },
);

const { t } = useI18nTyped();
const store = useStore();

const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

const route = useRoute();
const router = useRouter();

/** The org selector's value for the whole group. */
const ALL_ORGS = "__all__";

/** Shares `?org=` with Overview, so an org picked on one tab stays picked on the other. */
const selectedOrg = computed<BillingOrg | null>(
  () => props.billingOrgs.find((org) => org.id === route.query.org) ?? null,
);

const orgOptions = computed(() => [
  { label: String(t("billing.usageV2.allOrgs")), value: ALL_ORGS },
  ...props.billingOrgs.map((org) => ({
    label: org.isSelf ? String(t("billing.usageV2.thisOrg", { org: org.name })) : org.name,
    value: org.id,
  })),
]);

/** Whose usage the page counts: one org, or null for a super org's whole group. */
const usageOrg = computed<string | null>(() =>
  props.billingOrgs.length ? (selectedOrg.value?.id ?? null) : orgId.value,
);

const selectOrg = (value: unknown) => {
  const id = typeof value === "string" && value !== ALL_ORGS ? value : undefined;
  router.replace({ query: { ...route.query, org: id } });
};

const usageStreamEnabled = computed<boolean>(
  () => !!store.state?.organizationData?.organizationSettings?.usage_stream_enabled,
);

const showEnableConfirm = ref(false);
const enabling = ref(false);

/** Merge with the current settings so the POST cannot clobber another org parameter. */
const enableUsageReporting = async () => {
  showEnableConfirm.value = false;
  if (enabling.value) return;
  enabling.value = true;
  const updated = {
    ...(store.state?.organizationData?.organizationSettings ?? {}),
    usage_stream_enabled: true,
  };
  try {
    await organizations.post_organization_settings(orgId.value, updated);
    store.dispatch("setOrganizationSettings", updated);
    toast({ variant: "success", message: t("billing.usageTrends.enablePending"), timeout: 5000 });
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.message) || t("billing.failedToEnableUsageReporting"),
      timeout: 5000,
    });
  } finally {
    enabling.value = false;
  }
};

// ── Range ────────────────────────────────────────────────────────

const nowSeconds = () => Math.floor(Date.now() / 1000);

const upcoming = computed(() => props.cycles[0] ?? props.details ?? null);

const lastCycle = computed(() => props.cycles[1] ?? null);

/** Neither the picker nor a preset may reach back past the data the metering API priced. */
const oldest = computed(() => {
  const fromApi = toEpochSeconds(props.oldestTs);
  return fromApi || upcoming.value?.cycle_start || nowSeconds() - 30 * SECONDS_PER_DAY;
});

/** A range wholly before the data moves forward to start on it, keeping its length. */
const clamp = (span: Window): Window => {
  const start = Math.max(span.start, oldest.value);
  const length = Math.max(span.end - span.start, 60);
  return { start, end: span.end > start ? span.end : start + length };
};

const preset = ref<Preset>("current");
const customWindow = ref<Window | null>(null);

const presetOptions = computed(() => {
  const options: { value: Preset; labelKey: I18nKey }[] = [
    { value: "current", labelKey: "billing.usageV2.rangeCurrentCycle" },
  ];
  if (lastCycle.value) options.push({ value: "last", labelKey: "billing.usageV2.rangeLastCycle" });
  options.push({ value: "last90", labelKey: "billing.usageV2.rangeLast90Days" });
  return options;
});

const range = computed<Window>(() => {
  const now = nowSeconds();
  if (preset.value === "custom" && customWindow.value) return clamp(customWindow.value);
  if (preset.value === "last" && lastCycle.value) {
    return clamp({ start: lastCycle.value.cycle_start, end: lastCycle.value.cycle_end });
  }
  if (preset.value === "last90") return clamp({ start: now - 90 * SECONDS_PER_DAY, end: now });
  const cycle = upcoming.value;
  return clamp(
    cycle ? { start: cycle.cycle_start, end: cycle.cycle_end } : { start: now, end: now },
  );
});

const onPresetChange = (value: unknown) => {
  if (typeof value !== "string" || !value) return;
  preset.value = value as Preset;
  customWindow.value = null;
};

/**
 * Why days before `oldest` are greyed out, shown on the picker's info icon and on the days.
 * The hour count only turns that note on: Trends has no relative presets for it to limit.
 */
const historyNote = computed(() =>
  String(
    t("billing.usageV2.historyStartsOn", {
      date: raw(FULL_DATE.format(new Date(oldest.value * 1000))),
    }),
  ),
);
const historyHours = computed(() => Math.max(Math.ceil((nowSeconds() - oldest.value) / 3_600), 1));

/** DateTime compares calendar days as `yyyy/MM/dd` strings in the org's timezone. */
const minDate = computed(() =>
  timestampToTimezoneDate(oldest.value * 1000, store.state.timezone, "yyyy/MM/dd"),
);

/** The picker opens on the range the page is showing, in microseconds as it expects. */
const pickerDefault = computed(() => ({
  startTime: range.value.start * 1_000_000,
  endTime: range.value.end * 1_000_000,
}));

/** DateTime also emits on mount; only a change the user made should leave the preset. */
const onPickerChange = (value: {
  startTime?: number | string;
  endTime?: number | string;
  userChangedValue?: boolean;
}) => {
  if (!value?.userChangedValue) return;
  const start = Math.floor(Number(value.startTime) / 1_000_000);
  const end = Math.floor(Number(value.endTime) / 1_000_000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  customWindow.value = { start, end: Math.min(end, nowSeconds()) };
  preset.value = "custom";
};

/** Usage exists only up to now, so an open cycle's KPIs and labels stop at today, not the cycle end. */
const measuredEnd = computed(() => Math.min(range.value.end, nowSeconds()));

const rangeLabel = computed(() =>
  t("billing.usageV2.rangeDates", {
    start: raw(SHORT_DATE.format(new Date(range.value.start * 1000))),
    end: raw(SHORT_DATE.format(new Date(measuredEnd.value * 1000))),
  }),
);

// ── Data ─────────────────────────────────────────────────────────

const prices = computed(() => cyclePrices(props.cycles.length ? props.cycles : []));

const only = ref<MeterKey | null>(null);

const rows = ref<CostRow[]>([]);
/** A failed read shows as a dash, never as $0.00, which would claim there was no usage. */
const loadError = ref(false);
const loading = ref(true);
const streamMissing = ref(false);
const lastLoadedAt = ref<number | null>(null);

/** Chart slot width; a short custom range gets hours or minutes so it is not one bar. */
const bucket = computed(() => trendBucket(range.value.start, range.value.end));

let latestLoad = 0;

/** The chart's own query at a daily bucket, so the totals are exactly what the bars add up to. */
const loadCosts = async () => {
  if (!usageStreamEnabled.value) return;
  const loadId = ++latestLoad;
  loading.value = true;
  loadError.value = false;
  try {
    // Log search is never cached by house rule, so this goes to the service directly.
    const response = await searchService.search({
      org_identifier: orgId.value,
      page_type: "logs",
      query: {
        query: {
          sql: trendsCostSql(usageOrg.value, prices.value, bucket.value),
          start_time: range.value.start * 1_000_000,
          end_time: range.value.end * 1_000_000,
          from: 0,
          size: 10_000,
        },
      },
    });
    if (loadId !== latestLoad) return;
    rows.value = ((response?.data?.hits ?? []) as Record<string, unknown>[]).map((hit) => ({
      ts: bucketSeconds(hit.x_axis_1),
      event: String(hit.breakdown_1 ?? ""),
      cost: Number(hit.y_axis_1) || 0,
    }));
    streamMissing.value = false;
    lastLoadedAt.value = Date.now();
  } catch (err: any) {
    if (loadId !== latestLoad) return;
    rows.value = [];
    // The `usage` stream only exists once the org has reported usage.
    const message = String(err?.response?.data?.message ?? err?.message ?? "").toLowerCase();
    streamMissing.value = message.includes("stream not found") && message.includes("usage");
    loadError.value = !streamMissing.value;
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
};

watch([range, prices, usageStreamEnabled, usageOrg], loadCosts, { immediate: true });

const emit = defineEmits<{ refresh: [] }>();

/** Reloads the metering response too, so new cycles and rates come with the new usage. */
const refresh = () => {
  emit("refresh");
  loadCosts();
};

/** KPIs and the forecast count days, whatever bucket the chart uses. */
const dayRows = computed(() =>
  rows.value.map((row) => ({
    ...row,
    ts: Math.floor(row.ts / SECONDS_PER_DAY) * SECONDS_PER_DAY,
  })),
);

const summary = computed(() => summarizeTrend(dayRows.value, only.value));

/** Two decimals would read $0.00 for a real but sub-cent amount, so it gets four. */
const subCent = (value: number) => value > 0 && value < 0.01;

const precise = computed(() => subCent(summary.value.total));

const showForecast = ref(true);

/** Only the open cycle has days left to project, so the toggle shows for that range alone. */
const canForecast = computed(() => {
  const cycle = upcoming.value;
  return preset.value === "current" && !!cycle && cycle.cycle_end > nowSeconds();
});

const forecast = computed(() => {
  const cycle = upcoming.value;
  if (!cycle || !canForecast.value || !showForecast.value) return null;
  return forecastCycle(summary.value, cycle.cycle_start, cycle.cycle_end);
});

// ── KPIs ─────────────────────────────────────────────────────────

const meterLabel = (key: MeterKey): I18nText => {
  const def = METERS.find((entry) => entry.key === key);
  return def ? t(def.labelKey) : raw(key);
};

const kpiCards = computed(() => {
  const s = summary.value;
  const f = forecast.value;
  const cycle = upcoming.value;
  const spanDays = Math.max(
    Math.ceil((measuredEnd.value - range.value.start) / SECONDS_PER_DAY),
    1,
  );
  const cycleDays = cycle ? Math.round((cycle.cycle_end - cycle.cycle_start) / SECONDS_PER_DAY) : 0;
  const cycleDay = cycle
    ? Math.min(Math.floor((nowSeconds() - cycle.cycle_start) / SECONDS_PER_DAY) + 1, cycleDays)
    : 0;
  const peak = s.days.reduce((best, day) => (day.cost > best.cost ? day : best), {
    ts: 0,
    cost: 0,
  });
  const top = s.meters.find((meter) => meter.cost > 0);
  const cost = (value: number) => (loadError.value ? raw("—") : formatCost(value, precise.value));
  const date = (seconds: number) => raw(SHORT_DATE.format(new Date(seconds * 1000)));

  const cards: { key: string; label: I18nText; icon: IconName; value: I18nText; hint: I18nText }[] =
    [
      {
        key: "total",
        label: f ? t("billing.usageV2.costSoFar") : t("billing.usageV2.totalCost"),
        icon: "attach-money",
        value: cost(s.total),
        hint: f
          ? t("billing.usageV2.cycleDay", { day: cycleDay, total: cycleDays })
          : rangeLabel.value,
      },
      f
        ? {
            key: "pace",
            label: t("billing.usageV2.runRate"),
            icon: "show-chart",
            value: t("billing.usageV2.perDay", { cost: formatCost(f.pace, subCent(f.pace)) }),
            hint: t("billing.usageV2.runRateWindow", { days: f.paceDays }),
          }
        : {
            key: "pace",
            label: t("billing.usageV2.dailyAverage"),
            icon: "show-chart",
            value: cost(s.total / spanDays),
            hint: t("billing.usageV2.acrossDays", { days: spanDays }),
          },
      f && cycle
        ? {
            key: "projected",
            label: t("billing.usageV2.projectedTotal"),
            icon: "trending-up",
            value: cost(f.projected),
            hint: t("billing.usageV2.projectedRange", {
              low: cost(f.low),
              high: cost(f.high),
              date: date(cycle.cycle_end),
            }),
          }
        : {
            key: "peak",
            label: t("billing.usageV2.peakDay"),
            icon: "trending-up",
            value: cost(peak.cost),
            hint: peak.ts ? date(peak.ts) : raw("—"),
          },
      {
        key: "top",
        label: t("billing.usageV2.topMeter"),
        icon: "bar-chart",
        value: top ? meterLabel(top.key) : raw("—"),
        hint: top
          ? t("billing.usageV2.topMeterOfCost", {
              cost: cost(top.cost),
              percent: s.total > 0 ? Math.round((top.cost / s.total) * 100) : 0,
            })
          : t("billing.usageV2.noUsageInRange"),
      },
    ];
  return cards;
});

// ── Chart ────────────────────────────────────────────────────────

const chartEvents = computed(() =>
  only.value ? (METERS.find((def) => def.key === only.value)?.events ?? []) : PRICED_EVENTS,
);

const BUCKET_SECONDS: Record<string, number> = {
  "1 minute": 60,
  "1 hour": 3_600,
  "1 day": SECONDS_PER_DAY,
};

const SLOT_TIME = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" });

const chartOption = computed(() => {
  const step = BUCKET_SECONDS[bucket.value] ?? SECONDS_PER_DAY;
  const money = (value: number) => String(formatCost(value, precise.value));
  return buildTrendsChartOption({
    rows: rows.value,
    events: chartEvents.value,
    start: range.value.start,
    end: range.value.end,
    bucket: step,
    now: nowSeconds(),
    forecast: forecast.value,
    meterLabel: (key) => String(meterLabel(key)),
    money,
    slotLabel: (ts) =>
      (step === SECONDS_PER_DAY ? SHORT_DATE : SLOT_TIME).format(new Date(ts * 1000)),
    labels: {
      spendToDate: String(t("billing.usageV2.spendToDate")),
      forecast: String(t("billing.usageV2.forecast")),
      dayTotal: String(t("billing.usageV2.dayTotal")),
      projected: String(t("billing.usageV2.projectedTotal")),
    },
  });
});

// ── Meter list ───────────────────────────────────────────────────

const meterRows = computed<MeterRow[]>(() => {
  const all = summarizeTrend(dayRows.value).meters;
  const max = all[0]?.cost ?? 0;
  return all.map((meter) => ({
    key: meter.key,
    label: meterLabel(meter.key),
    cost: meter.cost,
    share: max > 0 ? meter.cost / max : 0,
  }));
});

const meterColumns = computed<OTableColumnDef<MeterRow>[]>(() => [
  {
    id: "label",
    header: t("billing.usageV2.colMeter"),
    accessorKey: "label",
    meta: { isName: true },
  },
  { id: "cost", header: t("billing.usageV2.colEstCost"), accessorKey: "cost" },
]);

const toggleMeter = (row: MeterRow) => {
  only.value = only.value === row.key ? null : row.key;
};

const meterRowClass = (row: MeterRow) =>
  only.value === row.key
    ? "cursor-pointer bg-table-row-selected-bg"
    : only.value
      ? "cursor-pointer text-text-secondary"
      : "cursor-pointer";

const isolateHint = (row: MeterRow) =>
  only.value === row.key
    ? t("billing.usageV2.showAllMeters")
    : t("billing.usageV2.showOnlyMeter", { meter: row.label });
</script>
