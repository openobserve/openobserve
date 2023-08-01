// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { reactive, computed } from "vue";
import StreamService from '@/services/stream';
import { useStore } from "vuex";
import { useQuasar } from "quasar";

const colors = [
  '#5960b2',
  '#c23531',
  '#2f4554',
  '#61a0a8',
  '#d48265',
  '#91c7ae',
  '#749f83',
  '#ca8622',
  '#bda29a',
  '#6e7074',
  '#546570',
  '#c4ccd3'
]

const getDefaultDashboardPanelData = () => ({
  data: {
    id: "",
    type: "bar",
    fields: {
      stream: "",
      stream_type: "logs",
      x: <any>[],
      y: <any>[],
      filter: <any>[],
    },
    config: {
      title: "",
      description: "",
      show_legends: true,
      legends_position: null,
      promql_legend: "",
      unit: null,
      unit_custom: null
    },
    queries: [
      {
        query:
          'histogram_quantile(0.95, sum(irate(zo_grpc_response_time_bucket{namespace="ziox-alpha1"}[5m])) by (le, exported_endpoint))',
        promql_legend: "q1-{exported_endpoint}",
      },
      {
        query:
          'histogram_quantile(0.98, sum(irate(zo_grpc_response_time_bucket{namespace="ziox-alpha1"}[5m])) by (le, exported_endpoint))',
        promql_legend: "q2-{exported_endpoint}",
      },
    ],
    queryType: "sql",
    query: "a",
    customQuery: false,
  },
  layout: {
    splitter: 20,
    showQueryBar: false,
    isConfigPanelOpen: false,
  },
  meta: {
    parsedQuery: "",
    dragAndDrop: {
      dragging: false,
      dragElement: null,
    },
    errors: {
      queryErrors: [],
    },
    editorValue: "",
    dateTime: { start_time: new Date(), end_time: new Date() },
    filterValue: <any>[],
    stream: {
      selectedStreamFields: [],
      customQueryFields: [],
      functions: [],
      streamResults: <any>[],
      filterField: "",
    },
  },
});

let dashboardPanelData = reactive({ ...getDefaultDashboardPanelData()});

