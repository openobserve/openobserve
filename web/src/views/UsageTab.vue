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
      class="w-full h-full flex flex-col overflow-y-auto [padding-right:0.625rem]"
    >
      <!-- Banners -->
      <div class="banners-wrapper shrink-0 flex flex-col gap-2">
        <div>
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
        class="rounded p-4 bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)]"
        role="region"
        aria-label="Streams overview section"
      >
        <div class="flex justify-between items-center mb-3">
          <div class="flex items-center gap-2">
            <div class="bg-[rgba(57,126,246,0.2)] border border-[rgba(57,126,246,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg" aria-hidden="true">
              <OIcon name="window" size="md" />
            </div>
            <div class="text-(length:--text-lg) font-semibold [line-height:1.4]">{{ t("home.streams") }}</div>
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
            <OIcon name="arrow-forward" size="sm" class="view-arrow-icon" />
            <OIcon name="arrow-forward" size="sm" class="view-arrow-icon-in" />
            <router-link
              exact
              :to="{
                name: 'logstreams',
                query: {
                  org_identifier:
                    store.state.selectedOrganization?.identifier,
                },
              }"
              class="absolute inset-0"
              aria-label="Navigate to streams page"
            ></router-link>
          </OButton>
        </div>

        <!-- Tiles -->
        <div class="grid [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))] gap-3">
          <div class="[border-radius:0.325rem] border border-[var(--o2-border-color)]">
            <div
              class="rounded-lg text-center flex flex-col justify-between h-full p-3 gap-1 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] [contain:layout_style_paint]"
              role="article"
              aria-label="Streams count statistics"
            >
              <div class="flex flex-col justify-between">
                <div class="flex justify-between">
                  <div class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%]">{{ t("home.streams") }}</div>
                  <div class="bg-[rgba(57,126,246,0.2)] border border-[rgba(57,126,246,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg" aria-hidden="true">
                    <img :src="streamsIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="rounded-[3.125rem] w-40 px-2 flex items-center text-xs! bg-[var(--o2-status-success-bg)] border border-[var(--o2-border-color)] text-[var(--o2-status-success-text)]"
                >
                  <OIcon name="arrow-upward" size="xs" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="text-(length:--text-xl) font-semibold [line-height:1.3] flex items-end"
                aria-live="polite"
                data-test="home-usage-tab-streams-count"
              >
                {{ animatedStreamsCount || summary.streams_count }}
              </div>
            </div>
          </div>

          <div class="[border-radius:0.325rem] border border-[var(--o2-border-color)]">
            <div
              class="rounded-lg text-center flex flex-col justify-between h-full p-3 gap-1 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] [contain:layout_style_paint]"
              role="article"
              aria-label="Events count statistics"
            >
              <div class="flex flex-col justify-between">
                <div class="flex justify-between">
                  <div class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%]">{{ t("home.docsCountLbl") }}</div>
                  <div class="bg-[rgba(57,126,246,0.2)] border border-[rgba(57,126,246,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg" aria-hidden="true">
                    <img :src="recordsIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="rounded-[3.125rem] w-40 px-2 flex items-center text-xs! bg-[var(--o2-status-success-bg)] border border-[var(--o2-border-color)] text-[var(--o2-status-success-text)]"
                >
                  <OIcon name="arrow-upward" size="xs" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="text-(length:--text-xl) font-semibold [line-height:1.3] flex items-end"
                aria-live="polite"
                data-test="home-usage-tab-events-count"
              >
                {{ formattedAnimatedEventsCount }}
              </div>
            </div>
          </div>

          <div class="[border-radius:0.325rem] border border-[var(--o2-border-color)]">
            <div
              class="rounded-lg text-center flex flex-col justify-between h-full p-3 gap-1 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] [contain:layout_style_paint]"
              role="article"
              aria-label="Ingested data size statistics"
            >
              <div class="flex flex-col justify-between">
                <div class="flex justify-between">
                  <div class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%]">
                    {{ t("home.totalDataIngested") }}
                  </div>
                  <div class="bg-[rgba(57,126,246,0.2)] border border-[rgba(57,126,246,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg" aria-hidden="true">
                    <img :src="ingestedSizeIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="rounded-[3.125rem] w-40 px-2 flex items-center text-xs! bg-[var(--o2-status-error-bg)] border border-[var(--o2-border-color)] text-[var(--o2-status-error-text)]"
                >
                  <OIcon name="arrow-downward" size="xs" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="text-(length:--text-xl) font-semibold [line-height:1.3] flex items-end"
                aria-live="polite"
                data-test="home-usage-tab-ingested-size"
              >
                {{ formattedAnimatedIngestedSize }}
              </div>
            </div>
          </div>

          <div class="[border-radius:0.325rem] border border-[var(--o2-border-color)]" v-if="config.isCloud == 'false'">
            <div
              class="rounded-lg text-center flex flex-col justify-between h-full p-3 gap-1 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] [contain:layout_style_paint]"
              role="article"
              aria-label="Compressed data size statistics"
            >
              <div class="flex flex-col justify-between">
                <div class="flex justify-between">
                  <div class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%]">
                    {{ t("home.totalDataCompressed") }}
                  </div>
                  <div class="bg-[rgba(57,126,246,0.2)] border border-[rgba(57,126,246,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg" aria-hidden="true">
                    <img :src="compressedSizeIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="rounded-[3.125rem] w-40 px-2 flex items-center text-xs! bg-[var(--o2-status-success-bg)] border border-[var(--o2-border-color)] text-[var(--o2-status-success-text)]"
                >
                  <OIcon name="arrow-upward" size="xs" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="text-(length:--text-xl) font-semibold [line-height:1.3] flex items-end"
                aria-live="polite"
                data-test="home-usage-tab-compressed-size"
              >
                {{ formattedAnimatedCompressedSize }}
              </div>
            </div>
          </div>

          <div class="[border-radius:0.325rem] border border-[var(--o2-border-color)]" v-if="config.isCloud == 'false'">
            <div
              class="rounded-lg text-center flex flex-col justify-between h-full p-3 gap-1 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] [contain:layout_style_paint]"
              role="article"
              aria-label="Index size statistics"
            >
              <div class="flex flex-col justify-between">
                <div class="flex justify-between">
                  <div class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%]">{{ t("home.indexSizeLbl") }}</div>
                  <div class="bg-[rgba(57,126,246,0.2)] border border-[rgba(57,126,246,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg" aria-hidden="true">
                    <img :src="indexSizeIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
                  </div>
                </div>
                <div
                  v-if="false"
                  class="rounded-[3.125rem] w-40 px-2 flex items-center text-xs! bg-[var(--o2-status-success-bg)] border border-[var(--o2-border-color)] text-[var(--o2-status-success-text)]"
                >
                  <OIcon name="arrow-upward" size="xs" /> 0.00% from last
                  week
                </div>
              </div>
              <div
                class="text-(length:--text-xl) font-semibold [line-height:1.3] flex items-end"
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
      <div class="grid [grid-template-columns:minmax(min-content,max-content)_1fr_2fr] gap-3 mt-4 items-stretch flex-1 min-h-0">
        <!-- Functions and Dashboards tiles -->
        <div class="flex flex-col gap-4 w-full">
          <div class="flex-1 flex min-w-0 w-full">
            <div
              class="rounded p-4 w-full bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] text-center flex flex-col justify-between"
              role="article"
              aria-label="Functions count statistics"
            >
              <div class="flex flex-col justify-between">
                <div
                  class="flex items-center gap-2 flex-nowrap w-full"
                >
                  <div
                    class="bg-[rgba(238,95,38,0.2)] border border-[rgba(238,95,38,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg flex-shrink-0"
                    aria-hidden="true"
                  >
                    <img :src="functionsIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
                  </div>
                  <div
                    class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%] flex-1 text-left whitespace-nowrap overflow-hidden text-ellipsis"
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
                    class="flex-shrink-0"
                    :title="t('home.viewButton')"
                    data-test="home-usage-tab-view-functions-btn"
                  >
                    <OIcon name="arrow-forward" size="sm" class="view-arrow-icon" />
                    <OIcon name="arrow-forward" size="sm" class="view-arrow-icon-in" />
                    <router-link
                      exact
                      :to="{
                        name: 'functionList',
                        query: {
                          org_identifier:
                            store.state.selectedOrganization?.identifier,
                        },
                      }"
                      class="absolute inset-0"
                      aria-label="Navigate to functions page"
                    ></router-link>
                  </OButton>
                </div>
              </div>
              <div
                class="text-(length:--text-xl) font-semibold [line-height:1.3] flex items-end"
                aria-live="polite"
                data-test="home-usage-tab-functions-count"
              >
                {{ animatedFunctionCount || summary.function_count }}
              </div>
            </div>
          </div>

          <div class="flex-1 flex min-w-0 w-full">
            <div
              class="rounded p-4 w-full bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] text-center flex flex-col justify-between"
              role="article"
              aria-label="Dashboards count statistics"
            >
              <div class="flex flex-col justify-between">
                <div
                  class="flex items-center gap-2 flex-nowrap w-full"
                >
                  <div
                    class="bg-[rgba(238,95,38,0.2)] border border-[rgba(238,95,38,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg flex-shrink-0"
                    aria-hidden="true"
                  >
                    <img :src="dashboardsIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
                  </div>
                  <div
                    class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%] flex-1 text-left whitespace-nowrap overflow-hidden text-ellipsis"
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
                    class="flex-shrink-0"
                    :title="t('home.viewButton')"
                    data-test="home-usage-tab-view-dashboards-btn"
                  >
                    <OIcon name="arrow-forward" size="sm" class="view-arrow-icon" />
                    <OIcon name="arrow-forward" size="sm" class="view-arrow-icon-in" />
                    <router-link
                      exact
                      :to="{
                        name: 'dashboards',
                        query: {
                          org_identifier:
                            store.state.selectedOrganization?.identifier,
                        },
                      }"
                      class="absolute inset-0"
                      aria-label="Navigate to dashboards page"
                    ></router-link>
                  </OButton>
                </div>
              </div>
              <div
                class="text-(length:--text-xl) font-semibold [line-height:1.3] flex items-end"
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
          class="rounded p-4 bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] flex flex-col min-h-0"
          role="region"
          aria-label="Alerts overview section"
        >
          <div class="gap-2 mb-3">
            <div class="flex justify-between items-center">
              <span class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%] flex items-center gap-2">
                <div class="bg-[rgba(57,126,246,0.2)] border border-[rgba(57,126,246,0.35)] flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg" aria-hidden="true">
                  <img :src="alertsIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
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
                <OIcon name="arrow-forward" size="sm" class="view-arrow-icon" />
                <OIcon name="arrow-forward" size="sm" class="view-arrow-icon-in" />
                <router-link
                  exact
                  :to="{
                    name: 'alertList',
                    query: {
                      org_identifier:
                        store.state.selectedOrganization?.identifier,
                    },
                  }"
                  class="absolute inset-0"
                  aria-label="Navigate to alerts page"
                ></router-link>
              </OButton>
            </div>
            <div class="flex pt-2 gap-[1em]">
              <div class="flex flex-col">
                <span class="text-(length:--text-sm) font-normal [line-height:1.4] [letter-spacing:0%]">{{
                  t("home.scheduledAlert")
                }}</span>
                <span
                  class="text-(length:--text-md) font-semibold [line-height:1.4]"
                  aria-live="polite"
                  data-test="home-usage-tab-scheduled-alerts-count"
                >{{
                  animatedScheduledAlerts || summary.scheduled_alerts
                }}</span>
              </div>
              <OSeparator :vertical="true" />
              <div class="flex flex-col">
                <span class="text-(length:--text-sm) font-normal [line-height:1.4] [letter-spacing:0%]">{{ t("home.rtAlert") }}</span>
                <span
                  class="text-(length:--text-md) font-semibold [line-height:1.4]"
                  aria-live="polite"
                  data-test="home-usage-tab-rt-alerts-count"
                >{{
                  animatedRtAlerts || summary.rt_alerts
                }}</span>
              </div>
            </div>
          </div>
          <div
            class="custom-first-chart flex-1 min-h-[200px] w-full"
          >
            <CustomChartRenderer
              :key="alertsPanelDataKey"
              :data="alertsPanelData"
              class="w-full h-full"
            />
          </div>
        </div>

        <!-- Pipelines chart -->
        <div
          class="rounded p-4 bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] flex flex-col min-h-0"
          role="region"
          aria-label="Pipelines overview section"
        >
          <div class="gap-2 mb-3">
            <div class="flex justify-between items-center">
              <span class="text-(length:--text-base) font-medium [line-height:1.4] [letter-spacing:0%] flex items-center gap-2">
                <div class="bg-[rgba(57,126,246,0.2)] border border-[rgba(57,126,246,0.35)] opacity-80 flex items-center justify-center w-[2.5rem] h-[2.5rem] rounded-lg" aria-hidden="true">
                  <img :src="pipelinesIcon" alt="" class="h-6 dark:[filter:brightness(1.5)]" />
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
                <OIcon name="arrow-forward" size="sm" class="view-arrow-icon" />
                <OIcon name="arrow-forward" size="sm" class="view-arrow-icon-in" />
                <router-link
                  exact
                  :to="{
                    name: 'pipelines',
                    query: {
                      org_identifier:
                        store.state.selectedOrganization?.identifier,
                    },
                  }"
                  class="absolute inset-0"
                  aria-label="Navigate to pipelines page"
                ></router-link>
              </OButton>
            </div>
            <div class="flex pt-2 gap-[1em]">
              <div class="flex flex-col">
                <span class="text-(length:--text-sm) font-normal [line-height:1.4] [letter-spacing:0%]">
                  {{ t("home.schedulePipelineTitle") }}</span
                >
                <span
                  class="text-(length:--text-md) font-semibold [line-height:1.4]"
                  aria-live="polite"
                  data-test="home-usage-tab-scheduled-pipelines-count"
                >{{
                  animatedScheduledPipelines || summary.scheduled_pipelines
                }}</span>
              </div>
              <OSeparator :vertical="true" />
              <div class="flex flex-col">
                <span class="text-(length:--text-sm) font-normal [line-height:1.4] [letter-spacing:0%]">{{
                  t("home.rtPipelineTitle")
                }}</span>
                <span
                  class="text-(length:--text-md) font-semibold [line-height:1.4]"
                  aria-live="polite"
                  data-test="home-usage-tab-rt-pipelines-count"
                >{{
                  animatedRtPipelines || summary.rt_pipelines
                }}</span>
              </div>
            </div>
          </div>
          <div
            class="custom-second-chart flex-1 min-h-[200px] w-full"
          >
            <CustomChartRenderer
              :key="pipelinesPanelDataKey"
              :data="pipelinesPanelData"
              class="w-full h-full"
            />
          </div>
        </div>
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
    <div v-if="isLoadingSummary" data-test="home-usage-tab-loading">
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
import { formatSizeFromMB, getImageURL } from "@/utils/zincutils";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";
import UsageReportBanner from "@/enterprise/components/billings/UsageReportBanner.vue";
import DatabaseDeprecationBanner from "@/components/DatabaseDeprecationBanner.vue";
import HomeViewSkeleton from "@/components/shared/HomeViewSkeleton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
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

