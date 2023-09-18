<!-- Copyright 2023 Zinc Labs Inc.

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
    <div v-if="!dataLoading">
      <div v-if="chartData.value">
        <div class="text-h6 text-weight-medium text-center">
          {{ t("billing.messageDataNotFound") }}
        </div>
      </div>
      <div v-else>
        <ChartRenderer
          id="billing-usage"
          :data="chartData"
          style="height: 400px;"
        />
      </div>
    </div>
    <div v-else class="text-h6 text-weight-medium text-center">Loading...</div>
  </q-page>
</template>
<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar, date } from "quasar";
import { useI18n } from "vue-i18n";
import BillingService from "@/services/billings";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { convertBillingData } from "@/utils/billing/convertBillingData";

let currentDate = new Date(); // Get the current date and time

// Subtract 30 days from the current date
let thirtyDaysAgo = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);

export default defineComponent({
  name: "Usage",
  components: {
    ChartRenderer
},
  setup() {
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();
    const usageDate = ref("30days");
    const dataLoading = ref(false);
    let chartData:any = ref({});
    onMounted(() => {
      selectUsageDate();
    });
    const getUsage = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading usage data...",
      });
      dataLoading.value = true;
      BillingService.get_data_usage(
        store.state.selectedOrganization.identifier,
        usageDate.value
      )
        .then((res) => {
          dataLoading.value = false;
          chartData.value = convertBillingData(res);
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
      dataLoading,
      options: ["30days", "60days", "3months", "6months"],
      selectUsageDate,
    };
  },
});
</script>
<style lang="scss" scoped>
.date-selector {
  width: 200px;
}
</style>
