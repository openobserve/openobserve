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
      v-if="!no_data_ingest && !isLoadingSummary"
      class="w-full h-full flex flex-col overflow-y-auto px-page-edge pt-2 pb-1"
    >
      <!-- Banners — each component renders nothing when inactive, so this whole
           block collapses to zero height (no reserved margin) when idle; the
           gap below only appears when a banner is actually shown. -->
      <div class="shrink-0 flex flex-col gap-2 empty:hidden not-empty:mb-3">
        <TrialPeriod></TrialPeriod>
        <LicensePeriod
          v-if="!showUsageReportBanner"
          @update-license="goToLicensePage"
        ></LicensePeriod>
        <UsageReportBanner></UsageReportBanner>
        <DatabaseDeprecationBanner></DatabaseDeprecationBanner>
      </div>

      <!-- Streams — data-volume metrics. Uniform, non-clickable stat tiles; the
           list is reached from the section header so the row stays consistent. -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text"
            aria-hidden="true"
          >
            <OIcon name="window" size="sm" />
          </span>
          <span class="text-base font-semibold text-text-heading">{{ t("home.streams") }}</span>
        </div>
        <OButton
          v-if="canView('logstreams')"
          variant="ghost"
          size="icon-circle"
          class="relative"
          :aria-label="t('home.viewButton')"
          :title="t('home.viewButton')"
          data-test="home-usage-tab-view-streams-btn"
        >
          <OIcon name="arrow-forward" size="sm" />
          <router-link
            exact
            :to="{ name: 'logstreams', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
            class="absolute inset-0"
            :aria-label="t('home.viewButton')"
          ></router-link>
        </OButton>
      </div>
      <KpiCardRow class="shrink-0 mb-4" min-width="12rem">
        <!-- Streams -->
        <KpiCard
          :label="t('home.streams')"
          icon="window"
          icon-size="md"
          label-class="text-sm font-medium text-text-secondary"
          icon-class="bg-icon-chip-primary-bg text-icon-chip-primary-text"
        >
          <template #value>
            <span
              class="text-2xl font-semibold text-text-heading tabular-nums leading-tight"
              aria-live="polite"
              data-test="home-usage-tab-streams-count"
            >{{ animatedStreamsCount || summary.streams_count }}</span>
          </template>
        </KpiCard>

        <!-- Events -->
        <KpiCard
          :label="t('home.docsCountLbl')"
          icon="bar-chart"
          icon-size="md"
          label-class="text-sm font-medium text-text-secondary"
          icon-class="bg-icon-chip-primary-bg text-icon-chip-primary-text"
        >
          <template #value>
            <span
              class="text-2xl font-semibold text-text-heading tabular-nums leading-tight"
              aria-live="polite"
              data-test="home-usage-tab-events-count"
            >{{ formattedAnimatedEventsCount }}</span>
          </template>
        </KpiCard>

        <!-- Ingested size -->
        <KpiCard
          :label="t('home.totalDataIngested')"
          icon="download"
          icon-size="md"
          label-class="text-sm font-medium text-text-secondary"
          icon-class="bg-icon-chip-warning-bg text-icon-chip-warning-text"
        >
          <template #value>
            <span
              class="text-2xl font-semibold text-text-heading tabular-nums leading-tight"
              aria-live="polite"
              data-test="home-usage-tab-ingested-size"
            >{{ formattedAnimatedIngestedSize }}</span>
          </template>
        </KpiCard>

        <!-- Compressed size (self-hosted only) -->
        <KpiCard
          v-if="config.isCloud == 'false'"
          :label="t('home.totalDataCompressed')"
          icon="compress"
          icon-size="md"
          label-class="text-sm font-medium text-text-secondary"
          icon-class="bg-icon-chip-success-bg text-icon-chip-success-text"
        >
          <template #value>
            <span
              class="text-2xl font-semibold text-text-heading tabular-nums leading-tight"
              aria-live="polite"
              data-test="home-usage-tab-compressed-size"
            >{{ formattedAnimatedCompressedSize }}</span>
          </template>
        </KpiCard>

        <!-- Index size (self-hosted only) -->
        <KpiCard
          v-if="config.isCloud == 'false'"
          :label="t('home.indexSizeLbl')"
          icon="save"
          icon-size="md"
          label-class="text-sm font-medium text-text-secondary"
          icon-class="bg-icon-chip-warning-bg text-icon-chip-warning-text"
        >
          <template #value>
            <span
              class="text-2xl font-semibold text-text-heading tabular-nums leading-tight"
              aria-live="polite"
              data-test="home-usage-tab-index-size"
            >{{ formattedAnimatedIndexSize }}</span>
          </template>
        </KpiCard>
      </KpiCardRow>

      <!-- Main region — a filled resources rail beside the two status charts, so
           Functions/Dashboards live somewhere purposeful and the vertical space
           is actually used. Rail carries counts + one-click access to every area. -->
      <div class="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 flex-1 min-h-0">
        <!-- Resources rail -->
        <aside
          class="rounded-default p-4 bg-card-glass-bg border border-card-glass-border flex flex-col min-h-0 overflow-y-auto"
          :aria-label="t('common.resources')"
        >
          <!-- Resources — owned assets with live counts. Each row is gated to the
               same route the left nav uses, so it hides when access is missing. -->
          <template v-if="showResources">
            <div class="text-sm font-semibold text-text-heading mb-1">{{ t("home.resources") }}</div>
            <nav class="flex flex-col">
              <router-link
                v-if="canView('functionList')"
                class="group flex items-center gap-2.5 rounded-default -mx-2 px-2 py-2 no-underline text-inherit transition-colors hover:bg-table-row-hover-bg"
                :to="{ name: 'functionList', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                data-test="home-usage-tab-functions-card"
              >
                <span class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text" aria-hidden="true">
                  <OIcon name="function" size="sm" />
                </span>
                <span class="flex-1 min-w-0 text-sm font-medium text-text-body truncate">{{ t("home.functionTitle") }}</span>
                <span class="text-sm font-semibold text-text-heading tabular-nums" data-test="home-usage-tab-functions-count">{{ animatedFunctionCount || summary.function_count }}</span>
                <OIcon name="chevron-right" size="sm" class="shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" />
              </router-link>
              <router-link
                v-if="canView('dashboards')"
                class="group flex items-center gap-2.5 rounded-default -mx-2 px-2 py-2 no-underline text-inherit transition-colors hover:bg-table-row-hover-bg"
                :to="{ name: 'dashboards', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                data-test="home-usage-tab-dashboards-card"
              >
                <span class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-warning-bg text-icon-chip-warning-text" aria-hidden="true">
                  <OIcon name="dashboard" size="sm" />
                </span>
                <span class="flex-1 min-w-0 text-sm font-medium text-text-body truncate">{{ t("home.dashboardTitle") }}</span>
                <span class="text-sm font-semibold text-text-heading tabular-nums" data-test="home-usage-tab-dashboards-count">{{ animatedDashboardCount || summary.dashboard_count }}</span>
                <OIcon name="chevron-right" size="sm" class="shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" />
              </router-link>
            </nav>
          </template>

          <div v-if="showResources && showExplore" class="h-px bg-border-default my-3" role="separator"></div>

          <!-- Explore — data surfaces. Same per-route gating as above. -->
          <template v-if="showExplore">
            <div class="text-xs font-semibold text-text-secondary mb-1">{{ t("home.explore") }}</div>
            <nav class="flex flex-col">
              <router-link
                v-if="canView('logs')"
                class="group flex items-center gap-2.5 rounded-default -mx-2 px-2 py-2 no-underline text-inherit transition-colors hover:bg-table-row-hover-bg"
                :to="{ name: 'logs', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                data-test="home-usage-tab-explore-logs"
              >
                <span class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-success-bg text-icon-chip-success-text" aria-hidden="true">
                  <OIcon name="search" size="sm" />
                </span>
                <span class="flex-1 min-w-0 text-sm font-medium text-text-body truncate">{{ t("menu.search") }}</span>
                <OIcon name="chevron-right" size="sm" class="shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" />
              </router-link>
              <router-link
                v-if="canView('traces')"
                class="group flex items-center gap-2.5 rounded-default -mx-2 px-2 py-2 no-underline text-inherit transition-colors hover:bg-table-row-hover-bg"
                :to="{ name: 'traces', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                data-test="home-usage-tab-explore-traces"
              >
                <span class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text" aria-hidden="true">
                  <OIcon name="account-tree" size="sm" />
                </span>
                <span class="flex-1 min-w-0 text-sm font-medium text-text-body truncate">{{ t("menu.traces") }}</span>
                <OIcon name="chevron-right" size="sm" class="shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" />
              </router-link>
              <router-link
                v-if="canView('metrics')"
                class="group flex items-center gap-2.5 rounded-default -mx-2 px-2 py-2 no-underline text-inherit transition-colors hover:bg-table-row-hover-bg"
                :to="{ name: 'metrics', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                data-test="home-usage-tab-explore-metrics"
              >
                <span class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-success-bg text-icon-chip-success-text" aria-hidden="true">
                  <OIcon name="bar-chart" size="sm" />
                </span>
                <span class="flex-1 min-w-0 text-sm font-medium text-text-body truncate">{{ t("menu.metrics") }}</span>
                <OIcon name="chevron-right" size="sm" class="shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" />
              </router-link>
              <router-link
                v-if="canView('RUM')"
                class="group flex items-center gap-2.5 rounded-default -mx-2 px-2 py-2 no-underline text-inherit transition-colors hover:bg-table-row-hover-bg"
                :to="{ name: 'RUM', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                data-test="home-usage-tab-explore-rum"
              >
                <span class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text" aria-hidden="true">
                  <OIcon name="devices" size="sm" />
                </span>
                <span class="flex-1 min-w-0 text-sm font-medium text-text-body truncate">{{ t("menu.rum") }}</span>
                <OIcon name="chevron-right" size="sm" class="shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" />
              </router-link>
              <router-link
                v-if="canView('incidentList')"
                class="group flex items-center gap-2.5 rounded-default -mx-2 px-2 py-2 no-underline text-inherit transition-colors hover:bg-table-row-hover-bg"
                :to="{ name: 'incidentList', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                data-test="home-usage-tab-explore-incidents"
              >
                <span class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-warning-bg text-icon-chip-warning-text" aria-hidden="true">
                  <OIcon name="notifications-active" size="sm" />
                </span>
                <span class="flex-1 min-w-0 text-sm font-medium text-text-body truncate">{{ t("menu.incidents") }}</span>
                <OIcon name="chevron-right" size="sm" class="shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" />
              </router-link>
              <router-link
                v-if="canView('reports')"
                class="group flex items-center gap-2.5 rounded-default -mx-2 px-2 py-2 no-underline text-inherit transition-colors hover:bg-table-row-hover-bg"
                :to="{ name: 'reports', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                data-test="home-usage-tab-explore-reports"
              >
                <span class="inline-flex items-center justify-center shrink-0 w-8 h-8 rounded-default bg-icon-chip-warning-bg text-icon-chip-warning-text" aria-hidden="true">
                  <OIcon name="description" size="sm" />
                </span>
                <span class="flex-1 min-w-0 text-sm font-medium text-text-body truncate">{{ t("menu.report") }}</span>
                <OIcon name="chevron-right" size="sm" class="shrink-0 text-text-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-text-secondary" />
              </router-link>
            </nav>
          </template>
        </aside>

        <!-- Alerts -->
        <section
          class="rounded-default p-4 bg-card-glass-bg border border-card-glass-border flex flex-col min-h-0"
          :aria-label="t('home.alertsOverviewSection')"
        >
          <div class="flex justify-between items-center gap-2">
            <span class="text-sm font-semibold text-text-heading flex items-center gap-2">
              <span class="inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-default bg-icon-chip-warning-bg text-icon-chip-warning-text" aria-hidden="true">
                <OIcon name="shield-alert-outline" size="md" />
              </span>
              {{ t("home.alertTitle") }}
            </span>
            <OButton
              v-if="canView('alertList')"
              variant="ghost"
              size="icon-circle"
              class="relative"
              :aria-label="t('home.viewButton')"
              :title="t('home.viewButton')"
              data-test="home-usage-tab-view-alerts-btn"
            >
              <OIcon name="arrow-forward" size="sm" />
              <router-link
                exact
                :to="{ name: 'alertList', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                class="absolute inset-0"
                :aria-label="t('home.viewButton')"
              ></router-link>
            </OButton>
          </div>
          <div class="flex pt-3 gap-4">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-text-secondary">{{ t("home.scheduledAlert") }}</span>
              <span
                class="text-lg font-semibold text-text-heading tabular-nums leading-tight"
                aria-live="polite"
                data-test="home-usage-tab-scheduled-alerts-count"
              >{{ animatedScheduledAlerts || summary.scheduled_alerts }}</span>
            </div>
            <OSeparator :vertical="true" />
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-text-secondary">{{ t("home.rtAlert") }}</span>
              <span
                class="text-lg font-semibold text-text-heading tabular-nums leading-tight"
                aria-live="polite"
                data-test="home-usage-tab-rt-alerts-count"
              >{{ animatedRtAlerts || summary.rt_alerts }}</span>
            </div>
          </div>
          <div class="flex-1 min-h-50 w-full mt-3">
            <CustomChartRenderer
              :key="alertsPanelDataKey"
              :data="alertsPanelData"
              class="w-full h-full"
            />
          </div>
        </section>

        <!-- Pipelines -->
        <section
          class="rounded-default p-4 bg-card-glass-bg border border-card-glass-border flex flex-col min-h-0"
          :aria-label="t('home.pipelinesOverviewSection')"
        >
          <div class="flex justify-between items-center gap-2">
            <span class="text-sm font-semibold text-text-heading flex items-center gap-2">
              <span class="inline-flex items-center justify-center shrink-0 w-10 h-10 rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text" aria-hidden="true">
                <OIcon name="lan" size="md" />
              </span>
              {{ t("home.pipelineTitle") }}
            </span>
            <OButton
              v-if="canView('pipelines')"
              variant="ghost"
              size="icon-circle"
              class="relative"
              :aria-label="t('home.viewButton')"
              :title="t('home.viewButton')"
              data-test="home-usage-tab-view-pipelines-btn"
            >
              <OIcon name="arrow-forward" size="sm" />
              <router-link
                exact
                :to="{ name: 'pipelines', query: { org_identifier: store.state.selectedOrganization?.identifier } }"
                class="absolute inset-0"
                :aria-label="t('home.viewButton')"
              ></router-link>
            </OButton>
          </div>
          <div class="flex pt-3 gap-4">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-text-secondary">{{ t("home.schedulePipelineTitle") }}</span>
              <span
                class="text-lg font-semibold text-text-heading tabular-nums leading-tight"
                aria-live="polite"
                data-test="home-usage-tab-scheduled-pipelines-count"
              >{{ animatedScheduledPipelines || summary.scheduled_pipelines }}</span>
            </div>
            <OSeparator :vertical="true" />
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-text-secondary">{{ t("home.rtPipelineTitle") }}</span>
              <span
                class="text-lg font-semibold text-text-heading tabular-nums leading-tight"
                aria-live="polite"
                data-test="home-usage-tab-rt-pipelines-count"
              >{{ animatedRtPipelines || summary.rt_pipelines }}</span>
            </div>
          </div>
          <div class="flex-1 min-h-50 w-full mt-3">
            <CustomChartRenderer
              :key="pipelinesPanelDataKey"
              :data="pipelinesPanelData"
              class="w-full h-full"
            />
          </div>
        </section>
      </div>
    </div>

    <!-- Empty state when no data ingested -->
    <div
      v-if="no_data_ingest && !isLoadingSummary"
      class="flex flex-col h-full"
      data-test="home-usage-tab-no-data"
    >
      <TrialPeriod />
      <HomeNoDataState />
    </div>

    <!-- Loading state -->
    <div v-if="isLoadingSummary" class="h-full" data-test="home-usage-tab-loading">
      <HomeViewSkeleton />
    </div>
  </div>
