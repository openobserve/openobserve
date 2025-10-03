<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page class="q-px-md" style="overflow-y: auto;" :class="store.state.zoConfig.ai_enabled ? 'ai-enabled-home-view q-pb-sm' : ''">
    <div v-if="!no_data_ingest && !isLoadingSummary" class="column q-pt-md" style="height: auto; overflow-y: auto; ">
        <!-- 1st section -->
         <div>
          <TrialPeriod></TrialPeriod>
         </div>
        <div class="streams-container q-pa-md"
        :class="store.state.theme === 'dark' ? 'dark-stream-container' : 'light-stream-container'"
         >
          <div class="row justify-between items-center q-mb-md">
            <div class="section-header">Streams</div>
              <q-btn no-caps flat round :class="store.state.theme === 'dark' ? 'view-button-dark' : 'view-button-light'"
               >
                <q-tooltip>View</q-tooltip>
                <q-icon name="arrow_forward" class="view-arrow-icon" />
                <router-link
                  exact
                  :to="{ name: 'logstreams' }"
                  class="absolute full-width full-height"
                ></router-link>
            </q-btn>
          </div>


          <!-- Tiles -->
          <div class="row wrap justify-evenly q-gutter-md ">
            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column justify-between "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">   {{ t("home.streams") }}</div>
                  <div class="tile-icon icon-bg-blue">
                    <img :src="streamsIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div v-if="false" class="performance-text"
                :class="store.state.theme === 'dark' ? 'positive-increase-dark' : 'positive-increase-light'"
                >
                  <q-icon name="arrow_upward" size="14px"  /> 2.89% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ animatedStreamsCount || summary.streams_count }}
            </div>
            </div>
            </div>

            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column justify-between "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between" >
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">   {{ t("home.docsCountLbl") }}</div>
                  <div class="tile-icon icon-bg-blue">
                    <img :src="recordsIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div v-if="false" class="performance-text "
                :class="store.state.theme === 'dark' ? 'positive-increase-dark' : 'positive-increase-light'"
                >
                  <q-icon name="arrow_upward" size="14px" /> 2.89% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ formattedAnimatedEventsCount }}
            </div>
            </div>
            </div>
            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column justify-between "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title"> {{ t("home.totalDataCompressed") }}</div>
                  <div class="tile-icon icon-bg-blue">
                    <img :src="compressedSizeIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div v-if="false" class="performance-text "
                :class="store.state.theme === 'dark' ? 'positive-increase-dark' : 'positive-increase-light'"
                >
                  <q-icon name="arrow_upward" size="14px" /> 2.89% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ formattedAnimatedCompressedSize }}
            </div>
            </div>
            </div>

            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column justify-between "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between" >
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title"> {{ t("home.totalDataIngested") }}</div>
                  <div class="tile-icon icon-bg-blue">
                    <img :src="ingestedSizeIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div v-if="false" class="performance-text "
                :class="store.state.theme === 'dark' ? 'negative-increase-dark' : 'negative-increase-light'"
                >
                  <q-icon name="arrow_downward" size="14px" /> 2.89% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ formattedAnimatedIngestedSize }}
            </div>
            </div>
            </div>

            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column justify-between "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">  {{ t("home.indexSizeLbl") }}</div>
                  <div class="tile-icon icon-bg-blue">
                    <img :src="indexSizeIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div v-if="false" class="performance-text "
                :class="store.state.theme === 'dark' ? 'positive-increase-dark' : 'positive-increase-light'"
                >
                  <q-icon name="arrow_upward" size="14px" /> 0.00% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ formattedAnimatedIndexSize }}
            </div>
            </div>
            </div>

        </div>

        </div>
      <!-- 2nd section -->
        <div class="charts-main-container row tw-gap-4 q-mt-md xl:tw-min-h-[330px] " style="display: flex; gap: 16px; height: calc(100% - 22px);  ">
          <!-- functions and dashboards tiles + 2 charts -->
        <div class="xl:tw-flex-col lg:tw-flex md:tw-flex-row tw-justify-evenly sm:tw-justify-start tw-gap-4 md:tw-w-full xl:tw-w-fit " >

          <div class="tw-w-full lg:tw-w-[calc(50%-0.5rem)] xl:tw-w-[240px] tw-max-w-full">
            <div class="functions-tile-content q-pa-md rounded-borders text-center column justify-between"
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'">
              <div class="column justify-between">
                <div class="row justify-between tw-items-center">
                  <div class="row tw-items-center tw-gap-2">
                    <div class="tile-icon icon-bg-orange">
                      <img :src="functionsIcon" />
                    </div>
                    <div class="tile-title">{{ t("home.functionTitle") }}</div>
                  </div>
                  <q-btn no-caps flat round :class="store.state.theme === 'dark' ? 'view-button-dark' : 'view-button-light'"
                  >
                      <q-tooltip>View</q-tooltip>
                      <q-icon name="arrow_forward" class="view-arrow-icon" />
                    <router-link
                      exact
                      :to="{ name: 'functionList' }"
                      class="absolute full-width full-height"
                    ></router-link>
                </q-btn>
                </div>
              </div>
              <div class="data-to-display row items-end">
                {{ animatedFunctionCount || summary.function_count }}
              </div>
            </div>
          </div>

          <!-- Tile 2 -->
          <div class="tw-w-full lg:tw-w-[calc(50%-0.5rem)] xl:tw-w-[240px] tw-max-w-full">
            <div class="dashboards-tile-content q-pa-md rounded-borders text-center column justify-between"
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'">
              <div class="column justify-between">
                <div class="row justify-between tw-items-center">
                  <div class="row tw-items-center tw-gap-2">
                    <div class="tile-icon icon-bg-orange">
                      <img :src="dashboardsIcon" />
                    </div>
                    <div class="tile-title">{{ t("home.dashboardTitle") }}</div>
                  </div>
                  <q-btn no-caps flat round :class="store.state.theme === 'dark' ? 'view-button-dark' : 'view-button-light'"
                  >
                  <q-tooltip>View</q-tooltip>
                  <q-icon name="arrow_forward" class="view-arrow-icon" />
                    <router-link
                      exact
                      :to="{ name: 'dashboards' }"
                      class="absolute full-width full-height"
                    ></router-link>
                </q-btn>
                </div>
              </div>
              <div class="data-to-display row items-end">
                {{ animatedDashboardCount || summary.dashboard_count }}
              </div>
            </div>
          </div>
        </div>
                  <!-- Chart 1 --> 
          <div class="chart-container first-chart-container rounded-borders tw-w-full tw-max-w-full xl:tw-w-[31%] tw-p-4"
          :class="store.state.theme === 'dark' ? 'chart-container-dark' : 'chart-container-light'"
          >
            <div class="details-container">
              <div class="row justify-between items-center">
                <span class="text-title tw-flex tw-items-center tw-gap-2">
                  <div class="tile-icon icon-bg-blue">
                      <img :src="alertsIcon" />
                  </div>
                  {{ t("home.alertTitle") }}
                </span>
                <q-btn no-caps flat round :class="store.state.theme === 'dark' ? 'view-button-dark' : 'view-button-light'">
                  <q-tooltip>View</q-tooltip>
                  <q-icon name="arrow_forward" class="view-arrow-icon" />
                  <router-link
                    exact
                    :to="{ name: 'alertList' }"
                    class="absolute full-width full-height"
                  ></router-link>
              </q-btn>
              </div>
              <div class="row q-pt-sm" style="gap: 16px;">
                <div class="column">
                  <span class="text-subtitle">{{ t("home.scheduledAlert") }}</span>
                  <span class="results-count">{{ animatedScheduledAlerts || summary.scheduled_alerts }}</span>
                </div>
                <q-separator vertical />
                <div class="column">
                  <span class="text-subtitle">{{ t("home.rtAlert") }}</span>
                  <span class="results-count">{{ animatedRtAlerts || summary.rt_alerts }}</span>
                </div>
              </div>
            </div>
            <div class="custom-first-chart tw-my-auto xl:tw-min-h-[200px] tw-h-[calc(100vh-500px)]  md:tw-h-[calc(100vh-500px)] lg:tw-h-[calc(100vh-550px)] xl:tw-h-[calc(100vh-645px)] tw-w-full"  >
              <CustomChartRenderer
                :key="alertsPanelDataKey"
                :data="alertsPanelData"
                class="tw-w-full tw-h-full md:tw-h-[calc(100vh-400px)] "
              />
            </div>
          </div>
          <div class="chart-container second-chart-container rounded-borders tw-w-full tw-max-w-full xl:tw-w-[calc(100%-240px-31%-2rem)] tw-p-4"
          :class="store.state.theme === 'dark' ? 'chart-container-dark' : 'chart-container-light'"
          >
            <div class="details-container">
              <div class="row justify-between items-center">
                <span class="text-title tw-flex tw-items-center tw-gap-2">
                  <div class="tile-icon icon-bg-blue">
                      <img :src="pipelinesIcon" />
                  </div>
                  {{ t("home.pipelineTitle") }}
                </span>
                <q-btn no-caps flat round :class="store.state.theme === 'dark' ? 'view-button-dark' : 'view-button-light'">
                  <q-tooltip>View</q-tooltip>
                  <q-icon name="arrow_forward" class="view-arrow-icon" />
                  <router-link
                    exact
                    :to="{ name: 'pipelines' }"
                    class="absolute full-width full-height"
                  ></router-link>
              </q-btn>
              </div>
              <div class="row q-pt-sm" style="gap: 16px;">
                <div class="column">
                  <span class="text-subtitle"> {{ t("home.schedulePipelineTitle") }}</span>
                  <span class="results-count">{{ animatedScheduledPipelines || summary.scheduled_pipelines }}</span>
                </div>
                <q-separator vertical />
                <div class="column">
                  <span class="text-subtitle">{{ t("home.rtPipelineTitle") }}</span>
                  <span class="results-count">{{ animatedRtPipelines || summary.rt_pipelines }}</span>
                </div>
              </div>
            </div>
            <div class="custom-second-chart tw-my-auto xl:tw-min-h-[200px] tw-h-[calc(100vh-500px)]  md:tw-h-[calc(100vh-500px)] lg:tw-h-[calc(100vh-550px)] xl:tw-h-[calc(100vh-645px)]"  >
              <CustomChartRenderer
                :key="pipelinesPanelDataKey"
                :data="pipelinesPanelData"
                class="tw-w-full tw-h-full "
              />
            </div>
          </div>
        </div>
      </div>
      <div
      v-if="no_data_ingest && !isLoadingSummary"
      class="q-pa-md row items-start q-gutter-md"
      style="margin: 0 auto; justify-content: center"
    >
    <TrialPeriod></TrialPeriod>
      <div class="my-card card-container">
        <div align="center" flat
