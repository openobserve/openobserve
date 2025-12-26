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
  <div class="q-py-sm">
    <div class="row">
      <div class="row button-group">
        <div>
          <button
            data-test="dashboard-sql-query-type"
            :class="[
              selectedButtonQueryType === 'sql' ? 'selected' : '',
              !(
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.stream_type == 'metrics'
              )
                ? 'button-right'
                : '',
            ]"
            :style="{
              backgroundColor:
              store.state.theme == 'dark' ? 'transparent' : '#f0eaea',
            }"
            class="button button-left"
            @click="onUpdateQueryMode('sql', $event)"
          >
            {{ t("panel.SQL") }}
          </button>
        </div>
        <div>
          <button
            data-test="dashboard-promql-query-type"
            class="button button-right"
            :style="{
              backgroundColor:
                store.state.theme == 'dark' ? 'transparent' : '#f0eaea',
            }"
            :class="selectedButtonQueryType === 'promql' ? 'selected' : ''"
            v-show="
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.stream_type == 'metrics'
            "
            @click="onUpdateQueryMode('promql', $event)"
          >
            {{ t("panel.promQL") }}
          </button>
        </div>
      </div>
      <div class="row button-group tw:ml-[0.25rem]">
        <div v-if="dashboardPanelData.data.type != 'custom_chart'">
          <button
            data-test="dashboard-builder-query-type"
            :class="selectedButtonType === 'builder' ? 'selected' : ''"
            class="button button-left"
            @click="onUpdateBuilderMode('builder', $event)"
            :style="{
              backgroundColor:
              store.state.theme == 'dark' ? 'transparent' : '#f0eaea',
            }"
          >
            {{ t("panel.builder") }}
          </button>
        </div>
        <div>
          <button
            data-test="dashboard-custom-query-type"
            class="button button-right"
            :style="{
              backgroundColor:
                store.state.theme == 'dark' ? 'transparent' : '#f0eaea',
            }"
            :class="[
              selectedButtonType === 'custom' ? 'selected' : '',
              dashboardPanelData.data.type === 'custom_chart'
                ? 'button-left'
                : '',
            ]"
            @click="onUpdateBuilderMode('custom', $event)"
          >
            {{ t("panel.custom") }}
          </button>
        </div>
      </div>
    </div>
    <ConfirmDialog
      title="Change Query Mode"
      :message="confirmDialogMessage"
      @update:ok="changeToggle()"
      @update:cancel="confirmQueryModeChangeDialog = false"
      v-model="confirmQueryModeChangeDialog"
    />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  watch,
  onActivated,
  onMounted,
  nextTick,
  inject,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import ConfirmDialog from "../../ConfirmDialog.vue";
import { useStore } from "vuex";

