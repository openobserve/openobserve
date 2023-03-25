// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { reactive } from "vue";
import queryService from "../services/nativequery"
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

const getDefaultDashboardPanelData = () => (
  {
    data: {
      id: "",
      type: "bar",
      fields: {
        stream: '',
        x: <any>[],
        y: <any>[],
        filter: <any>[]
      },
      config: {
        title: "",
        description: "",
        show_legends: true,
      },
      query: "",
      customQuery: false
    },
    layout: {
      splitter: 20
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
      dateTime: {},
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

  const resetDashboardPanelData = () => {
    Object.assign(dashboardPanelData, getDefaultDashboardPanelData());
    // console.log("updated...",dashboardPanelData);
  };

  const generateLabelFromName = (name: string) => {
    return name.replace(/[\_\-\s\.]/g,' ').split(' ').map(string => string.charAt(0).toUpperCase() + string.slice(1)).filter(it => it).join(' ')
  }

  const addXAxisItem = (name: string) => {
    if(!dashboardPanelData.data.fields.x) {
      dashboardPanelData.data.fields.x = []
    }

    // TODO: condition for all chart type
    if(dashboardPanelData.data.fields.x.length >= 1){
      return;
    } 

    // check for existing field
    if(!dashboardPanelData.data.fields.x.find((it:any) => it.column == name)) {
      dashboardPanelData.data.fields.x.push({
        label: !dashboardPanelData.data.customQuery ? generateLabelFromName(name) : name,
        alias: !dashboardPanelData.data.customQuery ? 'x_axis_' + (dashboardPanelData.data.fields.x.length + 1) : name,
        column: name,
        color: null,
        aggregationFunction: (name == '_timestamp') ? 'histogram' : null
      })
    }
  }

  const addYAxisItem = (name: string) => {
    if(!dashboardPanelData.data.fields.y) {
      dashboardPanelData.data.fields.y = []
    }

    if(!dashboardPanelData.data.fields.y.find((it:any) => it.column == name)) {
      dashboardPanelData.data.fields.y.push({
        label: !dashboardPanelData.data.customQuery ? generateLabelFromName(name) : name,
        alias: !dashboardPanelData.data.customQuery ? 'y_axis_' + (dashboardPanelData.data.fields.y.length + 1) : name,
        column: name,
        color: colors[dashboardPanelData.data.fields.y.length % colors.length],
        aggregationFunction: 'count'
      })
    }
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

    if (
      !dashboardPanelData.meta.filterValue.find(
        (it: any) => it.column == name
      )
    ) {
      let queryData = "SELECT ";

      // get unique value of the selected fields
      queryData += `${name} as value`;

      //now add the selected stream
      queryData += ` FROM '${dashboardPanelData.data.fields.stream}'`;

      // console.log("queryData= ", queryData);
      // add group by statement
      queryData += ` GROUP BY value`;

      const query = {
        query: { sql: queryData, sql_mode: "full" },
      };

      queryService
        .runquery(query, store.state.selectedOrganization.identifier)
        .then((res) => {

          dashboardPanelData.meta.filterValue.push({
            column: name,
            value: res.data.hits
              .map((it: any) => it.value)
              .filter((it: any) => it),
          });

        })
        .catch((error) => {
          $q.notify({
            type: "negative",
            message: "Something went wrong!",
            timeout: 5000,
          });
        });
    }
  }

  const removeXYFilters = () => {
    dashboardPanelData.data.fields.x.splice(0,dashboardPanelData.data.fields.x.length)
    dashboardPanelData.data.fields.y.splice(0,dashboardPanelData.data.fields.y.length)
    dashboardPanelData.data.fields.filter.splice(0,dashboardPanelData.data.fields.filter.length)
  }

  return { 
    dashboardPanelData, 
    resetDashboardPanelData, 
    addXAxisItem, 
    addYAxisItem,
    removeXAxisItem,
    removeYAxisItem,
    removeFilterItem,
    addFilteredItem,
    removeXYFilters
  };
};

export default useDashboardPanelData;
