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
  <q-page class="q-pa-md " style="overflow-y: auto; ">
    <div class="column " style="height: auto; overflow-y: auto; ">
        <!-- 1st section -->
        <div class="streams-container q-pa-lg "
        :class="store.state.theme === 'dark' ? 'dark-stream-container' : 'light-stream-container'"
         >
          <div class="row justify-between items-center q-mb-md">
            <div class="text-h6 ">Streams</div>
              <q-btn no-caps flat :class="store.state.theme === 'dark' ? 'view-button-dark' : 'view-button-light'"
               >View
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
              <div class="tile-content q-pa-md rounded-borders text-center column "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title"> {{ t("home.totalDataCompressed") }}</div>
                  <div style="opacity: 0.8;">
                    <img :src="compressedSizeIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text "
                :class="store.state.theme === 'dark' ? 'positive-increase-dark' : 'positive-increase-light'"
                >
                  <q-icon name="arrow_upward" size="14px" /> 2.89% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ summary.compressed_data }}
            </div>
            </div>
            </div>

            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between" >
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title"> {{ t("home.totalDataIngested") }}</div>
                  <div>
                    <img :src="ingestedSizeIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text "
                :class="store.state.theme === 'dark' ? 'negative-increase-dark' : 'negative-increase-light'"
                >
                  <q-icon name="arrow_downward" size="14px" /> 2.89% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ summary.ingested_data }}
            </div>
            </div>
            </div>

            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">  {{ t("home.indexSizeLbl") }}</div>
                  <div>
                    <img :src="indexSizeIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text "
                :class="store.state.theme === 'dark' ? 'positive-increase-dark' : 'positive-increase-light'"
                >
                  <q-icon name="arrow_upward" size="14px" /> 0.00% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ summary.index_size }}
            </div>
            </div>
            </div>

            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between" >
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">   {{ t("home.docsCountLbl") }}</div>
                  <div>
                    <img :src="recordsIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text "
                :class="store.state.theme === 'dark' ? 'positive-increase-dark' : 'positive-increase-light'"
                >
                  <q-icon name="arrow_upward" size="14px" /> 2.89% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ summary.doc_count }}
            </div>
            </div>
            </div>

            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column "
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
               style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">   {{ t("home.streams") }}</div>
                  <div>
                    <img height="32px" :src="streamsIcon" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text"
                :class="store.state.theme === 'dark' ? 'positive-increase-dark' : 'positive-increase-light'"
                >
                  <q-icon name="arrow_upward" size="14px"  /> 2.89% from last week
                </div>
              </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display row items-end ">
              {{ summary.streams_count }} 
            </div>
            </div>
            </div>
        </div>

        </div>
      <!-- 2nd section -->
        <div class="charts-main-container row tw-gap-4 q-mt-md xl:tw-min-h-[450px] " style="display: flex; gap: 16px; height: calc(100% - 22px);  ">
          <!-- Chart 1 --> 
          <div class=" first-chart-container rounded-borders tw-w-full tw-max-w-full xl:tw-w-[35%]  tw-p-4 " style= " display: flex; flex-direction: column;"
          :class="store.state.theme === 'dark' ? 'chart-container-dark' : 'chart-container-light'"
          >
            <div class="details-container" style="margin-bottom: 16px;">
              <div class="row justify-between items-center">
                <span class="text-title">Alerts</span>
                <q-btn no-caps flat :class="store.state.theme === 'dark' ? 'view-button-dark' : 'view-button-light'">View
                  <router-link
                    exact
                    :to="{ name: 'alertList' }"
                    class="absolute full-width full-height"
                  ></router-link>
              </q-btn>
              </div>
              <div class="row q-pt-sm" style="gap: 16px;">
                <div class="column">
                  <span class="text-subtitle">Scheduled</span>
                  <span class="results-count">40</span>
                </div>
                <q-separator vertical />
                <div class="column">
                  <span class="text-subtitle">Real time</span>
                  <span class="results-count">88</span>
                </div>
              </div>
            </div>
            <div class="custom-first-chart xl:tw-min-h-[350px] tw-h-[calc(100vh-500px)]  md:tw-h-[calc(100vh-500px)] lg:tw-h-[calc(100vh-550px)] xl:tw-h-[calc(100vh-645px)] tw-w-full"  >
              <CustomChartRenderer
                :key="panelDataKey"
                :data="panelData"
                class="tw-w-full tw-h-full md:tw-h-[calc(100vh-400px)] "
              />
            </div>
          </div>
          <div class=" second-chart-container rounded-borders tw-w-full tw-max-w-full xl:tw-w-[calc(65%-16px)] tw-p-4 " style=" display: flex; flex-direction: column;"
          :class="store.state.theme === 'dark' ? 'chart-container-dark' : 'chart-container-light'"
          >
            <div class="details-container" style="margin-bottom: 16px;">
              <div class="row justify-between items-center">
                <span class="text-title">Pipelines</span>
                <q-btn no-caps flat :class="store.state.theme === 'dark' ? 'view-button-dark' : 'view-button-light'">View
                  <router-link
                    exact
                    :to="{ name: 'pipelines' }"
                    class="absolute full-width full-height"
                  ></router-link>
              </q-btn>
              </div>
              <div class="row q-pt-sm" style="gap: 16px;">
                <div class="column">
                  <span class="text-subtitle">Scheduled</span>
                  <span class="results-count">50</span>
                </div>
                <q-separator vertical />
                <div class="column">
                  <span class="text-subtitle">Real time</span>
                  <span class="results-count">69</span>
                </div>
              </div>
            </div>
            <div class="custom-second-chart xl:tw-min-h-[350px] tw-h-[calc(100vh-500px)]  md:tw-h-[calc(100vh-500px)] lg:tw-h-[calc(100vh-550px)] xl:tw-h-[calc(100vh-645px)]"  >
              <CustomChartRenderer
                :key="panelDataKey"
                :data="panelData2"
                class="tw-w-full tw-h-full "
              />
            </div>
          </div>
        </div>
        <!-- 3rd section -->
        <div class="tw-flex flex-col sm:tw-flex-row tw-justify-evenly sm:tw-justify-start tw-flex-wrap tw-gap-4 q-mt-md " >

          <div class="tw-w-full sm:tw-w-[calc(50%-0.5rem)] xl:tw-w-[240px] tw-max-w-full">
            <div class="tile-content q-pa-md rounded-borders text-center column justify-between"
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
              style="min-height: 150px; gap: 12px;">
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">{{ t("home.functionTitle") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/compressed_size.svg')" />
                  </div>
                </div>
              </div>
              <div class="data-to-display row items-end">
                {{ summary.function_count }}
              </div>
            </div>
          </div>

          <!-- Tile 2 -->
          <div class="tw-w-full sm:tw-w-[calc(50%-0.5rem)] xl:tw-w-[240px] tw-max-w-full">
            <div class="tile-content q-pa-md rounded-borders text-center column justify-between"
              :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
              style="min-height: 150px; gap: 12px;">
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">{{ t("home.dashboardTitle") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/compressed_size.svg')" />
                  </div>
                </div>
              </div>
              <div class="data-to-display row items-end">
                {{ summary.dashboard_count }}
              </div>
            </div>
          </div>
        </div>

      </div>


  </q-page>