export default defineComponent({
  name: "QueryTypeSelector",
  component: { ConfirmDialog },
  props: [],
  emits: [],
  setup() {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard"
    );
    const {
      dashboardPanelData,
      removeXYFilters,
      updateXYFieldsForCustomQueryMode,
    } = useDashboardPanelData(dashboardPanelDataPageKey);
    const confirmQueryModeChangeDialog = ref(false);
    const confirmDialogMessage = ref("Are you sure you want to change the query mode? The data saved for X-Axis, Y-Axis and Filters will be wiped off.");

    const selectedButtonQueryType = ref("sql");
    // this is the value of the current button
    const selectedButtonType = ref("builder");

    // this holds the temporary value of the button while user confirms the choice on popup
    const popupSelectedButtonType = ref("auto");

    const ignoreSelectedButtonTypeUpdate = ref(false);

    const initializeSelectedButtonType = async () => {
      // set a variable to ignore updates for selectedButtonType

      ignoreSelectedButtonTypeUpdate.value = true;
      selectedButtonQueryType.value = dashboardPanelData.data.queryType;
      selectedButtonType.value = dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.customQuery
        ? "custom"
        : "builder";

      if (dashboardPanelData.data.type == "custom_chart") {
        // For custom_chart, check the actual query type and customQuery flag
        selectedButtonType.value = "custom";
        ignoreSelectedButtonTypeUpdate.value = false;
        return;
      }

      // if the query type is not present, set the value to "sql"
      if (
        !dashboardPanelData.data.queryType ||
        dashboardPanelData.data.queryType == ""
      ) {
        dashboardPanelData.data.queryType = "sql";
      }

      await nextTick();

      // set a variable to allow watcher updates for selectedButtonType
      ignoreSelectedButtonTypeUpdate.value = false;
    };

    onMounted(async () => {
      initializeSelectedButtonType();
    });

    // onActivated(async () => {
    //     initializeSelectedButtonType()
    // })

    // when the data is loaded, initialize the selectedButtonType
    watch(
      () => [
        dashboardPanelData.data.queryType,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery,
      ],
      () => {
        initializeSelectedButtonType();
      }
    );

    const isSQLMode = computed(() => selectedButtonQueryType.value === "sql");

    const isPromQLMode = computed(
      () => selectedButtonQueryType.value === "promql",
    );

    const isBuilderMode = computed(
      () => selectedButtonType.value === "builder",
    );

    const isCustomMode = computed(() => selectedButtonType.value === "custom");

    const onUpdateQueryMode = (selectedQueryType: any, event?: any) => {
      event.stopPropagation();

      // Should we show popup of query being cleared

      popupSelectedButtonType.value = selectedQueryType;
      changeToggle();
      dashboardPanelData.layout.showQueryBar = true;
      // if (selectedQueryType != selectedButtonQueryType.value) {
      //   // some exceptions
      //   // If user is switching from auto to custom, promql to auto, promql to custom-sql,
      //   // promql-builder to promql, or promql-builder to auto no need for the popup,
      //   // else show the popup
      //   if (
      //     (isSQLMode.value &&
      //       isBuilderMode.value &&
      //       selectedQueryType == "custom") ||
      //     (isPromQLMode.value &&
      //       isBuilderMode.value &&
      //       selectedQueryType == "custom")
      //   ) {
      //     // act like you confirmed without opening the popup

      //   } else {
      //     popupSelectedButtonType.value = selectedQueryType;
      //     dashboardPanelData.data.queries[0].query != ""
      //       ? (confirmQueryModeChangeDialog.value = true)
      //       : changeToggle();
      //   }
      // }
    };

    const onUpdateBuilderMode = (selectedQueryType: any, event?: any) => {
      event.stopPropagation();
      if (selectedQueryType != selectedButtonType.value) {
        // some exceptions
        // If user is switching from auto to custom, promql to auto, promql to custom-sql,
        // promql-builder to promql, or promql-builder to auto no need for the popup,
        // else show the popup
        if (isBuilderMode.value && selectedQueryType == "custom") {
          // act like you confirmed without opening the popup
          popupSelectedButtonType.value = selectedQueryType;
          changeToggle();
          dashboardPanelData.layout.showQueryBar = true;
        } else {
          popupSelectedButtonType.value = selectedQueryType;

          // Set appropriate message based on the transition
          if (
            isPromQLMode.value &&
            isCustomMode.value &&
            selectedQueryType === "builder"
          ) {
            // Switching from PromQL custom to builder
            confirmDialogMessage.value =
              "Are you sure you want to switch to builder mode? Your custom PromQL query will be wiped off.";
          } else {
            // Default message for other transitions
            confirmDialogMessage.value =
              "Are you sure you want to change the query mode? The data saved for X-Axis, Y-Axis and Filters will be wiped off.";
          }

          dashboardPanelData.data.queries[0].query != ""
            ? (confirmQueryModeChangeDialog.value = true)
            : changeToggle();
        }
      }
    };

    const changeToggle = async () => {
      const isQueryTypeChange =
        popupSelectedButtonType.value === "promql" ||
        popupSelectedButtonType.value === "sql";

      const isSwitchingToBuilder =
        !isQueryTypeChange && popupSelectedButtonType.value === "builder";

      if (isQueryTypeChange) {
        selectedButtonQueryType.value = popupSelectedButtonType.value;
      } else {
        selectedButtonType.value = popupSelectedButtonType.value;
      }

      await nextTick(); // let the watchers execute first
      removeXYFilters();
      updateXYFieldsForCustomQueryMode();

      // Clear query when switching query types (SQL <-> PromQL)
      if (isQueryTypeChange && dashboardPanelData.data.type !== "custom_chart") {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].query = "";
      }

      // For metrics page: when switching from custom to builder in PromQL, set sample query
      if (
        dashboardPanelDataPageKey === "metrics" &&
        isSwitchingToBuilder &&
        dashboardPanelData.data.queryType === "promql" &&
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream
      ) {
        const streamName =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].query = `${streamName}{}`;
      }

      // empty the errors
      dashboardPanelData.meta.errors.queryErrors = [];

      // if (selectedButtonType.value == "promql") {
      //   dashboardPanelData.layout.currentQueryIndex = 0;
      //   dashboardPanelData.data.queries = dashboardPanelData.data.queries.slice(
      //     0,
      //     1
      //   );
      // }
      dashboardPanelData.layout.showQueryBar = true;
    };

    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
      () => {
        // Switch from PromQL to SQL when changing from metrics to logs/other stream types
        if (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type != "metrics" &&
          selectedButtonQueryType.value === "promql"
        ) {
          selectedButtonQueryType.value = "sql";
          selectedButtonType.value = "builder";
          dashboardPanelData.data.queryType = "sql";
          // Clear the query since we're switching query types
          if (dashboardPanelData.data.type !== "custom_chart") {
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].query = "";
          }
        }
      },
    );

    watch(selectedButtonQueryType, () => {
      window.dispatchEvent(new Event("resize"));
      if (!ignoreSelectedButtonTypeUpdate.value) {
        if (selectedButtonQueryType.value) {
          dashboardPanelData.data.queryType = selectedButtonQueryType.value;
        } else {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery = false;
          dashboardPanelData.data.queryType = "sql";
        }

        // Preserve the query when switching query types
        // Query should remain intact when switching between SQL and PromQL
      }
    });

    watch(selectedButtonType, () => {
      window.dispatchEvent(new Event("resize"));
      if (!ignoreSelectedButtonTypeUpdate.value) {
        if (selectedButtonType.value) {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery = selectedButtonType.value === "custom";
        } else {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery = false;
          dashboardPanelData.data.queryType = "sql";
        }

        // Don't clear the query when switching between builder and custom modes in PromQL
        // Only clear when switching query types (SQL/PromQL) and not for custom_chart
        // Query should be preserved when switching from builder to custom or vice versa
      }
    });

    return {
      t,
      router,
      dashboardPanelData,
      onUpdateBuilderMode,
      onUpdateQueryMode,
      changeToggle,
      confirmQueryModeChangeDialog,
      confirmDialogMessage,
      selectedButtonType,
      store,
      selectedButtonQueryType,
    };
  },
  components: { ConfirmDialog },
});
</script>

<style lang="scss" scoped>
.selected {
  background-color: var(--q-primary) !important;
  font-weight: bold;
  color: white;
}

.button-group {
  border: 1px solid gray !important;
  border-radius: 9px;
}

.button {
  display: block;
  cursor: pointer;
  // background-color: #f0eaea;
  border: none;
  font-size: 14px;
  padding: 3px 10px;
}

.button-left {
  border-top-left-radius: 8px;
  border-bottom-left-radius: 8px;
}

.button-right {
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
}
</style>
