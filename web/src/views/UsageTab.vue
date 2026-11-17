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
  <div class="usage-tab h-full">
    <!-- Main content when data exists -->
    <div
      v-if="!no_data_ingest && !isLoadingSummary && !summaryFailed"
      class="px-page-edge flex h-full w-full flex-col overflow-y-auto pt-2 pb-4"
    >
      <!-- Banners — each component renders nothing when inactive, so this whole
           block collapses to zero height (no reserved margin) when idle; the
           gap below only appears when a banner is actually shown. -->
      <div class="flex shrink-0 flex-col gap-2 not-empty:mb-3 empty:hidden">
        <TrialPeriod></TrialPeriod>
        <LicensePeriod v-if="!showUsageReportBanner" @renew="goToLicensePage"></LicensePeriod>
        <UsageReportBanner></UsageReportBanner>
        <DatabaseDeprecationBanner></DatabaseDeprecationBanner>
      </div>

      <div class="flex min-h-8 items-center justify-between">
        <h2 class="text-text-heading text-sm font-semibold">{{ t("home.streams") }}</h2>
        <OButton
          v-if="canView('logstreams')"
          icon-only
          variant="ghost"
          class="relative"
          :aria-label="t('home.viewButton')"
          :title="t('home.viewButton')"
          data-test="home-usage-tab-view-streams-btn"
        >
          <OIcon name="arrow-forward" size="sm" />
          <router-link
            exact
            :to="{
              name: 'logstreams',
              query: { org_identifier: store.state.selectedOrganization?.identifier },
            }"
            class="absolute inset-0"
            :aria-label="t('home.viewButton')"
          ></router-link>
        </OButton>
      </div>
      <div class="flex shrink-0 flex-wrap gap-x-8 gap-y-3 pb-6" data-test="home-usage-tab-kpis">
        <!-- Streams -->
        <OStatCard
          variant="kpi"
          stacked
          :label="t('home.streams')"
          :value="animatedStreamsCount || summary.streams_count"
        >
          <template #value>
            <span aria-live="polite" data-test="home-usage-tab-streams-count">{{
              animatedStreamsCount || summary.streams_count
            }}</span>
          </template>
        </OStatCard>

        <!-- Events -->
        <OStatCard
          variant="kpi"
          stacked
          :label="t('home.docsCountLbl')"
          :value="formattedAnimatedEventsCount"
        >
          <template #value>
            <span aria-live="polite" data-test="home-usage-tab-events-count">{{
              formattedAnimatedEventsCount
            }}</span>
          </template>
        </OStatCard>

        <!-- Ingested size -->
        <OStatCard
          variant="kpi"
          stacked
          :label="t('home.totalDataIngested')"
          :value="formattedAnimatedIngestedSize"
        >
          <template #value>
            <span aria-live="polite" data-test="home-usage-tab-ingested-size">{{
              formattedAnimatedIngestedSize
            }}</span>
          </template>
        </OStatCard>

        <!-- Compressed size (self-hosted only) -->
        <OStatCard
          variant="kpi"
          stacked
          v-if="config.isCloud == 'false'"
          :label="t('home.totalDataCompressed')"
          :value="formattedAnimatedCompressedSize"
        >
          <template #value>
            <span aria-live="polite" data-test="home-usage-tab-compressed-size">{{
              formattedAnimatedCompressedSize
            }}</span>
          </template>
        </OStatCard>

        <!-- Index size (self-hosted only) -->
        <OStatCard
          variant="kpi"
          stacked
          v-if="config.isCloud == 'false'"
          :label="t('home.indexSizeLbl')"
          :value="formattedAnimatedIndexSize"
        >
          <template #value>
            <span aria-live="polite" data-test="home-usage-tab-index-size">{{
              formattedAnimatedIndexSize
            }}</span>
          </template>
        </OStatCard>
      </div>

      <!-- Main region — a filled resources rail beside the two status charts, so
           Functions/Dashboards live somewhere purposeful and the vertical space
           is actually used. Rail carries counts + one-click access to every area. -->
      <!-- < lg the region must scroll, or the fixed-height grid compresses its auto rows and cards overlap. -->
      <div
        class="border-border-default grid min-h-0 flex-1 grid-cols-1 gap-x-8 gap-y-6 border-t pt-6 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <!-- Resources rail -->
        <aside class="flex min-h-0 flex-col overflow-y-auto" :aria-label="t('common.resources')">
          <!-- Resources — owned assets with live counts. Each row is gated to the
               same route the left nav uses, so it hides when access is missing. -->
          <template v-if="showResources">
            <h2 class="text-text-heading mb-1 flex min-h-8 items-center text-sm font-semibold">
              {{ t("home.resources") }}
            </h2>
            <nav class="flex flex-col">
              <router-link
                v-if="canView('functionList')"
                class="group rounded-default hover:bg-table-row-hover-bg text-compact h-control-md -mx-2 flex items-center gap-2.5 px-2 text-inherit no-underline transition-colors"
                :to="{
                  name: 'functionList',
                  query: { org_identifier: store.state.selectedOrganization?.identifier },
                }"
                data-test="home-usage-tab-functions-card"
              >
                <OIcon name="function" size="sm" class="text-text-secondary shrink-0" />
                <OTruncatedText class="text-text-body flex-1 font-medium">{{
                  t("home.functionTitle")
                }}</OTruncatedText>
                <span
                  class="text-text-heading font-semibold tabular-nums"
                  data-test="home-usage-tab-functions-count"
                  >{{ animatedFunctionCount || summary.function_count }}</span
                >
                <OIcon
                  name="chevron-right"
                  size="sm"
                  class="text-text-disabled group-hover:text-text-secondary shrink-0 transition-transform group-hover:translate-x-0.5"
                />
              </router-link>
              <OTooltip
                v-if="canView('dashboards')"
                :content="lockedReason('dashboards')"
                :disabled="!isLocked('dashboards')"
              >
                <router-link
                  class="group rounded-default hover:bg-table-row-hover-bg text-compact h-control-md -mx-2 flex items-center gap-2.5 px-2 text-inherit no-underline transition-colors"
                  :to="{
                    name: 'dashboards',
                    query: { org_identifier: store.state.selectedOrganization?.identifier },
                  }"
                  data-test="home-usage-tab-dashboards-card"
                >
                  <OIcon name="dashboard" size="sm" class="text-text-secondary shrink-0" />
                  <OTruncatedText class="text-text-body flex-1 font-medium">{{
                    t("home.dashboardTitle")
                  }}</OTruncatedText>
                  <span
                    class="text-text-heading font-semibold tabular-nums"
                    data-test="home-usage-tab-dashboards-count"
                    >{{ animatedDashboardCount || summary.dashboard_count }}</span
                  >
                  <template v-if="isLocked('dashboards')">
                    <OIcon
                      name="lock"
                      size="xs"
                      class="text-icon-locked shrink-0"
                      data-test="home-usage-tab-dashboards-card-lock"
                    />
                    <span class="sr-only">{{ lockedReason("dashboards") }}</span>
                  </template>
                  <OIcon
                    v-else
                    name="chevron-right"
                    size="sm"
                    class="text-text-disabled group-hover:text-text-secondary shrink-0 transition-transform group-hover:translate-x-0.5"
                  />
                </router-link>
              </OTooltip>
            </nav>
          </template>

          <div
            v-if="showResources && showExplore"
            class="bg-border-default my-3 h-px"
            role="separator"
          ></div>

          <!-- Explore — data surfaces. Same per-route gating as above. -->
          <template v-if="showExplore">
            <h3 class="text-text-secondary mb-1 text-xs font-medium">
              {{ t("home.explore") }}
            </h3>
            <nav class="flex flex-col">
              <OTooltip
                v-for="row in exploreRows"
                :key="row.name"
                :content="lockedReason(row.feature)"
                :disabled="!isLocked(row.feature)"
              >
                <router-link
                  class="group rounded-default hover:bg-table-row-hover-bg text-compact h-control-md -mx-2 flex items-center gap-2.5 px-2 text-inherit no-underline transition-colors"
                  :to="{
                    name: row.name,
                    query: { org_identifier: store.state.selectedOrganization?.identifier },
                  }"
                  :data-test="`home-usage-tab-explore-${row.test}`"
                >
                  <OIcon :name="row.icon" size="sm" class="text-text-secondary shrink-0" />
                  <OTruncatedText class="text-text-body flex-1 font-medium">{{
                    row.label
                  }}</OTruncatedText>
                  <template v-if="isLocked(row.feature)">
                    <OIcon
                      name="lock"
                      size="xs"
                      class="text-icon-locked shrink-0"
                      :data-test="`home-usage-tab-explore-${row.test}-lock`"
                    />
                    <span class="sr-only">{{ lockedReason(row.feature) }}</span>
                  </template>
                  <OIcon
                    v-else
                    name="chevron-right"
                    size="sm"
                    class="text-text-disabled group-hover:text-text-secondary shrink-0 transition-transform group-hover:translate-x-0.5"
                  />
                </router-link>
              </OTooltip>
            </nav>
          </template>
        </aside>

        <!-- Alerts -->
        <section class="flex min-h-0 flex-col" :aria-label="t('home.alertsOverviewSection')">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-text-heading text-sm font-semibold">
              {{ t("home.alertTitle") }}
            </h2>
            <OButton
              v-if="canView('alertList')"
              icon-only
              variant="ghost"
              class="relative"
              :aria-label="viewLabel('alerts')"
              :title="viewLabel('alerts')"
              data-test="home-usage-tab-view-alerts-btn"
            >
              <OIcon
                :name="isLocked('alerts') ? 'lock' : 'arrow-forward'"
                size="sm"
                :class="{ 'text-icon-locked': isLocked('alerts') }"
              />
              <router-link
                exact
                :to="{
                  name: 'alertList',
                  query: {
                    org_identifier: store.state.selectedOrganization?.identifier,
                    state: ALERT_LIST_ALL_STATES,
                    all_folders: ALERT_LIST_ALL_FOLDERS,
                  },
                }"
                class="absolute inset-0"
                :aria-label="viewLabel('alerts')"
              ></router-link>
            </OButton>
          </div>
          <div class="flex gap-x-6 pt-2">
            <OStatCard
              variant="kpi"
              stacked
              :label="t('home.scheduledAlert')"
              :value="animatedScheduledAlerts || summary.scheduled_alerts"
            >
              <template #value>
                <span aria-live="polite" data-test="home-usage-tab-scheduled-alerts-count">{{
                  animatedScheduledAlerts || summary.scheduled_alerts
                }}</span>
              </template>
            </OStatCard>
            <OStatCard
              variant="kpi"
              stacked
              :label="t('home.rtAlert')"
              :value="animatedRtAlerts || summary.rt_alerts"
            >
              <template #value>
                <span aria-live="polite" data-test="home-usage-tab-rt-alerts-count">{{
                  animatedRtAlerts || summary.rt_alerts
                }}</span>
              </template>
            </OStatCard>
          </div>
          <div class="mt-3 min-h-50 w-full flex-1">
            <CustomChartRenderer
              :key="alertsPanelDataKey"
              :data="alertsPanelData"
              class="h-full w-full"
            />
          </div>
        </section>

        <!-- Pipelines -->
        <section class="flex min-h-0 flex-col" :aria-label="t('home.pipelinesOverviewSection')">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-text-heading text-sm font-semibold">
              {{ t("home.pipelineTitle") }}
            </h2>
            <OButton
              v-if="canView('pipelines')"
              icon-only
              variant="ghost"
              class="relative"
              :aria-label="viewLabel('pipelines')"
              :title="viewLabel('pipelines')"
              data-test="home-usage-tab-view-pipelines-btn"
            >
              <OIcon
                :name="isLocked('pipelines') ? 'lock' : 'arrow-forward'"
                size="sm"
                :class="{ 'text-icon-locked': isLocked('pipelines') }"
              />
              <router-link
                exact
                :to="{
                  name: 'pipelines',
                  query: { org_identifier: store.state.selectedOrganization?.identifier },
                }"
                class="absolute inset-0"
                :aria-label="viewLabel('pipelines')"
              ></router-link>
            </OButton>
          </div>
          <div class="flex gap-x-6 pt-2">
            <OStatCard
              variant="kpi"
              stacked
              :label="t('home.schedulePipelineTitle')"
              :value="animatedScheduledPipelines || summary.scheduled_pipelines"
            >
              <template #value>
                <span aria-live="polite" data-test="home-usage-tab-scheduled-pipelines-count">{{
                  animatedScheduledPipelines || summary.scheduled_pipelines
                }}</span>
              </template>
            </OStatCard>
            <OStatCard
              variant="kpi"
              stacked
              :label="t('home.rtPipelineTitle')"
              :value="animatedRtPipelines || summary.rt_pipelines"
            >
              <template #value>
                <span aria-live="polite" data-test="home-usage-tab-rt-pipelines-count">{{
                  animatedRtPipelines || summary.rt_pipelines
                }}</span>
              </template>
            </OStatCard>
          </div>
          <div class="mt-3 min-h-50 w-full flex-1">
            <CustomChartRenderer
              :key="pipelinesPanelDataKey"
              :data="pipelinesPanelData"
              class="h-full w-full"
            />
          </div>
        </section>
      </div>
    </div>

    <!-- Empty state when no data ingested -->
    <div
      v-if="no_data_ingest && !isLoadingSummary"
      class="flex h-full flex-col"
      data-test="home-usage-tab-no-data"
    >
      <TrialPeriod />
      <HomeNoDataState />
    </div>

    <div
      v-if="summaryFailed && !isLoadingSummary"
      class="flex h-full flex-col"
      data-test="home-usage-tab-load-error"
    >
      <OEmptyState
        kind="error"
        :title="t('emptyState.loadError.title')"
        :text="t('emptyState.loadError.description')"
        data-test="usage-load-error-empty-state"
        @action="() => getSummary(store.state.selectedOrganization.identifier)"
      />
    </div>

    <!-- Loading state -->
    <div v-if="isLoadingSummary" class="h-full" data-test="home-usage-tab-loading">
      <HomeViewSkeleton />
    </div>
  </div>