bordered class="my-card q-py-md">
          <div class="text-h6">{{ t("home.noData") }}</div>
          <div class="text-subtitle1">{{ t("home.ingestionMsg") }}</div>
        </div>

        <q-separator />

        <div align="center" class="q-py-sm">
          <q-btn
            no-caps
            color="primary"
            @click="() => $router.push({ name: 'ingestion' })"
            flat
            >{{ t("home.findIngestion") }}
          </q-btn>
        </div>
      </div>
    </div>
    <div v-if="isLoadingSummary" class="column q-pt-md" style="height: auto; overflow-y: auto;">
      <HomeViewSkeleton />
    </div>
  </q-page>


</template>

<script lang="ts">
import { useQuasar } from "quasar";
import { computed, defineComponent, ref, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import orgService from "../services/organizations";
import config from "../aws-exports";
import { formatSizeFromMB, addCommasToNumber, getImageURL } from "@/utils/zincutils";
import useStreams from "@/composables/useStreams";
import pipelines from "@/services/pipelines";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import HomeViewSkeleton from "@/components/shared/HomeViewSkeleton.vue";
import store from "@/test/unit/helpers/store";

export default defineComponent({
  name: "PageHome",

  setup() {
    const store = useStore();
    const { t } = useI18n();
    const summary: any = ref([]);
    const $q = useQuasar();
    const no_data_ingest = ref(false);
    const isCloud = config.isCloud;
    const { setStreams } = useStreams();
    const alertsPanelDataKey = ref(0);
    const pipelinesPanelDataKey = ref(0);
    const isLoadingSummary = ref(false);

    // Animated counters for numbers
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

    // Count-up animation function
    const animateValue = (ref: any, start: number, end: number, duration: number) => {
      if (start === end) {
        ref.value = end;
        return;
      }
      const range = end - start;
      const increment = range / (duration / 16); // 60fps
      let current = start;

      const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
          current = end;
          clearInterval(timer);
        }
        ref.value = Math.floor(current);
      }, 16);
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
          const rawCompressedSize = res.data.streams?.total_compressed_size ?? 0;
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
          $q.notify({
            type: "negative-increase",
            message: "Error while pulling summary.",
            timeout: 2000,
          });
        })
        .finally(() => {
          isLoadingSummary.value = false;
        });
    };

    if (
      Object.keys(store.state.selectedOrganization).length > 0 &&
      store.state.selectedOrganization?.identifier != undefined
    ) {
      getSummary(store.state.selectedOrganization.identifier);
    }

  const alertsPanelData = computed (() => ({
    chartType: "custom_chart",
    title: {
      text: "Last 15 minutes",
      left: "70%",
      top: "35%",
      textStyle: {
        fontSize: 16,
        fontWeight: "normal",
        color: store.state.theme === 'dark' ? '#D9D9D9' : '#262626'
      }
    },
    tooltip: {
      trigger: "item"
    },
    legend: {
      top: "50%",
      orient: "vertical",
      left: "70%",
      textStyle: {
        color: store.state.theme === 'dark' ? '#DCDCDC' : '#232323'
      }
    },
    series: [
      {
        name: "Alert Status",
        type: "pie",
        radius: ["35%", "55%"],
        center: ["50%", "50%"],
        right: "40%",
        startAngle: 0,
        endAngle: 360,
        label: {
          formatter: "{d}%",
          show: true,
          fontSize: 16,
          color: store.state.theme === 'dark' ? '#ffffff' : '#000000'
        },
        labelLine: {
          show: true,
          length: 10,
          length2: 10,
          lineStyle: {
            width: 2
          }
        },
        data: [
          {
            value: summary.value.healthy_alerts,
            name: "Success Alerts",
            itemStyle: {
              color: "#15ba73"
            }
          },
          {
            value: summary.value.failed_alerts,
            name: "Failed Alerts",
            itemStyle: {
              color: "#db373a"
            }
          }
        ]
      }
    ]
  }));

  const pipelinesPanelData = computed(() => {

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
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B'
          },
          axisLabel: {
            fontSize: 14,
            color: store.state.theme === 'dark' ? '#CCCFD1' : '#2E3133'
          }
        },
        yAxis: {
          type: "value",
          min: 0,
          max:Math.ceil((summary.value.healthy_pipelines + summary.value.failed_pipelines + summary.value.warning_pipelines) / 3 / 10) * 10 ,
          interval: 10,
          name: "Number of Pipelines",
          nameLocation: "middle",
          nameGap: 60,
          nameRotate: 90,
          nameTextStyle: {
            fontSize: 16,
            fontWeight: "normal",
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B'
          },
          axisLabel: {
            fontSize: 12,
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B'
          },
          splitLine: {
            lineStyle: {
              color: store.state.theme === 'dark' ? '#444' : '#e0e0e0'
            }
          },
          offset: -20

        },

        series: [
          {
            data: [summary.value.healthy_pipelines, summary.value.failed_pipelines, summary.value.warning_pipelines],
            type: "bar",
            barWidth: "50%",
            label: {
              show: true,
              position: "top",
              fontSize: 14,
              fontWeight: "bold",
              color: store.state.theme === 'dark' ? '#CCCFD1' : '#2E3133'
            },
            itemStyle: {
              color: function (params: any) {
                const colors = ['#16b26a', '#db373b', '#ffc328'];
                return colors[params.dataIndex];
              }
            }
          }
          ]
      };
  });

  const compressedSizeIcon = computed(() => {
    const icon = store.state.theme === 'dark' ? 'images/home/compressed_size_dark.svg' : 'images/home/compressed_size.svg';
    return getImageURL(icon);
  });

  const ingestedSizeIcon = computed(() => {
    const icon = store.state.theme === 'dark' ? 'images/home/ingested_size_dark.svg' : 'images/home/ingested_size.svg';
    return getImageURL(icon);
  });

  const indexSizeIcon = computed(() => {
    const icon = store.state.theme === 'dark' ? 'images/home/index_size_dark.svg' : 'images/home/index_size.svg';
    return getImageURL(icon);
  });

  const recordsIcon = computed(() => {
    const icon = store.state.theme === 'dark' ? 'images/home/records_dark.svg' : 'images/home/records.svg';
    return getImageURL(icon);
  });

  const streamsIcon = computed(() => {
    const icon = store.state.theme === 'dark' ? 'images/home/streams_dark.svg' : 'images/home/streams.svg';
    return getImageURL(icon);
  });

  const functionsIcon = computed(() => {
    const icon = store.state.theme === 'dark' ? 'images/home/function_tile_icon_dark.svg' : 'images/home/function_tile_icon.svg';
    return getImageURL(icon);
  });

  const dashboardsIcon = computed(() => {
    const icon = store.state.theme === 'dark' ? 'images/home/dashboards_tile_icon.svg' : 'images/home/dashboards_tile_icon.svg';
    return getImageURL(icon);
  });


  const alertsIcon = computed(() => {
    return getImageURL('images/home/alerts.svg');
  });

  const pipelinesIcon = computed(() => {
    return getImageURL('images/home/pipeline.svg');
  });

  const getForwardIcon = computed(() => {
    const icon = store.state.theme === 'dark' ? 'images/home/forward_dark.svg' : 'images/home/forward_light.svg';
    return getImageURL(icon);
  });

  const formatEventCount = (num: number): string => {
  if (num < 100000) return num.toString();

  const units = ["", "K", "M", "B", "T"];
  let tier = Math.floor(Math.log10(num) / 3);

  // clamp to max unit (T)
  if (tier >= units.length) tier = units.length - 1;

  const scaled = num / Math.pow(10, tier * 3);
  return scaled.toFixed(1).replace(/\.0$/, "") + units[tier];
};

  // Computed property for formatted animated events count
  const formattedAnimatedEventsCount = computed(() => {
    return animatedEventsCount.value > 0
      ? formatEventCount(animatedEventsCount.value)
      : summary.value.doc_count;
  });

  // Computed properties for formatted animated sizes
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




    return {
      t,
      store,
      summary,
      no_data_ingest,
      getSummary,
      isCloud,
      getImageURL,
      alertsPanelData,
      pipelinesPanelData,
      alertsPanelDataKey,
      pipelinesPanelDataKey,
      compressedSizeIcon,
      ingestedSizeIcon,
      indexSizeIcon,
      recordsIcon,
      streamsIcon,
      functionsIcon,
      dashboardsIcon,
      isLoadingSummary,
      pipelinesIcon,
      alertsIcon,
      getForwardIcon,
      formatEventCount,
      animatedStreamsCount,
      animatedEventsCount,
      formattedAnimatedEventsCount,
      animatedCompressedSize,
      animatedIngestedSize,
      animatedIndexSize,
      formattedAnimatedCompressedSize,
      formattedAnimatedIngestedSize,
      formattedAnimatedIndexSize,
      animatedFunctionCount,
      animatedDashboardCount,
      animatedScheduledAlerts,
      animatedRtAlerts,
      animatedScheduledPipelines,
      animatedRtPipelines
    };
  },
  computed: {
    selectedOrg() {
      return this.store.state.selectedOrganization?.identifier;
    },
  },
  watch: {
    selectedOrg(newVal: any, oldVal: any) {
      if (newVal != oldVal || this.summary.value == undefined) {
        this.summary = {};
        this.getSummary(this.store.state?.selectedOrganization?.identifier);
      }
    },
  },
  components: {
    CustomChartRenderer,
    TrialPeriod,
    HomeViewSkeleton,
  },
});
</script>

