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
  <div class="flex h-full min-h-0 flex-col gap-2.5" data-test="billings-usageoverview-root">
    <OBanner
      v-if="missingMeterNames"
      variant="warning"
      :content="t('billing.usageV2.missingMeters', { meters: missingMeterNames })"
      data-test="billings-usageoverview-missing-banner"
    />

    <!-- An org with no bill shows usage from its own stream, which only exists once reporting is on. -->
    <OEmptyState
      v-if="!details && volumeOnly"
      size="hero"
      illustration="wave-bars"
      :title="
        usageStreamEnabled
          ? t('billing.usageTrends.waitingTitle')
          : t('billing.usageTrends.enableTitle')
      "
      :description="
        usageStreamEnabled
          ? t('billing.usageTrends.waitingForData')
          : t('billing.usageV2.enableVolumeSubtitle')
      "
      :action-label="usageStreamEnabled ? undefined : t('billing.usageTrends.enableButton')"
      data-test="billings-usageoverview-enable"
      @action="confirmingEnable = true"
    />

    <OEmptyState
      v-else-if="!details"
      size="block"
      :title="t('billing.usageV2.noPricingTitle')"
      :description="t('billing.usageV2.noPricingSubtitle')"
      data-test="billings-usageoverview-no-pricing"
    />

    <template v-else>
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div class="text-text-secondary text-sm" data-test="billings-usageoverview-cycle">
          <template v-if="volumeOnly">{{ windowLabel }}</template>
          <template v-else>
            {{ formatCycle(details, t) }}
            <span class="text-text-body ms-2 font-medium">
              {{ t("billing.usageV2.cycleDay", { day: progress.day, total: progress.totalDays }) }}
            </span>
          </template>
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
        <!-- No bill, no strip: a share across meters means nothing when GB and run counts mix. -->
        <div
          v-if="isSuperOrg && !volumeOnly && orgCostsPending"
          class="border-border-default border-b px-4 py-2.5"
          data-test="billings-usageoverview-strip-loading"
        >
          <OSkeleton class="h-7 w-full" />
        </div>
        <UsageBillStrip
          v-else-if="isSuperOrg && !volumeOnly"
          :rows="orgRows"
          :total="orgTotals.total"
          :selected="selectedOrg?.id ?? null"
          :color-for="orgColor"
          :aria-label="t('billing.usageV2.costByOrg')"
          :click-hint="t('billing.usageV2.clickForOrg')"
          @select="selectOrg"
        />
        <UsageBillStrip
          v-else-if="!volumeOnly"
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
                    :disabled="unavailableGroupIds.includes(item.id)"
                    focusable-unavailable
                    :tooltip="
                      unavailableGroupIds.includes(item.id)
                        ? t('billing.usageV2.groupNotRecorded', { group: t(item.columnKey) })
                        : undefined
                    "
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
            <UsagePaneHeader
              v-else
              :title="
                volumeOnly ? t('billing.usageV2.usageByMeter') : t('billing.usageV2.costByMeter')
              "
            />

            <!-- Each meter's breakdown is kept, so drilling back into it shows its table without querying again. -->
            <KeepAlive :max="BREAKDOWN_CACHE_SIZE">
              <UsageMeterBreakdown
                v-if="selectedMeter"
                :key="`${selectedOrg?.id ?? 'self'}-${selectedMeter}`"
                :meter-key="selectedMeter"
                :scope-org-id="selectedOrg?.id"
                :rate="meterRate(selectedMeter)"
                :details="details"
                :group="selectedGroup"
                :refresh-token="refreshToken"
                :volume-only="volumeOnly"
                @update:group="selectGroup"
                @top-names="onTopNames"
                @sections="onSections"
              />
            </KeepAlive>
            <template v-if="!selectedMeter">
              <OEmptyState
                v-if="isSuperOrg && !selectedOrg && orgCostsFailed"
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
                :loading="orgCostsPending"
                :streaming="orgCostsLoading && hasOrgCosts"
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
                :loading="orgCostsPending"
                :streaming="orgCostsLoading && hasOrgCosts"
                data-test="billings-usageoverview-org-meters"
                @select="(key) => selectMeter(key as MeterKey)"
              />
              <UsageMeterTable
                v-else
                :rows="meterRows"
                :total="total"
                :gross="subtotal"
                :discount="discountAmount"
                :streaming="refreshing"
                :volume-only="volumeOnly"
                @select="(key) => selectMeter(key as MeterKey)"
              />
            </template>
          </div>

          <aside
            class="border-border-default flex min-h-0 min-w-0 flex-col overflow-hidden border-t @min-[56.25rem]/usage-breakdown:border-s @min-[56.25rem]/usage-breakdown:border-t-0"
            :aria-label="chartTitle"
            data-test="billings-usageoverview-daily-pane"
          >
            <UsagePaneHeader :title="chartTitle" :subtitle="chartSubtitle" />
            <!-- v-show, not v-if: the KeepAlive inside must survive the moment a drilldown has no chart yet. -->
            <div v-show="chartSchema" class="relative min-h-60 w-full flex-1 p-2">
              <!-- Each view is kept per key, so leaving a drilldown shows the drawn chart instead of querying again. -->
              <KeepAlive :max="CHART_CACHE_SIZE">
                <UsageCachedChart
                  v-if="chartSchema"
                  :key="chartKey"
                  :panel-schema="chartSchema"
                  :selected-time-obj="elapsedTimeObj"
                  data-test="billings-usageoverview-daily-chart"
                />
              </KeepAlive>
            </div>
            <div v-if="chartPending" class="relative min-h-60 w-full flex-1 p-2">
              <UsageChartSkeleton data-test="billings-usageoverview-daily-pending" />
            </div>
            <OEmptyState
              v-else-if="!chartSchema"
              size="inline"
              :title="chartEmptyTitle"
              :action-label="usageStreamEnabled ? undefined : t('billing.usageTrends.enableButton')"
              data-test="billings-usageoverview-daily-empty"
              @action="confirmingEnable = true"
            />
          </aside>
        </div>
      </section>
    </template>

    <ConfirmDialog
      v-model="confirmingEnable"
      data-test="billings-usageoverview-enable-confirm"
      :title="t('billing.usageTrends.enableConfirmTitle')"
      :message="t('billing.usageTrends.enableConfirmMessage')"
      :ok-label="t('billing.usageTrends.enableButton')"
      @update:ok="enableUsageReporting"
      @update:cancel="confirmingEnable = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { formatSizeFromMB } from "@/utils/formatters";