<style scoped lang="scss">

/*
 * UsageTab Styles
 *
 * Structure:
 * 1. CSS Variables
 * 2. Global Transitions
 * 3. Layout Components
 * 4. Interactive States
 * 5. Responsive Design
 */

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

.banners-wrapper:has(> div) {
  margin-bottom: 0.75rem;
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
  font-size: var(--text-md);
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

.view-arrow-icon-in {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) translateX(-1.25rem);
  opacity: 0;
  transition:
    transform 0.4s ease-in-out,
    opacity 0.4s ease-in-out;
  pointer-events: none;
  z-index: 1;
}

.view-button-light:hover .view-arrow-icon-in,
.view-button-dark:hover .view-arrow-icon-in {
  transform: translate(-50%, -50%) translateX(0);
  opacity: 1;
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

@media (max-width: 1400px) {
  .functions-dashboards-column {
    flex-direction: row;
  }
}

@media (max-width: 768px) {
  .functions-dashboards-column {
    flex-direction: column;
  }
}

/* ===== 4. Interactive States ===== */

.view-button-light:focus-visible,
.view-button-dark:focus-visible {
  outline: 2px solid var(--o2-focus-ring);
  outline-offset: 2px;
  border-radius: 0.25rem;
}

a:focus-visible,
button:focus-visible {
  outline: 2px solid var(--o2-focus-ring);
  outline-offset: 2px;
}

*:focus:not(:focus-visible) {
  outline: none;
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
}
</style>