</template>

<!-- UsageTab: self-contained home usage dashboard showing streams, functions, dashboards, alerts, and pipelines summary with animated counters and charts. -->
<script setup lang="ts">
import { configFullQuery } from "@/services/config.queries";
import { orgSummaryQuery } from "@/services/organizations.queries";
import { queryClient } from "@/composables/query/queryClient";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { formatSizeFromMB } from "@/utils/zincutils";
import { formatCompactCount } from "@/utils/formatters";
import { summaryHasUserData } from "@/utils/internalStreams";
import { ALERT_LIST_ALL_FOLDERS, ALERT_LIST_ALL_STATES } from "@/utils/alerts/alertListLink";
import { chartColor } from "@/utils/chartTheme";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";
import UsageReportBanner from "@/enterprise/components/billings/UsageReportBanner.vue";
import DatabaseDeprecationBanner from "@/components/DatabaseDeprecationBanner.vue";
import HomeViewSkeleton from "@/components/shared/HomeViewSkeleton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OStatCard from "@/lib/data/StatStrip/OStatCard.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import HomeNoDataState from "@/views/HomeNoDataState.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useLicenseLocks } from "@/composables/useFeatureLock";
import { useLicensePage } from "@/composables/useLicensePage";
import { markFullConfigLoaded } from "@/composables/useFullConfigLoad";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { goToLicensePage } = useLicensePage();
const { isLocked, lockedReason } = useLicenseLocks();

