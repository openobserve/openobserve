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
  Cost for the current billing cycle, with what drives each meter beside it.

  Meter costs come only from the metering API; the `usage` stream is read only
  for the breakdown and the daily chart, where it is the sole source and so
  cannot contradict a billed number.
-->
<template>
  <div class="flex h-full min-h-0 flex-col gap-2.5" data-test="billings-usageoverview-root">
    <OBanner
      v-if="missingMeterNames"
      variant="warning"
      :content="t('billing.usageV2.missingMeters', { meters: missingMeterNames })"
      data-test="billings-usageoverview-missing-banner"
    />

    <OEmptyState
      v-if="!details"
      size="block"
      :title="t('billing.usageV2.noPricingTitle')"
      :description="t('billing.usageV2.noPricingSubtitle')"
      data-test="billings-usageoverview-no-pricing"
    />

    <template v-else>
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div class="text-text-secondary text-sm" data-test="billings-usageoverview-cycle">
          {{ formatCycle(details, t) }}
          <span class="text-text-body ms-2 font-medium">
            {{ t("billing.usageV2.cycleDay", { day: progress.day, total: progress.totalDays }) }}
          </span>
        </div>
        <ORefreshButton
          :last-run-at="lastLoadedAt"
          :loading="refreshing"
          data-test="billings-usageoverview-refresh"
          @click="refresh"
        />
      </div>

      <KpiCardRow
        :columns="kpiCards.length"
        class="shrink-0"
        data-test="billings-usageoverview-kpis"
      >
        <UsageKpiCard
          v-for="card in kpiCards"
          :key="card.key"
          :label="card.label"
          :value="card.value"
          :icon="card.icon"
          :value-suffix="card.valueSuffix"
          :hint="card.hint"
          :struck="card.struck"
          :positive="card.positive"
          :data-test="`billings-usageoverview-kpi-${card.key}`"
        />
      </KpiCardRow>

      <section
        class="bg-card-glass-bg rounded-default border-border-default @container/usage-breakdown flex min-h-0 flex-1 flex-col overflow-hidden border"
        :aria-label="t('billing.usageV2.costBreakdown')"
        data-test="billings-usageoverview-breakdown"
      >
        <UsageBillStrip
          v-if="isSuperOrg"
          :rows="orgRows"
          :total="orgTotals.total"
          :selected="selectedOrg?.id ?? null"
          :color-for="orgColor"
          :aria-label="t('billing.usageV2.costByOrg')"
          :click-hint="t('billing.usageV2.clickForOrg')"
          @select="selectOrg"
        />
        <UsageBillStrip
          v-else
          :rows="rows"
          :total="total"
          :selected="selectedMeter"
          :click-hint="t('billing.usageV2.clickForBreakdown')"
          @select="(key) => selectMeter(key as MeterKey | null)"
        />

        <div
          class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden @min-[56.25rem]/usage-breakdown:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
        >
          <div ref="breakdownAnchor" class="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <UsagePaneHeader v-if="selectedMeter" :title="meterTitle" :subtitle="meterSummary">
              <template #leading>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="chevron-left"
                  :aria-label="t('billing.usageV2.allMeters')"
                  data-test="billings-usageoverview-all-meters"
                  @click="selectMeter(null)"
                />
                <span
                  class="rounded-default h-2.5 w-2.5 shrink-0"
                  :style="{ backgroundColor: meterColorFor(selectedMeter) }"
                />
              </template>
              <template v-if="groupSections.length > 1" #actions>
                <span class="text-text-secondary text-2xs">{{ t("billing.usageV2.groupBy") }}</span>
                <OToggleGroup
                  :model-value="activeGroupId"
                  mobile-dropdown
                  data-test="billings-usageoverview-groups"
                  @update:model-value="onGroupChange"
                >
                  <OToggleGroupItem
                    v-for="item in groupSections"
                    :key="item.id"
                    :value="item.id"
                    size="sm"
                  >
                    {{ t(item.columnKey) }}
                  </OToggleGroupItem>
                </OToggleGroup>
              </template>
            </UsagePaneHeader>
            <UsagePaneHeader
              v-else-if="selectedOrg"
              :title="raw(selectedOrg.name)"
              :subtitle="orgSummary"
            >
              <template #leading>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="chevron-left"
                  :aria-label="t('billing.usageV2.allOrgs')"
                  data-test="billings-usageoverview-all-orgs"
                  @click="selectOrg(null)"
                />
                <span
                  class="rounded-default h-2.5 w-2.5 shrink-0"
                  :style="{ backgroundColor: orgColor(selectedOrg.id) }"
                />
              </template>
            </UsagePaneHeader>
            <UsagePaneHeader
              v-else-if="isSuperOrg"
              :title="t('billing.usageV2.costByOrg')"
              :subtitle="t('billing.usageV2.orgCostEstimated')"
            />
            <UsagePaneHeader v-else :title="t('billing.usageV2.costByMeter')" />

            <UsageMeterBreakdown
              v-if="selectedMeter"
              :key="`${selectedOrg?.id ?? 'self'}-${selectedMeter}`"
              :meter-key="selectedMeter"
              :scope-org-id="selectedOrg?.id"
              :details="details"
              :group="selectedGroup"
              :refresh-token="refreshToken"
              @update:group="selectGroup"
              @top-names="onTopNames"
              @sections="onSections"
            />
            <OEmptyState
              v-else-if="isSuperOrg && !selectedOrg && orgCostsFailed"
              size="inline"
              :title="t('billing.usageV2.orgCostsFailed')"
              data-test="billings-usageoverview-org-error"
            />
            <UsageMeterTable
              v-else-if="isSuperOrg && !selectedOrg"
              :rows="orgRows"
              :total="orgTotals.total"
              :gross="orgTotals.gross"
              :discount="orgTotals.discount"
              :color-for="orgColor"
              :name-header="t('billing.usageV2.colOrganization')"
              :loading="orgCostsLoading"
              data-test="billings-usageoverview-org-table"
              @select="selectOrg"
            />
            <UsageMeterTable
              v-else-if="selectedOrg"
              :rows="scopedRows"
              :total="scopedTotals.total"
              :gross="scopedTotals.gross"
              :discount="scopedTotals.discount"
              :share-header="t('billing.usageV2.shareOfOrg', { org: selectedOrg.name })"
              :loading="orgVolumesLoading"
              data-test="billings-usageoverview-org-meters"
              @select="(key) => selectMeter(key as MeterKey)"
            />
            <UsageMeterTable
              v-else
              :rows="meterRows"
              :total="total"
              :gross="subtotal"
              :discount="discountAmount"
              @select="(key) => selectMeter(key as MeterKey)"
            />
          </div>

          <aside
            class="border-border-default flex min-h-0 min-w-0 flex-col overflow-hidden border-t @min-[56.25rem]/usage-breakdown:border-s @min-[56.25rem]/usage-breakdown:border-t-0"
            :aria-label="t('billing.usageV2.dailyCost')"
            data-test="billings-usageoverview-daily-pane"
          >
            <UsagePaneHeader :title="t('billing.usageV2.dailyCost')" :subtitle="chartSubtitle" />
            <!-- The renderer sizes itself with h-full, so the flex chain above must stay height-definite. -->
            <div v-if="chartSchema" class="relative min-h-60 w-full flex-1 p-2">
              <!-- The renderer only suppresses its own "no data" once it knows it is
                   loading, so it flashes empty on the first tick; the skeleton covers
                   that window and every reload after it. -->
              <UsageChartSkeleton
                v-if="chartBusy"
                class="absolute inset-0 z-10 p-4"
                data-test="billings-usageoverview-daily-loading"
              />
              <PanelSchemaRenderer
                :key="chartKey"
                class="h-full w-full"
                :panel-schema="chartSchema"
                :selected-time-obj="elapsedTimeObj"
                :variables-data="{}"
                data-test="billings-usageoverview-daily-chart"
                @loading-state-change="onChartLoading"
              />
            </div>
            <OEmptyState
              v-else
              size="inline"
              :title="chartEmptyTitle"
              data-test="billings-usageoverview-daily-empty"
            />
          </aside>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import searchService from "@/services/search";
