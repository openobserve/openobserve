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
  <div class="usage-tab tw:h-full">
    <!-- Main content when data exists -->
    <div
      v-if="!no_data_ingest && !isLoadingSummary"
      class="usage-scroll tw:w-full tw:h-full tw:overflow-y-auto tw:[padding-right:0.625rem]"
    >
      <!-- Banners -->
      <div class="banners-wrapper tw:shrink-0 tw:flex tw:flex-col tw:gap-2">
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
        class="feature-card tw:rounded tw:p-4"
        :class="
          store.state.theme === 'dark'
            ? 'dark-stream-container'
            : 'light-stream-container'
        "
        role="region"
        aria-label="Streams overview section"
      >
        <div class="tw:flex tw:justify-between tw:items-center streams-header tw:mb-3">
          <div class="tw:flex tw:items-center tw:gap-2">
            <div class="tile-icon icon-bg-blue tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg" aria-hidden="true">
              <OIcon name="window" size="md" />
            </div>
            <div class="section-header tw:text-[1.25rem] tw:font-semibold tw:[line-height:1.5rem]">{{ t("home.streams") }}</div>
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
              class="tw:absolute tw:inset-0"
              aria-label="Navigate to streams page"
            ></router-link>
          </OButton>
        </div>

        <!-- Tiles -->
        <div class="tiles-grid tw:grid tw:[grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))] tw:gap-3">
          <div class="tile tw:[border-radius:0.325rem] tw:border tw:border-[var(--o2-border-color)]">
            <div
              class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Streams count statistics"
            >
              <div class="tw:flex tw:flex-col tw:justify-between">
                <div class="tw:flex tw:justify-between">
                  <div class="tile-title tw:text-base tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%]">{{ t("home.streams") }}</div>
                  <div class="tile-icon icon-bg-blue tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg" aria-hidden="true">
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
                  <OIcon name="arrow-upward" size="xs" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display tw:text-[1.5rem] tw:font-semibold tw:[line-height:1.75rem] tw:flex tw:items-end"
                aria-live="polite"
                data-test="home-usage-tab-streams-count"
              >
                {{ animatedStreamsCount || summary.streams_count }}
              </div>
            </div>
          </div>

          <div class="tile tw:[border-radius:0.325rem] tw:border tw:border-[var(--o2-border-color)]">
            <div
              class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Events count statistics"
            >
              <div class="tw:flex tw:flex-col tw:justify-between">
                <div class="tw:flex tw:justify-between">
                  <div class="tile-title tw:text-base tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%]">{{ t("home.docsCountLbl") }}</div>
                  <div class="tile-icon icon-bg-blue tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg" aria-hidden="true">
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
                  <OIcon name="arrow-upward" size="xs" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display tw:text-[1.5rem] tw:font-semibold tw:[line-height:1.75rem] tw:flex tw:items-end"
                aria-live="polite"
                data-test="home-usage-tab-events-count"
              >
                {{ formattedAnimatedEventsCount }}
              </div>
            </div>
          </div>

          <div class="tile tw:[border-radius:0.325rem] tw:border tw:border-[var(--o2-border-color)]">
            <div
              class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Ingested data size statistics"
            >
              <div class="tw:flex tw:flex-col tw:justify-between">
                <div class="tw:flex tw:justify-between">
                  <div class="tile-title tw:text-base tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%]">
                    {{ t("home.totalDataIngested") }}
                  </div>
                  <div class="tile-icon icon-bg-blue tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg" aria-hidden="true">
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
                  <OIcon name="arrow-downward" size="xs" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display tw:text-[1.5rem] tw:font-semibold tw:[line-height:1.75rem] tw:flex tw:items-end"
                aria-live="polite"
                data-test="home-usage-tab-ingested-size"
              >
                {{ formattedAnimatedIngestedSize }}
              </div>
            </div>
          </div>

          <div class="tile" v-if="config.isCloud == 'false'">
            <div
              class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Compressed data size statistics"
            >
              <div class="tw:flex tw:flex-col tw:justify-between">
                <div class="tw:flex tw:justify-between">
                  <div class="tile-title tw:text-base tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%]">
                    {{ t("home.totalDataCompressed") }}
                  </div>
                  <div class="tile-icon icon-bg-blue tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg" aria-hidden="true">
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
                  <OIcon name="arrow-upward" size="xs" /> 2.89% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display tw:text-[1.5rem] tw:font-semibold tw:[line-height:1.75rem] tw:flex tw:items-end"
                aria-live="polite"
                data-test="home-usage-tab-compressed-size"
              >
                {{ formattedAnimatedCompressedSize }}
              </div>
            </div>
          </div>

          <div class="tile" v-if="config.isCloud == 'false'">
            <div
              class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Index size statistics"
            >
              <div class="tw:flex tw:flex-col tw:justify-between">
                <div class="tw:flex tw:justify-between">
                  <div class="tile-title tw:text-base tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%]">{{ t("home.indexSizeLbl") }}</div>
                  <div class="tile-icon icon-bg-blue tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg" aria-hidden="true">
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
                  <OIcon name="arrow-upward" size="xs" /> 0.00% from last
                  week
                </div>
              </div>
              <div
                class="data-to-display tw:text-[1.5rem] tw:font-semibold tw:[line-height:1.75rem] tw:flex tw:items-end"
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
      <div class="charts-main-container tw:grid tw:[grid-template-columns:minmax(min-content,max-content)_1fr_2fr] tw:gap-3 tw:mt-4 tw:items-stretch tw:flex-1 tw:min-h-0">
        <!-- Functions and Dashboards tiles -->
        <div class="functions-dashboards-column tw:flex tw:flex-col tw:gap-4 tw:w-full">
          <div class="tile-wrapper tw:flex-1 tw:flex tw:min-w-0 tw:w-full">
            <div
              class="feature-card tw:rounded tw:p-4 tw:bg-[var(--o2-card-bg)] tw:border tw:border-[var(--o2-border-color)] tw:text-center tw:flex tw:flex-col tw:justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Functions count statistics"
            >
              <div class="tw:flex tw:flex-col tw:justify-between">
                <div
                  class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap tw:w-full"
                >
                  <div
                    class="tile-icon icon-bg-orange tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg tw:flex-shrink-0"
                    aria-hidden="true"
                  >
                    <img :src="functionsIcon" alt="" />
                  </div>
                  <div
                    class="tile-title tw:text-base tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%] tw:flex-1 tw:text-left tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis"
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
                      class="tw:absolute tw:inset-0"
                      aria-label="Navigate to functions page"
                    ></router-link>
                  </OButton>
                </div>
              </div>
              <div
                class="data-to-display tw:text-[1.5rem] tw:font-semibold tw:[line-height:1.75rem] tw:flex tw:items-end"
                aria-live="polite"
                data-test="home-usage-tab-functions-count"
              >
                {{ animatedFunctionCount || summary.function_count }}
              </div>
            </div>
          </div>

          <div class="tile-wrapper tw:flex-1 tw:flex tw:min-w-0 tw:w-full">
            <div
              class="feature-card tw:rounded tw:p-4 tw:bg-[var(--o2-card-bg)] tw:border tw:border-[var(--o2-border-color)] tw:text-center tw:flex tw:flex-col tw:justify-between"
              :class="
                store.state.theme === 'dark'
                  ? 'dark-tile-content'
                  : 'light-tile-content'
              "
              role="article"
              aria-label="Dashboards count statistics"
            >
              <div class="tw:flex tw:flex-col tw:justify-between">
                <div
                  class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap tw:w-full"
                >
                  <div
                    class="tile-icon icon-bg-orange tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg tw:flex-shrink-0"
                    aria-hidden="true"
                  >
                    <img :src="dashboardsIcon" alt="" />
                  </div>
                  <div
                    class="tile-title tw:text-base tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%] tw:flex-1 tw:text-left tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis"
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
                      class="tw:absolute tw:inset-0"
                      aria-label="Navigate to dashboards page"
                    ></router-link>
                  </OButton>
                </div>
              </div>
              <div
                class="data-to-display tw:text-[1.5rem] tw:font-semibold tw:[line-height:1.75rem] tw:flex tw:items-end"
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
          class="feature-card first-chart-container tw:rounded tw:p-4 tw:bg-[var(--o2-card-bg)] tw:border tw:border-[var(--o2-border-color)]"
          :class="
            store.state.theme === 'dark'
              ? 'chart-container-dark'
              : 'chart-container-light'
          "
          role="region"
          aria-label="Alerts overview section"
        >
          <div class="details-container tw:gap-2 tw:mb-3">
            <div class="tw:flex tw:justify-between tw:items-center">
              <span class="text-title tw:text-[1.125rem] tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%] tw:flex tw:items-center tw:gap-2">
                <div class="tile-icon icon-bg-blue tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg" aria-hidden="true">
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
                  class="tw:absolute tw:inset-0"
                  aria-label="Navigate to alerts page"
                ></router-link>
              </OButton>
            </div>
            <div class="tw:flex tw:pt-2 home-stat-row tw:gap-[1em]">
              <div class="tw:flex tw:flex-col">
                <span class="text-subtitle tw:text-sm tw:font-normal tw:[line-height:1.25rem] tw:[letter-spacing:0%]">{{
                  t("home.scheduledAlert")
                }}</span>
                <span
                  class="results-count tw:text-[1.25rem] tw:font-semibold tw:[line-height:1.5rem]"
                  aria-live="polite"
                  data-test="home-usage-tab-scheduled-alerts-count"
                >{{
                  animatedScheduledAlerts || summary.scheduled_alerts
                }}</span>
              </div>
              <OSeparator :vertical="true" />
              <div class="tw:flex tw:flex-col">
                <span class="text-subtitle tw:text-sm tw:font-normal tw:[line-height:1.25rem] tw:[letter-spacing:0%]">{{ t("home.rtAlert") }}</span>
                <span
                  class="results-count tw:text-[1.25rem] tw:font-semibold tw:[line-height:1.5rem]"
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
          class="feature-card second-chart-container tw:rounded tw:p-4 tw:bg-[var(--o2-card-bg)] tw:border tw:border-[var(--o2-border-color)]"
          :class="
            store.state.theme === 'dark'
              ? 'chart-container-dark'
              : 'chart-container-light'
          "
          role="region"
          aria-label="Pipelines overview section"
        >
          <div class="details-container tw:gap-2 tw:mb-3">
            <div class="tw:flex tw:justify-between tw:items-center">
              <span class="text-title tw:text-[1.125rem] tw:font-medium tw:[line-height:1.25rem] tw:[letter-spacing:0%] tw:flex tw:items-center tw:gap-2">
                <div class="tile-icon icon-bg-blue tw:opacity-80 tw:flex tw:items-center tw:justify-center tw:w-[2.5rem] tw:h-[2.5rem] tw:rounded-lg" aria-hidden="true">
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
                  class="tw:absolute tw:inset-0"
                  aria-label="Navigate to pipelines page"
                ></router-link>
              </OButton>
            </div>
            <div class="tw:flex tw:pt-2 home-stat-row tw:gap-[1em]">
              <div class="tw:flex tw:flex-col">
                <span class="text-subtitle tw:text-sm tw:font-normal tw:[line-height:1.25rem] tw:[letter-spacing:0%]">
                  {{ t("home.schedulePipelineTitle") }}</span
                >
                <span
                  class="results-count tw:text-[1.25rem] tw:font-semibold tw:[line-height:1.5rem]"
                  aria-live="polite"
                  data-test="home-usage-tab-scheduled-pipelines-count"
                >{{
                  animatedScheduledPipelines || summary.scheduled_pipelines
                }}</span>
              </div>
              <OSeparator :vertical="true" />
              <div class="tw:flex tw:flex-col">
                <span class="text-subtitle tw:text-sm tw:font-normal tw:[line-height:1.25rem] tw:[letter-spacing:0%]">{{
                  t("home.rtPipelineTitle")
                }}</span>
                <span
                  class="results-count tw:text-[1.25rem] tw:font-semibold tw:[line-height:1.5rem]"
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
      class="tw:flex tw:flex-col tw:h-full"
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

const getCssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const summary = ref<any>([]);
const no_data_ingest = ref(false);
const alertsPanelDataKey = ref(0);
const pipelinesPanelDataKey = ref(0);
// Incremented on themeColorChanged to invalidate getCssVar snapshots in computed properties
const themeVersion = ref(0);
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

  const textMuted = getCssVar("--o2-text-muted");
  const textPrimary = getCssVar("--o2-text-primary");

  if (total === 0) {
    return {
      chartType: "custom_chart",
      title: {
        text: t("home.noDataAvailable"),
        left: "center",
        top: "center",
        textStyle: {
          fontSize: 13,
          fontWeight: "normal",
          color: textMuted,
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
        fontSize: 13,
        fontWeight: "normal",
        color: textPrimary,
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
        color: textPrimary,
        fontSize: 12,
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
          fontSize: 12,
          color: textPrimary,
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
            itemStyle: {},
          },
          {
            value: failedAlerts,
            name: "Failed Alerts",
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

  const textMuted = getCssVar("--o2-text-muted");
  const textPrimary = getCssVar("--o2-text-primary");
  const textSecondary = getCssVar("--o2-text-secondary");
  const borderColor = getCssVar("--o2-border-color");
  const colorSuccess = getCssVar("--o2-positive");
  const colorError = getCssVar("--o2-negative");
  const colorWarning = getCssVar("--o2-warning");

  if (total === 0) {
    return {
      chartType: "custom_chart",
      title: {
        text: t("home.noDataAvailable"),
        left: "center",
        top: "center",
        textStyle: {
          fontSize: 13,
          fontWeight: "normal",
          color: textMuted,
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
        fontSize: 13,
        fontWeight: "normal",
        color: textSecondary,
      },
      axisLabel: {
        fontSize: 12,
        color: textPrimary,
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
        fontSize: 13,
        fontWeight: "normal",
        color: textSecondary,
      },
      axisLabel: {
        fontSize: 12,
        color: textSecondary,
      },
      splitLine: {
        lineStyle: {
          color: borderColor,
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
          fontSize: 12,
          fontWeight: "bold",
          color: textPrimary,
        },
        itemStyle: {
          color: function (params: any) {
            const colors = [colorSuccess, colorError, colorWarning];
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
  window.addEventListener("themeColorChanged", onThemeColorChanged);
});

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

<style>
/*
 * UsageTab Styles
 *
 * Structure:
 * 1. CSS Variables & Theme
 * 2. Global Transitions
 * 3. Layout Components
 * 4. Interactive States
 * 5. Responsive Design
 */

/* ===== 1. CSS Variables & Theme ===== */
:root {
  --accent-blue: #397ef6;
  --accent-orange: #ee5f26;
  --accent-purple: #9333ea;
}

/* dark-theme-vars inlined */
.dark-stream-container,
.dark-tile-content,
.chart-container-dark {
  /* No card fill in dark mode — the border alone defines each card (the solid
     grey fill reads as odd against the near-black theme). */
  --tile-bg: transparent;
  --tile-border: #444444;
  --text-primary: #cccfd1;
  --text-secondary: #b7b7b7;
  --hover-shadow: rgba(0, 0, 0, 0.6);
}

/* light-theme-vars inlined */
.light-stream-container,
.light-tile-content,
.chart-container-light {
  --tile-bg: #ffffff;
  --tile-border: #e7eaee;
  --text-primary: #2e3133;
  --text-secondary: #72777b;
  --hover-shadow: rgba(0, 0, 0, 0.3);
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

.banners-wrapper:has(> div) {
  margin-bottom: 0.75rem;
}

.dark-stream-container,
.light-stream-container {
  background: var(--o2-card-bg);
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
}
.view-button-light .router-link-active,
.view-button-light a,
.view-button-dark .router-link-active,
.view-button-dark a {
  z-index: 10;
  pointer-events: all;
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

/* tile-base mixin inlined */
.tile-content {
  height: 100%;
  padding: 0.75rem;
  border-radius: 0.5rem;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  contain: layout style paint;
  gap: 0.25rem;
}

.section-header {
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 1.4;
}

.tile-title {
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0%;
}

.performance-text {
  border-radius: 3.125rem;
  width: 10rem;
  padding: 0 0.5rem;
  display: flex;
  align-items: center;
  background-color: var(--o2-status-success-bg);
  color: var(--o2-status-success-text);
  font-size: 0.75rem !important;
}
.positive-increase-light,
.positive-increase-dark {
  background-color: var(--o2-status-success-bg);
  border: 0.0625rem solid var(--o2-border-color);
  color: var(--o2-status-success-text);
}
.negative-increase-light,
.negative-increase-dark {
  background-color: var(--o2-status-error-bg);
  border: 0.0625rem solid var(--o2-border-color);
  color: var(--o2-status-error-text);
}
.data-to-display {
  font-size: var(--text-xl);
  font-weight: 600;
  line-height: 1.3;
}

@media (max-width: 1400px) {
  .charts-main-container {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
  }
}

@media (max-width: 768px) {
  .charts-main-container {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
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

.tile-wrapper .feature-card {
  width: 100%;
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
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0%;
}
.text-subtitle {
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.4;
  letter-spacing: 0%;
}
.results-count {
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.4;
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
}

.tile-icon img {
  height: 1.5rem;
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
  background: rgba(147, 51, 234, 0.25);
  border: 0.0625rem solid rgba(147, 51, 234, 0.45);
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

  .tile-content:hover,
  .functions-tile-content:hover,
  .dashboards-tile-content:hover,
  .chart-container:hover,
  .streams-container:hover {
    transform: none;
  }
}
</style>
