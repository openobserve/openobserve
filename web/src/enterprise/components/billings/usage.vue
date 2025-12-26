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
    <div class="q-pa-md " style="height: calc(100vh - 130px); width: 100%;" >
      <div class="row items-baseline justify-between">
        <div class="row q-table__title tw:font-[600] q-pb-md">
          {{ t("billing.totalUsage") }}
        </div>
      </div>
      <div>
        <div v-if="Object.keys(usageData).length === 0" >
          <div class="text-h6 text-weight-medium text-center">
            {{ t("billing.messageDataNotFound") }}
          </div>
        </div>
      </div>
      <!-- usage section new -->
      <div>
      <!-- tab-info-section -->
      <!-- this will be unlocked when we get the actionscripts , rum sessions , error tracking from BE -->
        <div v-if="false" class="row wrap justify-evenly q-gutter-md ">
            <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="usage-tile-title"> Action Scripts</div>
                  <div style="opacity: 0.8;">
                    <img :src="actionScriptIcon" />
                  </div>
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="usage-data-to-display row items-end ">
              2
            </div>
            </div>
            </div>
            <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="usage-tile-title">Error Tracking</div>
                  <div style="opacity: 0.8;">
                    <img :src="errorTrackingIcon" />
                  </div>
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="usage-data-to-display row items-end ">
              300
            </div>
            </div>
            </div>
            <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="usage-tile-title">RUM Session</div>
                  <div style="opacity: 0.8;">
                    <img :src="rumSessionIcon" />
                  </div>
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="usage-data-to-display row items-end ">
              20
            </div>
            </div>
            </div>

        </div>
        <!-- new section introduced to show the usage for ingestion , search , functions -->
        <div v-if="!dataLoading && Object.keys(usageData).length > 0" class="row wrap justify-evenly q-gutter-md ">
            <div class="tw:grid tw:grid-cols-3 tw:gap-4 tw:w-full">
                <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="usage-tile-title"> Ingestion</div>
                  <div style="opacity: 0.8;">
                    <img :src="ingestionIcon" />
                  </div>
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="usage-data-to-display row items-end ">
               {{ usageData.ingestion }} {{ usageDataType.toUpperCase() }}
            </div>
            </div>
                </div>
                <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
                <!-- Top Section (60%) -->
                <div class="column justify-between">
                    <!-- Title row -->
                    <div class="row justify-between">
                    <div class="usage-tile-title">Search</div>
                    <div style="opacity: 0.8;">
                        <img :src="searchIcon" />
                    </div>
                    </div>
                </div>

                <!-- Bottom Section (40%) -->
                <div class="usage-data-to-display row items-end ">
                {{ usageData.search }} {{ usageDataType.toUpperCase() }}
                </div>
                </div>
                </div>
                <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
                <!-- Top Section (60%) -->
                <div class="column justify-between">
                    <!-- Title row -->
                    <div class="row justify-between">
                    <div class="usage-tile-title">Functions</div>
                    <div style="opacity: 0.8;">
                        <img :src="functionsIcon" />
                    </div>
                    </div>
                </div>

                <!-- Bottom Section (40%) -->
                <div class="usage-data-to-display row items-end ">
                {{ usageData.functions }} {{ usageDataType.toUpperCase() }}
                </div>
                </div>
                </div>
            </div>
            <div class="tw:grid tw:grid-cols-3 tw:gap-4 tw:w-full">
                <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
                <!-- Top Section (60%) -->
                <div class="column justify-between">
                    <!-- Title row -->
                    <div class="row justify-between">
                    <div class="usage-tile-title">Pipelines</div>
                    <div style="opacity: 0.8;" class="tw:bg-[#E6EFFE] tw:flex tw:items-center tw:justify-center tw:rounded-[9px] tw:h-[33px] tw:w-[33px]">
                        <img :src="pipelineIcon" class="tw:h-[18px] tw:w-[18px] tw:mx-[7px] tw:my-[7px]" />
                    </div>
                    </div>
                </div>

                <!-- Bottom Section (40%) -->
                <div class="usage-data-to-display row items-end ">
                {{ usageData.pipeline }} {{ usageDataType.toUpperCase() }}
                </div>
                </div>
                </div>
                <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
                <!-- Top Section (60%) -->
                <div class="column justify-between">
                    <!-- Title row -->
                    <div class="row justify-between">
                    <div class="usage-tile-title">Remote Pipelines</div>
                    <div style="opacity: 0.8;" class="tw:bg-[#F2DCF5] tw:flex tw:items-center tw:justify-center tw:rounded-[9px] tw:h-[33px] tw:w-[33px]">
                        <img :src="remotePipelineIcon" class="tw:h-[18px] tw:w-[18px] tw:mx-[7px] tw:my-[7px]" />
                    </div>
                    </div>
                </div>

                <!-- Bottom Section (40%) -->
                <div class="usage-data-to-display row items-end ">
                {{ usageData.remotepipeline }} {{ usageDataType.toUpperCase() }}
                </div>
                </div>
                </div>
                <div class="feature-card">
              <div class="tile-content text-center column justify-between ">
                <!-- Top Section (60%) -->
                <div class="column justify-between">
                    <!-- Title row -->
                    <div class="row justify-between">
                    <div class="usage-tile-title">Data Retention</div>
                    <div style="opacity: 0.8;" class="tw:bg-[#FFF4E6] tw:flex tw:items-center tw:justify-center tw:rounded-[9px] tw:h-[33px] tw:w-[33px]">
                        <img :src="dataRetentionIcon" class="tw:h-[18px] tw:w-[18px] tw:mx-[7px] tw:my-[7px]" />
                    </div>
                    </div>
                </div>

                <!-- Bottom Section (40%) -->
                <div class="usage-data-to-display row items-end ">
                {{ usageData.dataretention }} {{ usageDataType.toUpperCase() }}
                </div>
                </div>
                </div>
            </div>
        </div>
        <!-- charts section -->
        <div>

        </div>
      </div>
      <div v-if="dataLoading" class="text-h6 text-weight-medium text-center">Loading...</div>
    </div>
  </template>
  <script lang="ts">
  import { defineComponent, ref, onMounted, defineAsyncComponent, watch, computed, onUnmounted, onActivated   , onBeforeMount, nextTick } from "vue";
  import { useStore } from "vuex";
  import { useQuasar, date } from "quasar";
  import { useI18n } from "vue-i18n";
  import BillingService from "@/services/billings";
  import { convertBillingData } from "@/utils/billing/convertBillingData";
