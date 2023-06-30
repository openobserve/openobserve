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
  <div>
    <q-bar class="row sql-bar">
      <div style="flex: 1;" @click="onDropDownClick">
        <q-icon
          flat
          :name="!dashboardPanelData.layout.showQueryBar ? 'arrow_right' : 'arrow_drop_down'"
          text-color="black"
          class="q-mr-sm"
        />
        <span class="text-subtitle2 text-weight-bold">{{ t('panel.sql') }}</span>
        <q-space />
      </div>
      <div>
        <QueryTypeSelector></QueryTypeSelector>
      </div>
    </q-bar>
  </div>
  <div class="row" 
    :style="!dashboardPanelData.layout.showQueryBar ? 'height: 0px;' : 'height: auto;'"
    style="overflow: hidden;">
    <div class="col">
      <query-editor
      ref="queryEditorRef"
      class="monaco-editor"
      v-model:query="dashboardPanelData.data.query"
      v-model:fields="dashboardPanelData.meta.stream.selectedStreamFields"
      v-model:functions="dashboardPanelData.meta.stream.functions"
      @run-query="searchData"
      :readOnly="!dashboardPanelData.data.customQuery"
      ></query-editor>
      <div style="color: red;" class="q-mx-sm">{{ dashboardPanelData.meta.errors.queryErrors.join(', ') }}&nbsp;</div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, watch, reactive, toRaw, onActivated } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { Parser } from "node-sql-parser";

import ConfirmDialog from "../../components/ConfirmDialog.vue";
import QueryEditor from "./QueryEditor.vue";
import useDashboardPanelData from "../../composables/useDashboardPanel";
import QueryTypeSelector from "./addPanel/QueryTypeSelector.vue";