const viewLabel = (feature: string) =>
  isLocked(feature) ? lockedReason(feature) : t("home.viewButton");

interface ExploreRow {
  name: string;
  test: string;
  feature: string;
  icon: IconName;
  label: I18nText;
}

const exploreRows = computed(() =>
  (
    [
      {
        name: "logs",
        test: "logs",
        feature: "logs",
        icon: "search",
        label: t("menu.search"),
      },
      {
        name: "traces",
        test: "traces",
        feature: "traces",
        icon: "account-tree",
        label: t("menu.traces"),
      },
      {
        name: "metrics",
        test: "metrics",
        feature: "metrics",
        icon: "bar-chart",
        label: t("menu.metrics"),
      },
      {
        name: "RUM",
        test: "rum",
        feature: "rum",
        icon: "devices",
        label: raw("RUM"),
      },
      {
        name: "incidentList",
        test: "incidents",
        feature: "incidents",
        icon: "notifications-active",
        label: t("menu.incidents"),
      },
      {
        name: "reports",
        test: "reports",
        feature: "reports",
        icon: "description",
        label: t("menu.report"),
      },
    ] as ExploreRow[]
  ).filter((row) => canView(row.name)),
);

const summary = ref<any>([]);
const no_data_ingest = ref(false);
const alertsPanelDataKey = ref(0);
const pipelinesPanelDataKey = ref(0);
const isLoadingSummary = ref(false);
const flagOn = computed(() => store.state.zoConfig?.restricted_routes_on_empty_data === true);
// flag-on only: the flag-off page keeps its toasts and its populated fall-through
const summaryFailed = ref(false);