import useBreakpoint from "@/composables/useBreakpoint";
import UsageKpiCard from "./UsageKpiCard.vue";
import UsageBillStrip from "./UsageBillStrip.vue";
import UsageMeterTable from "./UsageMeterTable.vue";
import UsageMeterBreakdown from "./UsageMeterBreakdown.vue";
import UsagePaneHeader from "./UsagePaneHeader.vue";
import UsageCachedChart from "./UsageCachedChart.vue";
import UsageChartSkeleton from "./UsageChartSkeleton.vue";
import {
  buildMeterRows,
  cycleProgress,
  effectiveRate,
  formatCost,
  formatDay,
  formatVolume,
  formatCycle,
  METERS,
  meterForEvent,
  netCost,
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
  CHART_TOP,
  VOLUME_METERS,
  entitySeriesColors,
  OTHERS_SERIES,
  meterColorFor,
  paletteColor,
} from "./usageCharts";
import {
  dailyOrgCostSql,
  dailyEntitySql,
  dailyVolumeSql,
  type DrilldownSection,
} from "./usageQueries";
import { cyclePrices } from "./trendsModel";
import type { OrgCostsState } from "./useOrgCosts";
import { useUsageReporting } from "./useUsageReporting";

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
    /** The cycle's projected total, worked out once by the page so every tab shows the same figure. */
    projected: number | null;
    refreshing: boolean;
    volumeOnly?: boolean;
    /** The super org's per-org spend, read once by the page. */
    orgCosts?: OrgCostsState;
  }>(),
  {
    billingOrgs: () => [],
    volumeOnly: false,
    orgCosts: () => ({ costs: {}, loading: false, failed: false }),
  },
);
const emit = defineEmits<{ refresh: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const { isMobile } = useBreakpoint();

const refreshToken = ref(0);
const breakdownAnchor = ref<HTMLElement | null>(null);
const groupSections = ref<DrilldownSection[]>([]);
/** The view the breakdown's groupings came from; another meter's must not shape this chart. */
const sectionsFor = ref<string | null>(null);
/** Groupings this org has never recorded: shown, but disabled. */
const unavailableGroupIds = ref<string[]>([]);
const activeGroupId = ref<string | undefined>(undefined);
/** The table's top names, used only to colour the chart's bands as the table ranks them. */
const chartNames = ref<string[]>([]);
/** The view and grouping those names were ranked for. */
const chartNamesFor = ref<string | null>(null);

/** Views a user moves between in one visit: all meters, a few drilldowns, a few orgs. */
const CHART_CACHE_SIZE = 8;

/** Meter breakdowns kept alive at once; each holds only its own top-N rows. */
const BREAKDOWN_CACHE_SIZE = 8;

const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

/** The org whose usage the chart and breakdown count: a super org's chosen member, or this org. */
const usageOrgId = computed(() => selectedOrg.value?.id ?? orgId.value);

const {
  enabled: usageStreamEnabled,
  confirming: confirmingEnable,
  enable: enableUsageReporting,
} = useUsageReporting();

/** Without a bill, retention has no usage event to count, so its row would only ever read zero. */
const rows = computed<MeterRow[]>(() =>
  buildMeterRows(props.details, t).filter((row) => !props.volumeOnly || row.key !== "retention"),
);

const split = computed(() => splitByUse(rows.value));

/** Every meter, priciest first; an unused one reads as $0.00 rather than a sentence under the table. */
const meterRows = computed(() => [...rows.value].sort((a, b) => b.cost - a.cost));

const total = computed(() => Number(props.details?.total_cost) || 0);

const subtotal = computed(() => subtotalCost(props.details));

const discountAmount = computed(() => Number(props.details?.total_discounted_amount) || 0);

const progress = computed(() =>
  props.details ? cycleProgress(props.details) : { day: 0, totalDays: 0, elapsed: 0 },
);

const projected = computed(() => props.projected);

const cycleEndText = computed(() => raw(formatDay(props.details?.cycle_end ?? 0)));

const isSuperOrg = computed(() => props.billingOrgs.length > 0);

/** An org keeps its palette slot by its place in the group; the retention row keeps its meter colour. */
const orgColor = (key: string) => {
  const index = props.billingOrgs.findIndex((org) => org.id === key);
  if (index >= 0) return paletteColor(index);
  const former = formerOrgIds.value.indexOf(key);
  return former >= 0
    ? paletteColor(props.billingOrgs.length + former)
    : meterColorFor(key as MeterKey);
};

const selectedOrg = computed<BillingOrg | null>(() =>
  isSuperOrg.value ? (props.billingOrgs.find((org) => org.id === route.query.org) ?? null) : null,
);

// The page reads org costs once for every tab, so Budget judges spend on these same figures.
const orgCosts = computed(() => props.orgCosts.costs);
const orgCostsLoading = computed(() => props.orgCosts.loading);
const orgCostsFailed = computed(() => props.orgCosts.failed);

/** Partial costs stream in, so the skeleton only covers the wait for the first chunk. */
const hasOrgCosts = computed(() => Object.keys(orgCosts.value).length > 0);
/** Until the first org costs land, the bill's retention row would read as the whole bill. */
const orgCostsPending = computed(() => orgCostsLoading.value && !hasOrgCosts.value);

/** Every org with its cost, plus retention, which writes no usage events to split by org. */
/** Orgs still on this bill that are no longer members: one that left the group mid-cycle. */
const formerOrgIds = computed(() => {
  const members = new Set(props.billingOrgs.map((org) => org.id));
  return Object.entries(orgCosts.value)
    .filter(([id, cost]) => id && !members.has(id) && (cost.gross > 0 || cost.billed > 0))
    .map(([id]) => id);
});

const orgRow = (id: string, label: I18nText, member: boolean): BillRow => {
  const cost = orgCosts.value[id] ?? { gross: 0, billed: 0, ingested: 0, byMeter: {} };
  const discount = Math.max(cost.gross - cost.billed, 0);
  const volume = raw(formatSizeFromMB(cost.ingested));
  return {
    key: id,
    label,
    volume: EM_DASH,
    rate: EM_DASH,
    subline: member
      ? t("billing.usageV2.ingestedVolume", { volume })
      : t("billing.usageV2.formerMemberIngested", { volume }),
    cost: cost.billed,
    gross: cost.gross,
    discount,
    missing: false,
    discountPercent: cost.gross > 0 ? Math.round((discount / cost.gross) * 1000) / 10 : 0,
    drillable: member,
    hasBreakdown: member,
  };
};

const orgRows = computed<BillRow[]>(() => {
  if (orgCostsFailed.value || orgCostsPending.value) return [];
  const orgs = props.billingOrgs.map((org) =>
    orgRow(
      org.id,
      org.isSelf ? t("billing.usageV2.thisOrg", { org: org.name }) : raw(org.name),
      true,
    ),
  );
  // An org that left mid-cycle stays on the payer's bill, so its row keeps the rows equal to the bill.
  for (const id of formerOrgIds.value) {
    const name =
      (store.state.organizations ?? []).find((org: any) => org.identifier === id)?.name ?? id;
    orgs.push(orgRow(id, raw(name), false));
  }
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

/** The selected org's part of each meter, from the same split as its row, so the two always agree. */
const selectedShares = computed(() =>
  selectedOrg.value ? (orgCosts.value[selectedOrg.value.id]?.byMeter ?? {}) : {},
);

/** The selected org's meters, priciest first. */
const scopedRows = computed<MeterRow[]>(() =>
  scopedMeterRows(props.details, selectedShares.value, t).sort((a, b) => b.cost - a.cost),
);

/** Inside an org, a meter is priced at that org's share of it, so its breakdown adds up to the org's row. */
const meterRate = (key: MeterKey) => {
  const share = selectedShares.value[key];
  if (!selectedOrg.value || !share) return effectiveRate(props.details?.[key]);
  return share.volume > 0 ? share.billed / share.volume : 0;
};

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
  if (props.volumeOnly) {
    const meter = selectedMeter.value ? props.details?.[selectedMeter.value] : null;
    return meter ? formatVolume(meter, selectedMeter.value) : undefined;
  }
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
    volume: formatVolume(meter, selectedMeter.value),
    share: total.value > 0 ? raw(`${((billed / total.value) * 100).toFixed(1)}%`) : EM_DASH,
  });
});