<style scoped lang="scss">
.streams-container {
  border-radius: 8px;
  box-sizing: border-box;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  border-left: 3px solid #397EF6;
  animation: fadeInUp 0.5s ease-out backwards;
}
.dark-stream-container {
  background: #2B2C2D;
  border: 1px solid #444444;
}
.light-stream-container {
  background: #ffffff;
  border: 1px solid #E7EAEE;
}
.view-button-light {
  cursor: pointer;
  padding: 0px
}
.view-button-dark {
  cursor: pointer;
  padding: 0px;
  margin: 0px;
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
  font-size: 18px;
  transition: transform 0.4s ease-in-out, opacity 0.4s ease-in-out;
  pointer-events: none;
  position: relative;
  z-index: 1;
}

// Slide out current arrow on hover
.view-button-light:hover .view-arrow-icon,
.view-button-dark:hover .view-arrow-icon {
  transform: translateX(20px);
  opacity: 0;
}

// Create second arrow that slides in using Material Icons font
.view-button-light::after,
.view-button-dark::after {
  content: 'arrow_forward';
  font-family: 'Material Icons';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) translateX(-20px);
  opacity: 0;
  transition: transform 0.4s ease-in-out, opacity 0.4s ease-in-out;
  font-size: 18px;
  pointer-events: none;
  z-index: 1;
  line-height: 1;
  font-feature-settings: 'liga';
}