import router from "@/router";
import { useRouter } from "vue-router";
import { getImageURL } from "@/utils/zincutils";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
  
  let currentDate = new Date(); // Get the current date and time
  
  // Subtract 30 days from the current date
  let thirtyDaysAgo = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  export default defineComponent({
    name: "Usage",
    components: {
      ChartRenderer: defineAsyncComponent(
        () => import("@/components/dashboards/panels/ChartRenderer.vue")
      ),
      CustomChartRenderer: defineAsyncComponent(
        () => import("@/components/dashboards/panels/CustomChartRenderer.vue")
      ),
    },
    setup() {
      const { t } = useI18n();
      const $q = useQuasar();
      const store = useStore();
      const router = useRouter();
      const dataLoading = ref(false);
      const lastUsageUpdated = ref(0);
      const pipelinesPanelDataKey = ref(0);
      const elapsedText = ref('Just now');
      const usageData = ref<any>({
        ingestion: "0.00",
        search: "0.00",
        functions: "0.00",
        pipeline: "0.00",
        remotepipeline: "0.00",
        dataretention: "0.00"
      });
      let chartData: any = ref({});
      onMounted(async () => {
        selectUsageDate();
      });
      const usageDate: any = computed(() => {
        return router.currentRoute.value.query.usage_date ?? "30days";
      })
      const usageDataType: any = computed(() => { return router.currentRoute.value.query.data_type ?? "gb" })
      watch(usageDate, (val) => {
        getUsage();
      })
      watch(usageDataType, (val) => {
        getUsage();
      })
      const getUsage = () => {
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait while loading usage data...",
        });
        dataLoading.value = true;
        BillingService.get_data_usage(
          store.state.selectedOrganization.identifier,
          usageDate.value,  
          usageDataType.value
        )
          .then((res) => {
            dataLoading.value = false;
            res.data.data.forEach((item: any) => {  
              const numericValue = parseFloat(item.value);
              usageData.value[item.event.toLowerCase()] =  numericValue.toFixed(2);
            });

            dismiss();
          })
          .catch((e) => {
            $q.notify({
              type: "negative",
              message: e.message,
              timeout: 5000,
            });
            dataLoading.value = false;
          })


      };
      const selectUsageDate = () => {
        chartData.value = {};
        getUsage();
      };
      const actionScriptIcon = getImageURL("images/usage/action_script.svg");
      const errorTrackingIcon = getImageURL("images/usage/error_tracking.svg");
      const rumSessionIcon = getImageURL("images/usage/rum_session.svg");
      const ingestionIcon = getImageURL("images/usage/ingestion.svg");
      const searchIcon = getImageURL("images/usage/search.svg");
      const functionsIcon = getImageURL("images/usage/function.svg");
      const pipelineIcon = getImageURL("images/usage/pipeline.svg");
      const remotePipelineIcon = getImageURL("images/usage/remote_pipeline.svg");
      const dataRetentionIcon = getImageURL("images/usage/data_retention.svg");
      //this is the example data that needs to be used to get the chart in usage page 
      //we just need to have the data in the format of the dataModel
      //eg: date and value and in the array format
      const dataModel = ref(
                {
                "chartType": "bar",
                "options": {
                    "backgroundColor": "transparent",
                    "legend": {
                        "show": false,
                        "type": "scroll",
                        "orient": "horizontal",
                        "padding": [
                            10,
                            20,
                            10,
                            10
                        ],
                        "tooltip": {
                            "show": true,
                            "padding": 10,
                            "textStyle": {
                                "fontSize": 12
                            }
                        },
                        "textStyle": {
                            "width": 100,
                            "overflow": "truncate",
                            "rich": {
                                "a": {
                                    "fontWeight": "bold"
                                },
                                "b": {
                                    "fontStyle": "normal"
                                }
                            }
                        },
                        "left": "0",
                        "top": "bottom"
                    },
                    "grid": {
                        "containLabel": true,
                        "left": 30,
                        "right": 20,
                        "top": "15",
                        "bottom": 35
                    },
                    "tooltip": {
                        "trigger": "axis",
                        "textStyle": {
                            "color": "#000",
                            "fontSize": 12
                        },
                        "enterable": true,
                        "backgroundColor": "rgba(255,255,255,1)",
                        "extraCssText": "max-height: 200px; overflow: auto; max-width: 400px",
                        "axisPointer": {
                            "type": "cross",
                            "label": {
                                "fontsize": 12,
                                "precision": 2
                            }
                        }
                    },
                    "xAxis": [
                        {
                            "type": "time",
                            "position": "bottom",
                            "inverse": false,
                            "name": "Timestamp",
                            "label": {
                                "show": false,
                                "position": "None",
                                "rotate": 0
                            },
                            "nameLocation": "middle",
                            "nameGap": 25,
                            "nameTextStyle": {
                                "fontWeight": "bold",
                                "fontSize": 14
                            },
                            "axisLabel": {
                                "interval": "auto",
                                "overflow": "none",
                                "hideOverlap": true,
                                "width": 120,
                                "margin": 10
                            },
                            "splitLine": {
                                "show": true
                            },
                            "axisLine": {
                                "show": false
                            },
                            "axisTick": {
                                "show": false,
                                "align": "left",
                                "alignWithLabel": false,
                                "length": 5
                            },
                            "data": []
                        }
                    ],
                    "yAxis": {
                        "type": "value",
                        "name": "K8s Container Name",
                        "nameLocation": "middle",
                        "nameGap": 61,
                        "nameTextStyle": {
                            "fontWeight": "bold",
                            "fontSize": 14
                        },
                        "axisLabel": {},
                        "splitLine": {
                            "show": true
                        },
                        "axisLine": {
                            "show": false
                        }
                    },
                    "toolbox": {
                        "orient": "vertical",
                        "show": true,
                        "showTitle": false,
                        "tooltip": {
                            "show": false
                        },
                        "itemSize": 0,
                        "itemGap": 0,
                        "bottom": "100%",
                        "feature": {
                            "dataZoom": {
                                "yAxisIndex": "none"
                            }
                        }
                    },
                    "series": [
                        {
                            "name": "K8s Container Name",
                            "type": "bar",
                            "emphasis": {
                                "focus": "series"
                            },
                            "lineStyle": {
                                "width": 1.5
                            },
                            "label": {
                                "show": false,
                                "position": "None",
                                "rotate": 0
                            },
                            "originalSeriesName": "",
                            "markLine": {
                                "silent": true,
                                "animation": false,
                                "data": []
                            },
                            "connectNulls": false,
                            "large": true,
                            "color": "#64b5f6",
                            "data": [
                                [
                                    "2025-05-29T11:38:00.000Z",
                                    525
                                ],
                                [
                                    "2025-05-29T11:38:10.000Z",
                                    26185
                                ],
                                [
                                    "2025-05-29T11:38:20.000Z",
                                    19537
                                ],
                                [
                                    "2025-05-29T11:38:30.000Z",
                                    24852
                                ],
                                [
                                    "2025-05-29T11:38:40.000Z",
                                    12448
                                ],
                                [
                                    "2025-05-29T11:38:50.000Z",
                                    15757
                                ],
                                [
                                    "2025-05-29T11:39:00.000Z",
                                    16502
                                ],
                                [
                                    "2025-05-29T11:39:10.000Z",
                                    21424
                                ],
                                [
                                    "2025-05-29T11:39:20.000Z",
                                    13249
                                ],
                                [
                                    "2025-05-29T11:39:30.000Z",
                                    22533
                                ],
                                [
                                    "2025-05-29T11:39:40.000Z",
                                    17767
                                ],
                                [
                                    "2025-05-29T11:39:50.000Z",
                                    11406
                                ],
                                [
                                    "2025-05-29T11:40:00.000Z",
                                    19588
                                ],
                                [
                                    "2025-05-29T11:40:10.000Z",
                                    13109
                                ],
                                [
                                    "2025-05-29T11:40:20.000Z",
                                    14540
                                ],
                                [
                                    "2025-05-29T11:40:30.000Z",
                                    14074
                                ],
                                [
                                    "2025-05-29T11:40:40.000Z",
                                    12856
                                ],
                                [
                                    "2025-05-29T11:40:50.000Z",
                                    8782
                                ],
                                [
                                    "2025-05-29T11:41:00.000Z",
                                    14729
                                ],
                                [
                                    "2025-05-29T11:41:10.000Z",
                                    14617
                                ],
                                [
                                    "2025-05-29T11:41:20.000Z",
                                    21772
                                ],
                                [
                                    "2025-05-29T11:41:30.000Z",
                                    15147
                                ],
                                [
                                    "2025-05-29T11:41:40.000Z",
                                    17362
                                ],
                                [
                                    "2025-05-29T11:41:50.000Z",
                                    15018
                                ],
                                [
                                    "2025-05-29T11:42:00.000Z",
                                    17007
                                ],
                                [
                                    "2025-05-29T11:42:10.000Z",
                                    16545
                                ],
                                [
                                    "2025-05-29T11:42:20.000Z",
                                    17489
                                ],
                                [
                                    "2025-05-29T11:42:30.000Z",
                                    19863
                                ],
                                [
                                    "2025-05-29T11:42:40.000Z",
                                    18351
                                ],
                                [
                                    "2025-05-29T11:42:50.000Z",
                                    10001
                                ],
                                [
                                    "2025-05-29T11:43:00.000Z",
                                    21750
                                ],
                                [
                                    "2025-05-29T11:43:10.000Z",
                                    23619
                                ],
                                [
                                    "2025-05-29T11:43:20.000Z",
                                    14901
                                ],
                                [
                                    "2025-05-29T11:43:30.000Z",
                                    19604
                                ],
                                [
                                    "2025-05-29T11:43:40.000Z",
                                    14491
                                ],
                                [
                                    "2025-05-29T11:43:50.000Z",
                                    18249
                                ],
                                [
                                    "2025-05-29T11:44:00.000Z",
                                    14324
                                ],
                                [
                                    "2025-05-29T11:44:10.000Z",
                                    11322
                                ],
                                [
                                    "2025-05-29T11:44:20.000Z",
                                    10481
                                ],
                                [
                                    "2025-05-29T11:44:30.000Z",
                                    18098
                                ],
                                [
                                    "2025-05-29T11:44:40.000Z",
                                    14593
                                ],
                                [
                                    "2025-05-29T11:44:50.000Z",
                                    24532
                                ],
                                [
                                    "2025-05-29T11:45:00.000Z",
                                    11336
                                ],
                                [
                                    "2025-05-29T11:45:10.000Z",
                                    17646
                                ],
                                [
                                    "2025-05-29T11:45:20.000Z",
                                    16908
                                ],
                                [
                                    "2025-05-29T11:45:30.000Z",
                                    13049
                                ],
                                [
                                    "2025-05-29T11:45:40.000Z",
                                    19015
                                ],
                                [
                                    "2025-05-29T11:45:50.000Z",
                                    15213
                                ],
                                [
                                    "2025-05-29T11:46:00.000Z",
                                    17953
                                ],
                                [
                                    "2025-05-29T11:46:10.000Z",
                                    19638
                                ],
                                [
                                    "2025-05-29T11:46:20.000Z",
                                    10446
                                ],
                                [
                                    "2025-05-29T11:46:30.000Z",
                                    17906
                                ],
                                [
                                    "2025-05-29T11:46:40.000Z",
                                    15080
                                ],
                                [
                                    "2025-05-29T11:46:50.000Z",
                                    23020
                                ],
                                [
                                    "2025-05-29T11:47:00.000Z",
                                    22451
                                ],
                                [
                                    "2025-05-29T11:47:10.000Z",
                                    21097
                                ],
                                [
                                    "2025-05-29T11:47:20.000Z",
                                    16644
                                ],
                                [
                                    "2025-05-29T11:47:30.000Z",
                                    18096
                                ],
                                [
                                    "2025-05-29T11:47:40.000Z",
                                    14492
                                ],
                                [
                                    "2025-05-29T11:47:50.000Z",
                                    13806
                                ],
                                [
                                    "2025-05-29T11:48:00.000Z",
                                    13533
                                ],
                                [
                                    "2025-05-29T11:48:10.000Z",
                                    12718
                                ],
                                [
                                    "2025-05-29T11:48:20.000Z",
                                    15700
                                ],
                                [
                                    "2025-05-29T11:48:30.000Z",
                                    11800
                                ],
                                [
                                    "2025-05-29T11:48:40.000Z",
                                    13252
                                ],
                                [
                                    "2025-05-29T11:48:50.000Z",
                                    14647
                                ],
                                [
                                    "2025-05-29T11:49:00.000Z",
                                    10797
                                ],
                                [
                                    "2025-05-29T11:49:10.000Z",
                                    18977
                                ],
                                [
                                    "2025-05-29T11:49:20.000Z",
                                    14971
                                ],
                                [
                                    "2025-05-29T11:49:30.000Z",
                                    19181
                                ],
                                [
                                    "2025-05-29T11:49:40.000Z",
                                    14652
                                ],
                                [
                                    "2025-05-29T11:49:50.000Z",
                                    15085
                                ],
                                [
                                    "2025-05-29T11:50:00.000Z",
                                    11316
                                ],
                                [
                                    "2025-05-29T11:50:10.000Z",
                                    19070
                                ],
                                [
                                    "2025-05-29T11:50:20.000Z",
                                    11385
                                ],
                                [
                                    "2025-05-29T11:50:30.000Z",
                                    18561
                                ],
                                [
                                    "2025-05-29T11:50:40.000Z",
                                    13120
                                ],
                                [
                                    "2025-05-29T11:50:50.000Z",
                                    17771
                                ],
                                [
                                    "2025-05-29T11:51:00.000Z",
                                    17426
                                ],
                                [
                                    "2025-05-29T11:51:10.000Z",
                                    19740
                                ],
                                [
                                    "2025-05-29T11:51:20.000Z",
                                    26322
                                ],
                                [
                                    "2025-05-29T11:51:30.000Z",
                                    15417
                                ],
                                [
                                    "2025-05-29T11:51:40.000Z",
                                    18328
                                ],
                                [
                                    "2025-05-29T11:51:50.000Z",
                                    14118
                                ],
                                [
                                    "2025-05-29T11:52:00.000Z",
                                    20130
                                ],
                                [
                                    "2025-05-29T11:52:10.000Z",
                                    14243
                                ],
                                [
                                    "2025-05-29T11:52:20.000Z",
                                    15377
                                ],
                                [
                                    "2025-05-29T11:52:30.000Z",
                                    19846
                                ],
                                [
                                    "2025-05-29T11:52:40.000Z",
                                    17345
                                ],
                                [
                                    "2025-05-29T11:52:50.000Z",
                                    12196
                                ],
                                [
                                    "2025-05-29T11:53:00.000Z",
                                    6227
                                ]
                            ],
                            "zlevel": 2
                        },
                        {
                            "type": "line",
                            "data": [
                                [
                                    "Invalid Date",
                                    null
                                ]
                            ],
                            "markLine": {
                                "itemStyle": {
                                    "color": "rgba(0, 191, 255, 0.5)"
                                },
                                "silent": false,
                                "animation": false,
                                "data": []
                            },
                            "markArea": {
                                "itemStyle": {
                                    "color": "rgba(0, 191, 255, 0.15)"
                                },
                                "data": []
                            },
                            "zlevel": 1
                        }
                    ]
                },
                "extras": {
                    "panelId": "Panel_ID5876310",
                    "isTimeSeries": true
                }
              }
            )


      return {
        t,
        store,
        chartData,
        dataLoading,
        options: ["30days", "60days", "3months", "6months"],
        selectUsageDate,
        usageDate,
        usageDataType,
        lastUsageUpdated,
        elapsedText,
        actionScriptIcon,
        errorTrackingIcon,
        rumSessionIcon,
        pipelinesPanelDataKey,
        dataModel,
        ingestionIcon,
        searchIcon,
        functionsIcon,
        usageData,
        getUsage,
        router,
        pipelineIcon,
        remotePipelineIcon,
        dataRetentionIcon,
      };
    },
  });
  </script>
  <style lang="scss" scoped>
  .date-selector {
    width: 200px;
  }
  .tile-content {
  border-radius: 0.325rem;
}
.dark-usage-tile-content {
  background: #2B2C2D;
  border: 1px solid #444444;
  color: #D2D2D2;
}

.light-usage-tile-content {
  background: #ffffff;
  border: 1px solid #E7EAEE;
  color: #2D2D2D;
}
.usage-tile-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 20px;
  letter-spacing: 0%;
}
.usage-data-to-display {
  font-size: 24px;
  font-weight: 600;
  line-height: auto;
  letter-spacing: 0px;
  
}
.custom-first-chart {
  width: 500px;
}
.chart-container {
  height: 250px !important;
}
.text-title{
  font-size: 16px;
  font-weight: bold;

}

.text-sub-title{
  font-size: 20px;
  font-weight: bolder;
}
  </style>
  