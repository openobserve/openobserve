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

<template>
  <div ref="chartPanelRef" style="height: 100%; position: relative">
    <div v-if="!errorDetail" style="height: 100%; width: 100%">
      <GeoMapRenderer
        v-if="panelSchema.type == 'geomap'"
        :data="
          panelData.chartType == 'geomap'
            ? panelData
            : { options: { backgroundColor: 'transparent' } }
        "
      />
      <TableRenderer
        v-else-if="panelSchema.type == 'table'"
        :data="
          panelData.chartType == 'table'
            ? panelData
            : { options: { backgroundColor: 'transparent' } }
        "
        @click="onChartClick"
        ref="tableRendererRef"
      />
      <div
        v-else-if="panelSchema.type == 'html'"
        class="col column"
        style="width: 100%; height: 100%; flex: 1"
      >
        <HTMLRenderer
          :htmlContent="panelSchema.htmlContent"
          style="width: 100%; height: 100%"
          class="col"
        />
      </div>
      <div
        v-else-if="panelSchema.type == 'markdown'"
        class="col column"
        style="width: 100%; height: 100%; flex: 1"
      >
        <MarkdownRenderer
          :markdownContent="panelSchema.markdownContent"
          style="width: 100%; height: 100%"
          class="col"
        />
      </div>
      <ChartRenderer
        v-else
        :data="
          panelSchema.queryType === 'promql' ||
          (data.length &&
            data[0]?.length &&
            panelData.chartType != 'geomap' &&
            panelData.chartType != 'table')
            ? panelData
            : { options: { backgroundColor: 'transparent' } }
        "
        @updated:data-zoom="$emit('updated:data-zoom', $event)"
        @error="errorDetail = $event"
        @click="onChartClick"
      />
    </div>
    <div v-if="!errorDetail" class="noData" data-test="no-data">
      {{ noData }}
    </div>
    <div
      v-if="errorDetail && !panelSchema?.error_config?.custom_error_handeling"
      class="errorMessage"
    >
      <q-icon size="md" name="warning" />
      <div style="height: 80%; width: 100%">{{ errorDetail }}</div>
    </div>
    <div
      v-if="
        errorDetail &&
        panelSchema?.error_config?.custom_error_handeling &&
        !panelSchema?.error_config?.default_data_on_error &&
        panelSchema?.error_config?.custom_error_message
      "
      class="customErrorMessage"
    >
      {{ panelSchema?.error_config?.custom_error_message }}
    </div>
    <div
      v-if="loading"
      class="row"
      style="position: absolute; top: 0px; width: 100%; z-index: 999"
    >
      <q-spinner-dots
        color="primary"
        size="40px"
        style="margin: 0 auto; z-index: 999"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, watch, ref, toRefs, computed, inject } from "vue";