.view-button-light:hover::after,
.view-button-dark:hover::after {
  transform: translate(-50%, -50%) translateX(0);
  opacity: 1;
}
.tile {
  flex: 1 1 240px; /* grow, shrink, basis */
  max-width: 100%; /* prevents overflow */
  animation: fadeInUp 0.5s ease-out backwards;
}

// Stagger animation for tiles
.tile:nth-child(1) { animation-delay: 0ms; }
.tile:nth-child(2) { animation-delay: 50ms; }
.tile:nth-child(3) { animation-delay: 100ms; }
.tile:nth-child(4) { animation-delay: 150ms; }
.tile:nth-child(5) { animation-delay: 200ms; }

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tile-content {
  height: 160px !important;
  padding: 16px;
  border-radius: 8px;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.dashboards-tile-content,
.functions-tile-content {
  height: 160px !important;
  padding: 16px;
  border-radius: 8px;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  animation: fadeInUp 0.5s ease-out backwards;
}

.functions-tile-content {
  animation-delay: 250ms;
}

.dashboards-tile-content {
  animation-delay: 300ms;
}
.dark-tile-content {
  background: #2B2C2D;
  border: 1px solid #444444;
  color: #D2D2D2;
}

.light-tile-content {
  background: #ffffff;
  border: 1px solid #E7EAEE;
  color: #2D2D2D;
}
.section-header {
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
}

.tile-title {
  font-size: 16px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0%;
}
.performance-text{
  border-radius: 50px;
  width: 160px;
  padding: 0px 8px;
  display: flex;
  align-items: center;
  background-color: #EBFDF5;
  color: #0e6842;
  font-size: 12px !important;
}
.positive-increase-light{
  background-color: #EBFDF5;
  border: 1px solid #E4E7EC;
  color: #0e6842;
}
.negative-increase-light{
  background-color: #FFEBE9;
  border: 1px solid #E4E7EC;
  color: #B42318;
}
.positive-increase-dark{
  background-color: #254421;
  color: #A1FFd6;
}
.negative-increase-dark{
  background-color: #4A2323;
  color: #FFD6D6;
}
.data-to-display{
  font-size: 28px;
  font-weight: 600;
  line-height: 32px;
}
.chart-container {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  animation: fadeInUp 0.5s ease-out backwards;
}

.first-chart-container {
  border-left: 3px solid #EE5F26;
  animation-delay: 350ms;
}

.second-chart-container {
  border-left: 3px solid #9333EA;
  animation-delay: 400ms;
}

.chart-container-light{
  border: 1px solid #E7EAEE;
  background: #ffffff;
}
.chart-container-dark{
  border: 1px solid #444444;
  background: #2B2C2D;
}
.text-title{
  font-size: 18px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0%;
}
.text-subtitle{
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: 0%;
}
.results-count{
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
}
.details-container{
  gap: 12px;
  margin-bottom: 16px;
}
.charts-main-container{
  gap: 12px;
}
// .first-chart-container{
//   width: 35%;
// }
// .second-chart-container{
//   width: calc(65% - 16px);
// }

.ai-enabled-home-view{
  height: calc(100vh - 120px);
}

.tile-icon {
  opacity: 0.8;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;

  img {
    height: 24px;
  }
}

.functions-tile-content .tile-icon img,
.dashboards-tile-content .tile-icon img {
  height: 20px;
}

// Dark mode icon visibility enhancement
.dark-tile-content .tile-icon img,
.dark-stream-container .tile-icon img,
.chart-container-dark .tile-icon img {
  filter: brightness(1.5);
}

.tile-icon.icon-bg-blue {
  background: rgba(57, 126, 246, 0.2);
  border: 1px solid rgba(57, 126, 246, 0.35);
}

.tile-icon.icon-bg-orange {
  background: rgba(238, 95, 38, 0.2);
  border: 1px solid rgba(238, 95, 38, 0.35);
}

.tile-icon.icon-bg-yellow {
  background: rgba(245, 235, 147, 0.25);
  border: 1px solid rgba(245, 235, 147, 0.45);
}

.tile-icon.icon-bg-purple {
  background: rgba(242, 220, 245, 0.25);
  border: 1px solid rgba(242, 220, 245, 0.45);
}

/* Tile hover effects */
.tile-content:hover,
.functions-tile-content:hover,
.dashboards-tile-content:hover,
.chart-container:hover,
.streams-container:hover {
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}

.dark-tile-content:hover,
.functions-tile-content.dark-tile-content:hover,
.dashboards-tile-content.dark-tile-content:hover,
.chart-container-dark:hover,
.dark-stream-container:hover {
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6);
  transform: translateY(-2px);
}

/* Focus visible states for keyboard navigation */
.view-button-light:focus-visible,
.view-button-dark:focus-visible {
  outline: 2px solid #397EF6;
  outline-offset: 2px;
  border-radius: 4px;
}

a:focus-visible,
button:focus-visible {
  outline: 2px solid #397EF6;
  outline-offset: 2px;
}

// Remove default focus outline (only show on keyboard navigation)
*:focus:not(:focus-visible) {
  outline: none;
}

/* Reduced motion support for accessibility */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  // Keep hover lift but remove animation
  .tile-content:hover,
  .functions-tile-content:hover,
  .dashboards-tile-content:hover,
  .chart-container:hover,
  .streams-container:hover {
    transform: none;
  }
}
</style>