import { formatSizeFromMB } from "@/utils/formatters";
import useBreakpoint from "@/composables/useBreakpoint";
import UsageKpiCard from "./UsageKpiCard.vue";
import UsageBillStrip from "./UsageBillStrip.vue";
import UsageMeterTable from "./UsageMeterTable.vue";
import UsageMeterBreakdown from "./UsageMeterBreakdown.vue";
import UsagePaneHeader from "./UsagePaneHeader.vue";
import UsageChartSkeleton from "./UsageChartSkeleton.vue";
import {
  buildMeterRows,
  cycleProgress,
  effectiveRate,
  formatCost,
  formatVolume,
  formatCycle,
  netCost,
  projectCycleCost,
  scopedMeterRows,
  splitByUse,
  subtotalCost,
  type BillingOrg,
  type BillRow,
  type MeterKey,
  type MeterRow,
  type MeteringDetails,
} from "./meteringModel";
import {
  buildStackedCostPanelSchema,
  buildTrendsPanelSchema,
  entitySeriesColors,
  meterColorFor,
  paletteColor,
} from "./usageCharts";
import {
  dailyOrgCostSql,
  dailyTopSql,
  orgEventVolumeSql,
  type DrilldownSection,
} from "./usageQueries";
import { cyclePrices } from "./trendsModel";
import { useOrgCosts } from "./useOrgCosts";

