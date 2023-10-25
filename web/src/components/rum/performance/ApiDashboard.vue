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
    <div class="row q-px-md">
      <div class="col-6 q-px-xs q-py-xs">
        <div class="view-error-table q-px-sm q-py-xs">
          <div>Top Slowest Resource</div>
          <AppTable :columns="slowResourceColumn" :rows="topSlowResources" />
        </div>
      </div>
      <div class="col-6 q-px-xs q-py-xs">
        <div class="view-error-table q-px-sm q-py-xs">
          <div>Top Heaviest Resource</div>
          <AppTable :columns="heavyResourceColumn" :rows="topHeavyResources" />
        </div>
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
import { reactive } from "vue";
import { useRoute } from "vue-router";
import errorDashboard from "@/utils/rum/errors.json";
import AppTable from "@/components/AppTable.vue";
import searchService from "@/services/search";
import { cloneDeep } from "lodash-es";

export default defineComponent({
  name: "AppPerformance",
  components: {
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
    const topSlowResources = ref([]);
    const topHeavyResources = ref([]);
    const variablesData = ref(null);

    const refDateTime: any = ref(null);
    const refreshInterval = ref(0);
    const topCount = 10;

    // variables data
    const variablesDataUpdated = (data: any) => {
      console.log(data);
      variablesData.value = data;
    };

    const slowResourceColumn = [
      {
        name: "resource_url",
        label: "Resource URL",
        field: (row) => row["resource_url"],
        align: "left",
        style: { flex: 2 },
      },
      {
        name: "max_duration",
        label: "Duration (ms)",
        field: (row: any) => row["max_duration"],
        align: "left",
        sortable: true,
        style: { flex: 2 },
      },
    ];

    const heavyResourceColumn = [
      {
        name: "resource_url",
        label: "Resource URL",
        field: (row) => row["resource_url"],
        align: "left",
      },
      {
        name: "max_resource_size",
        label: "Size (kb)",
        field: (row: any) => row["max_resource_size"],
        align: "left",
        sortable: true,
        style: { width: "56px" },
      },
    ];

    onMounted(async () => {
      await loadDashboard();
      console.log;
    });

    const getTopSlowResources = () => {
      topHeavyResources.value = [];
      console.log(
        "get resources",
        variablesData.value?.values?.length,
        cloneDeep(variablesData.value)
      );

      let whereClause = `where resource_duration is not null and resource_duration>=0 and resource_method is not null`;
      const variablesString = getVariablesString();
      if (variablesString && variablesString.length) {
        whereClause += ` and ${variablesString}`;
      }

      const req = {
        query: {
          sql: `SELECT avg(resource_duration/1000000) as max_duration, SPLIT_PART(resource_url, '?', 1) AS resource_url FROM "_rumdata" ${whereClause} group by resource_url order by max_duration desc`,
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
          res.data.hits.slice(0, topCount).forEach((element: any) => {
            topSlowResources.value.push({
              resource_url: new URL(element.resource_url).pathname,
              max_duration: element.max_duration.toFixed(2),
            });
          });
        })
        .finally(() => console.log(""));
    };

    const getTopHeavyResources = () => {
      topHeavyResources.value = [];

      let whereClause = `WHERE resource_size is not null and resource_size>=0`;
      const variablesString = getVariablesString();
      if (variablesString && variablesString.length) {
        whereClause += ` and ${variablesString}`;
      }

      const req = {
        query: {
          sql: `SELECT max(resource_size/1024) as max_resource_size, SPLIT_PART(resource_url, '?', 1) AS resource_url FROM "_rumdata" ${whereClause} group by resource_url order by max_resource_size desc`,
          start_time: props.selectedDate.startTime,
          end_time: props.selectedDate.endTime,
          from: 0,
          size: 150,
          sql_mode: "full",
        },
      };

      searchService
        .search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: req,
          page_type: "logs",
        })
        .then((res) => {
          res.data.hits.slice(0, topCount).forEach((element: any) => {
            topHeavyResources.value.push({
              ...element,
              resource_url: new URL(element.resource_url).pathname,
            });
          });
        })
        .finally(() => console.log(""));
    };

    const getVariablesString = () => {
      let variablesString = "";
      variablesData.value?.values?.length &&
        variablesData.value.values.forEach((element: any) => {
          if (element.type === "query_values" && !!element.value) {
            variablesString += `${element.name}=${element.value}&`;
          }
        });
      return variablesString;
    };

    const loadDashboard = async () => {
      getTopSlowResources();
      getTopHeavyResources();

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
          getTopHeavyResources();
          getTopSlowResources();
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
      topSlowResources,
      topHeavyResources,
      heavyResourceColumn,
      slowResourceColumn,
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

<style lang="scss">
.view-error-table {
  .q-table td[name="resource_url"] {
    width: 80%;
  }

  .q-table td[name="max_duration"] {
    flex: 1;
  }
}
</style>