import { useStore } from "vuex";
import { usePanelDataLoader } from "@/composables/dashboard/usePanelDataLoader";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import TableRenderer from "@/components/dashboards/panels/TableRenderer.vue";
import GeoMapRenderer from "@/components/dashboards/panels/GeoMapRenderer.vue";
import HTMLRenderer from "./panels/HTMLRenderer.vue";
import MarkdownRenderer from "./panels/MarkdownRenderer.vue";
import { getAllDashboardsByFolderId, getFoldersList } from "@/utils/commons";
import { useRoute, useRouter } from "vue-router";
export default defineComponent({
  name: "PanelSchemaRenderer",
  components: {
    ChartRenderer,
    TableRenderer,
    GeoMapRenderer,
    HTMLRenderer,
    MarkdownRenderer,
  },
  props: {
    selectedTimeObj: {
      required: true,
      type: Object,
    },
    panelSchema: {
      required: true,
      type: Object,
    },
    variablesData: {
      required: true,
      type: Object,
    },
  },
  emits: ["updated:data-zoom", "error", "metadata-update", "refresh"],
  setup(props, { emit }) {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();

    // stores the converted data which can be directly used for rendering different types of panels
    const panelData: any = ref({}); // holds the data to render the panel after getting data from the api based on panel config
    const chartPanelRef = ref(null); // holds the ref to the whole div
    // get refs from props
    const { panelSchema, selectedTimeObj, variablesData } = toRefs(props);

    // calls the apis to get the data based on the panel config
    let { data, loading, errorDetail, metadata } = usePanelDataLoader(
      panelSchema,
      selectedTimeObj,
      variablesData,
      chartPanelRef
    );

    // need tableRendererRef to access downloadTableAsCSV method
    const tableRendererRef = ref(null);

    // hovered series state
    // used to show tooltip axis for all charts
    const hoveredSeriesState: any = inject("hoveredSeriesState", null);

    // when we get the new data from the apis, convert the data to render the panel
    watch(
      [data, store?.state],
      async () => {
        // panelData.value = convertPanelData(panelSchema.value, data.value, store);
        if (!errorDetail.value) {
          try {
            // passing chartpanelref to get width and height of DOM element
            panelData.value = convertPanelData(
              panelSchema.value,
              data.value,
              store,
              chartPanelRef,
              hoveredSeriesState
            );

            errorDetail.value = "";
          } catch (error: any) {
            errorDetail.value = error.message;
          }
        } else {
          // if no data is available, then show the default data
          // if there is an error config in the panel schema, then show the default data on error
          // if no default data on error is set, then show the custom error message
          if (
            panelSchema.value?.error_config?.custom_error_handeling &&
            panelSchema.value?.error_config?.default_data_on_error
          ) {
            data.value = JSON.parse(
              panelSchema.value?.error_config?.default_data_on_error
            );
            errorDetail.value = "";
          }
        }
      },
      { deep: true }
    );

    // when we get the new metadata from the apis, emit the metadata update
    watch(metadata, () => {
      emit("metadata-update", metadata.value);
    });

    const handleNoData = (panelType: any) => {
      const xAlias = panelSchema.value.queries[0].fields.x.map(
        (it: any) => it.alias
      );
      const yAlias = panelSchema.value.queries[0].fields.y.map(
        (it: any) => it.alias
      );
      const zAlias = panelSchema.value.queries[0].fields.z.map(
        (it: any) => it.alias
      );

      switch (panelType) {
        case "area":
        case "area-stacked":
        case "bar":
        case "h-bar":
        case "stacked":
        case "h-stacked":
        case "line":
        case "scatter":
        case "table": {
          // return data.value[0].some((it: any) => {return (xAlias.every((x: any) => it[x]) && yAlias.every((y: any) => it[y]))});
          return (
            data.value[0]?.length > 1 ||
            (xAlias.every((x: any) => data.value[0][0][x] != null) &&
              yAlias.every((y: any) => data.value[0][0][y]) != null)
          );
        }
        case "gauge":
        case "metric": {
          return (
            data.value[0]?.length > 1 ||
            yAlias.every(
              (y: any) =>
                data.value[0][0][y] != null || data.value[0][0][y] === 0
            )
          );
        }
        case "heatmap": {
          return (
            data.value[0]?.length > 1 ||
            (xAlias.every((x: any) => data.value[0][0][x] != null) &&
              yAlias.every((y: any) => data.value[0][0][y] != null) &&
              zAlias.every((z: any) => data.value[0][0][z]) != null)
          );
        }
        case "pie":
        case "donut": {
          return (
            data.value[0]?.length > 1 ||
            yAlias.every((y: any) => data.value[0][0][y] != null)
          );
        }
        case "sankey": {
          const source = panelSchema.value.queries[0].fields.source.alias;
          const target = panelSchema.value.queries[0].fields.target.alias;
          const value = panelSchema.value.queries[0].fields.value.alias;
          return (
            data.value[0]?.length > 1 ||
            source.every((s: any) => data.value[0][0][s] != null) ||
            target.every((t: any) => data.value[0][0][t] != null) ||
            value.every((v: any) => data.value[0][0][v] != null)
          );
        }
        default:
          break;
      }
    };

    // Compute the value of the 'noData' variable
    const noData = computed(() => {
      // if panel type is 'html' or 'markdown', return an empty string
      if (
        panelSchema.value.type == "html" ||
        panelSchema.value.type == "markdown"
      ) {
        return "";
      }
      // Check if the queryType is 'promql'
      else if (panelSchema.value?.queryType == "promql") {
        // Check if the 'data' array has elements and every item has a non-empty 'result' array
        return data.value.length &&
          data.value.some((item: any) => item?.result?.length)
          ? "" // Return an empty string if there is data
          : "No Data"; // Return "No Data" if there is no data
      } else {
        // The queryType is not 'promql'
        return data.value.length &&
          data.value[0]?.length &&
          handleNoData(panelSchema.value.type)
          ? ""
          : "No Data"; // Return "No Data" if the 'data' array is empty, otherwise return an empty string
      }
    });

    // when the error changes, emit the error
    watch(errorDetail, () => {
      //check if there is an error message or not
      if (!errorDetail.value) return;
      emit("error", errorDetail);
    });

    // drilldown
    const replacePlaceholders = (str: any, obj: any) => {
      return str.replace(/\$\{([^}]+)\}/g, function (_: any, key: any) {
        // Split the key into parts by either a dot or a ["xyz"] pattern and filter out empty strings
        let parts = key.split(/\.|\["(.*?)"\]/).filter(Boolean);

        let value = obj;
        for (let part of parts) {
          if (value && part in value) {
            value = value[part];
          } else {
            return "${" + part + "}";
          }
        }
        return value;
      });
    };

    const onChartClick = async (params: any, ...args: any) => {
      // if panelSchema exists
      if (panelSchema.value) {
        // check if drilldown data exists
        if (
          !panelSchema.value.config.drilldown ||
          panelSchema.value.config.drilldown.length == 0
        ) {
          return;
        }

        // find drilldown data
        const drilldownData = panelSchema.value.config.drilldown[0];

        // need to change dynamic variables to it's value using current variables, current chart data(params)
        // if pie, donut or heatmap then series name will come in name field
        // also, if value is an array, then last value will be taken
        const drilldownVariables: any = {};

        // if chart type is 'table' then we need to pass the table name
        if (panelSchema.value.type == "table") {
          const fields: any = {};
          panelSchema.value.queries.forEach((query: any) => {
            // take all field from x, y and z
            const panelFields: any = [
              ...query.fields.x,
              ...query.fields.y,
              ...query.fields.z,
            ];
            console.log(panelFields);
            panelFields.forEach((field: any) => {
              // we have label and alias, use both in dynamic values
              fields[field.label] = args[0][field.alias];
              fields[field.alias] = args[0][field.alias];
            });
          });
          drilldownVariables.row = {
            field: fields,
            index: args[1],
          };
        } else {
          // we have an series object
          drilldownVariables.series = {
            __name: ["pie", "donut", "heatmap"].includes(panelSchema.value.type)
              ? params.name
              : params.seriesName,
            __value: Array.isArray(params.value)
              ? params.value[params.value.length - 1]
              : params.value,
          };
        }

        variablesData.value.values.forEach((variable: any) => {
          if (variable.type != "dynamic_filters") {
            drilldownVariables["var-" + variable.name] = variable.value;
          }
        });

        // if drilldown by url
        if (drilldownData.type == "byUrl") {
          // open url
          return window.open(
            new URL(
              replacePlaceholders(drilldownData.data.url, drilldownVariables)
            ),
            drilldownData.targetBlank ? "_blank" : "_self"
          );
        } else if (drilldownData.type == "byDashboard") {
          // we have folder, dashboard and tabs name
          // so we have to get id of folder, dashboard and tab

          // get folder id
          if (
            !store.state.organizationData.folders ||
            (Array.isArray(store.state.organizationData.folders) &&
              store.state.organizationData.folders.length === 0)
          ) {
            await getFoldersList(store);
          }
          const folderId = store.state.organizationData.folders.find(
            (folder: any) => folder.name == drilldownData.data.folder
          )?.folderId;

          if (!folderId) {
            return;
          }

          // get dashboard id
          const allDashboardData = await getAllDashboardsByFolderId(
            store,
            folderId
          );
          const dashboardData = allDashboardData.find(
            (dashboard: any) => dashboard.title == drilldownData.data.dashboard
          );

          if (!dashboardData) {
            return;
          }

          // get tab id
          const tabId =
            dashboardData.tabs.find(
              (tab: any) => tab.name == drilldownData.data.tab
            )?.tabId ?? "default";

          // if targetBlank is true then create new url
          // else made changes in current router only
          if (drilldownData.targetBlank) {
            // get current origin
            const pos = window.location.pathname.indexOf("/web/");
            let currentUrl: any =
              pos > -1
                ? window.location.origin +
                  window.location.pathname.slice(0, pos)
                : window.location.origin;

            // always, go to view dashboard page
            currentUrl += "/dashboards/view?";

            // if pass all variables in url
            currentUrl += drilldownData.data.passAllVariables
              ? new URLSearchParams(route.query as any).toString()
              : "";

            const url = new URL(currentUrl);

            // set variables provided by user
            drilldownData.data.variables.forEach((variable: any) => {
              if (variable?.name?.trim() && variable?.value?.trim()) {
                url.searchParams.set(
                  replacePlaceholders(variable.name, drilldownVariables),
                  replacePlaceholders(variable.value, drilldownVariables)
                );
              }
            });

            url.searchParams.set("dashboard", dashboardData.dashboardId);
            url.searchParams.set("folder", folderId);
            url.searchParams.set("tab", tabId);
            currentUrl = url.toString();

            window.open(currentUrl, "_blank");
          } else {
            let oldParams: any = [];
            // if pass all variables is true
            if (drilldownData.data.passAllVariables) {
              // get current query params
              oldParams = route.query;
            }

            drilldownData.data.variables.forEach((variable: any) => {
              if (variable?.name?.trim() && variable?.value?.trim()) {
                oldParams[
                  replacePlaceholders(variable.name, drilldownVariables)
                ] = replacePlaceholders(variable.value, drilldownVariables);
              }
            });

            // make changes in router
            await router.push({
              path: "/dashboards/view",
              query: {
                ...oldParams,
                org_identifier: store.state.selectedOrganization.identifier,
                dashboard: dashboardData.dashboardId,
                folder: folderId,
                tab: tabId,
              },
            });

            // reload dashboard because it will be in same path
            emit("refresh");
          }
        }
      }
    };

    return {
      chartPanelRef,
      data,
      loading,
      errorDetail,
      panelData,
      noData,
      metadata,
      tableRendererRef,
      onChartClick,
    };
  },
});
</script>

<style lang="scss" scoped>
.errorMessage {
  position: absolute;
  top: 20%;
  width: 100%;
  height: 80%;
  overflow: hidden;
  text-align: center;
  color: rgba(255, 0, 0, 0.8);
  text-overflow: ellipsis;
}

.customErrorMessage {
  position: absolute;
  top: 20%;
  width: 100%;
  height: 80%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
}

.noData {
  position: absolute;
  top: 20%;
  width: 100%;
  text-align: center;
}
</style>
