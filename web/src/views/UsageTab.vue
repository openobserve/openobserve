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
  <div class="usage-tab" :class="{ 'usage-tab--ai': store.state.isAiChatEnabled }">
    <!-- Main content when data exists -->
    <div
      v-if="!no_data_ingest && !isLoadingSummary"
      class="tw:w-full tw:px-[0.625rem] tw:py-[0.625rem] card-container card-container--col"
      :class="
        store.state.isAiChatEnabled ? 'tw:h-[calc(100% - 2.5rem)]' : 'tw:h-full'
      "
    >
      <!-- Banners -->
      <div class="banners-wrapper">
        <div>
          <WebinarBanner v-if="config.isCloud === 'true'" variant="home" />
          <TrialPeriod></TrialPeriod>
        </div>
        <LicensePeriod
          v-if="!showUsageReportBanner"
          @update-license="goToLicensePage"
        ></LicensePeriod>
        <UsageReportBanner></UsageReportBanner>
        <DatabaseDeprecationBanner></DatabaseDeprecationBanner>
      </div>

      <!-- Streams overview section -->
      <div
        class="feature-card"
        :class="
          store.state.theme === 'dark'
            ? 'dark-stream-container'
            : 'light-stream-container'
        "
        role="region"
        aria-label="Streams overview section"
      >
        <div class="row justify-between items-center streams-header">
          <div class="row tw:items-center tw:gap-2">
            <div class="tile-icon icon-bg-blue" aria-hidden="true">
              <q-icon :name="outlinedWindow" size="1.5rem" />
            </div>
            <div class="section-header">{{ t("home.streams") }}</div>
          </div>
          <OButton
            variant="ghost"
            size="icon-circle"
            :class="
              store.state.theme === 'dark'
                ? 'view-button-dark'
                : 'view-button-light'
            "
            aria-label="View all streams"
            :title="t('home.viewButton')"
            data-test="home-usage-tab-view-streams-btn"
          >
            <q-icon name="arrow_forward" class="view-arrow-icon" />
            <router-link
              exact
              :to="{
                name: 'logstreams',
                query: {
                  org_identifier:
                    store.state.selectedOrganization?.identifier,
                },
              }"
              class="tw:absolute tw:inset-0"
              aria-label="Navigate to streams page"
            ></router-link>
          </OButton>
        </div>

        <!-- Tiles -->
        <div class="tiles-grid">
          <div class="tile">
            <div
              class="tile-content rounded-borders text-center column justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Streams count statistics"
            >
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">{{ t("home.streams") }}</div>
                  <div class="tile-icon icon-bg-blue" aria-hidden="true">
                    <img :src="streamsIcon" alt="" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="performance-text"
                  :class="
                    store.state.theme === 'dark'
                      ? 'positive-increase-dark'
                      : 'positive-increase-light'
                  "
                >
                  <q-icon name="arrow_upward" size="0.875rem" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display row items-end"
                aria-live="polite"
                data-test="home-usage-tab-streams-count"
              >
                {{ animatedStreamsCount || summary.streams_count }}
              </div>
            </div>
          </div>

          <div class="tile">
            <div
              class="tile-content rounded-borders text-center column justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Events count statistics"
            >
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">{{ t("home.docsCountLbl") }}</div>
                  <div class="tile-icon icon-bg-blue" aria-hidden="true">
                    <img :src="recordsIcon" alt="" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="performance-text"
                  :class="
                    store.state.theme === 'dark'
                      ? 'positive-increase-dark'
                      : 'positive-increase-light'
                  "
                >
                  <q-icon name="arrow_upward" size="0.875rem" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display row items-end"
                aria-live="polite"
                data-test="home-usage-tab-events-count"
              >
                {{ formattedAnimatedEventsCount }}
              </div>
            </div>
          </div>

          <div class="tile">
            <div
              class="tile-content rounded-borders text-center column justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Ingested data size statistics"
            >
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">
                    {{ t("home.totalDataIngested") }}
                  </div>
                  <div class="tile-icon icon-bg-blue" aria-hidden="true">
                    <img :src="ingestedSizeIcon" alt="" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="performance-text"
                  :class="
                    store.state.theme === 'dark'
                      ? 'negative-increase-dark'
                      : 'negative-increase-light'
                  "
                >
                  <q-icon name="arrow_downward" size="0.875rem" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display row items-end"
                aria-live="polite"
                data-test="home-usage-tab-ingested-size"
              >
                {{ formattedAnimatedIngestedSize }}
              </div>
            </div>
          </div>

          <div class="tile" v-if="config.isCloud == 'false'">
            <div
              class="tile-content rounded-borders text-center column justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Compressed data size statistics"
            >
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">
                    {{ t("home.totalDataCompressed") }}
                  </div>
                  <div class="tile-icon icon-bg-blue" aria-hidden="true">
                    <img :src="compressedSizeIcon" alt="" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="performance-text"
                  :class="
                    store.state.theme === 'dark'
                      ? 'positive-increase-dark'
                      : 'positive-increase-light'
                  "
                >
                  <q-icon name="arrow_upward" size="0.875rem" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display row items-end"
                aria-live="polite"
                data-test="home-usage-tab-compressed-size"
              >
                {{ formattedAnimatedCompressedSize }}
              </div>
            </div>
          </div>

          <div class="tile" v-if="config.isCloud == 'false'">
            <div
              class="tile-content rounded-borders text-center column justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Index size statistics"
            >
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">{{ t("home.indexSizeLbl") }}</div>
                  <div class="tile-icon icon-bg-blue" aria-hidden="true">
                    <img :src="indexSizeIcon" alt="" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="performance-text"
                  :class="
                    store.state.theme === 'dark'
                      ? 'positive-increase-dark'
                      : 'positive-increase-light'
                  "
                >
                  <q-icon name="arrow_upward" size="0.875rem" /> 0.00% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display row items-end"
                aria-live="polite"
                data-test="home-usage-tab-index-size"
              >
                {{ formattedAnimatedIndexSize }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Charts section -->
      <div class="charts-main-container">
        <!-- Functions and Dashboards tiles -->
        <div class="functions-dashboards-column">
          <div class="tile-wrapper">
            <div
              class="feature-card rounded-borders text-center column justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Functions count statistics"
            >
              <div class="column justify-between">
                <div
                  class="row tw:items-center tw:gap-2 tw:flex-nowrap full-width"
                >
                  <div
                    class="tile-icon icon-bg-orange tw:flex-shrink-0"
                    aria-hidden="true"
                  >
                    <img :src="functionsIcon" alt="" />
                  </div>
                  <div
                    class="tile-title tw:flex-1 tw:text-left tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis"
                  >
                    {{ t("home.functionTitle") }}
                  </div>
                  <OButton
                    variant="ghost"
                    size="icon-circle"
                    :class="
                      store.state.theme === 'dark'
                        ? 'view-button-dark'
                        : 'view-button-light'
                    "
                    aria-label="View all functions"
                    class="tw:flex-shrink-0"
                    :title="t('home.viewButton')"
                    data-test="home-usage-tab-view-functions-btn"
                  >
                    <q-icon name="arrow_forward" class="view-arrow-icon" />
                    <router-link
                      exact
                      :to="{
                        name: 'functionList',
                        query: {
                          org_identifier:
                            store.state.selectedOrganization?.identifier,
                        },
                      }"
                      class="tw:absolute tw:inset-0"
                      aria-label="Navigate to functions page"
                    ></router-link>
                  </OButton>
                </div>
              </div>
              <div
                class="data-to-display row items-end"
                aria-live="polite"
                data-test="home-usage-tab-functions-count"
              >
                {{ animatedFunctionCount || summary.function_count }}
              </div>
            </div>
          </div>

          <div class="tile-wrapper">
            <div
              class="feature-card rounded-borders text-center column justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Dashboards count statistics"
            >
              <div class="column justify-between">
                <div
                  class="row tw:items-center tw:gap-2 tw:flex-nowrap full-width"
                >
                  <div
                    class="tile-icon icon-bg-orange tw:flex-shrink-0"
                    aria-hidden="true"
                  >
                    <img :src="dashboardsIcon" alt="" />
                  </div>
                  <div
                    class="tile-title tw:flex-1 tw:text-left tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis"
                  >
                    {{ t("home.dashboardTitle") }}
                  </div>
                  <OButton
                    variant="ghost"
                    size="icon-circle"
                    :class="
                      store.state.theme === 'dark'
                        ? 'view-button-dark'
                        : 'view-button-light'
                    "
                    aria-label="View all dashboards"
                    class="tw:flex-shrink-0"
                    :title="t('home.viewButton')"
                    data-test="home-usage-tab-view-dashboards-btn"
                  >
                    <q-icon name="arrow_forward" class="view-arrow-icon" />
                    <router-link
                      exact
                      :to="{
                        name: 'dashboards',
                        query: {
                          org_identifier:
                            store.state.selectedOrganization?.identifier,
                        },
                      }"
                      class="tw:absolute tw:inset-0"
                      aria-label="Navigate to dashboards page"
                    ></router-link>
                  </OButton>
                </div>
              </div>
              <div
                class="data-to-display row items-end"
                aria-live="polite"
                data-test="home-usage-tab-dashboards-count"
              >
                {{ animatedDashboardCount || summary.dashboard_count }}
              </div>
            </div>
          </div>
        </div>

        <!-- Alerts chart -->
        <div
          class="feature-card first-chart-container rounded-borders tw:p-4"
          :class="
            store.state.theme === 'dark'
              ? 'chart-container-dark'
              : 'chart-container-light'
          "
          role="region"
          aria-label="Alerts overview section"
        >
          <div class="details-container">
            <div class="row justify-between items-center">
              <span class="text-title tw:flex tw:items-center tw:gap-2">
                <div class="tile-icon icon-bg-blue" aria-hidden="true">
                  <img :src="alertsIcon" alt="" />
                </div>
                {{ t("home.alertTitle") }}
              </span>
              <OButton
                variant="ghost"
                size="icon-circle"
                :class="
                  store.state.theme === 'dark'
                    ? 'view-button-dark'
                    : 'view-button-light'
                "
                aria-label="View all alerts"
                :title="t('home.viewButton')"
                data-test="home-usage-tab-view-alerts-btn"
              >
                <q-icon name="arrow_forward" class="view-arrow-icon" />
                <router-link
                  exact
                  :to="{
                    name: 'alertList',
                    query: {
                      org_identifier:
                        store.state.selectedOrganization?.identifier,
                    },
                  }"
                  class="tw:absolute tw:inset-0"
                  aria-label="Navigate to alerts page"
                ></router-link>
              </OButton>
            </div>
            <div class="row tw:pt-2 home-stat-row">
              <div class="column">
                <span class="text-subtitle">{{
                  t("home.scheduledAlert")
                }}</span>
                <span
                  class="results-count"
                  aria-live="polite"
                  data-test="home-usage-tab-scheduled-alerts-count"
                >{{
                  animatedScheduledAlerts || summary.scheduled_alerts
                }}</span>
              </div>
              <OSeparator :vertical="true" />
              <div class="column">
                <span class="text-subtitle">{{ t("home.rtAlert") }}</span>
                <span
                  class="results-count"
                  aria-live="polite"
                  data-test="home-usage-tab-rt-alerts-count"
                >{{
                  animatedRtAlerts || summary.rt_alerts
                }}</span>
              </div>
            </div>
          </div>
          <div
            class="custom-first-chart tw:my-auto xl:tw:min-h-[200px] tw:h-[calc(100vh-500px)] md:tw:h-[calc(100vh-500px)] lg:tw:h-[calc(100vh-550px)] xl:tw:h-[calc(100vh-645px)] tw:w-full"
          >
            <CustomChartRenderer
              :key="alertsPanelDataKey"
              :data="alertsPanelData"
              class="tw:w-full tw:h-full md:tw:h-[calc(100vh-400px)]"
            />
          </div>
        </div>

        <!-- Pipelines chart -->
        <div
          class="feature-card second-chart-container rounded-borders tw:p-4"
          :class="
            store.state.theme === 'dark'
              ? 'chart-container-dark'
              : 'chart-container-light'
          "
          role="region"
          aria-label="Pipelines overview section"
        >
          <div class="details-container">
            <div class="row justify-between items-center">
              <span class="text-title tw:flex tw:items-center tw:gap-2">
                <div class="tile-icon icon-bg-blue" aria-hidden="true">
                  <img :src="pipelinesIcon" alt="" />
                </div>
                {{ t("home.pipelineTitle") }}
              </span>
              <OButton
                variant="ghost"
                size="icon-circle"
                :class="
                  store.state.theme === 'dark'
                    ? 'view-button-dark'
                    : 'view-button-light'
                "
                aria-label="View all pipelines"
                :title="t('home.viewButton')"
                data-test="home-usage-tab-view-pipelines-btn"
              >
                <q-icon name="arrow_forward" class="view-arrow-icon" />
                <router-link
                  exact
                  :to="{
                    name: 'pipelines',
                    query: {
                      org_identifier:
                        store.state.selectedOrganization?.identifier,
                    },
                  }"
                  class="tw:absolute tw:inset-0"
                  aria-label="Navigate to pipelines page"
                ></router-link>
              </OButton>
            </div>
            <div class="row tw:pt-2 home-stat-row">
              <div class="column">
                <span class="text-subtitle">
                  {{ t("home.schedulePipelineTitle") }}</span
                >
                <span
                  class="results-count"
                  aria-live="polite"
                  data-test="home-usage-tab-scheduled-pipelines-count"
                >{{
                  animatedScheduledPipelines || summary.scheduled_pipelines
                }}</span>
              </div>
              <OSeparator :vertical="true" />
              <div class="column">
                <span class="text-subtitle">{{
                  t("home.rtPipelineTitle")
                }}</span>
                <span
                  class="results-count"
                  aria-live="polite"
                  data-test="home-usage-tab-rt-pipelines-count"
                >{{
                  animatedRtPipelines || summary.rt_pipelines
                }}</span>
              </div>
            </div>
          </div>
          <div
            class="custom-second-chart tw:my-auto xl:tw:min-h-[200px] tw:h-[calc(100vh-500px)] md:tw:h-[calc(100vh-500px)] lg:tw:h-[calc(100vh-550px)] xl:tw:h-[calc(100vh-645px)]"
          >
            <CustomChartRenderer
              :key="pipelinesPanelDataKey"
              :data="pipelinesPanelData"
              class="tw:w-full tw:h-full"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state when no data ingested -->
    <div
      v-if="no_data_ingest && !isLoadingSummary"
      class="tw:p-4 row items-start tw:gap-4 home-no-data-panel"
      data-test="home-usage-tab-no-data"
    >
      <TrialPeriod></TrialPeriod>
      <div class="my-card">
        <div align="center" class="my-card tw:py-4">
          <div class="tw:text-xl tw:font-medium">{{ t("home.noData") }}</div>
          <div class="tw:text-base">{{ t("home.ingestionMsg") }}</div>
        </div>

        <OSeparator />

        <div class="tw:py-2 tw:text-center">
          <OButton
            variant="ghost-primary"
            data-test="home-usage-tab-find-ingestion-btn"
            @click="() => $router.push({ name: 'ingestion' })"
            >{{ t("home.findIngestion") }}
          </OButton>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="isLoadingSummary" data-test="home-usage-tab-loading">
      <HomeViewSkeleton />
    </div>
  </div>
