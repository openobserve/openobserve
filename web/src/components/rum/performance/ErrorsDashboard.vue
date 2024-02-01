<!-- Copyright 2023 Zinc Labs Inc.

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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <q-page class="relative-position">
    <div
      class="performance-error-dashboard"
      :style="{ visibility: isLoading.length ? 'hidden' : 'visible' }"
    >
      <div class="q-px-sm performance-dashboard">
        <RenderDashboardCharts
          ref="errorRenderDashboardChartsRef"
          :viewOnly="true"
          :dashboardData="currentDashboardData.data"
          :currentTimeObj="dateTime"
          @variablesData="variablesDataUpdated"
        />
      </div>
      <div class="row q-px-md">
        <div class="col-6 view-error-table q-pa-sm">
          <div class="q-pb-sm text-bold q-pl-xs">Top Error Views</div>
          <AppTable
            :columns="columns"
            :rows="errorsByView"
            style="height: auto"
            :virtualScroll="false"
            height="200px"
          />
        </div>
      </div>
    </div>
    <div
      v-show="isLoading.length"
      class="q-pb-lg flex items-center justify-center text-center absolute full-width"
      style="height: calc(100vh - 250px); top: 0"
    >
      <div>
        <q-spinner-hourglass
          color="primary"
          size="40px"
          style="margin: 0 auto; display: block"
        />
        <div class="text-center full-width">Loading Dashboard</div>
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
import { convertDashboardSchemaVersion } from "../../../utils/dashboard/convertDashboardSchemaVersion";

export default defineComponent({
  name: "ErrorsDashboard",
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
    const store = useStore();
    const currentDashboardData = reactive({
      data: {},
    });
    const showDashboardSettingsDialog = ref(false);
    const viewOnly = ref(true);
    const errorsByView = ref([]);
    const variablesData = ref(null);
    const errorRenderDashboardChartsRef = ref(null);

    const refDateTime: any = ref(null);
    const refreshInterval = ref(0);
    const isLoading: Ref<boolean[]> = ref([]);

    onMounted(async () => {
      await loadDashboard();
      updateLayout();
    });

    onActivated(() => {
      updateLayout();
    });

    const updateLayout = async () => {
      // await nextTick();
      // await nextTick();
      // await nextTick();
      // await nextTick();
      // // emit window resize event to trigger the layout
      // errorRenderDashboardChartsRef.value.layoutUpdate();
      isLoading.value.push(true);

      // Settimeout is used to make consitent loading experience across all tabs
      // As due to vue-grid-layout issue in summary and webvitals

      setTimeout(() => {
        errorRenderDashboardChartsRef.value.layoutUpdate();
        isLoading.value.pop();
      }, 1000);
    };

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
          sql: `SELECT SPLIT_PART(view_url, '?', 1) AS url, count(*) as error_count FROM "_rumdata" ${whereClause} group by url order by error_count desc`,
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
          res.data.hits.forEach((element: any) => {
            errorsByView.value.push(element);
          });
        });
    };

    // variables data
    const variablesDataUpdated = (data: any) => {
      if (JSON.stringify(variablesData.value) === JSON.stringify(data)) return;

      variablesData.value = data;
      if (variablesData.value?.values?.length) {
        const areVariablesLoaded = variablesData.value.values.every(
          (element: any) => element.value
        );
        if (areVariablesLoaded) getResourceErrors();
      }
    };

    const columns = [
      {
        name: "url",
        label: t("rum.viewURL"),
        field: (row) => row["url"],
        align: "left",
      },
      {
        name: "error_count",
        label: t("rum.errorCount"),
        field: (row: any) => row["error_count"],
        align: "left",
        sortable: true,
        style: { width: "56px" },
      },
    ];

    const loadDashboard = async () => {
      // schema migration
      currentDashboardData.data = convertDashboardSchemaVersion(errorDashboard);


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
      },
      { immediate: true }
    );

    return {
      currentDashboardData,
      t,
      store,
      refDateTime,
      refreshInterval,
      viewOnly,
      variablesData,
      variablesDataUpdated,
      addSettingsData,
      showDashboardSettingsDialog,
      loadDashboard,
      columns,
      errorsByView,
      errorRenderDashboardChartsRef,
      isLoading,
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
  margin-top: 4px;
  border: 1px solid rgba(194, 194, 194, 0.4784313725) !important;
  border-radius: 4px;
  min-height: 200px;
}

.performance-error-dashboard {
  min-height: auto !important;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}
</style>

<style lang="scss"></style>