interface KpiCard {
  key: string;
  label: I18nText;
  icon: IconName;
  valueSuffix?: I18nText;
  value: I18nText;
  hint: I18nText;
  struck?: I18nText;
  positive?: boolean;
}

const EM_DASH = raw("—");

const props = withDefaults(
  defineProps<{
    details: MeteringDetails | null;
    /** A super org's orgs, itself first; empty for any other org. */
    billingOrgs?: BillingOrg[];
    lastLoadedAt: number | null;
    refreshing: boolean;
  }>(),
  { billingOrgs: () => [] },
);
const emit = defineEmits<{ refresh: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const { isMobile } = useBreakpoint();

const refreshToken = ref(0);
const breakdownAnchor = ref<HTMLElement | null>(null);
const chartSection = ref<DrilldownSection | null>(null);
const groupSections = ref<DrilldownSection[]>([]);
const activeGroupId = ref<string | undefined>(undefined);
const chartNames = ref<string[]>([]);

/** Starts busy: the renderer reports "not loading" until its first query starts. */
const chartBusy = ref(true);

const onChartLoading = (value: boolean) => {
  chartBusy.value = value;
};

const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

/** The org whose usage the chart and breakdown count: a super org's chosen member, or this org. */
const usageOrgId = computed(() => selectedOrg.value?.id ?? orgId.value);

const usageStreamEnabled = computed<boolean>(
  () => !!store.state?.organizationData?.organizationSettings?.usage_stream_enabled,
);

const rows = computed<MeterRow[]>(() => buildMeterRows(props.details, t));

const split = computed(() => splitByUse(rows.value));

/** Every meter, priciest first; an unused one reads as $0.00 rather than a sentence under the table. */
const meterRows = computed(() => [...rows.value].sort((a, b) => b.cost - a.cost));

const total = computed(() => Number(props.details?.total_cost) || 0);

const subtotal = computed(() => subtotalCost(props.details));

const discountAmount = computed(() => Number(props.details?.total_discounted_amount) || 0);

const progress = computed(() =>
  props.details ? cycleProgress(props.details) : { day: 0, totalDays: 0, elapsed: 0 },
);

const projected = computed(() => projectCycleCost(props.details));

const cycleEndText = computed(() =>
  raw(
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
      new Date((props.details?.cycle_end ?? 0) * 1000),
    ),
  ),
);

// ── Super org: the bill by org ───────────────────────────────────
//
// Stripe itemises a super org's bill for the super org only, but every member's usage
// also lands in the super org's `usage` stream with its own org_id. So each org's cost
// is its usage priced at this bill's rates and discounts: an estimate that tracks the bill.

const isSuperOrg = computed(() => props.billingOrgs.length > 0);

/** An org keeps its palette slot by its place in the group; the retention row keeps its meter colour. */
const orgColor = (key: string) => {
  const index = props.billingOrgs.findIndex((org) => org.id === key);
  return index >= 0 ? paletteColor(index) : meterColorFor(key as MeterKey);
};

