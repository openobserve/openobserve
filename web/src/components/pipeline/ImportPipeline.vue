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
    <div class="q-mt-md " >
      <div class="flex q-mx-md items-center no-wrap">
        <div class="col">
          <div class="flex">
            <q-btn
              no-caps
              padding="xs"
              outline
              @click="router.back()"
              icon="arrow_back_ios_new"
              data-test="pipeline-import-back-btn"
            />
            <div class="text-h6 q-ml-md">Import Pipeline</div>
          </div>
        </div>
        <div class="flex justify-center">
          <q-btn
            v-close-popup
            class="text-bold q-mr-md"
            :label="t('function.cancel')"
            text-color="light-text"
            padding="sm xl"
            no-caps
            @click="router.back()"
            data-test="pipeline-import-cancel-btn"
          />
          <q-btn
            class="text-bold no-border"
            :label="t('dashboard.import')"
            color="secondary"
            type="submit"
            padding="sm xl"
            no-caps
            @click="importJson"
            data-test="pipeline-import-json-btn"
          />
        </div>
      </div>
  
      <q-separator class="q-my-sm q-mx-md" />
    </div>
    <div class="flex">
      <div class="report-list-tabs flex items-center justify-center q-mx-md">
        <app-tabs
          data-test="pipeline-import-tabs"
          class="q-mr-md"
          :tabs="tabs"
          v-model:active-tab="activeTab"
          @update:active-tab="updateActiveTab"
        />
      </div>
  
      <div class="flex" style="width: calc(100% - 20px);" >
        <q-splitter
          class="logs-search-splitter"
          no-scroll
          v-model="splitterModel"
          style="width: calc(95vw - 20px); height: 100%"
        >
          <template #before>
            <div
              v-if="activeTab == 'import_json_url'"
              class="editor-container-url"
            >
              <q-form class="q-mx-md q-mt-md" @submit="onSubmit">
                <div style="width: 100%" class="q-mb-md">
                  <q-input
                    data-test="pipeline-import-url-input"
                    v-model="url"
                    :label="t('dashboard.addURL')"
                    color="input-border"
                    bg-color="input-bg"
                    stack-label
                    filled
                    label-slot
                  />
                </div>
                <query-editor
                  data-test="pipeline-import-sql-editor"
                  ref="queryEditorRef"
                  editor-id="pipeline-import-query-editor"
                  class="monaco-editor"
                  :debounceTime="300"
                  v-model:query="jsonStr"
                  language="json"
                  :class="
                    jsonStr == '' && queryEditorPlaceholderFlag
                      ? 'empty-query'
                      : ''
                  "
                  @focus="queryEditorPlaceholderFlag = false"
                  @blur="queryEditorPlaceholderFlag = true"
                />
  
                <div></div>
              </q-form>
            </div>
            <div
              v-if="activeTab == 'import_json_file'"
              class="editor-container-json"
            >
              <q-form class="q-mx-md q-mt-md" @submit="onSubmit">
                <div style="width: 100%" class="q-mb-md">
                  <q-file
                    data-test="pipeline-import-json-file-input"
                    v-model="jsonFiles"
                    filled
                    bottom-slots
                    :label="t('dashboard.dropFileMsg')"
                    accept=".json"
                    multiple
                  >
                    <template v-slot:prepend>
                      <q-icon name="cloud_upload" @click.stop.prevent />
                    </template>
                    <template v-slot:append>
                      <q-icon
                        name="close"
                        @click.stop.prevent="jsonFiles = null"
                        class="cursor-pointer"
                      />
                    </template>
                    <template v-slot:hint> .json files only </template>
                  </q-file>
                </div>
                <query-editor
                  data-test="pipeline-import-sql-editor"
                  ref="queryEditorRef"
                  editor-id="pipeline-import-query-editor"
                  class="monaco-editor"
                  :debounceTime="300"
                  v-model:query="jsonStr"
                  language="json"
                  :class="
                    jsonStr == '' && queryEditorPlaceholderFlag
                      ? 'empty-query'
                      : ''
                  "
                  @focus="queryEditorPlaceholderFlag = false"
                  @blur="queryEditorPlaceholderFlag = true"
                />
  
                <div></div>
              </q-form>
            </div>
          </template>
          <template #after>
            <div
              data-test="pipeline-import-output-editor"
              style="width: 100%; height: 100%"
            >
              <div
                v-if="pipelineErrorsToDisplay.length > 0"
                class="text-center text-h6"
              >
                Error Validations
              </div>
              <div v-else class="text-center text-h6">Output Messages</div>
              <q-separator class="q-mx-md q-mt-md" />
              <div class="error-report-container">
                <!-- Pipeline Errors Section -->
                <div class="error-section" v-if="pipelineErrorsToDisplay.length > 0">
                  <div class="error-list">
                    <!-- Iterate through the outer array -->
                    <div
                      v-for="(errorGroup, index) in pipelineErrorsToDisplay"
                      :key="index"
                      :data-test="`pipeline-import-error-${index}`"
                    >
                      <!-- Iterate through each inner array (the individual error message) -->
                      <div
                        v-for="(errorMessage, errorIndex) in errorGroup"
                        :key="errorIndex"
                        class="error-item"
                        :data-test="`pipeline-import-error-${index}-${errorIndex}`"
                      >
                      <!-- pipeline name should not be empty -->
                        <span
                          class="text-red"
                          v-if="
                            typeof errorMessage === 'object' &&
                            errorMessage.field == 'pipeline_name'
                          "
                        >
                          {{ errorMessage.message }}
  
                          <div style="width: 300px">
                            <q-input
                              data-test="pipeline-import-name-input"
                              v-model="userSelectedPipelineName[index]"
                              :label="t('alerts.name') + ' *'"
                              color="input-border"
                              bg-color="input-bg"
                              class="showLabelOnTop"
                              stack-label
                              outlined
                              filled
                              dense
                              tabindex="0"
                              @update:model-value="
                                updatePipelineName(userSelectedPipelineName[index],index)
                              "
                            />
                          </div>
                        </span>
                        <!-- source stream name should not be empty -->
                        <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'source_stream_name'
                        "
                      >
                        {{ errorMessage.message }}
                        <div style="width: 300px">
                          <q-select
                            data-test="pipeline-import-source-stream-name-input"
                            v-model="userSelectedStreamName[index]"
                            :options="streamList"
                            :label="t('alerts.stream_name') + ' *'"
                            :popup-content-style="{
                              textTransform: 'lowercase',
                            }"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            filled
                            stack-label
                            dense
                            use-input
                            hide-selected
                            fill-input
                            :input-debounce="400"
                            @update:model-value="updateStreamFields(userSelectedStreamName[index], index)"
                            behavior="menu"
                            @input-value="handleDynamicStreamName($event, index)"
                          >
                            <template v-slot:option="scope">
                              <q-item v-bind="scope.itemProps">
                                <q-item-section>
                                  <q-item-label :class="{ 'text-grey-6': scope.opt.disable }">
                                    {{ scope.opt.label }}
                                  </q-item-label>
                                </q-item-section>
                              </q-item>
                            </template>
                          </q-select>
                        </div>
                      </span>
                      <!-- source stream type should be one of the valid stream types -->
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'source_stream_type'
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <q-select
                            data-test="pipeline-import-source-stream-type-input"
                            v-model="userSelectedStreamType[index]"
                            :options="streamTypes"
                            :label="t('alerts.streamType') + ' *'"
                            :popup-content-style="{ textTransform: 'lowercase' }"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            stack-label
                            outlined
                            filled
                            dense
                            @update:model-value="getSourceStreamsList(userSelectedStreamType[index],index)"
                            :rules="[(val: any) => !!val || 'Field is required!']"
                            style="width: 300px"
                          />
                        </div>
                      </span>
                      <!-- sql query should be same across all nodes as well try to match the query in the nodes -->
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'sql_query_missing'
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <query-editor
                            style="width: 100%; height: 200px"
                            data-test="pipeline-import-sql-query-input"
                            v-model:query="userSelectedSqlQuery[index]"
                            :label="'SQL Query'"
                            :debounceTime="300"
                            language="sql"
                            @update:query="updateSqlQuery(userSelectedSqlQuery[index], index)"
                          />
                        </div>
                      </span>  
                      <!-- destination stream type should be one of the valid stream types -->
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          (errorMessage.field == 'destination_stream_type')
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <q-select
                            data-test="pipeline-import-destination-stream-type-input"
                            v-model="userSelectedDestinationStreamType[index]"
                            :options="destinationStreamTypes"
                            :label="t('alerts.streamType') + ' *'"
                            :popup-content-style="{ textTransform: 'lowercase' }"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            stack-label
                            outlined
                            filled
                            dense
                            @update:model-value="getDestinationStreamsList(userSelectedDestinationStreamType[index],index)"
                            :rules="[(val: any) => !!val || 'Field is required!']"
                            style="width: 300px"
                          />
                        </div>
                      </span>
                      <!-- destination stream name should not be empty -->
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field == 'org_id'
                        "
                      >
                        {{ errorMessage.message }}
                        <div style="width: 300px">
                          <q-select
                            data-test="pipeline-import-org-id-input"
                            v-model="userSelectedOrgId[index]"
                            :options="organizationData"
                            :label="'Organization Id'"
                            :popup-content-style="{
                              textTransform: 'lowercase',
                            }"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            filled
                            stack-label
                            dense
                            use-input
                            hide-selected
                            fill-input
                            :input-debounce="400"
                            @update:model-value="updateOrgId(userSelectedOrgId[index].value, index)"
                            behavior="menu"
                          >
                          </q-select>
                        </div>
                      </span>
                      <!-- source stream type should be one of the valid stream types -->
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          errorMessage.field.startsWith('function_name')
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <q-select
                            data-test="pipeline-import-destination-function-name-input"
                            v-model="userSelectedFunctionName[errorMessage.nodeIndex]"
                            :options="existingFunctions"
                            :label="'Function Name'"
                            :popup-content-style="{ textTransform: 'lowercase' }"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            stack-label
                            outlined
                            filled
                            dense
                            @update:model-value="updateFunctionName(userSelectedFunctionName[errorMessage.nodeIndex], index, errorMessage.nodeIndex)"
                            :rules="[(val: any) => !!val || 'Field is required!']"
                            style="width: 300px"
                          />
                        </div>
                      </span>

                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          (errorMessage.field == 'remote_destination')
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <q-select
                            data-test="pipeline-import-destination-stream-type-input"
                            v-model="userSelectedRemoteDestination[index]"
                            :options="pipelineDestinations"
                            :label="'Remote Destination'"
                            :popup-content-style="{ textTransform: 'lowercase' }"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            stack-label
                            outlined
                            filled
                            dense
                            @update:model-value="updateRemoteDestination(userSelectedRemoteDestination[index],index)"
                            :rules="[(val: any) => !!val || 'Field is required!']"
                            style="width: 300px"
                          />
                        </div>
                      </span>
                      <span
                        class="text-red"
                        v-else-if="
                          typeof errorMessage === 'object' &&
                          (errorMessage.field == 'source_timezone')
                        "
                      >
                        {{ errorMessage.message }}
                        <div>
                          <q-select
                            data-test="pipeline-import-destination-stream-type-input"
                            v-model="userSelectedTimezone[index]"
                            :options="timezoneOptions"
                            :label="'Timezone'"
                            color="input-border"
                            bg-color="input-bg"
                            class="q-py-sm showLabelOnTop no-case"
                            stack-label
                            outlined
                            filled
                            dense
                            @update:model-value="updateTimezone(userSelectedTimezone[index],index)"
                            :rules="[(val: any) => !!val || 'Field is required!']"
                            style="width: 300px"
                          />
                        </div>
                      </span>
                        <span v-else>{{ errorMessage }}</span>
                      </div>
                    </div>
                  </div>
                </div>
  
                <div class="error-section" v-if="pipelineCreators.length > 0">
                  <div class="section-title text-primary" data-test="pipeline-import-creation-title">Pipeline Creation</div>
                  <div
                    class="error-list"
                    v-for="(val, index) in pipelineCreators"
                    :key="index"
                    :data-test="`pipeline-import-creation-${index}`"
                  >
                  <div
                    :class="{
                      'error-item text-bold': true,
                      'text-green': val.success,
                      'text-red': !val.success,
                    }"
                    style="white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word;"
                    :data-test="`pipeline-import-creation-${index}-message`"
                  >
                    <pre style="white-space: pre-wrap; word-break: break-word;">{{ val.message }}</pre>
                  </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </q-splitter>
      </div>
    </div>
  </template>
  
  <script lang="ts">
  import {
    defineComponent,
    ref,
    onMounted,
    reactive,
    computed,
    watch,
  } from "vue";
  import { useI18n } from "vue-i18n";
  import { useStore } from "vuex";
  import { useRouter, useRoute } from "vue-router";
  import axios from "axios";
  import router from "@/router";
  import { useQuasar } from "quasar";
  import pipelinesService from "../../services/pipelines";
  import QueryEditor from "../QueryEditor.vue";
  import useStreams from "@/composables/useStreams";
  import destinationService from "@/services/alert_destination";
  import AppTabs from "../common/AppTabs.vue";
  import jstransform from "@/services/jstransform";
  
  export default defineComponent({
    name: "ImportPipeline",
    props: {
      destinations: {
        type: Array,
        default: () => [],
      },
      templates: {
        type: Array,
        default: () => [],
      },
      alerts: {
        type: Array,
        default: () => [],
      },
    },
    emits: ["update:pipelines"],
    setup(props, { emit }) {
      type ErrorMessage = {
        field: string;
        message: string;
        nodeIndex?: any;
        currentValue?: string;
      };
      type alertCreator = {
        message: string;
        success: boolean;
      }[];
  
      type AlertErrors = (ErrorMessage | string)[][];
      const { t } = useI18n();
      const store = useStore();
      const router = useRouter();
      const route = useRoute();
  
      const jsonStr: any = ref("");
      const q = useQuasar();
      const { getStreams } = useStreams();
  
      const templateErrorsToDisplay = ref([]);
  
      const destinationErrorsToDisplay = ref([]);
  
      const pipelineErrorsToDisplay = ref<AlertErrors>([]);
      const userSelectedDestinations = ref<string[][]>([]);
      const userSelectedPipelineName = ref<string[]>([]);
  
      const tempalteCreators = ref([]);
      const destinationCreators = ref([]);
      const pipelineCreators = ref<alertCreator>([]);
      const queryEditorPlaceholderFlag = ref(true);
      const streamList = ref<any>([]);
      const streamData = ref<any>([]);
      const userSelectedStreamName = ref<string[]>([]);
      const userSelectedDestinationStreamName = ref<string[]>([]);
      const userSelectedStreamType = ref<string[]>([]);
      const userSelectedDestinationStreamType = ref<string[]>([]);
      const userSelectedRemoteDestination = ref<string[]>([]);
      const jsonFiles = ref(null);

      const url = ref("");
      const jsonArrayOfObj: any = ref([{}]);
      const streams = ref<any>({});
      const activeTab = ref("import_json_file");
      const splitterModel = ref(60);
      const filteredDestinations = ref<string[]>([]);
      const streamTypes = ["logs", "metrics", "traces"];
      const destinationStreamTypes = ["logs", "metrics", "traces","enrichment_tables"];
      const existingFunctions = ref<any>([]);
      const pipelineDestinations = ref<any>([]);
      const alertDestinations = ref<any>([]);
      const userSelectedSqlQuery = ref<string[]>([]);
      const userSelectedFunctionName = ref<any[]>([]);
      const scheduledPipelines = ref<any>([]);
      const userSelectedOrgId = ref<any[]>([]);
      const organizationData = computed(() => {
        return store.state.organizations.map((org: any) => {
          return {
            label: org.identifier,
            value: org.identifier,
            disable: !org.identifier || org.identifier !== store.state.selectedOrganization.identifier
          };
        });
      });

      const getFormattedDestinations: any = computed(() => {
        return props.destinations.map((destination: any) => {
          return destination.name;
        });
      });
  
      const userSelectedTimezone = ref<string[]>([]);
  
      // @ts-ignore
      let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz: any) => {
        return tz;
      });
      const filteredTimezone = ref<any>([]);
        filteredTimezone.value = [...timezoneOptions];
  
        const browserTime =
        "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";
  
       // Add the UTC option
        timezoneOptions.unshift("UTC");
        timezoneOptions.unshift(browserTime);
  
      const updateUserSelectedDestinations = (destinations: string[], index: number) => {
        jsonArrayOfObj.value[index].destinations = destinations;
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      }
      const updateSqlQuery = (sqlQuery: string, index: number) => {
        
        jsonArrayOfObj.value[index].sql_query = sqlQuery;
        jsonArrayOfObj.value[index].source.query_condition.sql = sqlQuery;
        jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
          if(node.io_type == "input" && node.data.query_condition.type == "sql"){
            node.data.query_condition.sql = sqlQuery;
          }
        });
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      }
  
      const updateStreamFields = (streamName: any, index: number) => {
        const stream_name = streamName.value
        jsonArrayOfObj.value[index].source.stream_name = stream_name;
        jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
          if(node.io_type == "input"){
            node.data.stream_name = stream_name;
          }
        });
        jsonArrayOfObj.value[index].edges.forEach((edge: any) => {
          if(edge.hasOwnProperty('sourceNode')){
            edge.sourceNode.data.stream_name = stream_name;
          }
        });
        jsonArrayOfObj.value[index].stream_name = stream_name;
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
        
      };

      const updateRemoteDestination = (remoteDestination: string, index: number) => {
        jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
          if(node.data.node_type == "remote_stream"){
            node.data.destination_name = remoteDestination;
          }
        });
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      }

      const updateDestinationStreamFields = (streamName: any, index: number) => {
        jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
          if(node.io_type == "output"){
            node.data.stream_name = streamName;
          }
        }); 
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      }
  
      const updatePipelineName = (pipelineName: string, index: number) => {
        jsonArrayOfObj.value[index].name = pipelineName;
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      };
      //this function helps in updating the function name in the pipeline
      //we use the pipelineIndex to get the correct pipeline and the nodeIndex to get the correct node
      //we use the nodeIndex to push the error to the correct node

      const updateFunctionName = (functionName: any, pipelineIndex: any, nodeIndex: any) => {
        const node = jsonArrayOfObj.value[pipelineIndex].nodes[nodeIndex];
        
        if (
          node &&
          node.io_type === "default" &&
          node.data.node_type === "function"
        ) {
          node.data.name = functionName;
        }

        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      };

  
      watch(jsonFiles, async (newVal:any, oldVal:any) => {
        if (newVal && newVal.length > 0) {
          let combinedJson: any[] = [];
          
          for (const file of newVal) {
            try {
              const result: any = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e: any) => {
                  try {
                    const parsedJson = JSON.parse(e.target.result);
                    // Convert to array if it's a single object
                    const jsonArray = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
                    resolve(jsonArray);
                  } catch (error) {
                    q.notify({
                      message: `Error parsing JSON from file ${file.name}`,
                      color: "negative",
                      position: "bottom",
                      timeout: 2000,
                    });
                    resolve([]);
                  }
                };
                reader.readAsText(file);
              });
              
              combinedJson = [...combinedJson, ...result];
            } catch (error) {
              console.error('Error reading file:', error);
            }
          }
          
          // Update the refs with combined JSON data
          jsonArrayOfObj.value = combinedJson;
          jsonStr.value = JSON.stringify(combinedJson, null, 2);
        }
      });
      watch(url, async (newVal, oldVal) => {
        try {
          if (newVal) {
            const response = await axios.get(newVal);
  
            // Check if the response body is valid JSON
            try {
              if (
                response.headers["content-type"].includes("application/json") ||
                response.headers["content-type"].includes("text/plain")
              ) {
                jsonStr.value = JSON.stringify(response.data, null, 2);
                jsonArrayOfObj.value = response.data;
              } else {
                q.notify({
                  message: "Invalid JSON format in the URL",
                  color: "negative",
                  position: "bottom",
                  timeout: 2000,
                });
              }
            } catch (parseError) {
              // If parsing fails, display an error message
              q.notify({
                message: "Invalid JSON format",
                color: "negative",
                position: "bottom",
                timeout: 2000,
              });
            }
          }
        } catch (error) {
          q.notify({
            message: "Error fetching data",
            color: "negative",
            position: "bottom",
            timeout: 2000,
          });
        }
      });
  
      const tabs = reactive([
        {
          label: "File Upload / JSON",
          value: "import_json_file",
        },
        {
          label: "URL Import",
          value: "import_json_url",
        },
      ]);
  
      const updateActiveTab = () => {
        jsonStr.value = "";
        jsonFiles.value = null;
        url.value = "";
        jsonArrayOfObj.value = [{}];
      };
  
      onMounted(async () => {
        await getFunctions();
        await getAlertDestinations();
        await getPipelineDestinations();
        await getScheduledPipelines();
      });

      const getFunctions = async () => {
        const functions = await jstransform.list(1, 100, "created_at", true, "", store.state.selectedOrganization.identifier);
        existingFunctions.value = functions.data.list.map((fun: any)=>{
          return fun.name;
        });
      }
      const getPipelineDestinations = async () => {
        const destinations = await destinationService.list({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          org_identifier: store.state.selectedOrganization.identifier,
          module: "pipeline",
        });
        pipelineDestinations.value = destinations.data.map((dest: any)=>{
          return dest.name;
        });
      }
      const getAlertDestinations = async () => {
        const destinations = await destinationService.list({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false, 
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        });
        alertDestinations.value = destinations.data.map((dest: any)=>{
          return dest.name;
        });
      }
      
  
      const importJson = async () => {
        pipelineErrorsToDisplay.value = [];
        pipelineCreators.value = [];
  
        try {
          // Check if jsonStr.value is empty or null
          if ((!jsonStr.value || jsonStr.value.trim() === "") && !url.value) {
            throw new Error("JSON string is empty");
          } else {
            const parsedJson = JSON.parse(jsonStr.value);
            // Convert single object to array if needed
            jsonArrayOfObj.value = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
          }
        } catch (e: any) {
          q.notify({
            message: e.message || "Invalid JSON format",
            color: "negative",
            position: "bottom", 
            timeout: 2000,
          });
          return;
        }
  
        let allPipelinesCreated = true;
        // Now we can always process as an array
        for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
          const success = await processJsonObject(jsonObj, index + 1);
          if (!success) {
            allPipelinesCreated = false;
          }
        }
  
        if (allPipelinesCreated) {
          setTimeout(() => {
            emit("update:pipelines");
          q.notify({
            message: "Pipelines(s) imported successfully",
            color: "positive",
            position: "bottom",
            timeout: 2000,
          });
          router.push({
            name: "pipelines",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
            },
          });
          }, 3000);


        }
      };
  
      const processJsonObject = async (jsonObj: any, index: number) => {
        try {
          const isValidPipeline = await validatePipelineInputs(jsonObj, index);
          if (!isValidPipeline) {
            return false;
          }
  
          if (pipelineErrorsToDisplay.value.length === 0 ) {
            return await createPipeline(jsonObj, index);
          }
        } catch (e: any) {
          q.notify({
            message: "Error importing Pipeline(s) please check the JSON",
            color: "negative",
            position: "bottom",
            timeout: 2000,
          });
          return false;
        }
        return false;
      };

      const validateSourceStream = async (streamName: string, streamList: any[]) => {
        const response = await pipelinesService.getPipelineStreams(store.state.selectedOrganization.identifier);
        const usedStreams = response.data.list;
        if(streamName && streamList.length == 0){
        return usedStreams.some((stream: any) => { 
          return stream.stream_name === streamName});
        }
        else{
          const usedStreamNames = usedStreams.map((stream: any) => stream.stream_name);
          const filteredStreamList = streamList.filter((stream: any) => usedStreamNames.includes(stream));
          return filteredStreamList;
        }
      }

      const validateDestinationStream = async (streamType: string, streamName: string) => {
        try {
          
          // Fetch streams
          const response: any = await getStreams(streamType, false);
          
          // Ensure response contains the expected data
          if (response && Array.isArray(response.list)) {
            const streams = response.list;

            // Check if the stream with the given name exists
            return streams.some((stream: any) => stream.name === streamName);
          } else {
            // If the response structure is not as expected
            console.error("Invalid response structure", response);
            return false;
          }
        } catch (error) {
          // Handle error, e.g., if the API call fails
          console.error("Error fetching streams:", error);
          return false;
        }
      };


      const validateScheduledPipelineNodes = async (input: any, sqlQuery: string) => {
        if(input.source.source_type == 'realtime'){
          return true;
        }
        if (sqlQuery) {
          // Using `some()` to return `false` if condition is met
          return input.nodes.some((node: any) => {
            return node.io_type == "input" && 
                  node.data.query_condition.type == 'sql' && 
                  node.data.query_condition.sql !== sqlQuery;
          }) ? false : true; // If condition is met (returns true), return false, otherwise return true
        } else {
          // Check for nodes with "input" type and missing sql query
          if (input.nodes.some((node: any) => {
            return node.io_type === "input" && 
                  node.data.query_condition.type === 'sql' && 
                  !node.data.query_condition.sql;
          })) {
            return false;
          }
          return true;
        }
      };
      const validateNodesForOrg = (input: any) => {
        return input.nodes.some((node: any) => {
          const isFunction = node.data.node_type === 'function';
          const isCondition = node.data.node_type === 'condition';
          const orgId = node.data.org_id;
          const selectedOrgId = store.state.selectedOrganization.identifier;

          return !isFunction && !isCondition && (!orgId || orgId !== selectedOrgId);
        }) ? false : true;
      };



  
      const validatePipelineInputs = async (input: any, index: number) => {
        let pipelineErrors: (string | { message: string; field: string; nodeIndex?: number; currentValue?: string })[] = [];

        // 1. validate name it should not be empty 
        if(!input.name.trim() || input.name.trim() === ""){
          pipelineErrors.push({ message: `Pipeline - ${index}: Name is required`, field: "pipeline_name" });
        }
        //2. validate source stream type it should be one of the valid stream types
        const validStreamTypes = ["logs", "metrics", "traces"];
          if (!input.source.stream_type || !validStreamTypes.includes(input.source.stream_type) || !validStreamTypes.includes(input.stream_type)) {
            pipelineErrors.push(
              {
                message: `Pipeline - ${index}: Stream Type is mandatory and should be one of: 'logs', 'metrics', 'traces'.`,
                field: "source_stream_type",
              }
            );
          }
        //3. validate source stream name it should not be empty 
        if((input.source.source_type == "realtime" && !input.source.stream_name.trim()) || input.source.source_type == "realtime" && await validateSourceStream(input.source.stream_name,[]) ){
          pipelineErrors.push({ message: `Pipeline - ${index}: Source stream name is required `, field: "source_stream_name" });
        }

        //call getStreamsList to update the stream list 
        // not neded as we are updating the stream list while selecting the stream type
        if(input.source.stream_type && validStreamTypes.includes(input.source.stream_type)){
          await getSourceStreamsList(input.source.stream_type, -1);
        }

        const isValidScheduledPipeline = await validateScheduledPipelineNodes(input, "");
        //5. validate source node sql query
        if(
          (input.source.source_type == "scheduled" 
          && 
        (input.source.query_condition.type == "sql" && !input.source.query_condition.sql
         || !isValidScheduledPipeline || !input.sql_query)
        )){
          pipelineErrors.push({ message: `Pipeline - ${index}: SQL query is required`, field: "sql_query_missing" } );
        }


        const isValidQuery = await validateScheduledPipelineNodes(input, input.sql_query);
        //validate sql query in scheduled pipeline
        if(input.source.source_type == 'scheduled' && (input.sql_query != input.source.query_condition.sql) || !isValidQuery ){
          pipelineErrors.push(  `Pipeline - ${index}: SQL query should be same across all nodes as well try to match the query in the nodes \n 
          input.sql_query: ${input.sql_query} \n 
          input.source.query_condition.sql: ${input.source.query_condition.sql} \n`,
          );
        }

        //validate timezone in scheduled pipeline if the frequency type is cron
        if(input.source.source_type == 'scheduled' && input.source.trigger_condition.frequency_type == 'cron' && !input.source.trigger_condition.timezone){
          pipelineErrors.push({ message: `Pipeline - ${index}: Timezone is required`, field: "source_timezone" });
        }
        //validate if frequnecy type is minutes then the frequency should be in minutes
        if(input.source.source_type == 'scheduled' && input.source.trigger_condition.frequency_type == 'minutes' && input.source.trigger_condition.frequency < 1){
          pipelineErrors.push(
            `Pipeline - ${index}: Frequency should be greater than 0`,
          );
        }
        if(input.source.source_type == 'scheduled' && input.source.trigger_condition.frequency_type == 'cron' && input.source.trigger_condition.period < 1){
          pipelineErrors.push(
            `Pipeline - ${index}: Period should be greater than 0`,
          );
        }
        //should match in source as well as in nodes as well 

        if(input.source.source_type == 'scheduled' && input.source.trigger_condition.frequency_type == 'cron'){
          input.nodes.forEach((node: any) => {
            if(node.io_type == "input" && node.data.node_type == "query"){
              if(node.data.trigger_condition.frequency_type != 'cron'){
                pipelineErrors.push(`Pipeline - ${index}: Frequency type should be cron and should match in source as well as in nodes so kindly check the frequency type in all nodes`);
              }
              if(node.data.trigger_condition.cron != input.source.trigger_condition.cron){
                pipelineErrors.push(`Pipeline - ${index}: Cron should be same as in source and should match in all nodes so kindly check the cron in all nodes`);
              }
              if(node.data.trigger_condition.period != input.source.trigger_condition.period){
                pipelineErrors.push(`Pipeline - ${index}: Period should be same as in source and should match in all nodes so kindly check the period in all nodes`);
              }
              if(node.data.trigger_condition.timezone != input.source.trigger_condition.timezone){
                pipelineErrors.push(`Pipeline - ${index}: Timezone should be same as in source and should match in all nodes so kindly check the timezone in all nodes`);
              }
            }
          });
        }
        if(input.source.source_type == 'scheduled' && input.source.trigger_condition.frequency_type == 'minutes'){
          input.nodes.forEach((node: any) => {
            if(node.io_type == "input" && node.data.node_type == "query"){
              if(node.data.trigger_condition.frequency_type != 'minutes'){
                pipelineErrors.push(`Pipeline - ${index}: Frequency type should be minutes and should match in source as well as in nodes so kindly check the frequency type in all nodes`);
              }
              if(node.data.trigger_condition.frequency != input.source.trigger_condition.frequency){
                pipelineErrors.push(`Pipeline - ${index}: Frequency should be same as in source and should match in all nodes so kindly check the frequency in all nodes`);
              }
            }
          });
        } 
        if(!input.org || !input.source.org_id || !validateNodesForOrg(input) || input.org != store.state.selectedOrganization.identifier || input.source.org_id != store.state.selectedOrganization.identifier){
          pipelineErrors.push( {
            message: `Pipeline - ${index}: Organization Id is mandatory, should exist in organization list and should be equal to ${store.state.selectedOrganization.identifier} `,
            field: "org_id",
          });
        }

        // validate destination node in scheduled pipeline 
        if (input.source.source_type == 'scheduled' || input.source.source_type == 'realtime') {
          const validationPromises = input.nodes.map(async (node: any) => {
 
          //   if (node.io_type == "output" && node.data.node_type == "stream") {
          //     const isValidDestinationStream = await validateDestinationStream(node.data.stream_type, node.data.stream_name);
          //     await getDestinationStreamsList(node.data.stream_type, -1);
          //     if(!isValidDestinationStream){

          //     pipelineErrors.push({ message: `Pipeline - ${index}: Destination stream name is required`, field: "destination_stream_name" });
          //   }
          // }
          const validDestinationStreamTypes = ["logs", "metrics", "traces","enrichment_tables"];

            if (node.io_type == "output" && node.data.node_type == "stream" && !validDestinationStreamTypes.includes(node.data.stream_type)){
              pipelineErrors.push({ message: `Pipeline - ${index}: Destination Stream type is required`, field: "destination_stream_type" });
            }
          });
          // Wait for all validation to complete
          await Promise.all(validationPromises);
        }

        //validate function node in pipeline
        //this function helps in validating the function node and pushing the errors to the pipelineErrors array
        //we track the function counter to get the correct node index because all nodes are not function nodes
        //we use the nodeIndex to push the error to the correct node
        const validateFunctionNode = (input: any, pipelineIndex: number) => {
          let functionCounter = 0;

          input.nodes.forEach((node: any, nodeIndex: number) => {
            if (node.io_type === "default" && node.data.node_type === "function") {
              functionCounter++;

              if (!node.data.name || !existingFunctions.value.includes(node.data.name)) {
                pipelineErrors.push({
                  message: `Pipeline - ${pipelineIndex}, Function-${functionCounter}: Function name is required and should be in the existing functions list`,
                  field: `function_name_${nodeIndex}`,
                  nodeIndex: nodeIndex,
                });
              }
            }
          });
        };

        const validateConditionNode = (input: any) => {
          const isValid = !input.nodes.some((node: any) => {
            return node.io_type == "default" && 
                  node.data.node_type == "condition" && 
                  (!node.data.conditions || node.data.conditions.length === 0);
          });
          return isValid; 
        }
        validateFunctionNode(input, index);
        //validate condition node 
        if(!validateConditionNode(input)){
          pipelineErrors.push({ message: `Pipeline - ${index}: Condition is required`, field: "empty_condition" });
        }   
        const isValidRemoteDestination = validateRemoteDestination(input);
        if(!isValidRemoteDestination){
          pipelineErrors.push({ message: `Pipeline - ${index}: Remote destination is required`, field: "remote_destination" });
        }
        // Log all pipeline errors at the end
        if (pipelineErrors.length > 0) {
          pipelineErrorsToDisplay.value.push(pipelineErrors);
          return false;
        }
        return true;
      };

      const validateRemoteDestination = (input: any) => {
        return !input.nodes.some((node: any) => {
          return node.io_type == "output" && 
                node.data.node_type == "remote_stream" && 
                !pipelineDestinations.value.includes(node.data.destination_name);
        });
      }
  
      const createPipeline = async (input: any, index: any) => {
        try {
          await pipelinesService.createPipeline(
            {
              data: input,
              org_identifier: store.state.selectedOrganization.identifier,
            }
          );
  
          // Success
          pipelineCreators.value.push({
            message: `Pipeline - ${index}: "${input.name}" created successfully \nNote: please remove the created pipeline object ${input.name} from the json file`,
            success: true,
          });
  
          // Emit update after each successful creation
          emit("update:pipelines");
          await getScheduledPipelines();
          
          return true;
        } catch (error: any) {
          // Failure
          pipelineCreators.value.push({
            message: `Pipeline - ${index}: "${input.name}" creation failed --> \n Reason: ${error?.response?.data?.message || "Unknown Error"}`,
            success: false,
          });
          return false;
        }
      };
  
      const onSubmit = (e: any) => {
        e.preventDefault();
      };
      const getSourceStreamsList = async (streamType: string, index: number,isInput: boolean = false) => { 
        //update the stream type if user selects a different stream type
        if(index != -1){
          jsonArrayOfObj.value[index].source.stream_type = streamType;
          jsonArrayOfObj.value[index].stream_type = streamType;
          jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
            if(node.io_type == "input"){
              node.data.stream_type = streamType;
            }
          });
          jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
        }
        try {
          const streamResponse: any = await getStreams(streamType, false);
          //these will be used for destination stream
          const streamsNames = streamResponse.list.map(
            (stream: any) => stream.name,
          );
          const usedStreams = await pipelinesService.getPipelineStreams(store.state.selectedOrganization.identifier);
          const usedStreamNames = usedStreams.data.list.map((stream: any) => stream.stream_name);
          //this is used to disable the stream names which are already used in the source stream
          streamList.value = streamsNames.map((stream: any) => {
            return {
              label: stream,
              value: stream,
              disable: usedStreamNames.includes(stream),
            };
          });
        } catch (error) {
          console.error('Error fetching streams:', error);
        }
      };
      const getDestinationStreamsList = async (streamType: string, index: number,isInput: boolean = false) => { 
        //update the stream type if user selects a different stream type
        if(index != -1){
          jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
            if(node.io_type == "output"){
              node.data.stream_type = streamType;
            }
          });
          jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
        }
        try {
          const streamResponse: any = await getStreams(streamType, false);
          //these will be used for destination stream
          streamData.value = streamResponse.list.map(
            (stream: any) => stream.name,
          );
        } catch (error) {
          console.error('Error fetching streams:', error);
        }
      };
      const getOutputStreamsList = async (streamType: string, index: number,isInput: boolean = false) => { 
        //update the stream type if user selects a different stream type
        if(index != -1 ){
          jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
            if(node.io_type == "output"){
              node.data.stream_type = streamType;
            }
          });

          jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);

        }
        try {
          const streamResponse: any = await getStreams(streamType, false);
          streamData.value = streamResponse.list.map(
            (stream: any) => stream.name,
          );
        } catch (error) {
          console.error('Error fetching streams:', error);
        }
      };
      const filterDestinations = (val: string, update: Function) => {
          if (val === "") {
            update(() => {
              filteredDestinations.value = getFormattedDestinations.value;
            });
            return;
          }
  
          update(() => {
            filteredDestinations.value = getFormattedDestinations.value.filter((destination: string) =>
              destination.toLowerCase().includes(val.toLowerCase())
            );
          });
        };
  
      const toggleDestination = (destination: string, index: number) => {
        if (!userSelectedDestinations.value[index]) {
          userSelectedDestinations.value[index] = [];
        }
        
        const destinations = userSelectedDestinations.value[index];
        const destinationIndex = destinations.indexOf(destination);
        
        if (destinationIndex === -1) {
          destinations.push(destination);
        } else {
          destinations.splice(destinationIndex, 1);
        }
        
        updateUserSelectedDestinations(destinations, index);
      };
  
      const updateTimezone = (timezone: string, index: number) => {
        jsonArrayOfObj.value[index].source.trigger_condition.timezone = timezone;
        jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
          if(node.data.node_type == "query"){
            node.data.trigger_condition.timezone = timezone;
          }
        });
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      };
  
      const timezoneFilterFn = (val: string, update: Function) => {
        if (val === '') {
          update(() => {
            filteredTimezone.value = timezoneOptions;
          });
          return;
        }
  
        update(() => {
          const needle = val.toLowerCase();
          filteredTimezone.value = timezoneOptions.filter(
            (timezone: string) => timezone.toLowerCase().includes(needle)
          );
        });
      };
      const handleDynamicStreamName = (streamName: string, index: number) => {
        if(streamName?.trim() != ""){
          jsonArrayOfObj.value[index].source.stream_name = streamName;
          jsonArrayOfObj.value[index].stream_name = streamName;
          jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
            if(node.io_type == "input"){
              node.data.stream_name = streamName;
            }
          });
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
        }
      }

      const getScheduledPipelines  = async () => {
        const response: any = await pipelinesService.getPipelines(store.state.selectedOrganization.identifier);
        const list = response.data.list;
        scheduledPipelines.value = list.filter((pipeline: any) => pipeline.source.source_type == 'scheduled').map((pipeline: any) => pipeline.name);
      }
      const updateOrgId = (orgId: string, index: number) => {
        jsonArrayOfObj.value[index].org = orgId;
        jsonArrayOfObj.value[index].source.org_id = orgId;
        jsonArrayOfObj.value[index].nodes.forEach((node: any) => {
          if(node.data.node_type == "stream" || node.data.node_type == 'query'){
            node.data.org_id = orgId;
          }
        });
        jsonStr.value = JSON.stringify(jsonArrayOfObj.value, null, 2);
      }
  
      return {
        t,
        jsonStr,
        importJson,
        onSubmit,
        router,
        q,
        templateErrorsToDisplay,
        destinationErrorsToDisplay,
        pipelineErrorsToDisplay,
        tempalteCreators,
        destinationCreators,
        pipelineCreators,
        queryEditorPlaceholderFlag,
        splitterModel,
        tabs,
        activeTab,
        userSelectedDestinations,
        getFormattedDestinations,
        jsonArrayOfObj,
        streamList,
        userSelectedStreamName,
        userSelectedDestinationStreamName,
        updateStreamFields,
        updatePipelineName,
        jsonFiles,
        updateActiveTab,
        url,
        userSelectedPipelineName,
        streamTypes,
        userSelectedStreamType,
        userSelectedDestinationStreamType,
        getSourceStreamsList,
        getDestinationStreamsList,
        getOutputStreamsList,
        streams,
        filterDestinations,
        filteredDestinations,
        updateUserSelectedDestinations,
        toggleDestination,
        userSelectedTimezone,
        filteredTimezone,
        updateTimezone,
        timezoneFilterFn,
        userSelectedSqlQuery,
        updateSqlQuery,
        alertDestinations,
        updateDestinationStreamFields,
        streamData,
        existingFunctions,
        updateFunctionName,
        userSelectedFunctionName,
        pipelineDestinations,
        userSelectedRemoteDestination,
        updateRemoteDestination,
        destinationStreamTypes,
        timezoneOptions,
        handleDynamicStreamName,
        scheduledPipelines,
        userSelectedOrgId,
        organizationData,
        updateOrgId,
      };
    },
    components: {
      QueryEditor,
      AppTabs,
    },
  });
  </script>
  
  <style scoped lang="scss">
  .empty-query .monaco-editor-background {
    background-image: url("../../assets/images/common/query-editor.png");
    background-repeat: no-repeat;
    background-size: 115px;
  }
  
  .empty-function .monaco-editor-background {
    background-image: url("../../assets/images/common/vrl-function.png");
    background-repeat: no-repeat;
    background-size: 170px;
  }
  .editor-container {
    height: calc(78vh - 20px) !important;
  }
  .editor-container-url {
    .monaco-editor {
      height: calc(70vh - 16px) !important; /* Total editor height */
      overflow: auto; /* Allows scrolling if content overflows */
      resize: none; /* Remove resize behavior */
    }
  }
  .editor-container-json {
    .monaco-editor {
      height: calc(68vh - 20px) !important; /* Total editor height */
      overflow: auto; /* Allows scrolling if content overflows */
      resize: none; /* Remove resize behavior */
    }
  }
  .monaco-editor {
    height: calc(81vh - 14px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none; /* Remove resize behavior */
  }
  .error-report-container {
    height: calc(78vh - 24px) !important; /* Total editor height */
    overflow: auto; /* Allows scrolling if content overflows */
    resize: none;
  }
  .error-container {
    display: flex;
    overflow-y: auto;
  
    flex-direction: column;
    border: 1px solid #ccc;
    height: calc(100% - 100px) !important; /* Total container height */
  }
  
  .error-section {
    padding: 10px;
    margin-bottom: 10px;
  }
  
  .section-title {
    font-size: 16px;
    margin-bottom: 10px;
    text-transform: uppercase;
  }
  
  .error-list {
  }
  
  .error-item {
    padding: 5px 0px;
    font-size: 14px;
  }
  .report-list-tabs {
    height: fit-content;
  
    :deep(.rum-tabs) {
      border: 1px solid #464646;
    }
  
    :deep(.rum-tab) {
      &:hover {
        background: #464646;
      }
  
      &.active {
        background: #5960b2;
        color: #ffffff !important;
      }
    }
  }
  .report-list-tabs {
    height: fit-content;
  
    :deep(.rum-tabs) {
      border: 1px solid #eaeaea;
      height: fit-content;
      border-radius: 4px;
      overflow: hidden;
    }
  
    :deep(.rum-tab) {
      width: fit-content !important;
      padding: 4px 12px !important;
      border: none !important;
  
      &:hover {
        background: #eaeaea;
      }
  
      &.active {
        background: #5960b2;
        color: #ffffff !important;
      }
    }
  }
  </style>
  