export default defineComponent({
  name: "ComponentSearchSearchBar",
  components: {
    QueryEditor,
    ConfirmDialog,
    QueryTypeSelector
},
  emits: ["searchdata"],
  methods: {
    searchData() {
      if (this.searchdashboardPanelData.loading == false) {
        this.$emit("searchdata");
      }
    },
  },
  setup() {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const { dashboardPanelData, updateXYFieldsOnCustomQueryChange } = useDashboardPanelData()
    const confirmQueryModeChangeDialog = ref(false)
    const parser = new Parser();
    let streamName = "";

    // toggle show query view
    const onDropDownClick= () =>{
      dashboardPanelData.layout.showQueryBar = !dashboardPanelData.layout.showQueryBar
    }

    watch(() => dashboardPanelData.layout.showQueryBar, () => {
      window.dispatchEvent(new Event("resize"))
    })

    onActivated(() => {
      dashboardPanelData.meta.errors.queryErrors = []
    })

    // Generate the query when the fields are updated
    watch(() => [
      dashboardPanelData.data.fields.stream, 
      dashboardPanelData.data.fields.x, 
      dashboardPanelData.data.fields.y,
      dashboardPanelData.data.fields.filter,
      dashboardPanelData.data.customQuery
    ], () => {
      // only continue if current mode is auto query generation
      if(!dashboardPanelData.data.customQuery){
        // console.log("Updating query");
        
        // STEP 1: first check if there is at least 1 field selected
        if(dashboardPanelData.data.fields.x.length == 0 && dashboardPanelData.data.fields.y.length == 0) {
          dashboardPanelData.data.query = ""
          return;
        }

        // STEP 2: Now, continue if we have at least 1 field selected
        // merge the fields list
        let query = "SELECT "
        const fields = [...dashboardPanelData.data.fields.x, ...dashboardPanelData.data.fields.y]
        const filter = [...dashboardPanelData.data.fields?.filter]
        const array = fields.map((field, i) => {
          let selector = ""

          // TODO: add aggregator
          if(field.aggregationFunction) {
            switch(field.aggregationFunction) {
              case "count-distinct":
                selector += `count(distinct(${field.column}))`
                break;
              default:
                selector += `${field.aggregationFunction}(${field.column})`
                break;
            }
          } else {
            selector += `${field.column}`
          }
          selector += ` as "${field.alias}"${i==fields.length-1 ? ' ' : ', '}`
          return selector
        })
        query += array.join("")

        // now add from stream name
        query += ` FROM "${dashboardPanelData.data.fields.stream}" `

        const filterData = filter?.map((field, i)=>{
          let selectFilter = ""
            if(field.type == "list" && field.values?.length > 0){
              selectFilter += `${field.column} IN (${field.values.map(it => `'${it}'`).join(', ')})`
            }else if (field.type == "condition" && field.operator != null){
              selectFilter += `${field.column} `
              if(["Is Null", "Is Not Null"].includes(field.operator)) {
                switch(field.operator) {
                  case "Is Null":
                    selectFilter += `IS NULL`
                    break;
                  case "Is Not Null":
                    selectFilter += `IS NOT NULL`
                    break;
                }
              } else if (field.value != null && field.value != '') {
                switch(field.operator) {
                  case "=":
                  case "<>":
                  case "<":
                  case ">":
                  case "<=":
                  case ">=":
                    selectFilter += `${field.operator} ${field.value}`
                    break;
                  case "Contains":
                    selectFilter += `LIKE '%${field.value}%'`
                    break;
                  case "Not Contains":
                    selectFilter += `NOT LIKE '%${field.value}%'`
                    break;
                  default:
                    selectFilter += `${field.operator} ${field.value}`
                    break;
                }
              }
              
            }
            return selectFilter
        })
        // console.log("query: filterData",filterData);
        const filterItems = filterData.filter((it: any)=> it)
        if(filterItems.length > 0) {
          query += "WHERE " + filterItems.join(" AND ")
        }

        // add group by statement
        const xAxisAlias = dashboardPanelData.data.fields.x.map((it: any)=> it.alias)
        // console.log("xAxisAlias",xAxisAlias);
        
        query += xAxisAlias.length ? " GROUP BY " + xAxisAlias.join(", ") : ''
        query += xAxisAlias.length ? " ORDER BY " + xAxisAlias.join(", ") : ''

        // console.log('generated query: ', query)

        dashboardPanelData.data.query = query
      }
    }, {deep: true})


    watch(() => [dashboardPanelData.data.query, dashboardPanelData.data.customQuery, dashboardPanelData.meta.stream.selectedStreamFields], () => {
      // console.log("query changes in search bar", dashboardPanelData.data.customQuery);

      // Only continue if the current mode is "show custom query"
      if (dashboardPanelData.data.customQuery && dashboardPanelData.data.queryType == "sql") {
        // Call the updateQueryValue function
        updateQueryValue()
      } else {
        // auto query mode selected
        // remove the custom fields from the list
        dashboardPanelData.meta.stream.customQueryFields = []
      }
    }, {deep: true})

     // This function parses the custom query and generates the errors and custom fields
    const updateQueryValue = () => {
      // store the query in the dashboard panel data
      // dashboardPanelData.meta.editorValue = value;
      // dashboardPanelData.data.query = value;

      if (dashboardPanelData.data.customQuery && dashboardPanelData.data.queryType != "promql") {
        // console.log("query: value", dashboardPanelData.data.query);

        // empty the errors
        dashboardPanelData.meta.errors.queryErrors = []

        // Get the parsed query
        try {
          dashboardPanelData.meta.parsedQuery = parser.astify(dashboardPanelData.data.query);
          // console.log(dashboardPanelData.meta.parsedQuery)
        } catch(e) {
          // console.log("error")
          // console.log(e)
          // exit as there is an invalid query
          dashboardPanelData.meta.errors.queryErrors.push("Invalid SQL Syntax")
          return null;
        }
        if(!dashboardPanelData.meta.parsedQuery) {
          return;
        }

        // We have the parsed query, now get the columns and tables
        // get the columns first
        if(Array.isArray(dashboardPanelData.meta.parsedQuery?.columns) 
            && dashboardPanelData.meta.parsedQuery?.columns?.length > 0) {
              const oldCustomQueryFields = JSON.parse(JSON.stringify(dashboardPanelData.meta.stream.customQueryFields))
          dashboardPanelData.meta.stream.customQueryFields = []
          dashboardPanelData.meta.parsedQuery.columns.forEach((item: any, index: any) => {
            let val;
            // if there is a lable, use that, else leave it
            if (item["as"] === undefined || item["as"] === null) {
              val = item["expr"]["column"];
            } else {
              val = item["as"];
            }
            if (!dashboardPanelData.meta.stream.customQueryFields.find(it => it.name == val)) {
              dashboardPanelData.meta.stream.customQueryFields.push({name: val, type: ''});
            }
          });

          // update the existing x and y axis fields
          updateXYFieldsOnCustomQueryChange(oldCustomQueryFields)
        } else {
          dashboardPanelData.meta.errors.queryErrors.push("Invalid Columns")
        }

        // now check if the correct stream is selected
        if (dashboardPanelData.meta.parsedQuery.from?.length > 0) {
          // console.log("---parsedQuery.from--------",dashboardPanelData.meta.parsedQuery.from);
    
          const streamFound = dashboardPanelData.meta.stream.streamResults.find(it => it.name == dashboardPanelData.meta.parsedQuery.from[0].table)
          if(streamFound) {
            if(dashboardPanelData.data.fields.stream != streamFound.name) {
              dashboardPanelData.data.fields.stream = streamFound.name
            }
          } else {
            dashboardPanelData.meta.errors.queryErrors.push("Invalid stream")
          }

        } else {
          dashboardPanelData.meta.errors.queryErrors.push("Stream name required")
        }
      }

    };

    const onUpdateToggle = (value) => {
      dashboardPanelData.meta.errors.queryErrors = []
    }

    return {
      t,
      router,
      updateQueryValue,
      onDropDownClick,
      dashboardPanelData,
      confirmQueryModeChangeDialog,
      onUpdateToggle
    };
  },
});
</script>

<style lang="scss" scoped>
.sql-bar {
  height: 40px !important;
  overflow: hidden;
  cursor: pointer;

  &:hover {
    background-color: #eaeaeaa5;
  }
}
</style>