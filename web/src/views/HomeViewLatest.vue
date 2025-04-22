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
  <q-page class="q-pa-md ">
    <div class="column " style="height: auto; overflow: auto; ">


        <!-- 1st section -->
        <div class="streams-container q-pa-lg " >
          <div class="row justify-between">
            <div class="text-h6 q-mb-md">Streams</div>
            <div class="view-button">
              View
            </div>
          </div>


          <!-- Tiles -->
          <div class="row wrap justify-evenly q-gutter-md q-px-sm">
            <div class="tile" style="min-width: 240px; flex-grow: 1; max-width: 100%;">
              <div class="tile-content q-pa-md rounded-borders text-center column" style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title"> {{ t("home.totalDataCompressed") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/compressed_size.svg')" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text positive-increase">
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
              <div class="tile-content q-pa-md rounded-borders text-center column" style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between" >
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title"> {{ t("home.totalDataIngested") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/ingested_size.svg')" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text negative-increase">
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
              <div class="tile-content q-pa-md rounded-borders text-center column" style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">  {{ t("home.indexSizeLbl") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/index_size.svg')" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text positive-increase " >
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
              <div class="tile-content q-pa-md rounded-borders text-center column" style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between" >
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">   {{ t("home.docsCountLbl") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/records.svg')" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text positive-increase">
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
              <div class="tile-content q-pa-md rounded-borders text-center column" style="height: 100%; gap: 12px">
              <!-- Top Section (60%) -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between">
                  <div class="tile-title">   {{ t("home.streams") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/records.svg')" />
                  </div>
                </div>

                <!-- Performance text -->
                <div class="performance-text positive-increase">
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
          <div class="charts-main-container row tw-gap-4 q-mt-md " style="display: flex; gap: 16px; height: calc(100% - 20px); ">
            <!-- Chart 1 --> 
            <div class=" chart-container first-chart-container rounded-borders " style= "padding: 16px; display: flex; flex-direction: column;">
              <div class="details-container" style="margin-bottom: 16px;">
                <div class="row justify-between">
                  <span class="text-title">Alerts</span>
                  <span class="view-button">View</span>
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
              <div class="custom-first-chart"  style="height: 100%; min-height: 145px;" >
                <CustomChartRenderer
                  :key="panelDataKey"
                  :data="panelData"
                  style="width: 100%; height: 100%"
                />
              </div>
            </div>
            <div class="chart-container second-chart-container rounded-borders" style=" padding: 16px; display: flex; flex-direction: column;">
              <div class="details-container" style="margin-bottom: 16px;">
                <div class="row justify-between">
                  <span class="text-title">Pipelines</span>
                  <span class="view-button">View</span>
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
              <div class="custom-second-chart"  style="height: 100%; min-height: 145px;" >
                <CustomChartRenderer
                  :key="panelDataKey"
                  :data="panelData2"
                  style="width: 100%; height: 100%"
                />
              </div>
            </div>
          </div>

        <!-- 3rd section -->
        <div class="row tw-gap-4"
            style="max-height: 200px; overflow-y: auto; margin-top: 16px; ">
          <div style="width: 240px !important; max-width: 100%;">
            <div class="tile-content q-pa-md rounded-borders text-center column justify-between"
                style="min-height: 150px; gap: 12px;">
              <!-- Top Section -->
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">{{ t("home.functionTitle") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/compressed_size.svg')" />
                  </div>
                </div>
              </div>
              <!-- Bottom Section -->
              <div class="data-to-display row items-end">
                {{ summary.function_count }}
              </div>
            </div>
          </div>

          <div style="width: 240px !important; max-width: 100%;">
            <div class="tile-content q-pa-md rounded-borders text-center column justify-between"
                style="min-height: 150px; gap: 12px;">
              <!-- Top Section -->
              <div class="column justify-between">
                <div class="row justify-between">
                  <div class="tile-title">{{ t("home.dashboardTitle") }}</div>
                  <div>
                    <img :src="getImageURL('images/home/compressed_size.svg')" />
                  </div>
                </div>
              </div>
              <!-- Bottom Section -->
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
import { defineComponent, ref, watch } from "vue";
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

    const panelData = ref(
      {
      "chartType": "custom_chart",
      "title": {
          "text": "Last 15 minutes",
          "left": "70%",
          "top": "35%",
          "textStyle": {
              "fontSize": 16,
              "fontWeight": "normal"
          }
      },
      "tooltip": {
          "trigger": "item"
      },
      "legend": {
          "top": "50%",
          "orient": "vertical",
          "left": "70%"
      },
      "series": [
          {
              "name": "Alert Status",
              "type": "pie",
              "radius": [
                  "40%",
                  "60%"
              ],
              "center": [
                  "50%",
                  "50%"
              ],
              "right": "40%",
              "startAngle": 0,
              "endAngle": 360,
              "label": {
                  "formatter": "{d}%",
                  "show": true,
                  "fontSize": 16
              },
              "labelLine": {
                  "show": true,
                  "length": 10,
                  "length2": 10,
                  "lineStyle": {
                      "width": 2
                  }
              },
              "data": [
                  {
                      "value": 80,
                      "name": "Success Alerts",
                      "itemStyle": {
                          "color": "#15ba73"
                      }
                  },
                  {
                      "value": 30,
                      "name": "Failed Alerts",
                      "itemStyle": {
                          "color": "#db373a"
                      }
                  }
              ]
          }
      ]
  }
    );
    const panelData2 = ref(
      {
    "chartType": "custom_chart",
    "xAxis": {
        "type": "category",
        "data": [
            "Healthy",
            "Failed",
            "Warning"
        ],
        "name": "Last 15 minutes",
        "nameLocation": "middle",
        "nameGap": 30,
        "nameTextStyle": {
            "fontSize": 16,
            "fontWeight": "normal"
        },
        "axisLabel": {
            "fontSize": 14
        }
    },
    "yAxis": {
        "type": "value",
        "min": 0,
        "max": 50,
        "interval": 10,
        "name": "Number of Pipelines",
        "nameLocation": "middle",
        "nameGap": 60,
        "nameRotate": 90,
        "nameTextStyle": {
            "fontSize": 16,
            "fontWeight": "normal"
        },
        "axisLabel": {
            "fontSize": 12
        }
    },
    "series": [
        {
            "data": [
                33,
                43,
                49
            ],
            "type": "bar",
            "barWidth": "50%",
            "label": {
                "show": true,
                "position": "top",
                "fontSize": 14,
                "fontWeight": "bold"
            },
            "itemStyle": {
                "color": "function (params) {\n          const colors = ['#16b26a', '#db373b', '#FFc328'];\n          return colors[params.dataIndex];\n        }"
            }
        }
    ]
    }
    )

    watch (() => window.innerWidth, () => {
      panelDataKey.value++; // Increment the key to force a re-render
  // Trigger reactivity by modifying the panelData
  panelData.value = { ...panelData.value }; // or update any relevant field
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
  border: 1px solid #E7EAEE;
  border-radius: 8px;
  box-sizing: border-box;
}
.view-button {
  cursor: pointer;
  color: #5960B2
}
.tile {
  flex: 1 1 240px; /* grow, shrink, basis */
  max-width: 100%; /* prevents overflow */
}

.tile-content {
  height: 140px !important; /* or any fixed height */
  background-color: #ffffff;
  padding: 16px;
  border: 1px solid #E7EAEE;
  border-radius: 8px;
}
.tile-title {
  font-size: 16px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0%;
}
.performance-text{
  border: 1px solid #E4E7EC;
  border-radius: 50px;
  width: 160px;
  padding: 0px 8px;
  display: flex;
  align-items: center;
  background-color: #EBFDF5;
  color: #0e6842;
  font-size: 12px !important;
}
.positive-increase{
  background-color: #EBFDF5;
  color: #0e6842;
}
.negative-increase{
  background-color: #FFEBE9;
  color: #B42318;
}
.data-to-display{
  font-size: 24px;
  font-weight: 600;
}
.chart-container{
  border: 1px solid #E7EAEE;

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
.first-chart-container{
  width: 35%;
}
.second-chart-container{
  width: calc(65% - 16px);
}
</style>
