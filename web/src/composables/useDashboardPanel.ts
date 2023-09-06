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
      version: 2,
      id: "",
      type: "bar",
      config: {
        title: "",
        description: "",
        show_legends: true,
        legends_position: null,
        unit: null,
        unit_custom: null,
      },
      queryType: "sql",
      queries: [
        {
          query: "",
          customQuery: false,
          fields: {
            stream: "",
            stream_type: "logs",
            x: [],
            y: [],
            z: [],
            filter: [],
          },
          config: {
            promql_legend: "",
          },
        },
      ],
    },
    layout: {
      splitter: 20,
      showQueryBar: false,
      isConfigPanelOpen: false,
      currentQueryIndex: 0
    },
    meta: {
      parsedQuery: "",
      dragAndDrop: {
        dragging: false,
        dragElement: null
      },
      errors: {
        queryErrors: []
      },
      editorValue: "",
      dateTime: {start_time: "", end_time: ""},
      filterValue: <any>[],
      stream: {
        selectedStreamFields: [],
        customQueryFields: [],
        functions: [],
        streamResults: <any>[],
        filterField: "",
      },
    }
  }
)

let dashboardPanelData = reactive({ ...getDefaultDashboardPanelData()});

const useDashboardPanelData = () => {
  const store = useStore();
  const $q = useQuasar();

const addQuery = () => {
  const newQuery:any = {
    query: "",
    customQuery: true,
    fields: {
      stream: dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream,
      stream_type: dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream_type,
      x: [],
      y: [],
      z:[],
      filter: [],
    },
    config: {
      promql_legend: "",
    },
  }
  dashboardPanelData.data.queries.push(newQuery);
};

const removeQuery = (index: number) => {
  dashboardPanelData.data.queries.splice(index,1);
}

  const resetDashboardPanelData = () => {
    console.log("resetDashboardPanelData");
    
    Object.assign(dashboardPanelData, getDefaultDashboardPanelData());
    console.log("updated...",dashboardPanelData);
  };

  const generateLabelFromName = (name: string) => {
    return name.replace(/[\_\-\s\.]/g,' ').split(' ').map(string => string.charAt(0).toUpperCase() + string.slice(1)).filter(it => it).join(' ')
  }

  const promqlMode = computed(() => dashboardPanelData.data.queryType == "promql")

  const isAddXAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case 'pie':
      case 'donut':
      case 'heatmap':
        return dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length >= 1
      case 'metric':
        return dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length >= 0
      case 'table':
        return false
      default:
        return dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length >= 2;
    }
  })

  const isAddYAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "pie":
      case "donut":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      case "metric":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      case "area-stacked":
      case "stacked":
      case "heatmap":
      case "h-stacked":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      default:
        return false;
    }
  })

  const isAddZAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "heatmap":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.z.length >= 1
        );
      default:
        return false;
    }
  });

  const addXAxisItem = (row: any) => {
    if(!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x = []
    }

    if(isAddXAxisNotAllowed.value){
      return;
    }

    // check for existing field
    if(!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.find((it:any) => it.column == row.name)) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.push({
        label: !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery ? generateLabelFromName(row.name) : row.name,
        alias: !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery ? 'x_axis_' + (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length + 1) : row.name,
        column: row.name,
        color: null,
        aggregationFunction: (row.name == store.state.zoConfig.timestamp_column) ? 'histogram' : null
      })
    }
    updateArrayAlias()
  }

  const addYAxisItem = (row: any) => {
    if(!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y = []
    }

    if(isAddYAxisNotAllowed.value){
      return;
    }

    if(!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.find((it:any) => it.column == row.name)) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.push({
        label: !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery ? generateLabelFromName(row.name) : row.name,
        alias: !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery ? 'y_axis_' + (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.length + 1) : row.name,
        column: row.name,
        color: getNewColorValue(),
        aggregationFunction: dashboardPanelData.data.type == 'heatmap' ? null : 'count'
      })
    }
    updateArrayAlias()
  }

  const addZAxisItem = (row: any) => {
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z = [];
    }

    if (isAddZAxisNotAllowed.value) {
      return;
    }

    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z.find((it: any) => it.column == row.name)
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z.push({
        label: !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery
          ? generateLabelFromName(row.name)
          : row.name,
        alias: !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery
          ? "z_axis_" +
            (dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.z.length +
              1)
          : row.name,
        column: row.name,
        color: getNewColorValue(),
        aggregationFunction: "count",
      });
    }
    updateArrayAlias();
  };

  // get new color value based on existing color from the chart
  const getNewColorValue = () => {
   const YAxisColor = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.map((it: any)=> it.color)
   let newColor = colors.filter((el:any) => !YAxisColor.includes(el));
    if(!newColor.length){
      newColor = colors
    }
    return newColor[0]
  }

  const resetAggregationFunction = () => {
    switch (dashboardPanelData.data.type) {
      case "heatmap":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y.forEach((itemY) => {
          itemY.aggregationFunction = null;
        })
        break;

        case "area":
        case "area-stacked":
        case "bar":
        case "line":
        case "scatter":
        case "pie":
        case "donut":
        case "h-bar":
        case "stacked":
        case "h-stacked":
        case "metric":
        case "table":
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.forEach((itemY) => {
            if (itemY.aggregationFunction === null) {
              itemY.aggregationFunction = "count";
            }
          });
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.z = [];
      break;

      default:
        break;
    };
    
    // aggregation null then count 
    };

  // update X or Y axis aliases when new value pushes into the X and Y axes arrays
  const updateArrayAlias = () => {
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.forEach((it:any, index:any) => it.alias = !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery ? 'x_axis_' + (index + 1) : it.column )
    dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.forEach((it:any, index:any) => it.alias = !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery ? 'y_axis_' + (index + 1) : it.column )
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.z.forEach(
      (it: any, index: any) =>
        (it.alias = !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery
          ? "z_axis_" + (index + 1)
          : it.column)
    );
  }

  const removeXAxisItem = (name: string) => {
    const index = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.findIndex((it:any) => it.column == name)
    if(index >= 0) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.splice(index, 1)
    }
  }

  const removeYAxisItem = (name: string) => {
    const index = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.findIndex((it:any) => it.column == name)
    if(index >= 0) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.splice(index, 1)
    }
  }

  const removeZAxisItem = (name: string) => {
    const index = dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.z.findIndex((it: any) => it.column == name);
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z.splice(index, 1);
    }
  };

  const removeFilterItem = (name: string) => {
    const index = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter.findIndex((it:any) => it.column == name)
    if(index >= 0) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter.splice(index, 1)
    }
  }

  const addFilteredItem = (name: string) => {
    // console.log("name=", name);
    if (!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter = [];
    }

    if (
      !dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter.find(
        (it: any) => it.column == name
      )
    ) {
      // console.log("data");

      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter.push({
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
        stream_name: dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream,
        start_time:  new Date(dashboardPanelData.meta.dateTime["start_time"].toISOString()).getTime() * 1000,
        end_time:  new Date(dashboardPanelData.meta.dateTime["end_time"].toISOString()).getTime() * 1000,
        fields: [name],
        size: 10,
        type: dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream_type
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


const loadFilterItem = (name:any)=>{
  StreamService
      .fieldValues({
        org_identifier: store.state.selectedOrganization.identifier,
        stream_name: dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream,
        start_time:  new Date(dashboardPanelData.meta.dateTime["start_time"].toISOString()).getTime() * 1000,
        end_time:  new Date(dashboardPanelData.meta.dateTime["end_time"].toISOString()).getTime() * 1000,
        fields: [name],
        size: 10,
        type: dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream_type
      })
      .then((res:any) => {
        const find = dashboardPanelData.meta.filterValue.findIndex((it: any) => it.column == name)
        if (find >= 0) {
          dashboardPanelData.meta.filterValue.splice(find, 1);
        }
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
    if (promqlMode.value || dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery == false) {
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.splice(0,dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length);
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.splice(0,dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.length);
      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter.splice(0,dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter.length);
    }
  }

  // This function updates the x and y fields of a custom query in the dashboard panel data
  const updateXYFieldsForCustomQueryMode = () => {
    // Check if the custom query is enabled and PromQL mode is disabled
    if (!promqlMode.value &&dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery == true) {
      // Loop through each custom query field in the dashboard panel data's stream meta
      dashboardPanelData.meta.stream.customQueryFields.forEach((it: any, index: number) => {
        // Determine if the current field is an x or y field
        const currentFieldType = index < dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length ? "x" : "y";
        // Get the current field based on its index and whether it's an x or y field
        const field = index < dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length
            ? dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x[index]
            : dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[index -dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length];
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
        let fieldIndex = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.findIndex((it: any) => it.alias == oldName);
        // Check if the field is in the x fields array
        if (fieldIndex >= 0) {
          const newName = newArray[changedIndex[0]]?.name;
          const field =dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x[fieldIndex];

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        } else {
          // Check if the field is in the y fields array
          fieldIndex = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.findIndex((it: any) => it.alias == oldName);
          if (fieldIndex >= 0) {
            const newName = newArray[changedIndex[0]]?.name;
            const field =dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[fieldIndex];

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
    addZAxisItem,
    removeXAxisItem,
    removeYAxisItem,
    removeZAxisItem,
    removeFilterItem,
    addFilteredItem,
    loadFilterItem,
    removeXYFilters,
    updateXYFieldsForCustomQueryMode,
    updateXYFieldsOnCustomQueryChange,
    isAddXAxisNotAllowed,
    isAddYAxisNotAllowed,
    isAddZAxisNotAllowed,
    promqlMode,
    addQuery,
    removeQuery,
    resetAggregationFunction,
  };
};
export default useDashboardPanelData;