const selectedOrg = computed<BillingOrg | null>(() =>
  isSuperOrg.value ? (props.billingOrgs.find((org) => org.id === route.query.org) ?? null) : null,
);

const {
  costs: orgCosts,
  loading: orgCostsLoading,
  failed: orgCostsFailed,
  window: cycleWindow,
} = useOrgCosts(toRef(props, "details"), toRef(props, "billingOrgs"), refreshToken);

const searchUsage = async (sql: string) => {
  const response = await searchService.search({
    org_identifier: orgId.value,
    page_type: "logs",
    query: {
      query: {
        sql,
        start_time: cycleWindow.value.start,
        end_time: cycleWindow.value.end,
        from: 0,
        size: 1000,
      },
    },
  });
  return (response?.data?.hits ?? []) as Record<string, unknown>[];
};

/** Every org with its cost, plus retention, which writes no usage events to split by org. */
const orgRows = computed<BillRow[]>(() => {
  if (orgCostsFailed.value) return [];
  const orgs = props.billingOrgs.map((org): BillRow => {
    const cost = orgCosts.value[org.id] ?? { gross: 0, billed: 0, ingested: 0, byMeter: {} };
    const discount = Math.max(cost.gross - cost.billed, 0);
    return {
      key: org.id,
      label: org.isSelf ? t("billing.usageV2.thisOrg", { org: org.name }) : raw(org.name),
      volume: EM_DASH,
      rate: EM_DASH,
      subline: t("billing.usageV2.ingestedVolume", {
        volume: raw(formatSizeFromMB(cost.ingested)),
      }),
      cost: cost.billed,
      gross: cost.gross,
      discount,
      missing: false,
      discountPercent: cost.gross > 0 ? Math.round((discount / cost.gross) * 1000) / 10 : 0,
      drillable: true,
      hasBreakdown: true,
    };
  });
  const retention = props.details?.retention;
  const retentionRow = rows.value.find((row) => row.key === "retention");
  if (retention && retentionRow && retentionRow.cost > 0) {
    orgs.push({
      ...retentionRow,
      subline: t("billing.usageV2.notSplitByOrg"),
      drillable: false,
      hasBreakdown: false,
    });
  }
  return orgs.sort((a, b) => b.cost - a.cost);
});

const sumRows = (list: BillRow[]) => ({
  total: list.reduce((sum, row) => sum + row.cost, 0),
  gross: list.reduce((sum, row) => sum + row.gross, 0),
  discount: list.reduce((sum, row) => sum + row.discount, 0),
});

const orgTotals = computed(() => sumRows(orgRows.value));

const orgVolumes = ref<Record<string, number>>({});
const orgVolumesLoading = ref(false);

const loadOrgVolumes = async () => {
  const org = selectedOrg.value;
  if (!org || !props.details) return;
  orgVolumesLoading.value = true;
  orgVolumes.value = {};
  try {
    const hits = await searchUsage(orgEventVolumeSql(org.id));
    orgVolumes.value = Object.fromEntries(
      hits.map((hit) => [String(hit.name ?? ""), Number(hit.volume) || 0]),
    );
  } catch {
    orgVolumes.value = {};
  } finally {
    orgVolumesLoading.value = false;
  }
};

watch([() => selectedOrg.value?.id, () => props.details, refreshToken], loadOrgVolumes, {
  immediate: true,
});

/** The selected org's meters, priciest first. */
const scopedRows = computed<MeterRow[]>(() =>
  scopedMeterRows(props.details, orgVolumes.value, t).sort((a, b) => b.cost - a.cost),
);

const scopedTotals = computed(() => sumRows(scopedRows.value));

const orgSummary = computed(() => {
  const org = selectedOrg.value;
  if (!org) return undefined;
  const cost = orgCosts.value[org.id]?.billed ?? 0;
  return t("billing.usageV2.orgSummary", {
    cost: formatCost(cost),
    share:
      orgTotals.value.total > 0
        ? raw(`${((cost / orgTotals.value.total) * 100).toFixed(1)}%`)
        : EM_DASH,
  });
});