// Animated counters
const animatedStreamsCount = ref(0);
const animatedEventsCount = ref(0);
const animatedCompressedSize = ref(0);
const animatedIngestedSize = ref(0);
const animatedIndexSize = ref(0);
const animatedFunctionCount = ref(0);
const animatedDashboardCount = ref(0);
const animatedScheduledAlerts = ref(0);
const animatedRtAlerts = ref(0);
const animatedScheduledPipelines = ref(0);
const animatedRtPipelines = ref(0);

// Bumped when theme colors change to force re-computation of theme-dependent chart options
const themeVersion = ref(0);

// Count-up animation using requestAnimationFrame
const animateValue = (targetRef: any, start: number, end: number, duration: number) => {
  if (start === end) {
    targetRef.value = end;
    return;
  }
  const range = end - start;
  const startTime = performance.now();
  let animationId: number;

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    targetRef.value = Math.floor(start + range * progress);

    if (progress < 1) {
      animationId = requestAnimationFrame(animate);
    } else {
      targetRef.value = end;
    }
  };

  animationId = requestAnimationFrame(animate);

  return () => cancelAnimationFrame(animationId);
};

const getSummary = (org_id: any) => {
  isLoadingSummary.value = true;
  summaryFailed.value = false;
  const dismiss = flagOn.value
    ? () => {}
    : toast({
        variant: "loading",
        message: t("toastMessages.views.pleaseWaitWhileLoadingSummary"),
        timeout: 0,
      });
  queryClient
    .fetchQuery(orgSummaryQuery(org_id))
    .then((data: any) => {
      const res = { data };
      if (
        !summaryHasUserData(res.data) &&
        res.data.alerts?.num_realtime == 0 &&
        res.data.alerts.num_scheduled == 0 &&
        res.data.pipelines?.num_realtime == 0 &&
        res.data.pipelines?.num_scheduled == 0 &&
        res.data.total_dashboards == 0 &&
        res.data.total_functions == 0
      ) {
        no_data_ingest.value = true;
        summary.value = {};
        dismiss();
        return;
      }

      const rawDocCount = res.data.streams?.total_records ?? 0;
      const rawCompressedSize = res.data.streams?.total_compressed_size ?? 0;
      const rawIngestedSize = res.data.streams?.total_storage_size ?? 0;
      const rawIndexSize = res.data.streams?.total_index_size ?? 0;

      summary.value = {
        streams_count: res.data.streams?.num_streams ?? 0,
        ingested_data: formatSizeFromMB(rawIngestedSize),
        compressed_data: formatSizeFromMB(rawCompressedSize),
        doc_count: formatCompactCount(rawDocCount),
        doc_count_raw: rawDocCount,
        compressed_size_raw: rawCompressedSize,
        ingested_size_raw: rawIngestedSize,
        index_size: formatSizeFromMB(rawIndexSize),
        index_size_raw: rawIndexSize,
        scheduled_pipelines: res.data.pipelines?.num_scheduled ?? 0,
        rt_pipelines: res.data.pipelines?.num_realtime ?? 0,
        rt_alerts: res.data.alerts?.num_realtime ?? 0,
        scheduled_alerts: res.data.alerts?.num_scheduled ?? 0,
        dashboard_count: res.data.total_dashboards ?? 0,
        function_count: res.data.total_functions ?? 0,
        failed_pipelines: res.data.pipelines?.trigger_status.failed ?? 0,
        healthy_pipelines: res.data.pipelines?.trigger_status.healthy ?? 0,
        warning_pipelines: res.data.pipelines?.trigger_status.warning ?? 0,
        failed_alerts: res.data.alerts?.trigger_status.failed ?? 0,
        healthy_alerts: res.data.alerts?.trigger_status.healthy ?? 0,
        warning_alerts: res.data.alerts?.trigger_status.warning ?? 0,
      };

      // Animate counters
      animateValue(animatedStreamsCount, 0, summary.value.streams_count, 500);
      animateValue(animatedEventsCount, 0, summary.value.doc_count_raw, 500);
      animateValue(animatedCompressedSize, 0, summary.value.compressed_size_raw, 500);
      animateValue(animatedIngestedSize, 0, summary.value.ingested_size_raw, 500);
      animateValue(animatedIndexSize, 0, summary.value.index_size_raw, 500);
      animateValue(animatedFunctionCount, 0, summary.value.function_count, 500);
      animateValue(animatedDashboardCount, 0, summary.value.dashboard_count, 500);
      animateValue(animatedScheduledAlerts, 0, summary.value.scheduled_alerts, 500);
      animateValue(animatedRtAlerts, 0, summary.value.rt_alerts, 500);
      animateValue(animatedScheduledPipelines, 0, summary.value.scheduled_pipelines, 500);
      animateValue(animatedRtPipelines, 0, summary.value.rt_pipelines, 500);

      no_data_ingest.value = false;
      dismiss();
    })
    .catch((err) => {
      console.log(err);
      dismiss();
      if (flagOn.value) {
        summaryFailed.value = true;
        return;
      }
      toast({
        variant: "error",
        message: t("toastMessages.views.errorWhilePullingSummary"),
      });
    })
    .finally(() => {
      isLoadingSummary.value = false;
    });
};

