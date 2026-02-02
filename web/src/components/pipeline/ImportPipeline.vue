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
  <base-import
    ref="baseImportRef"
    title="Import Pipeline"
    test-prefix="pipeline"
    :is-importing="isPipelineImporting"
    :editor-heights="{
      urlEditor: 'calc(100vh - 290px)',
      fileEditor: 'calc(100vh - 310px)',
      outputContainer: 'calc(100vh - 132px)',
      errorReport: 'calc(100vh - 132px)',
    }"
    @back="router.back()"
    @cancel="router.back()"
    @import="importJson"
  >
    <!-- Output Section with Pipeline-specific Error Display -->
    <template #output-content>
      <div class="tw:w-full" style="min-width: 400px;">
        <div
          v-if="pipelineErrorsToDisplay.length > 0"
          class="text-center text-h6 tw:py-2"
        >
          Error Validations
        </div>
        <div v-else class="text-center text-h6 tw:py-2">Output Messages</div>
        <q-separator class="q-mx-md q-mt-md" />
        <div class="error-report-container" style="height: calc(100vh - 128px) !important; overflow: auto; resize: none;">
          <!-- Pipeline Errors Section -->
          <div
            class="error-section"
            v-if="pipelineErrorsToDisplay.length > 0"
          >
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
                        :model-value="userSelectedPipelineName[index] || ''"
                        :label="t('alerts.name') + ' *'"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                        @update:model-value="(val: string) => {
                          userSelectedPipelineName[index] = val;
                          updatePipelineName(val as string, index);
                        }"
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
                        :model-value="userSelectedStreamName[index] || ''"
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
                        @update:model-value="(val) => {
                          userSelectedStreamName[index] = val;
                          updateStreamFields(val, index);
                        }"
                        behavior="menu"
                        @input-value="handleDynamicStreamName($event, index)"
                      >
                        <template v-slot:option="scope">
                          <q-item v-bind="scope.itemProps">
                            <q-item-section>
                              <q-item-label
                                :class="{
                                  'text-grey-6': scope.opt.disable,
                                }"
                              >
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
                        :model-value="userSelectedStreamType[index] || ''"
                        :options="streamTypes"
                        :label="t('alerts.streamType') + ' *'"
                        :popup-content-style="{
                          textTransform: 'lowercase',
                        }"
                        color="input-border"
                        bg-color="input-bg"
                        class="q-py-sm showLabelOnTop no-case"
                        stack-label
                        outlined
                        filled
                        dense
                        @update:model-value="(val) => {
                          userSelectedStreamType[index] = val;
                          getSourceStreamsList(val, index);
                        }"
                        :rules="[
                          (val: any) => !!val || 'Field is required!',
                        ]"
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
                        :model-value="userSelectedSqlQuery[index] || ''"
                        :label="'SQL Query'"
                        :debounceTime="300"
                        language="sql"
                        @update:query="(val) => {
                          userSelectedSqlQuery[index] = val;
                          updateSqlQuery(val, index);
                        }"
                      />
                    </div>
                  </span>
                  <!-- destination stream type should be one of the valid stream types -->
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'destination_stream_type'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <q-select
                        data-test="pipeline-import-destination-stream-type-input"
                        :model-value="userSelectedDestinationStreamType[index] || ''"
                        :options="destinationStreamTypes"
                        :label="t('alerts.streamType') + ' *'"
                        :popup-content-style="{
                          textTransform: 'lowercase',
                        }"
                        color="input-border"
                        bg-color="input-bg"
                        class="q-py-sm showLabelOnTop no-case"
                        stack-label
                        outlined
                        filled
                        dense
                        @update:model-value="(val) => {
                          userSelectedDestinationStreamType[index] = val;
                          getDestinationStreamsList(val, index);
                        }"
                        :rules="[
                          (val: any) => !!val || 'Field is required!',
                        ]"
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
                        :model-value="userSelectedOrgId[index] || null"
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
                        @update:model-value="(val) => {
                          userSelectedOrgId[index] = val;
                          updateOrgId(val?.value || val, index);
                        }"
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
                        :model-value="userSelectedFunctionName[errorMessage.nodeIndex] || ''"
                        :options="existingFunctions"
                        :label="'Function Name'"
                        :popup-content-style="{
                          textTransform: 'lowercase',
                        }"
                        color="input-border"
                        bg-color="input-bg"
                        class="q-py-sm showLabelOnTop no-case"
                        stack-label
                        outlined
                        filled
                        dense
                        @update:model-value="(val) => {
                          userSelectedFunctionName[errorMessage.nodeIndex] = val;
                          updateFunctionName(val, index, errorMessage.nodeIndex);
                        }"
                        :rules="[
                          (val: any) => !!val || 'Field is required!',
                        ]"
                        style="width: 300px"
                      />
                    </div>
                  </span>

                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'remote_destination'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <q-select
                        data-test="pipeline-import-destination-stream-type-input"
                        :model-value="userSelectedRemoteDestination[index] || ''"
                        :options="pipelineDestinations"
                        :label="'Remote Destination'"
                        :popup-content-style="{
                          textTransform: 'lowercase',
                        }"
                        color="input-border"
                        bg-color="input-bg"
                        class="q-py-sm showLabelOnTop no-case"
                        stack-label
                        outlined
                        filled
                        dense
                        @update:model-value="(val) => {
                          userSelectedRemoteDestination[index] = val;
                          updateRemoteDestination(val, index);
                        }"
                        :rules="[
                          (val: any) => !!val || 'Field is required!',
                        ]"
                        style="width: 300px"
                      />
                    </div>
                  </span>
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'source_timezone'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <q-select
                        data-test="pipeline-import-destination-stream-type-input"
                        :model-value="userSelectedTimezone[index] || ''"
                        :options="timezoneOptions"
                        :label="'Timezone'"
                        color="input-border"
                        bg-color="input-bg"
                        class="q-py-sm showLabelOnTop no-case"
                        stack-label
                        outlined
                        filled
                        dense
                        @update:model-value="(val) => {
                          userSelectedTimezone[index] = val;
                          updateTimezone(val, index);
                        }"
                        :rules="[
                          (val: any) => !!val || 'Field is required!',
                        ]"
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
            <div
              class="section-title text-primary"
              data-test="pipeline-import-creation-title"
            >
              Pipeline Creation
            </div>
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
                style="
                  white-space: pre-wrap;
                  word-wrap: break-word;
                  overflow-wrap: break-word;
                "
                :data-test="`pipeline-import-creation-${index}-message`"
              >
                <pre
                  style="white-space: pre-wrap; word-break: break-word"
                  >{{ val.message }}</pre
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </base-import>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  computed,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import pipelinesService from "../../services/pipelines";
import useStreams from "@/composables/useStreams";
import destinationService from "@/services/alert_destination";
import jstransform from "@/services/jstransform";
import usePipelines from "@/composables/usePipelines";
import BaseImport from "../common/BaseImport.vue";
import {
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
} from "@/utils/alerts/alertDataTransforms";