</template>

<script lang="ts">
import { useQuasar } from "quasar";
import { computed, defineComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import orgService from "../services/organizations";
import config from "../aws-exports";
import { formatSizeFromMB, addCommasToNumber, getImageURL } from "@/utils/zincutils";
import useStreams from "@/composables/useStreams";
import pipelines from "@/services/pipelines";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";

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
    const panelDataKey = ref(0); // Start with a default key


    const getSummary = (org_id: any) => {
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

          summary.value = {
            streams_count: res.data.streams?.num_streams ?? 0,
            ingested_data: formatSizeFromMB(
              res.data.streams?.total_storage_size,
            ),
            compressed_data: formatSizeFromMB(
              res.data.streams?.total_compressed_size,
            ),
            doc_count: addCommasToNumber(res.data.streams?.total_records ?? 0),
            index_size: formatSizeFromMB(
              res.data.streams?.total_index_size ?? 0,
            ),
            scheduled_pipelines: res.data.pipelines?.num_scheduled ?? 0,
            rt_pipelines: res.data.pipelines?.num_realtime ?? 0,
            rt_alerts: res.data.alerts?.num_realtime ?? 0,
            scheduled_alerts: res.data.alerts?.num_scheduled ?? 0,
            dashboard_count: res.data.total_dashboards ?? 0,
            function_count: res.data.total_functions ?? 0,
          };
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
        });
    };

    if (
      Object.keys(store.state.selectedOrganization).length > 0 &&
      store.state.selectedOrganization?.identifier != undefined
    ) {
      getSummary(store.state.selectedOrganization.identifier);
    }

    const panelData = computed (() => ({
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
          radius: ["40%", "60%"],
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
              value: 80,
              name: "Success Alerts",
              itemStyle: {
                color: "#15ba73"
              }
            },
            {
              value: 30,
              name: "Failed Alerts",
              itemStyle: {
                color: "#db373a"
              }
            }
          ]
        }
      ]
    }));

    const panelData2 = computed(() => {

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
          max: 50,
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
            color: store.state.theme === 'dark' ? '#B7B7B&' : '#72777B'
          },
          splitLine: {
            lineStyle: {
              color: store.state.theme === 'dark' ? '#444' : '#e0e0e0'
            }
          }

        },

        series: [
          {
            data: [33, 43, 49],
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






    return {
      t,
      store,
      summary,
      no_data_ingest,
      getSummary,
      isCloud,
      getImageURL,
      panelData,
      panelData2,
      panelDataKey,
      compressedSizeIcon,
      ingestedSizeIcon,
      indexSizeIcon,
      recordsIcon,
      streamsIcon,
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
  },
});
</script>

<style scoped lang="scss">
.streams-container {
  background: linear-gradient(to bottom, #fdfdfe, #f3f3f9);
  border-radius: 8px;
  box-sizing: border-box;
}
.dark-stream-container {
  background: #222526;
  border: 1px solid #444444;
}
.light-stream-container {
  background: linear-gradient(to bottom, #fdfdfe, #f3f3f9);
  border: 1px solid #E7EAEE;
}
.view-button-light {
  cursor: pointer;
  color: #5960B2;
  padding: 0px
}
.view-button-dark {
  cursor: pointer;
  color: #929BFF;
  padding: 0px;
  margin: 0px;
}
.tile {
  flex: 1 1 240px; /* grow, shrink, basis */
  max-width: 100%; /* prevents overflow */
}

.tile-content {
  height: 140px !important; /* or any fixed height */
  padding: 16px;
  border-radius: 8px;
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
  font-size: 24px;
  font-weight: 600;
}
.chart-container-light{
  border: 1px solid #E7EAEE;
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
}
.details-container{
  gap: 12px;
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
</style>