const onSections = (payload: {
  sections: DrilldownSection[];
  unavailable: string[];
  activeId: string | undefined;
}) => {
  groupSections.value = payload.sections;
  unavailableGroupIds.value = payload.unavailable;
  sectionsFor.value = viewKey.value;
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

/** The four meters an org with no bill sees first, each by its own unit. */
const VOLUME_CARD_METERS: MeterKey[] = ["ingestion", "query", "pipeline", "ai"];

const volumeCards = computed<KpiCard[]>(() =>
  METERS.filter((def) => VOLUME_CARD_METERS.includes(def.key)).map((def) => ({
    key: def.key,
    label: t(def.labelKey),
    icon: "bar-chart",
    value: formatVolume(props.details?.[def.key], def.key),
    hint: t(def.billedAsKey),
  })),
);

/** "Last 30 days: Sep 20 to Oct 19", the window an org with no bill is shown. */
const windowLabel = computed(() => {
  const start = props.details?.cycle_start ?? 0;
  const end = Math.min(props.details?.cycle_end ?? 0, Math.floor(Date.now() / 1000));
  return t("billing.usageV2.lastDaysRange", {
    // Calendar days, today included: the window starts at midnight 29 days back.
    days: Math.floor((end - start) / 86_400) + 1,
    start: raw(formatDay(start)),
    end: raw(formatDay(end)),
  });
});

const kpiCards = computed<KpiCard[]>(() => {
  if (props.volumeOnly) return volumeCards.value;
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
      value: formatCost(-discountAmount.value),
      positive: true,
      valueSuffix:
        subtotal.value > 0
          ? raw(`${((discountAmount.value / subtotal.value) * 100).toFixed(1)}%`)
          : undefined,
      hint: discountedMeterNames.value,
    });
  return cards;
});