export default defineComponent({
  name: "ImportPipeline",
  components: {
    BaseImport,
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
  },
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
    type pipelineCreator = {
      message: string;
      success: boolean;
    }[];

    type PipelineErrors = (ErrorMessage | string)[][];
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    const q = useQuasar();
    const { getStreams } = useStreams();
    const { getPipelineDestinations } = usePipelines();

    const baseImportRef = ref<any>(null);
    const pipelineErrorsToDisplay = ref<PipelineErrors>([]);
    const userSelectedPipelineName = ref<string[]>([]);

    const pipelineCreators = ref<pipelineCreator>([]);
    const streamList = ref<any>([]);
    const streamData = ref<any>([]);
    const userSelectedStreamName = ref<string[]>([]);
    const userSelectedDestinationStreamName = ref<string[]>([]);
    const userSelectedStreamType = ref<string[]>([]);
    const userSelectedDestinationStreamType = ref<string[]>([]);
    const userSelectedRemoteDestination = ref<string[]>([]);

    // Use computed to directly reference BaseImport's jsonArrayOfObj
    const jsonArrayOfObj = computed({
      get: () => baseImportRef.value?.jsonArrayOfObj || [],
      set: (val) => {
        if (baseImportRef.value) {
          baseImportRef.value.jsonArrayOfObj = val;
        }
      }
    });

    const streamTypes = ["logs", "metrics", "traces"];
    const destinationStreamTypes = [
      "logs",
      "metrics",
      "traces",
      "enrichment_tables",
    ];
    const existingFunctions = ref<any>([]);
    const pipelineDestinations = ref<any>([]);
    const alertDestinations = ref<any>([]);
    const userSelectedSqlQuery = ref<string[]>([]);
    const userSelectedFunctionName = ref<any[]>([]);
    const scheduledPipelines = ref<any>([]);
    const userSelectedOrgId = ref<any[]>([]);
    const isPipelineImporting = ref(false);

    const organizationData = computed(() => {
      return store.state.organizations.map((org: any) => {
        return {
          label: org.identifier,
          value: org.identifier,
          disable:
            !org.identifier ||
            org.identifier !== store.state.selectedOrganization.identifier,
        };
      });
    });

    const userSelectedTimezone = ref<string[]>([]);

    // @ts-ignore
    let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz: any) => {
      return tz;
    });

    const browserTime =
      "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

    // Add the UTC option
    timezoneOptions.unshift("UTC");
    timezoneOptions.unshift(browserTime);

    const updateSqlQuery = (sqlQuery: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].sql_query = sqlQuery;
        baseImportRef.value.jsonArrayOfObj[index].source.query_condition.sql = sqlQuery;
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (
            node.io_type == "input" &&
            node.data.query_condition.type == "sql"
          ) {
            node.data.query_condition.sql = sqlQuery;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateStreamFields = (streamName: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        const stream_name = streamName.value || streamName;
        baseImportRef.value.jsonArrayOfObj[index].source.stream_name = stream_name;
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "input") {
            node.data.stream_name = stream_name;
          }
        });
        baseImportRef.value.jsonArrayOfObj[index].edges.forEach((edge: any) => {
          if (edge.hasOwnProperty("sourceNode")) {
            edge.sourceNode.data.stream_name = stream_name;
          }
        });
        baseImportRef.value.jsonArrayOfObj[index].stream_name = stream_name;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateRemoteDestination = (
      remoteDestination: string,
      index: number,
    ) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.data.node_type == "remote_stream") {
            node.data.destination_name = remoteDestination;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateDestinationStreamFields = (streamName: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "output") {
            node.data.stream_name = streamName;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updatePipelineName = (pipelineName: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = pipelineName;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateFunctionName = (
      functionName: any,
      pipelineIndex: any,
      nodeIndex: any,
    ) => {
      if (baseImportRef.value?.jsonArrayOfObj[pipelineIndex]) {
        const node = baseImportRef.value.jsonArrayOfObj[pipelineIndex].nodes[nodeIndex];

        if (
          node &&
          node.io_type === "default" &&
          node.data.node_type === "function"
        ) {
          node.data.name = functionName;
        }

        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    onMounted(async () => {
      await getFunctions();
      await getAlertDestinations();
      pipelineDestinations.value = await getPipelineDestinations();
      await getScheduledPipelines();
    });

    const getFunctions = async () => {
      const functions = await jstransform.list(
        1,
        100,
        "created_at",
        true,
        "",
        store.state.selectedOrganization.identifier,
      );
      existingFunctions.value = functions.data.list.map((fun: any) => {
        return fun.name;
      });
    };

    const getAlertDestinations = async () => {
      const destinations = await destinationService.list({
        page_num: 1,
        page_size: 100000,
        sort_by: "name",
        desc: false,
        org_identifier: store.state.selectedOrganization.identifier,
        module: "alert",
      });
      alertDestinations.value = destinations.data.map((dest: any) => {
        return dest.name;
      });
    };

    const importJson = async ({ jsonStr: jsonString, jsonArray }: any) => {
      pipelineErrorsToDisplay.value = [];
      pipelineCreators.value = [];

      try {
        // Check if jsonStr is empty or null
        if (!jsonString || jsonString.trim() === "") {
          throw new Error("JSON string is empty");
        }

        const parsedJson = JSON.parse(jsonString);
        // Convert single object to array if needed
        jsonArrayOfObj.value = Array.isArray(parsedJson)
          ? parsedJson
          : [parsedJson];
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
      isPipelineImporting.value = true;

      // Process each object in the array
      for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
        const success = await processJsonObject(jsonObj, index + 1);
        if (!success) {
          allPipelinesCreated = false;
        }
      }

      if (allPipelinesCreated) {
        q.notify({
          message: "Pipeline(s) imported successfully",
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });

        // Delay navigation to allow Monaco editor to complete all debounced operations
        setTimeout(() => {
          emit("update:pipelines");
          router.push({
            name: "pipelines",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
            },
          });
        }, 400);
      }

      isPipelineImporting.value = false;

      // Reset BaseImport's importing flag
      if (baseImportRef.value) {
        baseImportRef.value.isImporting = false;
      }
    };

    const processJsonObject = async (jsonObj: any, index: number) => {
      try {
        const isValidPipeline = await validatePipelineInputs(jsonObj, index);
        if (!isValidPipeline) {
          return false;
        }

        if (pipelineErrorsToDisplay.value.length === 0 && isValidPipeline) {
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

    const validateSourceStream = async (
      streamName: string,
      streamList: any[],
    ) => {
      const response = await pipelinesService.getPipelineStreams(
        store.state.selectedOrganization.identifier,
      );
      const usedStreams = response.data.list;
      if (streamName && streamList.length == 0) {
        return usedStreams.some((stream: any) => {
          return stream.stream_name === streamName;
        });
      } else {
        const usedStreamNames = usedStreams.map(
          (stream: any) => stream.stream_name,
        );
        const filteredStreamList = streamList.filter((stream: any) =>
          usedStreamNames.includes(stream),
        );
        return filteredStreamList;
      }
    };

    const validateDestinationStream = async (
      streamType: string,
      streamName: string,
    ) => {
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

    const validateScheduledPipelineNodes = async (
      input: any,
      sqlQuery: string,
    ) => {
      if (input.source.source_type == "realtime") {
        return true;
      }
      if (sqlQuery) {
        // Using `some()` to return `false` if condition is met
        return input.nodes.some((node: any) => {
          return (
            node.io_type == "input" &&
            node.data.query_condition.type == "sql" &&
            node.data.query_condition.sql !== sqlQuery
          );
        })
          ? false
          : true; // If condition is met (returns true), return false, otherwise return true
      } else {
        // Check for nodes with "input" type and missing sql query
        if (
          input.nodes.some((node: any) => {
            return (
              node.io_type === "input" &&
              node.data.query_condition.type === "sql" &&
              !node.data.query_condition.sql
            );
          })
        ) {
          return false;
        }
        return true;
      }
    };

    const validateNodesForOrg = (input: any) => {
      return input.nodes.some((node: any) => {
        const isFunction = node.data.node_type === "function";
        const isCondition = node.data.node_type === "condition";
        const orgId = node.data.org_id;
        const selectedOrgId = store.state.selectedOrganization.identifier;

        return (
          !isFunction && !isCondition && (!orgId || orgId !== selectedOrgId)
        );
      })
        ? false
        : true;
    };

    const validatePipelineInputs = async (input: any, index: number) => {
      let pipelineErrors: (
        | string
        | {
            message: string;
            field: string;
            nodeIndex?: number;
            currentValue?: string;
          }
      )[] = [];

      // 1. validate name it should not be empty
      if (!input.name.trim() || input.name.trim() === "") {
        pipelineErrors.push({
          message: `Pipeline - ${index}: Name is required`,
          field: "pipeline_name",
        });
      }
      //2. validate source stream type it should be one of the valid stream types
      const validStreamTypes = ["logs", "metrics", "traces"];
      if (
        !input.source.stream_type ||
        !validStreamTypes.includes(input.source.stream_type) ||
        !validStreamTypes.includes(input.stream_type)
      ) {
        pipelineErrors.push({
          message: `Pipeline - ${index}: Stream Type is mandatory and should be one of: 'logs', 'metrics', 'traces'.`,
          field: "source_stream_type",
        });
      }
      //3. validate source stream name it should not be empty
      if (
        (input.source.source_type == "realtime" &&
          !input.source.stream_name.trim()) ||
        (input.source.source_type == "realtime" &&
          (await validateSourceStream(input.source.stream_name, [])))
      ) {
        pipelineErrors.push({
          message: `Pipeline - ${index}: Source stream name is required `,
          field: "source_stream_name",
        });
      }

      //call getStreamsList to update the stream list
      // not neded as we are updating the stream list while selecting the stream type
      if (
        input.source.stream_type &&
        validStreamTypes.includes(input.source.stream_type)
      ) {
        await getSourceStreamsList(input.source.stream_type, -1);
      }

      const isValidScheduledPipeline = await validateScheduledPipelineNodes(
        input,
        "",
      );
      //5. validate source node sql query
      if (
        input.source.source_type == "scheduled" &&
        ((input.source.query_condition.type == "sql" &&
          !input.source.query_condition.sql) ||
          !isValidScheduledPipeline ||
          !input.sql_query)
      ) {
        pipelineErrors.push({
          message: `Pipeline - ${index}: SQL query is required`,
          field: "sql_query_missing",
        });
      }

      const isValidQuery = await validateScheduledPipelineNodes(
        input,
        input.sql_query,
      );
      //validate sql query in scheduled pipeline
      if (
        (input.source.source_type == "scheduled" &&
          input.sql_query != input.source.query_condition.sql) ||
        !isValidQuery
      ) {
        pipelineErrors.push(`Pipeline - ${index}: SQL query should be same across all nodes as well try to match the query in the nodes \n
          input.sql_query: ${input.sql_query} \n
          input.source.query_condition.sql: ${input.source.query_condition.sql} \n`);
      }

      //validate timezone in scheduled pipeline if the frequency type is cron
      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "cron" &&
        !input.source.trigger_condition.timezone
      ) {
        pipelineErrors.push({
          message: `Pipeline - ${index}: Timezone is required`,
          field: "source_timezone",
        });
      }
      //validate if frequnecy type is minutes then the frequency should be in minutes
      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "minutes" &&
        input.source.trigger_condition.frequency < 1
      ) {
        pipelineErrors.push(
          `Pipeline - ${index}: Frequency should be greater than 0`,
        );
      }
      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "cron" &&
        input.source.trigger_condition.period < 1
      ) {
        pipelineErrors.push(
          `Pipeline - ${index}: Period should be greater than 0`,
        );
      }
      //should match in source as well as in nodes as well

      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "cron"
      ) {
        input.nodes.forEach((node: any) => {
          if (node.io_type == "input" && node.data.node_type == "query") {
            if (node.data.trigger_condition.frequency_type != "cron") {
              pipelineErrors.push(
                `Pipeline - ${index}: Frequency type should be cron and should match in source as well as in nodes so kindly check the frequency type in all nodes`,
              );
            }
            if (
              node.data.trigger_condition.cron !=
              input.source.trigger_condition.cron
            ) {
              pipelineErrors.push(
                `Pipeline - ${index}: Cron should be same as in source and should match in all nodes so kindly check the cron in all nodes`,
              );
            }
            if (
              node.data.trigger_condition.period !=
              input.source.trigger_condition.period
            ) {
              pipelineErrors.push(
                `Pipeline - ${index}: Period should be same as in source and should match in all nodes so kindly check the period in all nodes`,
              );
            }
            if (
              node.data.trigger_condition.timezone !=
              input.source.trigger_condition.timezone
            ) {
              pipelineErrors.push(
                `Pipeline - ${index}: Timezone should be same as in source and should match in all nodes so kindly check the timezone in all nodes`,
              );
            }
          }
        });
      }
      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "minutes"
      ) {
        input.nodes.forEach((node: any) => {
          if (node.io_type == "input" && node.data.node_type == "query") {
            if (node.data.trigger_condition.frequency_type != "minutes") {
              pipelineErrors.push(
                `Pipeline - ${index}: Frequency type should be minutes and should match in source as well as in nodes so kindly check the frequency type in all nodes`,
              );
            }
            if (
              node.data.trigger_condition.frequency !=
              input.source.trigger_condition.frequency
            ) {
              pipelineErrors.push(
                `Pipeline - ${index}: Frequency should be same as in source and should match in all nodes so kindly check the frequency in all nodes`,
              );
            }
          }
        });
      }
      if (
        !input.org ||
        !input.source.org_id ||
        !validateNodesForOrg(input) ||
        input.org != store.state.selectedOrganization.identifier ||
        input.source.org_id != store.state.selectedOrganization.identifier
      ) {
        pipelineErrors.push({
          message: `Pipeline - ${index}: Organization Id is mandatory, should exist in organization list and should be equal to ${store.state.selectedOrganization.identifier} `,
          field: "org_id",
        });
      }

      // validate destination node in scheduled pipeline
      if (
        input.source.source_type == "scheduled" ||
        input.source.source_type == "realtime"
      ) {
        const validationPromises = input.nodes.map(async (node: any) => {
          const validDestinationStreamTypes = [
            "logs",
            "metrics",
            "traces",
            "enrichment_tables",
          ];
        });
        // Wait for all validation to complete
        await Promise.all(validationPromises);
      }

      //validate function node in pipeline
      const validateFunctionNode = (input: any, pipelineIndex: number) => {
        let functionCounter = 0;

        input.nodes.forEach((node: any, nodeIndex: number) => {
          if (
            node.io_type === "default" &&
            node.data.node_type === "function"
          ) {
            functionCounter++;

            if (
              !node.data.name ||
              !existingFunctions.value.includes(node.data.name)
            ) {
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
        let hasErrors = false;

        input.nodes.forEach((node: any, nodeIndex: number) => {
          if (node.io_type === "default" && node.data.node_type === "condition") {
            // Check if conditions exist
            if (!node.data.conditions) {
              pipelineErrors.push({
                message: `Pipeline - ${index}, Node ${nodeIndex}: Condition is required`,
                field: "empty_condition",
              });
              hasErrors = true;
              return;
            }

            // Validate the condition format (V0, V1, or V2)
            const validateV2Condition = (item: any): boolean => {
              if (item.filterType === 'group') {
                if (!Array.isArray(item.conditions)) {
                  pipelineErrors.push({
                    message: `Pipeline - ${index}, Node ${nodeIndex}: V2 group must have a conditions array.`,
                    field: "condition_format",
                  });
                  return false;
                }
                return item.conditions.every((nestedItem: any) => validateV2Condition(nestedItem));
              } else if (item.filterType === 'condition') {
                if (!item.column || !item.operator || item.value === undefined) {
                  pipelineErrors.push({
                    message: `Pipeline - ${index}, Node ${nodeIndex}: V2 condition must have column, operator, and value.`,
                    field: "condition_format",
                  });
                  return false;
                }
                return true;
              }
              return true;
            };

            const validateV1Condition = (condition: any): boolean => {
              if (condition.column && condition.operator && condition.value !== undefined) {
                return true;
              }
              if (condition.and || condition.or) {
                const conditions = condition.and || condition.or;
                if (!Array.isArray(conditions)) {
                  pipelineErrors.push({
                    message: `Pipeline - ${index}, Node ${nodeIndex}: V1 'and'/'or' conditions must be an array.`,
                    field: "condition_format",
                  });
                  return false;
                }
                return conditions.every((cond: any) => validateV1Condition(cond));
              }
              return false;
            };

            let conditionsToValidate = node.data.conditions;

            // Determine format and validate
            if (Array.isArray(conditionsToValidate)) {
              // V0 format - flat array
              const valid = conditionsToValidate.every((condition: any) => {
                return condition.column && condition.operator && condition.value !== undefined;
              });
              if (!valid) {
                pipelineErrors.push({
                  message: `Pipeline - ${index}, Node ${nodeIndex}: V0 format - each condition must have column, operator, and value.`,
                  field: "condition_format",
                });
                hasErrors = true;
              }
            } else if (conditionsToValidate.filterType === 'group') {
              // V2 format
              if (!validateV2Condition(conditionsToValidate)) {
                hasErrors = true;
              }
            } else if (conditionsToValidate.and || conditionsToValidate.or) {
              // V1 format
              if (!validateV1Condition(conditionsToValidate)) {
                pipelineErrors.push({
                  message: `Pipeline - ${index}, Node ${nodeIndex}: Invalid V1 condition format.`,
                  field: "condition_format",
                });
                hasErrors = true;
              }
            } else {
              pipelineErrors.push({
                message: `Pipeline - ${index}, Node ${nodeIndex}: Unrecognized condition format.`,
                field: "condition_format",
              });
              hasErrors = true;
            }
          }
        });

        return !hasErrors;
      };
      validateFunctionNode(input, index);
      //validate condition node - errors are added inside the function
      validateConditionNode(input);
      const isValidRemoteDestination = validateRemoteDestination(input);
      if (!isValidRemoteDestination) {
        pipelineErrors.push({
          message: `Pipeline - ${index}: Remote destination is required`,
          field: "remote_destination",
        });
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
        return (
          node.io_type == "output" &&
          node.data.node_type == "remote_stream" &&
          !pipelineDestinations.value.includes(node.data.destination_name)
        );
      });
    };

    const createPipeline = async (input: any, index: any) => {
      // VERSION DETECTION AND CONVERSION
      // Convert V0 and V1 conditions to V2 format in condition nodes before creating pipeline
      if (input.nodes && Array.isArray(input.nodes)) {
        input.nodes.forEach((node: any) => {
          if (node.data?.node_type === "condition" && node.data?.conditions) {
            let convertedConditions = node.data.conditions;

            // Check if version field is already present (V2)
            if (node.data.version !== 2 && node.data.version !== "2") {
              const version = detectConditionsVersion(convertedConditions);

              if (version === 0) {
                // V0: Flat array format - convert to V2
                convertedConditions = convertV0ToV2(convertedConditions);
              } else if (version === 1) {
                // V1: Tree-based format - convert to V2
                if (convertedConditions.and || convertedConditions.or) {
                  // V1 Backend format
                  convertedConditions = convertV1BEToV2(convertedConditions);
                } else if (convertedConditions.label && convertedConditions.items) {
                  // V1 Frontend format
                  convertedConditions = convertV1ToV2(convertedConditions);
                }
              }
              // For version === 2, convertedConditions is already in correct format

              // Update node data with converted conditions
              node.data.conditions = convertedConditions;
            }

            // Ensure version is set as integer (matching Condition.vue structure)
            // Backend expects: node.data = { node_type: "condition", version: 2, conditions: {...} }
            node.data.version = 2;
          }
        });
      }

      try {
        await pipelinesService.createPipeline({
          data: input,
          org_identifier: store.state.selectedOrganization.identifier,
        });

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

    const getSourceStreamsList = async (
      streamType: string,
      index: number,
      isInput: boolean = false,
    ) => {
      //update the stream type if user selects a different stream type
      if (index != -1 && baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].source.stream_type = streamType;
        baseImportRef.value.jsonArrayOfObj[index].stream_type = streamType;
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "input") {
            node.data.stream_type = streamType;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
      try {
        const streamResponse: any = await getStreams(streamType, false);
        //these will be used for destination stream
        const streamsNames = streamResponse.list.map(
          (stream: any) => stream.name,
        );
        const usedStreams = await pipelinesService.getPipelineStreams(
          store.state.selectedOrganization.identifier,
        );
        const usedStreamNames = usedStreams.data.list.map(
          (stream: any) => stream.stream_name,
        );
        //this is used to disable the stream names which are already used in the source stream
        streamList.value = streamsNames.map((stream: any) => {
          return {
            label: stream,
            value: stream,
            disable: usedStreamNames.includes(stream),
          };
        });
      } catch (error) {
        console.error("Error fetching streams:", error);
      }
    };

    const getDestinationStreamsList = async (
      streamType: string,
      index: number,
      isInput: boolean = false,
    ) => {
      //update the stream type if user selects a different stream type
      if (index != -1 && baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "output") {
            node.data.stream_type = streamType;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
      try {
        const streamResponse: any = await getStreams(streamType, false);
        //these will be used for destination stream
        streamData.value = streamResponse.list.map(
          (stream: any) => stream.name,
        );
      } catch (error) {
        console.error("Error fetching streams:", error);
      }
    };

    const getOutputStreamsList = async (
      streamType: string,
      index: number,
      isInput: boolean = false,
    ) => {
      //update the stream type if user selects a different stream type
      if (index != -1 && baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "output") {
            node.data.stream_type = streamType;
          }
        });

        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
      try {
        const streamResponse: any = await getStreams(streamType, false);
        streamData.value = streamResponse.list.map(
          (stream: any) => stream.name,
        );
      } catch (error) {
        console.error("Error fetching streams:", error);
      }
    };

    const updateTimezone = (timezone: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].source.trigger_condition.timezone = timezone;
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.data.node_type == "query") {
            node.data.trigger_condition.timezone = timezone;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const handleDynamicStreamName = (streamName: string, index: number) => {
      if (streamName?.trim() != "" && baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].source.stream_name = streamName;
        baseImportRef.value.jsonArrayOfObj[index].stream_name = streamName;
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "input") {
            node.data.stream_name = streamName;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const getScheduledPipelines = async () => {
      const response: any = await pipelinesService.getPipelines(
        store.state.selectedOrganization.identifier,
      );
      const list = response.data.list;
      scheduledPipelines.value = list
        .filter((pipeline: any) => pipeline.source.source_type == "scheduled")
        .map((pipeline: any) => pipeline.name);
    };

    const updateOrgId = (orgId: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].org = orgId;
        baseImportRef.value.jsonArrayOfObj[index].source.org_id = orgId;
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.data.node_type == "stream" || node.data.node_type == "query") {
            node.data.org_id = orgId;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    return {
      t,
      importJson,
      router,
      q,
      baseImportRef,
      pipelineErrorsToDisplay,
      pipelineCreators,
      jsonArrayOfObj,
      streamList,
      userSelectedStreamName,
      userSelectedDestinationStreamName,
      updateStreamFields,
      updatePipelineName,
      userSelectedPipelineName,
      streamTypes,
      userSelectedStreamType,
      userSelectedDestinationStreamType,
      getSourceStreamsList,
      getDestinationStreamsList,
      getOutputStreamsList,
      updateTimezone,
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
      userSelectedTimezone,
      store,
      isPipelineImporting,
      // Exposed internal functions for testing
      processJsonObject,
      validatePipelineInputs,
      validateSourceStream,
      validateDestinationStream,
      validateScheduledPipelineNodes,
      validateNodesForOrg,
      validateRemoteDestination,
      createPipeline,
      getFunctions,
      getAlertDestinations,
      getScheduledPipelines,
    };
  },
});
</script>

<style scoped lang="scss">
.error-report-container {
  height: calc(100vh - 128px) !important;
  overflow: auto;
  resize: none;
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

.error-item {
  padding: 5px 0px;
  font-size: 14px;
}
</style>