</template>

<!-- UsageTab: self-contained home usage dashboard showing streams, functions, dashboards, alerts, and pipelines summary with animated counters and charts. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import orgService from "@/services/organizations";
import configService from "@/services/config";
import config from "@/aws-exports";
import { formatSizeFromMB } from "@/utils/zincutils";
import { chartColor } from "@/utils/chartTheme";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";
import UsageReportBanner from "@/enterprise/components/billings/UsageReportBanner.vue";
import DatabaseDeprecationBanner from "@/components/DatabaseDeprecationBanner.vue";
import HomeViewSkeleton from "@/components/shared/HomeViewSkeleton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import KpiCard from "@/components/common/KpiCard.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import HomeNoDataState from "@/views/HomeNoDataState.vue";

const { t } = useI18n();
const store = useStore();
const router = useRouter();

const summary = ref<any>([]);
const no_data_ingest = ref(false);
const alertsPanelDataKey = ref(0);
const pipelinesPanelDataKey = ref(0);
const isLoadingSummary = ref(false);

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
const animateValue = (
  targetRef: any,
  start: number,
  end: number,
  duration: number,
) => {
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

const formatEventCount = (num: number): string => {
  if (num < 100000) return num.toString();

  const units = ["", "K", "M", "B", "T"];
  let tier = Math.floor(Math.log10(num) / 3);

  if (tier >= units.length) tier = units.length - 1;

  const scaled = num / Math.pow(10, tier * 3);
  return scaled.toFixed(1).replace(/\.0$/, "") + units[tier];
};

const getSummary = (org_id: any) => {
  isLoadingSummary.value = true;
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while loading summary...",
      timeout: 0,
});
  orgService
    .get_organization_summary(org_id)
    .then((res) => {
      if (
        res.data.streams.num_streams == 0 &&
        res.data.alerts.num_realtime == 0 &&
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
      const rawCompressedSize =
        res.data.streams?.total_compressed_size ?? 0;
      const rawIngestedSize = res.data.streams?.total_storage_size ?? 0;
      const rawIndexSize = res.data.streams?.total_index_size ?? 0;

      summary.value = {
        streams_count: res.data.streams?.num_streams ?? 0,
        ingested_data: formatSizeFromMB(rawIngestedSize),
        compressed_data: formatSizeFromMB(rawCompressedSize),
        doc_count: formatEventCount(rawDocCount),
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
      animateValue(
        animatedStreamsCount,
        0,
        summary.value.streams_count,
        500,
      );
      animateValue(
        animatedEventsCount,
        0,
        summary.value.doc_count_raw,
        500,
      );
      animateValue(
        animatedCompressedSize,
        0,
        summary.value.compressed_size_raw,
        500,
      );
      animateValue(
        animatedIngestedSize,
        0,
        summary.value.ingested_size_raw,
        500,
      );
      animateValue(animatedIndexSize, 0, summary.value.index_size_raw, 500);
      animateValue(
        animatedFunctionCount,
        0,
        summary.value.function_count,
        500,
      );
      animateValue(
        animatedDashboardCount,
        0,
        summary.value.dashboard_count,
        500,
      );
      animateValue(
        animatedScheduledAlerts,
        0,
        summary.value.scheduled_alerts,
        500,
      );
      animateValue(animatedRtAlerts, 0, summary.value.rt_alerts, 500);
      animateValue(
        animatedScheduledPipelines,
        0,
        summary.value.scheduled_pipelines,
        500,
      );
      animateValue(animatedRtPipelines, 0, summary.value.rt_pipelines, 500);

      no_data_ingest.value = false;
      dismiss();
    })
    .catch((err) => {
      console.log(err);
      dismiss();
      toast({
        variant: "error",
        message: "Error while pulling summary.",
      });
    })
    .finally(() => {
      isLoadingSummary.value = false;
    });
};

// Show usage report banner when last_usage_report_ts > 0 and elapsed > 1 hour
const showUsageReportBanner = computed(() => {
  if (
    !store.state.zoConfig ||
    !("last_usage_report_ts" in store.state.zoConfig)
  )
    return false;
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
      text: "Last 15 minutes",
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
        name: "Alert Status",
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
            name: "Success Alerts",
            itemStyle: {
            },
          },
          {
            value: failedAlerts,
            name: "Failed Alerts",
            itemStyle: {
            },
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
      data: ["Healthy", "Failed", "Warning"],
      name: "Last 15 minutes",
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
      max:
        Math.ceil(
          (healthyPipelines + failedPipelines + warningPipelines) / 3 / 10,
        ) * 10 || 10,
      interval: 10,
      name: "Number of Pipelines",
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










const goToLicensePage = () => {
  router.push({ name: "license" });
};

const formattedAnimatedEventsCount = computed(() => {
  return animatedEventsCount.value > 0
    ? formatEventCount(animatedEventsCount.value)
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
const showResources = computed(
  () => canView("functionList") || canView("dashboards"),
);
const showExplore = computed(() =>
  ["logs", "traces", "metrics", "RUM", "incidentList", "reports"].some((n) =>
    canView(n),
  ),
);

// Initial load
const onThemeColorChanged = () => { themeVersion.value++; };

onMounted(() => {
  if (
    Object.keys(store.state.selectedOrganization).length > 0 &&
    orgId.value != undefined
  ) {
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
    const res: any = await configService.get_config();
    store.dispatch("setConfig", res.data);
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