const missingMeterNames = computed(() => {
  const missing = rows.value.filter((row) => row.missing);
  return missing.length ? raw(missing.map((row) => row.label).join(", ")) : null;
});

/** Elapsed days only, so the bars use the full pane width instead of empty future days. */
/** The cycle's first moment; the charts count from here even though their window opens earlier. */
const cycleStartUs = computed(() => (props.details?.cycle_start ?? 0) * 1_000_000);

const elapsedTimeObj = computed(() => {
  const dayStart = Math.floor((props.details?.cycle_start ?? 0) / 86_400) * 86_400 * 1_000_000;
  const end = Math.min((props.details?.cycle_end ?? 0) * 1_000_000, Date.now() * 1000);
  // Microseconds in a Date, as the dashboard renderer reads its time window.
  return { start_time: new Date(dayStart), end_time: new Date(Math.max(end, dayStart)) };
});

const viewKey = computed(
  () => `${selectedOrg.value?.id ?? "self"}-${selectedMeter.value ?? "all"}`,
);

/** The grouping the chart splits by, known once the breakdown has read the schema, before its table query ends. */
const chartSection = computed<DrilldownSection | null>(() =>
  sectionsFor.value === viewKey.value
    ? (groupSections.value.find((item) => item.id === activeGroupId.value) ?? null)
    : null,
);