// Show usage report banner when last_usage_report_ts > 0 and elapsed > 1 hour
const showUsageReportBanner = computed(() => {
  if (!store.state.zoConfig || !("last_usage_report_ts" in store.state.zoConfig)) return false;
  const ts = store.state.zoConfig.last_usage_report_ts;
  if (!ts || ts === 0) return false;
  const reportedAtMs = ts / 1000;
  const elapsedMs = Date.now() - reportedAtMs;
  return elapsedMs > 60 * 60 * 1000;
});

const alertsPanelData = computed(() => {
  void themeVersion.value; // reactive dependency — re-runs when theme changes
  const healthyAlerts = summary.value.healthy_alerts || 0;
  const failedAlerts = summary.value.failed_alerts || 0;
  const total = healthyAlerts + failedAlerts;

  if (total === 0) {
    return {
      chartType: "custom_chart",
      title: {
        text: t("home.noDataAvailable"),
        left: "center",
        top: "center",
        textStyle: {
          fontSize: 16,
          fontWeight: "normal",
          color: chartColor("--color-text-secondary"),
        },
      },
    };
  }

  return {
    chartType: "custom_chart",
    title: {
      text: t("billing.last15Minutes"),
      left: "65%",
      top: "50%",
      textStyle: {
        fontSize: 16,
        fontWeight: "normal",
        color: chartColor("--color-text-heading"),
      },
    },
    tooltip: {
      trigger: "item",
    },
    legend: {
      top: "65%",
      orient: "vertical",
      left: "65%",
      textStyle: {
        color: chartColor("--color-text-heading"),
      },
    },
    series: [
      {
        name: t("billing.alertStatus"),
        type: "pie",
        radius: ["35%", "55%"],
        center: ["35%", "50%"],
        startAngle: 0,
        endAngle: 360,
        label: {
          formatter: "{d}%",
          show: true,
          fontSize: 14,
          color: chartColor("--color-text-heading"),
        },
        labelLine: {
          show: true,
          length: 15,
          length2: 8,
          lineStyle: {
            width: 2,
          },
        },
        data: [
          {
            value: healthyAlerts,
            name: t("billing.successAlerts"),
            itemStyle: {},
          },
          {
            value: failedAlerts,
            name: t("billing.failedAlerts"),
            itemStyle: {},
          },
        ],
      },
    ],
  };
});