</template>

<!-- UsageTab: self-contained home usage dashboard showing streams, functions, dashboards, alerts, and pipelines summary with animated counters and charts. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import orgService from "@/services/organizations";
import config from "@/aws-exports";
import { formatSizeFromMB, getImageURL } from "@/utils/zincutils";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";
import UsageReportBanner from "@/enterprise/components/billings/UsageReportBanner.vue";
import DatabaseDeprecationBanner from "@/components/DatabaseDeprecationBanner.vue";
import WebinarBanner from "@/components/WebinarBanner.vue";
import HomeViewSkeleton from "@/components/shared/HomeViewSkeleton.vue";
import { outlinedWindow } from "@quasar/extras/material-icons-outlined";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const $q = useQuasar();

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
  const dismiss = $q.notify({
    spinner: true,
    message: "Please wait while loading summary...",
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
      $q.notify({
        type: "negative",
        message: "Error while pulling summary.",
        timeout: 2000,
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
          color: store.state.theme === "dark" ? "#B7B7B7" : "#72777B",
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
        color: store.state.theme === "dark" ? "#D9D9D9" : "#262626",
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
        color: store.state.theme === "dark" ? "#DCDCDC" : "#232323",
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
          color: store.state.theme === "dark" ? "#ffffff" : "#000000",
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
              color: "#15ba73",
            },
          },
          {
            value: failedAlerts,
            name: "Failed Alerts",
            itemStyle: {
              color: "#db373a",
            },
          },
        ],
      },
    ],
  };
});

