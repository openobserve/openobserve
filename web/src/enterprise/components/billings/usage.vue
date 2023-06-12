<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <q-page class="q-pa-md">
    <div class="row items-baseline justify-between">
      <div class="row text-body1 text-weight-medium q-pb-md">
        {{ t("billing.usage") }}
      </div>
      <div class="date-selector">
        <q-select
          dense
          outlined
          v-model="usageDate"
          :options="options"
          @update:model-value="(value) => selectUsageDate()"
        />
      </div>
    </div>
    <reactive-line-chart
      :key="JSON.stringify(chartData.value)"
      :data="chartData"
    ></reactive-line-chart>
  </q-page>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar, date } from "quasar";
import ReactiveLineChart from "@/components/shared/plotly/doubleLinechart.vue";
import { useI18n } from "vue-i18n";
import BillingService from "@/services/billings";

const blankChartObj: any = {
  id: "panel_usage",
  data: [
    {
      x: [],
      y: [],
    },
    {
      x: [],
      y: [],
    },
    {
      x: [],
      y: [],
    },
  ],
  chartParams: { title: "" },
};

export default defineComponent({
  name: "Usage",
  components: {
    ReactiveLineChart,
  },
  setup() {
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();
    const usageDate = ref("30days");
    let chartData = ref(blankChartObj);
    onMounted(() => {
      getUsage();
    });
    const getUsage = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading usage data...",
      });
      BillingService.get_data_usage(
        store.state.selectedOrganization.identifier,
        usageDate.value
      )
        .then((res) => {
          const chartRes = res.data.data;
          var chartObj: any = JSON.parse(JSON.stringify(blankChartObj));
          if (chartRes?.length > 0) {
            chartRes.forEach(
              (data: {
                event: string;
                usage_timestamp: string;
                size: string;
              }) => {
                if (data.event == "bulk") {
                  chartObj.data[0].x.push(data.usage_timestamp);
                  chartObj.data[0].y.push(data.size);
                } else if (data.event == "search") {
                  chartObj.data[1].x.push(data.usage_timestamp);
                  chartObj.data[1].y.push(data.size);
                } else {
                  chartObj.data[2].x.push(data.usage_timestamp);
                  chartObj.data[2].y.push(data.size);
                }
              }
            );
          }
          chartData.value = chartObj;
          dismiss();
        })
        .catch((e) => {
          $q.notify({
            type: "negative",
            message: e.message,
            timeout: 5000,
          });
        });
    };
    const selectUsageDate = () => {
      chartData.value = {};
      getUsage();
    };
    return {
      t,
      store,
      chartData,
      usageDate,
      options: ["30days", "60days", "3months", "6months"],
      selectUsageDate,
    };
  },
  computed: {
    organization() {
      return this.store.state.selectedOrganization.identifier;
    },
  },
  watch: {
    organization() {
      this.selectUsageDate();
    },
  },
});
</script>
<style lang="scss" scoped>
.date-selector {
  width: 200px;
}
</style>