const pipelinesPanelData = computed(() => {
  void themeVersion.value; // reactive dependency — re-runs when theme changes
  const healthyPipelines = summary.value.healthy_pipelines || 0;
  const failedPipelines = summary.value.failed_pipelines || 0;
  const warningPipelines = summary.value.warning_pipelines || 0;
  const total = healthyPipelines + failedPipelines + warningPipelines;

  if (total === 0) {
    return {
      chartType: "custom_chart",
      title: {
        text: t("home.noDataAvailable"),
        left: "center",
        top: "center",
        textStyle: {
          fontSize: 16,
          fontWeight: "normal",
          color: chartColor("--color-text-secondary"),
        },
      },
    };
  }

  return {
    chartType: "custom_chart",
    xAxis: {
      type: "category",
      data: [
        t("billing.pipelineStatusHealthy"),
        t("billing.pipelineStatusFailed"),
        t("billing.pipelineStatusWarning"),
      ],
      name: t("billing.last15Minutes"),
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: {
        fontSize: 16,
        fontWeight: "normal",
        color: chartColor("--color-text-secondary"),
      },
      axisLabel: {
        fontSize: 14,
        color: chartColor("--color-text-body"),
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: Math.ceil((healthyPipelines + failedPipelines + warningPipelines) / 3 / 10) * 10 || 10,
      interval: 10,
      name: t("billing.numberOfPipelines"),
      nameLocation: "middle",
      nameGap: 60,
      nameRotate: 90,
      nameTextStyle: {
        fontSize: 16,
        fontWeight: "normal",
        color: chartColor("--color-text-secondary"),
      },
      axisLabel: {
        fontSize: 12,
        color: chartColor("--color-text-secondary"),
      },
      splitLine: {
        lineStyle: {
          color: chartColor("--color-border-subtle"),
        },
      },
      offset: -20,
    },
    series: [
      {
        data: [healthyPipelines, failedPipelines, warningPipelines],
        type: "bar",
        barWidth: "50%",
        label: {
          show: true,
          position: "top",
          fontSize: 14,
          fontWeight: "bold",
          color: chartColor("--color-text-body"),
        },
        itemStyle: {
          color: function (params: any) {
            const colors = ["#16b26a", "#db373b", "#ffc328"];
            return colors[params.dataIndex];
          },
        },
      },
    ],
  };
});

const formattedAnimatedEventsCount = computed(() => {
  return animatedEventsCount.value > 0
    ? formatCompactCount(animatedEventsCount.value)
    : summary.value.doc_count;
});

const formattedAnimatedCompressedSize = computed(() => {
  return animatedCompressedSize.value > 0
    ? formatSizeFromMB(animatedCompressedSize.value)
    : summary.value.compressed_data;
});

const formattedAnimatedIngestedSize = computed(() => {
  return animatedIngestedSize.value > 0
    ? formatSizeFromMB(animatedIngestedSize.value)
    : summary.value.ingested_data;
});

const formattedAnimatedIndexSize = computed(() => {
  return animatedIndexSize.value > 0
    ? formatSizeFromMB(animatedIndexSize.value)
    : summary.value.index_size;
});

const orgId = computed(() => store.state.selectedOrganization?.identifier);

// Rail visibility mirrors the left nav exactly: a route is only registered when
// the user's edition/feature/RBAC gate allows it, so `hasRoute` is the same
// signal the nav flyout filters its children by (see navGroups.ts). This keeps
// the rail from ever offering a page the user has no way to reach.
const canView = (name: string) => router.hasRoute(name);
const showResources = computed(() => canView("functionList") || canView("dashboards"));
const showExplore = computed(() =>
  ["logs", "traces", "metrics", "RUM", "incidentList", "reports"].some((n) => canView(n)),
);

// Initial load
const onThemeColorChanged = () => {
  themeVersion.value++;
};

onMounted(() => {
  if (Object.keys(store.state.selectedOrganization).length > 0 && orgId.value != undefined) {
    getSummary(orgId.value);
  }
  // Refresh config so the UsageReportBanner reflects the latest
  // last_usage_report_ts each time the Usage tab is opened. UsageTab remounts on
  // every visit (the home router-view is not kept-alive), and config is otherwise
  // only fetched at app startup.
  refreshConfig();
  window.addEventListener("themeColorChanged", onThemeColorChanged);
});

const refreshConfig = async () => {
  try {
    if (!orgId.value) return;
    // Forced: the whole point of this call is a fresher last_usage_report_ts
    // than the one the banner is already rendering.
    store.dispatch(
      "setConfig",
      await queryClient
        .invalidateQueries({
          queryKey: configFullQuery(orgId.value).queryKey,
          exact: true,
          refetchType: "none",
        })
        .then(() => queryClient.fetchQuery(configFullQuery(orgId.value))),
    );
    markFullConfigLoaded(orgId.value);
  } catch (error) {
    console.log(error);
  }
};

onUnmounted(() => {
  window.removeEventListener("themeColorChanged", onThemeColorChanged);
});

// Re-fetch when org changes
watch(orgId, (newVal, oldVal) => {
  if (newVal && (newVal != oldVal || !summary.value || Object.keys(summary.value).length === 0)) {
    summary.value = {};
    getSummary(newVal);
  }
});
</script>