const pipelinesPanelData = computed(() => {
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
          color: store.state.theme === "dark" ? "#B7B7B7" : "#72777B",
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
        color: store.state.theme === "dark" ? "#B7B7B7" : "#72777B",
      },
      axisLabel: {
        fontSize: 14,
        color: store.state.theme === "dark" ? "#CCCFD1" : "#2E3133",
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
        color: store.state.theme === "dark" ? "#B7B7B7" : "#72777B",
      },
      axisLabel: {
        fontSize: 12,
        color: store.state.theme === "dark" ? "#B7B7B7" : "#72777B",
      },
      splitLine: {
        lineStyle: {
          color: store.state.theme === "dark" ? "#444" : "#e0e0e0",
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
          color: store.state.theme === "dark" ? "#CCCFD1" : "#2E3133",
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

const compressedSizeIcon = computed(() => {
  const icon =
    store.state.theme === "dark"
      ? "images/home/compressed_size_dark.svg"
      : "images/home/compressed_size.svg";
  return getImageURL(icon);
});

const ingestedSizeIcon = computed(() => {
  const icon =
    store.state.theme === "dark"
      ? "images/home/ingested_size_dark.svg"
      : "images/home/ingested_size.svg";
  return getImageURL(icon);
});

const indexSizeIcon = computed(() => {
  const icon =
    store.state.theme === "dark"
      ? "images/home/index_size_dark.svg"
      : "images/home/index_size.svg";
  return getImageURL(icon);
});

const recordsIcon = computed(() => {
  const icon =
    store.state.theme === "dark"
      ? "images/home/records_dark.svg"
      : "images/home/records.svg";
  return getImageURL(icon);
});

const streamsIcon = computed(() => {
  const icon =
    store.state.theme === "dark"
      ? "images/home/streams_dark.svg"
      : "images/home/streams.svg";
  return getImageURL(icon);
});

const functionsIcon = computed(() => {
  const icon =
    store.state.theme === "dark"
      ? "images/home/function_tile_icon_dark.svg"
      : "images/home/function_tile_icon.svg";
  return getImageURL(icon);
});

const dashboardsIcon = computed(() => {
  const icon =
    store.state.theme === "dark"
      ? "images/home/dashboards_tile_icon.svg"
      : "images/home/dashboards_tile_icon.svg";
  return getImageURL(icon);
});

const alertsIcon = computed(() => {
  return getImageURL("images/home/alerts.svg");
});

const pipelinesIcon = computed(() => {
  return getImageURL("images/home/pipeline.svg");
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

// Initial load
onMounted(() => {
  if (
    Object.keys(store.state.selectedOrganization).length > 0 &&
    orgId.value != undefined
  ) {
    getSummary(orgId.value);
  }
});

// Re-fetch when org changes
watch(orgId, (newVal, oldVal) => {
  if (newVal && (newVal != oldVal || !summary.value || Object.keys(summary.value).length === 0)) {
    summary.value = {};
    getSummary(newVal);
  }
});
</script>

<style scoped lang="scss">
/*
 * UsageTab Styles
 *
 * Structure:
 * 1. CSS Variables & Theme Mixins - Centralized theming system
 * 2. Global Transitions - Smooth theme switching
 * 3. Layout Components - Containers, grids, tiles
 * 4. Interactive States - Hover, focus, animations
 * 5. Responsive Design - Media queries and accessibility
 */

/* ===== 1. CSS Variables & Theme Mixins ===== */
:root {
  --accent-blue: #397ef6;
  --accent-orange: #ee5f26;
  --accent-purple: #9333ea;

  --tile-bg: #ffffff;
  --tile-border: #e7eaee;
  --text-primary: #2e3133;
  --text-secondary: #72777b;
  --hover-shadow: rgba(0, 0, 0, 0.3);
}

@mixin dark-theme-vars {
  --tile-bg: #2b2c2d;
  --tile-border: #444444;
  --text-primary: #cccfd1;
  --text-secondary: #b7b7b7;
  --hover-shadow: rgba(0, 0, 0, 0.6);
}

@mixin light-theme-vars {
  --tile-bg: #ffffff;
  --tile-border: #e7eaee;
  --text-primary: #2e3133;
  --text-secondary: #72777b;
  --hover-shadow: rgba(0, 0, 0, 0.3);
}

@mixin tile-base {
  height: 100%;
  padding: 0.75rem;
  border-radius: 0.5rem;
  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease;
  contain: layout style paint;
  gap: 0.25rem;
}

@mixin container-base {
  border-radius: 0.5rem;
  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease;
  animation: fadeInUp 0.5s ease-out backwards;
}

.dark-stream-container,
.dark-tile-content,
.chart-container-dark {
  @include dark-theme-vars;
}

.light-stream-container,
.light-tile-content,
.chart-container-light {
  @include light-theme-vars;
}

/* ===== 2. Global Transitions ===== */
* {
  transition:
    background-color 0.3s ease,
    color 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}

*[class*="animation"],
*[style*="animation"] {
  transition: none;
}

/* ===== 3. Layout Components ===== */

.banners-wrapper {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &:has(> div) {
    margin-bottom: 0.75rem;
  }
}

.streams-header {
  margin-bottom: 0.75rem;
}
.dark-stream-container,
.light-stream-container {
  background: var(--tile-bg);
  border: 0.0625rem solid var(--o2-border-color);
}
.view-button-light {
  cursor: pointer;
  padding: 0;
}
.view-button-dark {
  cursor: pointer;
  padding: 0;
  margin: 0;
}
.view-button-light,
.view-button-dark {
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;

  .router-link-active,
  a {
    z-index: 10;
    pointer-events: all;
  }
}

.view-arrow-icon {
  font-size: 1.125rem;
  transition:
    transform 0.4s ease-in-out,
    opacity 0.4s ease-in-out;
  pointer-events: none;
  position: relative;
  z-index: 1;
}

.view-button-light:hover .view-arrow-icon,
.view-button-dark:hover .view-arrow-icon {
  transform: translateX(1.25rem);
  opacity: 0;
}

.view-button-light::after,
.view-button-dark::after {
  content: "arrow_forward";
  font-family: "Material Icons";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) translateX(-1.25rem);
  opacity: 0;
  transition:
    transform 0.4s ease-in-out,
    opacity 0.4s ease-in-out;
  font-size: 1.125rem;
  pointer-events: none;
  z-index: 1;
  line-height: 1;
  font-feature-settings: "liga";
}

.view-button-light:hover::after,
.view-button-dark:hover::after {
  transform: translate(-50%, -50%) translateX(0);
  opacity: 1;
}

.tiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 0.75rem;
}

.tile {
  border-radius: 0.325rem;
  border: 0.0625rem solid var(--o2-border-color);
}

.tile:nth-child(1) {
  animation-delay: 0ms;
}
.tile:nth-child(2) {
  animation-delay: 50ms;
}
.tile:nth-child(3) {
  animation-delay: 100ms;
}
.tile:nth-child(4) {
  animation-delay: 150ms;
}
.tile:nth-child(5) {
  animation-delay: 200ms;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(1.25rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tile-content {
  @include tile-base;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.section-header {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.5rem;
}

.tile-title {
  font-size: 1rem;
  font-weight: 500;
  line-height: 1.25rem;
  letter-spacing: 0%;
}
.performance-text {
  border-radius: 3.125rem;
  width: 10rem;
  padding: 0 0.5rem;
  display: flex;
  align-items: center;
  background-color: #ebfdf5;
  color: #0e6842;
  font-size: 0.75rem !important;
}
.positive-increase-light {
  background-color: #ebfdf5;
  border: 0.0625rem solid #e4e7ec;
  color: #0e6842;
}
.negative-increase-light {
  background-color: #ffebe9;
  border: 0.0625rem solid #e4e7ec;
  color: #b42318;
}
.positive-increase-dark {
  background-color: #254421;
  color: #a1ffd6;
}
.negative-increase-dark {
  background-color: #4a2323;
  color: #ffd6d6;
}
.data-to-display {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.75rem;
}

.charts-main-container {
  display: grid;
  grid-template-columns: minmax(min-content, max-content) 1fr 2fr;
  gap: 1rem;
  margin-top: 1rem;
  align-items: stretch;
  flex: 1;
  min-height: 0;

  @media (max-width: 1400px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
  }

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
  }
}

.usage-tab--ai .charts-main-container {
  grid-template-columns: 1fr !important;
  grid-template-rows: auto auto auto !important;
}

.functions-dashboards-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;

  @media (max-width: 1400px) {
    flex-direction: row;
  }

  @media (max-width: 768px) {
    flex-direction: column;
  }
}

.usage-tab--ai .functions-dashboards-column {
  flex-direction: row !important;

  @media (max-width: 768px) {
    flex-direction: column !important;
  }
}

.tile-wrapper {
  flex: 1;
  display: flex;
  min-width: 0;
  width: 100%;

  .feature-card {
    width: 100%;
  }
}

@keyframes shimmer {
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
}

.text-title {
  font-size: 1.125rem;
  font-weight: 500;
  line-height: 1.25rem;
  letter-spacing: 0%;
}
.text-subtitle {
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.25rem;
  letter-spacing: 0%;
}
.results-count {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.5rem;
}
.details-container {
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.charts-main-container {
  gap: 0.75rem;
}

.tile-icon {
  opacity: 0.8;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;

  img {
    height: 1.5rem;
  }
}

.functions-tile-content .tile-icon img,
.dashboards-tile-content .tile-icon img {
  height: 1.25rem;
}

.dark-tile-content .tile-icon img,
.dark-stream-container .tile-icon img,
.chart-container-dark .tile-icon img {
  filter: brightness(1.5);
}

.tile-icon.icon-bg-blue {
  background: rgba(57, 126, 246, 0.2);
  border: 0.0625rem solid rgba(57, 126, 246, 0.35);
}

.tile-icon.icon-bg-orange {
  background: rgba(238, 95, 38, 0.2);
  border: 0.0625rem solid rgba(238, 95, 38, 0.35);
}

.tile-icon.icon-bg-yellow {
  background: rgba(245, 235, 147, 0.25);
  border: 0.0625rem solid rgba(245, 235, 147, 0.45);
}

.tile-icon.icon-bg-purple {
  background: rgba(242, 220, 245, 0.25);
  border: 0.0625rem solid rgba(242, 220, 245, 0.45);
}

/* ===== 4. Interactive States ===== */

.view-button-light:focus-visible,
.view-button-dark:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 2px;
  border-radius: 0.25rem;
}

a:focus-visible,
button:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 2px;
}

*:focus:not(:focus-visible) {
  outline: none;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.75rem;
  opacity: 0.6;
}

.empty-state-icon {
  font-size: 3rem;
  opacity: 0.5;
}

.empty-state-text {
  font-size: 1rem;
  font-weight: 500;
  color: inherit;
}

/* ===== 5. Responsive Design & Accessibility ===== */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  .tile-content:hover,
  .functions-tile-content:hover,
  .dashboards-tile-content:hover,
  .chart-container:hover,
  .streams-container:hover {
    transform: none;
  }
}

.card-container--col {
  display: flex;
  flex-direction: column;
}

.home-stat-row {
  gap: 1em;
}

.home-no-data-panel {
  margin: 0 auto;
  justify-content: center;
}
</style>