/** Until the breakdown names its groupings, a meter's chart is loading, not empty. */
const chartPending = computed(
  () =>
    !!props.details &&
    usageStreamEnabled.value &&
    !!selectedMeter.value &&
    selectedMeter.value !== "retention" &&
    sectionsFor.value !== viewKey.value,
);

/** Daily megabytes per data meter, or one meter's top entities, for an org with no bill. */
const volumeChartSchema = (meterKey: MeterKey | null) => {
  if (!meterKey) {
    const events = METERS.filter((def) => VOLUME_METERS.includes(def.key)).flatMap(
      (def) => def.events,
    );
    return buildStackedCostPanelSchema({
      id: "usage-overview-volume",
      sql: dailyVolumeSql(usageOrgId.value, events),
      seriesColors: events.map((event) => ({
        value: event,
        color: meterColorFor(meterForEvent(event)?.key ?? "ingestion"),
      })),
      unit: "megabytes",
      t,
    });
  }
  const spec = chartSection.value;
  if (!spec) return null;
  const ranked = chartNamesFor.value === `${viewKey.value}-${spec.id}` ? chartNames.value : [];
  return buildStackedCostPanelSchema({
    id: `usage-overview-volume-${meterKey}-${spec.id}`,
    sql: dailyEntitySql(usageOrgId.value, spec, 1),
    seriesColors: entitySeriesColors(meterKey, ranked, OTHERS_SERIES),
    topResults: CHART_TOP,
    fixedColor: meterColorFor(meterKey),
    unit: spec.unit === "count" ? "numbers" : "megabytes",
    t,
  });
};

const chartSchema = computed(() => {
  if (!props.details || !usageStreamEnabled.value) return null;
  const meterKey = selectedMeter.value;
  if (props.volumeOnly) return volumeChartSchema(meterKey);
  if (isSuperOrg.value && !selectedOrg.value) {
    const otherLabel = t("billing.usageV2.otherBand");
    return buildStackedCostPanelSchema({
      id: "usage-overview-orgs",
      sql: dailyOrgCostSql(
        cyclePrices([props.details]),
        props.billingOrgs.map((org) => ({ id: org.id, name: org.name })),
        otherLabel,
        undefined,
        cycleStartUs.value,
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
      since: cycleStartUs.value,
      t,
    });
  }
  const spec = chartSection.value;
  if (!spec) return null;
  // Runs alongside the table; the names only recolour the bands, which needs no new query.
  const ranked = chartNamesFor.value === `${viewKey.value}-${spec.id}` ? chartNames.value : [];
  return buildStackedCostPanelSchema({
    id: `usage-overview-${meterKey}-${spec.id}`,
    sql: dailyEntitySql(usageOrgId.value, spec, meterRate(meterKey), cycleStartUs.value),
    seriesColors: entitySeriesColors(meterKey, ranked, OTHERS_SERIES),
    topResults: CHART_TOP,
    fixedColor: meterColorFor(meterKey),
    t,
  });
});

/** Refresh re-runs a chart through the new bill's window, not its key; the names only recolour it in place. */
const chartKey = computed(() => {
  const view = `${props.volumeOnly ? "volume-" : ""}${selectedOrg.value?.id ?? "orgs"}`;
  return selectedMeter.value
    ? `${view}-${selectedMeter.value}-${chartSection.value?.id}`
    : `${view}-all`;
});

const chartTitle = computed(() =>
  props.volumeOnly ? t("billing.usageV2.dailyVolume") : t("billing.usageV2.dailyCost"),
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
        : props.volumeOnly
          ? t("billing.usageV2.volumeSubtitle")
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
  chartNames.value = payload.names;
  chartNamesFor.value = `${viewKey.value}-${payload.section?.id}`;
};

const selectMeter = async (key: MeterKey | null) => {
  if (key === selectedMeter.value) return;
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