const selectOrg = (key: string | null) => {
  if (key === (selectedOrg.value?.id ?? null)) return;
  if (key && !props.billingOrgs.some((org) => org.id === key)) return;
  chartSection.value = null;
  chartNames.value = [];
  router.replace({
    query: { ...route.query, org: key ?? undefined, meter: undefined, group: undefined },
  });
};

/** A super org opens a meter only inside an org; any other org opens it from the bill. */
const meterSource = computed<MeterRow[]>(() =>
  isSuperOrg.value ? (selectedOrg.value ? scopedRows.value : []) : rows.value,
);

/** No meter in the URL means the All Meters view; a meter is chosen only by the user. */
const selectedMeter = computed<MeterKey | null>(() => {
  const match = meterSource.value.find((row) => row.drillable && row.key === route.query.meter);
  return match?.key ?? null;
});

const selectedGroup = computed(() => (route.query.group ? String(route.query.group) : undefined));

const selectedLabel = computed(
  () => rows.value.find((row) => row.key === selectedMeter.value)?.label ?? EM_DASH,
);

/** Inside an org, the meter's title carries the org, so the view says whose usage it is. */
const meterTitle = computed(() =>
  selectedOrg.value
    ? raw(`${selectedOrg.value.name} / ${selectedLabel.value}`)
    : selectedLabel.value,
);

/** One line of context in the pane header, so the breakdown adds no row of its own. */
const meterSummary = computed(() => {
  const scoped = selectedOrg.value
    ? scopedRows.value.find((row) => row.key === selectedMeter.value)
    : null;
  if (scoped) {
    const orgTotal = scopedTotals.value.total;
    return t("billing.usageV2.breakdownSummary", {
      cost: formatCost(scoped.cost),
      volume: scoped.volume,
      share: orgTotal > 0 ? raw(`${((scoped.cost / orgTotal) * 100).toFixed(1)}%`) : EM_DASH,
    });
  }
  const meter = selectedMeter.value ? props.details?.[selectedMeter.value] : null;
  if (!meter) return undefined;
  const billed = netCost(meter);
  return t("billing.usageV2.breakdownSummary", {
    cost: formatCost(billed),
    volume: formatVolume(meter),
    share: total.value > 0 ? raw(`${((billed / total.value) * 100).toFixed(1)}%`) : EM_DASH,
  });
});

const onSections = (payload: { sections: DrilldownSection[]; activeId: string | undefined }) => {
  groupSections.value = payload.sections;
  activeGroupId.value = payload.activeId;
};

const onGroupChange = (value: unknown) => {
  if (typeof value === "string" && value) selectGroup(value);
};

const discountedMeterNames = computed(() =>
  raw(
    split.value.used
      .filter((row) => row.discount > 0)
      .map((row) => row.label)
      .join(", "),
  ),
);

const kpiCards = computed<KpiCard[]>(() => {
  const top = split.value.used.find((row) => !row.missing);
  const discounted = discountAmount.value > 0;
  // No discount this cycle: no tile, so nobody wonders what an empty "Discount" means.
  const cards: KpiCard[] = [
    {
      key: "so-far",
      label: t("billing.usageV2.costSoFar"),
      icon: "attach-money",
      value: formatCost(total.value),
      hint: discounted
        ? t("billing.usageV2.grossLabel")
        : t("billing.usageV2.billedDay", {
            day: progress.value.day,
            total: progress.value.totalDays,
          }),
      struck: discounted ? formatCost(subtotal.value) : undefined,
    },
    {
      key: "projected",
      label: t("billing.usageV2.projectedTotal"),
      icon: "trending-up",
      value: projected.value === null ? EM_DASH : formatCost(projected.value),
      hint:
        projected.value === null
          ? t("billing.usageV2.tooEarlyToProject")
          : t("billing.usageV2.cycleCloses", { date: cycleEndText.value }),
    },
    {
      key: "top-meter",
      label: t("billing.usageV2.topMeter"),
      icon: "bar-chart",
      value: top ? top.label : EM_DASH,
      hint:
        top && total.value > 0
          ? t("billing.usageV2.topMeterShare", {
              cost: formatCost(top.cost),
              percent: ((top.cost / total.value) * 100).toFixed(1),
            })
          : EM_DASH,
    },
  ];
  if (discounted)
    cards.push({
      key: "discount",
      label: t("billing.usageV2.discount"),
      icon: "receipt-long",
      value: discounted ? formatCost(-discountAmount.value) : EM_DASH,
      positive: discounted,
      valueSuffix:
        discounted && subtotal.value > 0
          ? raw(`${((discountAmount.value / subtotal.value) * 100).toFixed(1)}%`)
          : undefined,
      hint: discounted ? discountedMeterNames.value : t("billing.usageV2.noDiscount"),
    });
  return cards;
});

