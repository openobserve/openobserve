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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <q-page :key="store.state.selectedOrganization.identifier">
    <div class="q-mx-sm performance-dashboard">
      <RenderDashboardCharts
        :dashboardData="currentDashboardData.data"
        :currentTimeObj="dateTime"
        @variablesData="variablesDataUpdated"
      />
    </div>
    <div class="row q-px-md">
      <div class="col-8 view-error-table q-px-sm q-py-xs">
        <div>Most Errors by View</div>
        <AppTable :columns="columns" :rows="errorsByView" />
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  watch,
  onActivated,
  nextTick,
  onMounted,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  parseDuration,
  generateDurationLabel,
  getDurationObjectFromParams,
  getQueryParamsForDuration,
} from "@/utils/date";
import { reactive } from "vue";
import { useRoute } from "vue-router";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import errorDashboard from "@/utils/rum/errors.json";
import AppTable from "@/components/AppTable.vue";
import searchService from "@/services/search";
import { cloneDeep } from "lodash-es";

export default defineComponent({
  name: "AppPerformance",
  components: {
    RenderDashboardCharts,
    AppTable,
  },
  props: {
    dateTime: {
      type: Object,
      default: () => ({}),
    },
    selectedDate: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const currentDashboardData = reactive({
      data: {},
    });
    const showDashboardSettingsDialog = ref(false);
    const viewOnly = ref(true);
    const eventLog = ref([]);
    const errorsByView = ref([]);
    const variablesData = ref(null);

    const refDateTime: any = ref(null);
    const refreshInterval = ref(0);

    const getResourceErrors = () => {
      errorsByView.value = [];

      let whereClause = `WHERE type='error'`;
      variablesData.value?.values?.length &&
        variablesData.value.values.forEach((element: any) => {
          if (element.type === "query_values" && !!element.value) {
            whereClause += ` and ${element.name}='${element.value}'`;
          }
        });

      const req = {
        query: {
          sql: `SELECT SPLIT_PART(view_url, '?', 1) AS view_url, count(*) as error_count FROM "_rumdata" ${whereClause} group by view_url order by error_count desc`,
          start_time: props.selectedDate.startTime,
          end_time: props.selectedDate.endTime,
          from: 0,
          size: 150,
          sql_mode: "full",
        },
      };

      // isLoading.value.push(true);

      // updateUrlQueryParams();

      searchService
        .search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: req,
          page_type: "logs",
        })
        .then((res) => {
          res.data.hits.forEach((element: any) => {
            errorsByView.value.push(element);
          });
        })
        .finally(() => console.log(""));
    };

    // variables data
    const variablesDataUpdated = (data: any) => {
      variablesData.value = data;
    };

    const columns = [
      {
        name: "view_url",
        label: "View URL",
        field: (row) => row["view_url"],
        align: "left",
      },
      {
        name: "error_count",
        label: "Error Count",
        field: (row: any) => row["error_count"],
        align: "left",
        sortable: true,
        style: { width: "56px" },
      },
    ];

    onMounted(async () => {
      await loadDashboard();
    });

    const loadDashboard = async () => {
      getResourceErrors();
      currentDashboardData.data = errorDashboard;

      // if variables data is null, set it to empty list
      if (
        !(
          currentDashboardData.data?.variables &&
          currentDashboardData.data?.variables?.list.length
        )
      ) {
        variablesData.value.isVariablesLoading = false;
        variablesData.value.values = [];
      }
    };

    const addSettingsData = () => {
      showDashboardSettingsDialog.value = true;
    };

    watch(
      () => props.selectedDate,
      (newVal, oldValue) => {
        if (JSON.stringify(newVal) !== JSON.stringify(oldValue)) {
          getResourceErrors();
        }
      }
    );

    return {
      currentDashboardData,
      t,
      store,
      refDateTime,
      refreshInterval,
      viewOnly,
      eventLog,
      variablesData,
      variablesDataUpdated,
      addSettingsData,
      showDashboardSettingsDialog,
      loadDashboard,
      columns,
      errorsByView,
    };
  },
});
</script>

<style lang="scss" scoped>
.performance_title {
  font-size: 24px;
}
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}

.view-error-table {
  margin-top: 20px;
  border: 1px solid rgba(194, 194, 194, 0.4784313725) !important;
  border-radius: 4px;
  min-height: 200px;
}
</style>

<style lang="scss"></style>