const useDashboardPanelData = () => {
  const store = useStore();
  const $q = useQuasar();

  const resetDashboardPanelData = () => {
    Object.assign(dashboardPanelData, getDefaultDashboardPanelData());
    // console.log("updated...",dashboardPanelData);
  };

  const generateLabelFromName = (name: string) => {
    return name.replace(/[\_\-\s\.]/g,' ').split(' ').map(string => string.charAt(0).toUpperCase() + string.slice(1)).filter(it => it).join(' ')
  }

  const promqlMode = computed(() => dashboardPanelData.data.fields.stream_type == "metrics" && dashboardPanelData.data.customQuery && dashboardPanelData.data.queryType == "promql")

  const isAddXAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case 'pie':
      case 'donut':
        return dashboardPanelData.data.fields.x.length >= 1
      case 'metric':
        return dashboardPanelData.data.fields.x.length >= 0
      case 'table':
        return false
      default:
        return dashboardPanelData.data.fields.x.length >= 2;
    }
  })

  const isAddYAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case 'pie':
      case 'donut':
        return dashboardPanelData.data.fields.y.length >= 1
      case 'metric':
        return dashboardPanelData.data.fields.y.length >= 1
      case 'area-stacked':
      case 'stacked':
      case 'h-stacked':
        return dashboardPanelData.data.fields.y.length >= 1
      default:
        return false;
    }
  })

  const addXAxisItem = (row: any) => {
    if(!dashboardPanelData.data.fields.x) {
      dashboardPanelData.data.fields.x = []
    }

    if(isAddXAxisNotAllowed.value){
      return;
    }

    // check for existing field
    if(!dashboardPanelData.data.fields.x.find((it:any) => it.column == row.name)) {
      dashboardPanelData.data.fields.x.push({
        label: !dashboardPanelData.data.customQuery ? generateLabelFromName(row.name) : row.name,
        alias: !dashboardPanelData.data.customQuery ? 'x_axis_' + (dashboardPanelData.data.fields.x.length + 1) : row.name,
        column: row.name,
        color: null,
        aggregationFunction: (row.name == store.state.zoConfig.timestamp_column) ? 'histogram' : null
      })
    }

    updateArrayAlias()
  }

  const addYAxisItem = (row: any) => {
    if(!dashboardPanelData.data.fields.y) {
      dashboardPanelData.data.fields.y = []
    }

    if(isAddYAxisNotAllowed.value){
      return;
    }

    if(!dashboardPanelData.data.fields.y.find((it:any) => it.column == row.name)) {
      dashboardPanelData.data.fields.y.push({
        label: !dashboardPanelData.data.customQuery ? generateLabelFromName(row.name) : row.name,
        alias: !dashboardPanelData.data.customQuery ? 'y_axis_' + (dashboardPanelData.data.fields.y.length + 1) : row.name,
        column: row.name,
        color: getNewColorValue(),
        aggregationFunction: 'count'
      })
    }
    updateArrayAlias()
  }

  // get new color value based on existing color from the chart
  const getNewColorValue = () => {
   const YAxisColor = dashboardPanelData.data.fields.y.map((it: any)=> it.color)
   let newColor = colors.filter((el:any) => !YAxisColor.includes(el));
    if(!newColor.length){
      newColor = colors
    }
    return newColor[0]
  }

  // update X or Y axis aliases when new value pushes into the X and Y axes arrays
  const updateArrayAlias = () => {
    dashboardPanelData.data.fields.x.forEach((it:any, index:any) => it.alias = !dashboardPanelData.data.customQuery ? 'x_axis_' + (index + 1) : it.column )
    dashboardPanelData.data.fields.y.forEach((it:any, index:any) => it.alias = !dashboardPanelData.data.customQuery ? 'y_axis_' + (index + 1) : it.column )
  }


  const removeXAxisItem = (name: string) => {
    const index = dashboardPanelData.data.fields.x.findIndex((it:any) => it.column == name)
    if(index >= 0) {
      dashboardPanelData.data.fields.x.splice(index, 1)
    }
  }

  const removeYAxisItem = (name: string) => {
    const index = dashboardPanelData.data.fields.y.findIndex((it:any) => it.column == name)
    if(index >= 0) {
      dashboardPanelData.data.fields.y.splice(index, 1)
    }
  }

  const removeFilterItem = (name: string) => {
    const index = dashboardPanelData.data.fields.filter.findIndex((it:any) => it.column == name)
    if(index >= 0) {
      dashboardPanelData.data.fields.filter.splice(index, 1)
    }
  }

  const addFilteredItem = (name: string) => {
    // console.log("name=", name);
    if (!dashboardPanelData.data.fields.filter) {
      dashboardPanelData.data.fields.filter = [];
    }

    if (
      !dashboardPanelData.data.fields.filter.find(
        (it: any) => it.column == name
      )
    ) {
      // console.log("data");

      dashboardPanelData.data.fields.filter.push({
        type: "list",
        values: [],
        column: name,
        operator: null,
        value: null,
      });
    }

    if (!dashboardPanelData.meta.filterValue) {
      dashboardPanelData.meta.filterValue = [];
    }

    // remove any existing data
    const find = dashboardPanelData.meta.filterValue.findIndex((it: any) => it.column == name)
    if (find >= 0) {
      dashboardPanelData.meta.filterValue.splice(find, 1);
    }

    StreamService
      .fieldValues({
        org_identifier: store.state.selectedOrganization.identifier,
        stream_name: dashboardPanelData.data.fields.stream,
        start_time:  new Date(dashboardPanelData.meta.dateTime["start_time"].toISOString()).getTime() * 1000,
        end_time:  new Date(dashboardPanelData.meta.dateTime["end_time"].toISOString()).getTime() * 1000,
        fields: [name],
        size: 10,
        type: dashboardPanelData.data.fields.stream_type
      })
      .then((res:any) => {
        dashboardPanelData.meta.filterValue.push({
          column: name,
          value: res?.data?.hits?.[0]?.values
            .map((it: any) => it.zo_sql_key)
            .filter((it: any) => it),
        });

      })
      .catch((error: any) => {
        $q.notify({
          type: "negative",
          message: "Something went wrong!",
          timeout: 5000,
        });
      });
  }

  const removeXYFilters = () => {
    if (promqlMode.value || dashboardPanelData.data.customQuery == false) {
      dashboardPanelData.data.fields.x.splice(0, dashboardPanelData.data.fields.x.length);
      dashboardPanelData.data.fields.y.splice(0, dashboardPanelData.data.fields.y.length);
      dashboardPanelData.data.fields.filter.splice(0, dashboardPanelData.data.fields.filter.length);
    }
  }

  // This function updates the x and y fields of a custom query in the dashboard panel data
  const updateXYFieldsForCustomQueryMode = () => {
    // Check if the custom query is enabled and PromQL mode is disabled
    if (!promqlMode.value && dashboardPanelData.data.customQuery == true) {
      // Loop through each custom query field in the dashboard panel data's stream meta
      dashboardPanelData.meta.stream.customQueryFields.forEach((it: any, index: number) => {
        // Determine if the current field is an x or y field
        const currentFieldType = index < dashboardPanelData.data.fields.x.length ? "x" : "y";
        // Get the current field based on its index and whether it's an x or y field
        const field = index < dashboardPanelData.data.fields.x.length
            ? dashboardPanelData.data.fields.x[index]
            : dashboardPanelData.data.fields.y[index - dashboardPanelData.data.fields.x.length];
        // Get the name of the current custom query field
        const { name } = it;

          // Update the properties of the current field
          field.alias = name; // Set the alias to the name of the custom query field
          field.column = name; // Set the column to the name of the custom query field
          field.color = null; // Reset the color to null
          // If the current field is a y field, set the aggregation function to "count"
          field.aggregationFunction = currentFieldType == "x" ? null : "count";
        }
      );
    }
  };


  const updateXYFieldsOnCustomQueryChange = (oldCustomQueryFields: any) => {
    // Create a copy of the old custom query fields array
    const oldArray = oldCustomQueryFields;
    // Create a deep copy of the new custom query fields array
    const newArray = JSON.parse(JSON.stringify(dashboardPanelData.meta.stream.customQueryFields));

    // Check if the length of the old and new arrays are the same
    if (oldArray.length == newArray.length) {
      // Create an array to store the indexes of changed fields
      const changedIndex: any = [];
      // Iterate through the new array
      newArray.forEach((obj: any, index: any) => {
        const { name } = obj;
        // Check if the name of the field at the same index in the old array is different
        if (oldArray[index].name != name) {
          changedIndex.push(index);
        }
      });
      // Check if there is only one changed field
      if (changedIndex.length == 1) {
        const oldName = oldArray[changedIndex[0]]?.name;
        let fieldIndex = dashboardPanelData.data.fields.x.findIndex((it: any) => it.alias == oldName);
        // Check if the field is in the x fields array
        if (fieldIndex >= 0) {
          const newName = newArray[changedIndex[0]]?.name;
          const field = dashboardPanelData.data.fields.x[fieldIndex];

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        } else {
          // Check if the field is in the y fields array
          fieldIndex = dashboardPanelData.data.fields.y.findIndex((it: any) => it.alias == oldName);
          if (fieldIndex >= 0) {
            const newName = newArray[changedIndex[0]]?.name;
            const field = dashboardPanelData.data.fields.y[fieldIndex];

            // Update the field alias and column to the new name
            field.alias = newName;
            field.column = newName;
          }
        }
      }
    }
  };

  return {
    dashboardPanelData,
    resetDashboardPanelData,
    addXAxisItem,
    addYAxisItem,
    removeXAxisItem,
    removeYAxisItem,
    removeFilterItem,
    addFilteredItem,
    removeXYFilters,
    updateXYFieldsForCustomQueryMode,
    updateXYFieldsOnCustomQueryChange,
    isAddXAxisNotAllowed,
    isAddYAxisNotAllowed,
    promqlMode,
  };
};
export default useDashboardPanelData;