const missingMeterNames = computed(() => {
  const missing = rows.value.filter((row) => row.missing);
  return missing.length ? raw(missing.map((row) => row.label).join(", ")) : null;
});

/** Elapsed days only, so the bars use the full pane width instead of empty future days. */
const elapsedTimeObj = computed(() => {
  const start = (props.details?.cycle_start ?? 0) * 1_000_000;
  const end = Math.min((props.details?.cycle_end ?? 0) * 1_000_000, Date.now() * 1000);
  return { start_time: new Date(start), end_time: new Date(Math.max(end, start)) };
});

const chartSchema = computed(() => {
  if (!props.details || !usageStreamEnabled.value) return null;
  const meterKey = selectedMeter.value;
  if (isSuperOrg.value && !selectedOrg.value) {
    const otherLabel = t("billing.usageV2.otherBand");
    return buildStackedCostPanelSchema({
      id: "usage-overview-orgs",
      sql: dailyOrgCostSql(
        cyclePrices([props.details]),
        props.billingOrgs.map((org) => ({ id: org.id, name: org.name })),
        otherLabel,
      ),
      seriesColors: props.billingOrgs.map((org, index) => ({
        value: org.name,
        color: paletteColor(index),
      })),
      t,
    });
  }
  if (!meterKey) {
    return buildTrendsPanelSchema({
      orgId: usageOrgId.value,
      cycles: [props.details],
      bucket: "1 day",
      t,
    });
  }
  const spec = chartSection.value;
  if (!spec || !chartNames.value.length) return null;
  const otherLabel = t("billing.usageV2.otherBand");
  return buildStackedCostPanelSchema({
    id: `usage-overview-${meterKey}-${spec.id}`,
    sql: dailyTopSql(
      usageOrgId.value,
      spec,
      chartNames.value,
      effectiveRate(props.details[meterKey]),
      otherLabel,
    ),
    seriesColors: entitySeriesColors(meterKey, chartNames.value, otherLabel),
    t,
  });
});

const chartKey = computed(
  () =>
    `${selectedOrg.value?.id ?? "orgs"}-${selectedMeter.value ?? "all"}-${chartSection.value?.id}-${chartNames.value.join("|")}-${refreshToken.value}`,
);

const chartSubtitle = computed(() =>
  selectedMeter.value
    ? t("billing.usageV2.meterByGroup", {
        meter: selectedLabel.value,
        group: chartSection.value ? t(chartSection.value.columnKey) : EM_DASH,
      })
    : selectedOrg.value
      ? raw(selectedOrg.value.name)
      : isSuperOrg.value
        ? t("billing.usageV2.byOrg")
        : undefined,
);

const chartEmptyTitle = computed(() =>
  !usageStreamEnabled.value
    ? t("billing.usageTrends.enableTitle")
    : selectedMeter.value === "retention"
      ? t("billing.usageV2.noDailyRetention")
      : t("billing.usageTrends.waitingTitle"),
);

const onTopNames = (payload: { section: DrilldownSection | null; names: string[] }) => {
  chartSection.value = payload.section;
  chartNames.value = payload.names;
};

const selectMeter = async (key: MeterKey | null) => {
  if (key === selectedMeter.value) return;
  chartSection.value = null;
  chartNames.value = [];
  router.replace({ query: { ...route.query, meter: key ?? undefined, group: undefined } });
  // Stacked on a phone, the breakdown sits below the strip, so bring it into view.
  if (key && isMobile.value) {
    await nextTick();
    breakdownAnchor.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

const selectGroup = (group: string) => {
  router.replace({ query: { ...route.query, group } });
};

const refresh = () => {
  refreshToken.value += 1;
  emit("refresh");
};
</script>
