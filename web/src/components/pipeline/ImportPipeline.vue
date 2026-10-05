<!-- Copyright 2026 OpenObserve Inc.

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
  <BaseImport
    ref="baseImportRef"
    :title="t('pipeline.importPipelineTitle')"
    test-prefix="pipeline"
    hide-header
    container-class=""
    :is-importing="isPipelineImporting"
    @back="router.back()"
    @cancel="router.back()"
    @import="importJson"
  >
    <!-- Output Section with Pipeline-specific Error Display -->
    <template #output-content>
      <div
        class="border-border-default flex h-full w-full flex-col border-s max-md:min-w-0!"
        style="min-width: 25rem"
      >
        <div
          v-if="pipelineErrorsToDisplay.length > 0"
          class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold"
        >
          {{ t("pipeline.errorValidations") }}
        </div>
        <div v-else class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold">
          {{ t("pipeline.outputMessages") }}
        </div>
        <OSeparator class="mt-1 shrink-0" />
        <div class="error-report-container min-h-0 flex-1 resize-none overflow-auto">
          <!-- Pipeline Errors Section -->
          <div class="mb-2.5 p-2.5" v-if="pipelineErrorsToDisplay.length > 0">
            <div>
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
                  class="py-1.25 text-sm"
                  :data-test="`pipeline-import-error-${index}-${errorIndex}`"
                >
                  <!-- pipeline name should not be empty -->
                  <span
                    class="text-status-negative"
                    v-if="typeof errorMessage === 'object' && errorMessage.field == 'pipeline_name'"
                  >
                    {{ errorMessage.message }}

                    <div style="width: 18.75rem">
                      <OInput
                        data-test="pipeline-import-name-input"
                        :model-value="userSelectedPipelineName[index] || ''"
                        :label="t('pipeline.importLabels.name')"
                        class="showLabelOnTop"
                        :error="touchedPipelineName[index] && !userSelectedPipelineName[index]"
                        :error-message="
                          touchedPipelineName[index] && !userSelectedPipelineName[index]
                            ? t('common.nameIsRequired')
                            : raw('')
                        "
                        tabindex="0"
                        @update:model-value="
                          (val: string | number) => {
                            touchedPipelineName[index] = true;
                            userSelectedPipelineName[index] = val as string;
                            updatePipelineName(val as string, index);
                          }
                        "
                      />
                    </div>
                  </span>
                  <!-- source stream name should not be empty -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' && errorMessage.field == 'source_stream_name'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 18.75rem">
                      <OSelect
                        data-test="pipeline-import-source-stream-name-input"
                        :model-value="userSelectedStreamName[index] || ''"
                        :options="streamList"
                        :label="t('pipeline.importLabels.streamName')"
                        class="showLabelOnTop no-case py-2"
                        @update:model-value="
                          (val) => {
                            userSelectedStreamName[index] = val as string;
                            updateStreamFields(val, index);
                          }
                        "
                        @search="handleDynamicStreamName($event, index)"
                      />
                    </div>
                  </span>
                  <!-- source stream type should be one of the valid stream types -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' && errorMessage.field == 'source_stream_type'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <OSelect
                        data-test="pipeline-import-source-stream-type-input"
                        :model-value="userSelectedStreamType[index] || ''"
                        :options="streamTypes"
                        :label="t('pipeline.importLabels.streamType')"
                        class="showLabelOnTop no-case py-2"
                        style="width: 18.75rem"
                        :error="touchedStreamType[index] && !userSelectedStreamType[index]"
                        :error-message="
                          touchedStreamType[index] && !userSelectedStreamType[index]
                            ? t('common.streamTypeIsRequired')
                            : raw('')
                        "
                        @update:model-value="
                          (val: any) => {
                            touchedStreamType[index] = true;
                            userSelectedStreamType[index] = val;
                            getSourceStreamsList(val, index);
                          }
                        "
                      />
                    </div>
                  </span>
                  <!-- sql query should be same across all nodes as well try to match the query in the nodes -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' && errorMessage.field == 'sql_query_missing'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <QueryEditor
                        class="w-full"
                        style="height: 12.5rem"
                        data-test="pipeline-import-sql-query-input"
                        :model-value="userSelectedSqlQuery[index] || ''"
                        :label="t('pipeline.sqlQuery')"
                        :debounceTime="300"
                        language="sql"
                        @update:query="
                          (val) => {
                            userSelectedSqlQuery[index] = val;
                            updateSqlQuery(val, index);
                          }
                        "
                      />
                    </div>
                  </span>
                  <!-- destination stream type should be one of the valid stream types -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'destination_stream_type'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <OSelect
                        data-test="pipeline-import-destination-stream-type-input"
                        :model-value="userSelectedDestinationStreamType[index] || ''"
                        :options="destinationStreamTypes"
                        :label="t('pipeline.importLabels.streamType')"
                        class="showLabelOnTop no-case py-2"
                        style="width: 18.75rem"
                        :error="
                          touchedDestinationStreamType[index] &&
                          !userSelectedDestinationStreamType[index]
                        "
                        :error-message="
                          touchedDestinationStreamType[index] &&
                          !userSelectedDestinationStreamType[index]
                            ? t('common.streamTypeIsRequired')
                            : raw('')
                        "
                        @update:model-value="
                          (val: any) => {
                            touchedDestinationStreamType[index] = true;
                            userSelectedDestinationStreamType[index] = val;
                            getDestinationStreamsList(val, index);
                          }
                        "
                      />
                    </div>
                  </span>
                  <!-- destination stream name should not be empty -->
                  <span
                    class="text-status-negative"
                    v-else-if="typeof errorMessage === 'object' && errorMessage.field == 'org_id'"
                  >
                    {{ errorMessage.message }}
                    <div style="width: 18.75rem">
                      <OSelect
                        data-test="pipeline-import-org-id-input"
                        :model-value="userSelectedOrgId[index] || null"
                        :options="organizationData"
                        :label="t('pipeline.organizationId')"
                        labelKey="label"
                        valueKey="value"
                        searchable
                        class="showLabelOnTop no-case py-2"
                        @update:model-value="
                          (val: any) => {
                            userSelectedOrgId[index] = val;
                            updateOrgId(val?.value || val, index);
                          }
                        "
                      />
                    </div>
                  </span>
                  <!-- source stream type should be one of the valid stream types -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field.startsWith('function_name')
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <OSelect
                        data-test="pipeline-import-destination-function-name-input"
                        :model-value="userSelectedFunctionName[errorMessage.nodeIndex] || ''"
                        :options="existingFunctions"
                        :label="t('pipeline.functionName')"
                        class="showLabelOnTop no-case py-2"
                        style="width: 18.75rem"
                        :error="
                          touchedFunctionName[errorMessage.nodeIndex] &&
                          !userSelectedFunctionName[errorMessage.nodeIndex]
                        "
                        :error-message="
                          touchedFunctionName[errorMessage.nodeIndex] &&
                          !userSelectedFunctionName[errorMessage.nodeIndex]
                            ? t('common.functionNameIsRequired')
                            : raw('')
                        "
                        @update:model-value="
                          (val: any) => {
                            touchedFunctionName[errorMessage.nodeIndex] = true;
                            userSelectedFunctionName[errorMessage.nodeIndex] = val;
                            updateFunctionName(val, index, errorMessage.nodeIndex);
                          }
                        "
                      />
                    </div>
                  </span>

                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' && errorMessage.field == 'remote_destination'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <OSelect
                        data-test="pipeline-import-destination-stream-type-input"
                        :model-value="userSelectedRemoteDestination[index] || ''"
                        :options="pipelineDestinations"
                        :label="t('pipeline.remoteDestination')"
                        class="showLabelOnTop no-case py-2"
                        style="width: 18.75rem"
                        :error="
                          touchedRemoteDestination[index] && !userSelectedRemoteDestination[index]
                        "
                        :error-message="
                          touchedRemoteDestination[index] && !userSelectedRemoteDestination[index]
                            ? t('common.remoteDestinationIsRequired')
                            : raw('')
                        "
                        @update:model-value="
                          (val: any) => {
                            touchedRemoteDestination[index] = true;
                            userSelectedRemoteDestination[index] = val;
                            updateRemoteDestination(val, index);
                          }
                        "
                      />
                    </div>
                  </span>
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' && errorMessage.field == 'source_timezone'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <OSelect
                        data-test="pipeline-import-destination-stream-type-input"
                        :model-value="userSelectedTimezone[index] || ''"
                        :options="timezoneSelectOptions"
                        :label="t('common.timezone')"
                        searchable
                        class="showLabelOnTop no-case py-2"
                        style="width: 18.75rem"
                        :error="touchedTimezone[index] && !userSelectedTimezone[index]"
                        :error-message="
                          touchedTimezone[index] && !userSelectedTimezone[index]
                            ? t('common.timezoneIsRequired')
                            : raw('')
                        "
                        @update:model-value="
                          (val: any) => {
                            touchedTimezone[index] = true;
                            userSelectedTimezone[index] = val;
                            updateTimezone(val, index);
                          }
                        "
                      />
                    </div>
                  </span>
                  <!-- Errors with no inline fix-up are pushed as plain strings, and must read as errors too. -->
                  <span v-else class="text-status-negative">{{ errorMessage }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="mb-2.5 p-2.5" v-if="pipelineCreators.length > 0">
            <div
              class="text-primary mb-2.5 text-base uppercase"
              data-test="pipeline-import-creation-title"
            >
              {{ t("pipeline.pipelineCreation") }}
            </div>
            <div
              v-for="(val, index) in pipelineCreators"
              :key="index"
              :data-test="`pipeline-import-creation-${index}`"
            >
              <div
                :class="{
                  'py-1.25 text-sm font-bold': true,
                  'text-green': val.success && !val.warning,
                  'text-status-warning-text': val.warning,
                  'text-status-negative': !val.success,
                }"
                class="whitespace-pre-wrap"
                style="word-wrap: break-word; overflow-wrap: break-word"
                :data-test="`pipeline-import-creation-${index}-message`"
              >
                <pre class="whitespace-pre-wrap" style="word-break: break-word">{{
                  val.message
                }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseImport>

  <!-- Actions live in the pipeline shell's OPageHeader (Functions.vue), next
       to the "Pipelines › Import" breadcrumb — the shell owns the single header
       so BaseImport's built-in header is hidden (hide-header). -->
  <!-- defer is required: #o2-page-actions is created by Functions.vue (parent shell)
       and must exist before this child mounts. See PipelineHistory.vue for the same pattern. -->
  <Teleport to="#o2-page-actions" defer>
    <OButton
      variant="outline"
      size="sm-action"
      data-test="pipeline-import-cancel-btn"
      @click="baseImportRef?.handleCancel()"
    >
      {{ t("function.cancel") }}
    </OButton>
    <OButton
      variant="primary"
      size="sm-action"
      type="submit"
      data-test="pipeline-import-json-btn"
      :loading="isPipelineImporting"
      :disabled="isPipelineImporting"
      @click="baseImportRef?.handleImport()"
    >
      {{ t("dashboard.import") }}
    </OButton>
  </Teleport>
</template>

<script lang="ts">
import { destinationsQuery } from "@/services/alert_destination.queries";
import { functionsQuery } from "@/services/jstransform.queries";
import { queryClient } from "@/composables/query/queryClient";
import { pipelineKeys } from "@/services/pipelines.querykeys";
import { functionKeys } from "@/services/jstransform.querykeys";
import { defineComponent, ref, onMounted, computed, defineAsyncComponent } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import pipelinesService from "../../services/pipelines";
import analytics from "@/services/product_analytics";
import useStreams from "@/composables/useStreams";
import jstransform from "@/services/jstransform";
import usePipelines from "@/composables/usePipelines";
import BaseImport from "../common/BaseImport.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import {
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
  ensureUnaryConditionValues,
} from "@/utils/alerts/alertDataTransforms";
import { isUnaryOperator } from "@/utils/alerts/conditionsFormatter";

export default defineComponent({
  name: "ImportPipeline",
  components: {
    OSeparator,
    OButton,
    BaseImport,
    QueryEditor: defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue")),
    OInput: defineAsyncComponent(() => import("@/lib/forms/Input/OInput.vue")),
    OSelect: defineAsyncComponent(() => import("@/lib/forms/Select/OSelect.vue")),
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
      message: I18nText;
      nodeIndex?: any;
      currentValue?: string;
    };
    type pipelineCreator = {
      message: I18nText;
      success: boolean;
      /** A result the user has to notice: a copy was made, or a function was not bundled. */
      warning?: boolean;
    }[];

    type PipelineErrors = (ErrorMessage | string)[][];
    const { t } = useI18nTyped();
    const store = useStore();
    const router = useRouter();

    const { getStreams } = useStreams(t);
    const { getPipelineDestinations } = usePipelines(t);

    const baseImportRef = ref<any>(null);
    const pipelineErrorsToDisplay = ref<PipelineErrors>([]);
    const userSelectedPipelineName = ref<string[]>([]);
    const touchedPipelineName = ref<boolean[]>([]);

    const pipelineCreators = ref<pipelineCreator>([]);
    const streamList = ref<any>([]);
    const streamData = ref<any>([]);
    const userSelectedStreamName = ref<string[]>([]);
    const userSelectedDestinationStreamName = ref<string[]>([]);
    const userSelectedStreamType = ref<string[]>([]);
    const touchedStreamType = ref<boolean[]>([]);
    const userSelectedDestinationStreamType = ref<string[]>([]);
    const touchedDestinationStreamType = ref<boolean[]>([]);
    const userSelectedRemoteDestination = ref<string[]>([]);
    const touchedRemoteDestination = ref<boolean[]>([]);

    // Use computed to directly reference BaseImport's jsonArrayOfObj
    const jsonArrayOfObj = computed({
      get: () => baseImportRef.value?.jsonArrayOfObj || [],
      set: (val) => {
        if (baseImportRef.value) {
          baseImportRef.value.jsonArrayOfObj = val;
        }
      },
    });

    // The endpoint paginates; every consumer here wants the whole list.
    // How far the copy search walks before giving up. A name that needs more than
    // this has a problem the import cannot name its way out of.
    const MAX_FUNCTION_COPY_SUFFIX = 50;

    const streamTypes = ["logs", "metrics", "traces"];
    const destinationStreamTypes = ["logs", "metrics", "traces", "enrichment_tables"];
    const existingFunctions = ref<any>([]);
    // The same functions keyed by name, bodies and all. The bundled-function
    // resolver compares against these; the remap OSelect still reads the name
    // list above.
    const functionsByName = ref<Map<string, any>>(new Map());
    // Set when a bundled function was created, so the batch invalidates the
    // functions cache once at the end rather than per pipeline.
    const functionsCreatedInBatch = ref(false);
    const pipelineDestinations = ref<any>([]);
    const alertDestinations = ref<any>([]);
    const userSelectedSqlQuery = ref<string[]>([]);
    const userSelectedFunctionName = ref<any[]>([]);
    const touchedFunctionName = ref<boolean[]>([]);
    const scheduledPipelines = ref<any>([]);
    const userSelectedOrgId = ref<any[]>([]);
    const isPipelineImporting = ref(false);

    const organizationData = computed(() => {
      return store.state.organizations.map((org: any) => {
        return {
          label: raw(org.identifier),
          value: org.identifier,
          disable:
            !org.identifier || org.identifier !== store.state.selectedOrganization.identifier,
        };
      });
    });

    const userSelectedTimezone = ref<string[]>([]);
    const touchedTimezone = ref<boolean[]>([]);

    // @ts-ignore
    let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz: any) => {
      return tz;
    });

    // The VALUE stays English: resolveBrowserTimezone() parses this exact shape and
    // stored records hold it verbatim. The LABEL is translated below.
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const browserTime = raw("Browser Time (" + browserTz + ")");

    // Add the UTC option
    timezoneOptions.unshift("UTC");
    timezoneOptions.unshift(browserTime);

    // Only the browser entry has copy to translate; every other option is an IANA
    // zone name. Mapped for display so the persisted value stays the English shape.
    const timezoneSelectOptions = computed(() =>
      (timezoneOptions as string[]).map((tz: string) =>
        tz === browserTime
          ? { label: t("common.browserTimeWithZone", { zone: browserTz }), value: tz }
          : { label: raw(tz), value: tz },
      ),
    );

    const updateSqlQuery = (sqlQuery: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].sql_query = sqlQuery;
        baseImportRef.value.jsonArrayOfObj[index].source.query_condition.sql = sqlQuery;
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "input" && node.data.query_condition.type == "sql") {
            node.data.query_condition.sql = sqlQuery;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
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
          if (Object.prototype.hasOwnProperty.call(edge, "sourceNode")) {
            edge.sourceNode.data.stream_name = stream_name;
          }
        });
        baseImportRef.value.jsonArrayOfObj[index].stream_name = stream_name;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const updateRemoteDestination = (remoteDestination: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.data.node_type == "remote_stream") {
            node.data.destination_name = remoteDestination;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
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
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const updatePipelineName = (pipelineName: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = pipelineName;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const updateFunctionName = (functionName: any, pipelineIndex: any, nodeIndex: any) => {
      if (baseImportRef.value?.jsonArrayOfObj[pipelineIndex]) {
        const node = baseImportRef.value.jsonArrayOfObj[pipelineIndex].nodes[nodeIndex];

        if (node && node.io_type === "default" && node.data.node_type === "function") {
          node.data.name = functionName;
        }

        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    onMounted(async () => {
      await getFunctions();
      await getAlertDestinations();
      pipelineDestinations.value = await getPipelineDestinations();
      await getScheduledPipelines();
    });

    const getFunctions = async () => {
      // The declared query already reads every function in the org; staleTime 0
      // because a name missing from this list answers the create with 400
      // `already exist`, which the resolver reads as "taken" and copies around.
      const list = await queryClient.fetchQuery({
        ...functionsQuery(store.state.selectedOrganization.identifier),
        staleTime: 0,
      });
      functionsByName.value = new Map(list.map((fun: any) => [fun.name, fun]));
      existingFunctions.value = list.map((fun: any) => {
        return fun.name;
      });
    };

    const getAlertDestinations = async () => {
      const destinations = await queryClient.fetchQuery(
        destinationsQuery(store.state.selectedOrganization.identifier, "alert"),
      );
      alertDestinations.value = destinations.map((dest: any) => dest.name);
    };

    const importJson = async ({ jsonStr: jsonString }: any) => {
      pipelineErrorsToDisplay.value = [];
      pipelineCreators.value = [];
      functionsCreatedInBatch.value = false;

      try {
        // Check if jsonStr is empty or null
        if (!jsonString || jsonString.trim() === "") {
          throw new Error(t("common.jsonStringEmpty"));
        }

        const parsedJson = JSON.parse(jsonString);
        // Convert single object to array if needed
        jsonArrayOfObj.value = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      } catch (e: any) {
        toast({
          message: e.message || t("common.invalidJsonFormat"),
          variant: "error",
        });
        // Reset BaseImport's importing flag on validation error
        if (baseImportRef.value) {
          baseImportRef.value.isImportingLocal = false;
        }
        return;
      }

      let allPipelinesCreated = true;
      let anyPipelineCreated = false;
      let createdCount = 0;
      isPipelineImporting.value = true;

      // Process each object in the array
      for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
        const success = await processJsonObject(jsonObj, index + 1);
        if (success) {
          anyPipelineCreated = true;
          createdCount++;
        } else allPipelinesCreated = false;
      }
      if (createdCount > 0) analytics.track("pipeline_imported", { count: createdCount });

      // Once per batch, not per item: the list stays mounted here, so N invalidations refetch it N times.
      if (anyPipelineCreated) {
        void queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(store.state.selectedOrganization.identifier),
        });
      }

      // Same reasoning for the functions a bundle created, so the Functions page
      // shows them without a reload.
      if (functionsCreatedInBatch.value) {
        void queryClient.invalidateQueries({
          queryKey: functionKeys.all(store.state.selectedOrganization.identifier),
        });
      }

      if (allPipelinesCreated) {
        toast({
          message: t("toastMessages.pipeline.pipelinesImportedSuccessfully", {
            count: jsonArrayOfObj.value.length,
          }),
          variant: "success",
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
        baseImportRef.value.isImportingLocal = false;
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
        toast({
          message: t("toastMessages.pipeline.errorImportingPipelinePleaseCheck"),
          variant: "error",
        });
        return false;
      }
      return false;
    };

    const validateSourceStream = async (streamName: string, streamList: any[]) => {
      const response = await pipelinesService.getPipelineStreams(
        store.state.selectedOrganization.identifier,
      );
      const usedStreams = response.data.list;
      if (streamName && streamList.length == 0) {
        return usedStreams.some((stream: any) => {
          return stream.stream_name === streamName;
        });
      } else {
        const usedStreamNames = usedStreams.map((stream: any) => stream.stream_name);
        const filteredStreamList = streamList.filter((stream: any) =>
          usedStreamNames.includes(stream),
        );
        return filteredStreamList;
      }
    };

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

        return !isFunction && !isCondition && (!orgId || orgId !== selectedOrgId);
      })
        ? false
        : true;
    };

    const validatePipelineInputs = async (input: any, index: number) => {
      let pipelineErrors: (
        | string
        | {
            message: I18nText;
            field: string;
            nodeIndex?: number;
            currentValue?: string;
          }
      )[] = [];

      // 1. validate name it should not be empty
      if (!input.name.trim() || input.name.trim() === "") {
        pipelineErrors.push({
          message: t("pipeline.importErrors.nameRequired", { index }),
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
          message: t("pipeline.importErrors.streamTypeInvalid", { index }),
          field: "source_stream_type",
        });
      }
      //3. validate source stream name it should not be empty
      if (
        (input.source.source_type == "realtime" && !input.source.stream_name.trim()) ||
        (input.source.source_type == "realtime" &&
          (await validateSourceStream(input.source.stream_name, [])))
      ) {
        pipelineErrors.push({
          message: t("pipeline.importErrors.sourceStreamNameRequired", { index }),
          field: "source_stream_name",
        });
      }

      //call getStreamsList to update the stream list
      // not neded as we are updating the stream list while selecting the stream type
      if (input.source.stream_type && validStreamTypes.includes(input.source.stream_type)) {
        await getSourceStreamsList(input.source.stream_type, -1);
      }

      const isValidScheduledPipeline = await validateScheduledPipelineNodes(input, "");
      //5. validate source node sql query
      if (
        input.source.source_type == "scheduled" &&
        ((input.source.query_condition.type == "sql" && !input.source.query_condition.sql) ||
          !isValidScheduledPipeline ||
          !input.sql_query)
      ) {
        pipelineErrors.push({
          message: t("pipeline.importErrors.sqlQueryRequired", { index }),
          field: "sql_query_missing",
        });
      }

      const isValidQuery = await validateScheduledPipelineNodes(input, input.sql_query);
      //validate sql query in scheduled pipeline
      if (
        (input.source.source_type == "scheduled" &&
          input.sql_query != input.source.query_condition.sql) ||
        !isValidQuery
      ) {
        pipelineErrors.push(
          t("pipeline.importErrors.sqlQueryMismatch", {
            index,
            sqlQuery: input.sql_query,
            sourceSql: input.source.query_condition.sql,
          }),
        );
      }

      //validate timezone in scheduled pipeline if the frequency type is cron
      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "cron" &&
        !input.source.trigger_condition.timezone
      ) {
        pipelineErrors.push({
          message: t("pipeline.importErrors.timezoneRequired", { index }),
          field: "source_timezone",
        });
      }
      //validate if frequnecy type is minutes then the frequency should be in minutes
      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "minutes" &&
        input.source.trigger_condition.frequency < 1
      ) {
        pipelineErrors.push(t("pipeline.importErrors.frequencyPositive", { index }));
      }
      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "cron" &&
        input.source.trigger_condition.period < 1
      ) {
        pipelineErrors.push(t("pipeline.importErrors.periodPositive", { index }));
      }
      //should match in source as well as in nodes as well

      if (
        input.source.source_type == "scheduled" &&
        input.source.trigger_condition.frequency_type == "cron"
      ) {
        input.nodes.forEach((node: any) => {
          if (node.io_type == "input" && node.data.node_type == "query") {
            if (node.data.trigger_condition.frequency_type != "cron") {
              pipelineErrors.push(t("pipeline.importErrors.cronFrequencyTypeMismatch", { index }));
            }
            if (node.data.trigger_condition.cron != input.source.trigger_condition.cron) {
              pipelineErrors.push(t("pipeline.importErrors.cronMismatch", { index }));
            }
            if (node.data.trigger_condition.period != input.source.trigger_condition.period) {
              pipelineErrors.push(t("pipeline.importErrors.periodMismatch", { index }));
            }
            if (node.data.trigger_condition.timezone != input.source.trigger_condition.timezone) {
              pipelineErrors.push(t("pipeline.importErrors.timezoneMismatch", { index }));
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
                t("pipeline.importErrors.minutesFrequencyTypeMismatch", { index }),
              );
            }
            if (node.data.trigger_condition.frequency != input.source.trigger_condition.frequency) {
              pipelineErrors.push(t("pipeline.importErrors.frequencyMismatch", { index }));
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
          message: t("pipeline.importErrors.orgIdInvalid", {
            index,
            orgId: store.state.selectedOrganization.identifier,
          }),
          field: "org_id",
        });
      }

      // validate destination node in scheduled pipeline
      if (input.source.source_type == "scheduled" || input.source.source_type == "realtime") {
        const validationPromises = input.nodes.map(async () => {});
        // Wait for all validation to complete
        await Promise.all(validationPromises);
      }

      //validate function node in pipeline
      const validateFunctionNode = (input: any, pipelineIndex: number) => {
        let functionCounter = 0;
        const { byName: bundledNames, conflicting } = bundledFunctionsByName(input);

        if (conflicting.length) {
          pipelineErrors.push(
            t("pipeline.importErrors.functionBundleConflict", {
              index: pipelineIndex,
              names: conflicting.join(", "),
            }),
          );
        }

        input.nodes.forEach((node: any, nodeIndex: number) => {
          if (node.io_type === "default" && node.data.node_type === "function") {
            functionCounter++;

            // A bundled name needs no match in the org: the import creates it.
            const isKnown =
              !!node.data.name &&
              (existingFunctions.value.includes(node.data.name) ||
                bundledNames.has(node.data.name));

            if (!isKnown) {
              pipelineErrors.push({
                message: t("pipeline.importErrors.functionNameRequired", {
                  index: pipelineIndex,
                  counter: functionCounter,
                }),
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
                message: t("pipeline.importErrors.conditionRequired", { index, nodeIndex }),
                field: "empty_condition",
              });
              hasErrors = true;
              return;
            }

            // Validate the condition format (V0, V1, or V2)
            const validateV2Condition = (item: any): boolean => {
              if (item.filterType === "group") {
                if (!Array.isArray(item.conditions)) {
                  pipelineErrors.push({
                    message: t("pipeline.importErrors.v2GroupConditionsArray", {
                      index,
                      nodeIndex,
                    }),
                    field: "condition_format",
                  });
                  return false;
                }
                return item.conditions.every((nestedItem: any) => validateV2Condition(nestedItem));
              } else if (item.filterType === "condition") {
                if (
                  !item.column ||
                  !item.operator ||
                  (item.value === undefined && !isUnaryOperator(item.operator))
                ) {
                  pipelineErrors.push({
                    message: t("pipeline.importErrors.v2ConditionFields", { index, nodeIndex }),
                    field: "condition_format",
                  });
                  return false;
                }
                return true;
              }
              return true;
            };

            const validateV1Condition = (condition: any): boolean => {
              if (
                condition.column &&
                condition.operator &&
                (condition.value !== undefined || isUnaryOperator(condition.operator))
              ) {
                return true;
              }
              if (condition.and || condition.or) {
                const conditions = condition.and || condition.or;
                if (!Array.isArray(conditions)) {
                  pipelineErrors.push({
                    message: t("pipeline.importErrors.v1ConditionsArray", { index, nodeIndex }),
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
                return (
                  condition.column &&
                  condition.operator &&
                  (condition.value !== undefined || isUnaryOperator(condition.operator))
                );
              });
              if (!valid) {
                pipelineErrors.push({
                  message: t("pipeline.importErrors.v0ConditionFields", { index, nodeIndex }),
                  field: "condition_format",
                });
                hasErrors = true;
              }
            } else if (conditionsToValidate.filterType === "group") {
              // V2 format
              if (!validateV2Condition(conditionsToValidate)) {
                hasErrors = true;
              }
            } else if (conditionsToValidate.and || conditionsToValidate.or) {
              // V1 format
              if (!validateV1Condition(conditionsToValidate)) {
                pipelineErrors.push({
                  message: t("pipeline.importErrors.v1ConditionInvalid", { index, nodeIndex }),
                  field: "condition_format",
                });
                hasErrors = true;
              }
            } else {
              pipelineErrors.push({
                message: t("pipeline.importErrors.conditionFormatUnrecognized", {
                  index,
                  nodeIndex,
                }),
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
          message: t("pipeline.importErrors.remoteDestinationRequired", { index }),
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

    /**
     * Trims, then strips the one trailing `" \n ."` that `save_function` appends to
     * a VRL body it is given without a return (src/core/src/functions.rs). An
     * export taken after that rewrite differs from the file it was imported from
     * by those three characters alone, so without this every older file reports a
     * false conflict against the very function it came from. JS bodies are stored
     * verbatim and are unaffected.
     */
    const normaliseFunctionBody = (body: any) =>
      String(body ?? "")
        .trim()
        .replace(/\s*\n\s*\.$/, "")
        .trim();

    // `params` defaults to `row` on the server, so a file that omits it and one
    // that spells it out describe the same function.
    const sameFunctionLogic = (a: any, b: any) =>
      normaliseFunctionBody(a?.function) === normaliseFunctionBody(b?.function) &&
      (a?.params || "row") === (b?.params || "row") &&
      Number(a?.transType ?? 0) === Number(b?.transType ?? 0);

    /**
     * The functions a file bundles for one pipeline, keyed by name.
     *
     * `conflicting` names an unresolvable file: two entries under one name
     * describing different logic, where no choice of body can be the right one for
     * the node that calls it.
     */
    const bundledFunctionsByName = (input: any) => {
      const byName = new Map<string, any>();
      const conflicting: string[] = [];
      const bundle = Array.isArray(input?.functions) ? input.functions : [];

      bundle.forEach((fn: any) => {
        if (!fn || typeof fn.name !== "string" || fn.name === "") return;
        const seen = byName.get(fn.name);
        if (!seen) {
          byName.set(fn.name, fn);
          return;
        }
        if (!sameFunctionLogic(seen, fn) && !conflicting.includes(fn.name)) {
          conflicting.push(fn.name);
        }
      });

      return { byName, conflicting };
    };

    // Only the bundled functions a node actually calls: a file may carry more than
    // the pipeline needs, and creating those would be a surprise.
    const usedBundledFunctions = (input: any, byName: Map<string, any>) => {
      const used: any[] = [];
      const seen = new Set<string>();
      (input?.nodes ?? []).forEach((node: any) => {
        if (node?.data?.node_type !== "function") return;
        const name = node?.data?.name;
        if (!name || seen.has(name) || !byName.has(name)) return;
        seen.add(name);
        used.push(byName.get(name));
      });
      return used;
    };

    // Names a node calls that the file did not carry, for a file that carried some.
    // An old file bundles nothing at all, and those nodes are the remap OSelect's
    // business, so they are not reported here.
    const unbundledFunctionNames = (input: any, byName: Map<string, any>) => {
      if (!byName.size) return [];
      const missing: string[] = [];
      (input?.nodes ?? []).forEach((node: any) => {
        const name = node?.data?.name;
        if (node?.data?.node_type !== "function" || !name) return;
        if (!byName.has(name) && !missing.includes(name)) missing.push(name);
      });
      return missing;
    };

    /**
     * Creates the functions this pipeline bundles and points its nodes at them.
     *
     * Never overwrites: a name taken by different logic gets a copy under the first
     * free `_N`, so no pipeline but this one changes behaviour, and this one runs
     * the logic it was exported with. Decided per function with no prompt.
     *
     * Returns false when a function could not be resolved — the caller abandons the
     * pipeline rather than create it against the wrong logic.
     */
    /** The four keys the server reads, spelled and typed the way it expects. */
    const bundledFunctionPayload = (fn: any, name: string) => ({
      name,
      function: String(fn.function).trim(),
      params: typeof fn.params === "string" && fn.params.trim() ? fn.params : "row",
      transType: parseInt(String(fn.transType ?? 0)),
    });

    const resolveBundledFunctions = async (input: any, index: any) => {
      const { byName, conflicting } = bundledFunctionsByName(input);

      // Validation already refuses this file; this is the guard that stops any write
      // if the resolver is ever reached without it.
      if (conflicting.length) {
        pipelineCreators.value.push({
          message: t("pipeline.importErrors.functionBundleConflict", {
            index,
            names: conflicting.join(", "),
          }),
          success: false,
        });
        return false;
      }

      const unbundled = unbundledFunctionNames(input, byName);
      if (unbundled.length) {
        pipelineCreators.value.push({
          message: t("pipeline.importErrors.functionsNotBundled", {
            index,
            names: unbundled.join(", "),
          }),
          success: true,
          warning: true,
        });
      }

      const renamed = new Map<string, string>();

      for (const fn of usedBundledFunctions(input, byName)) {
        let target: string | null = null;

        for (let n = 0; n <= MAX_FUNCTION_COPY_SUFFIX; n++) {
          // `_N` keeps the name inside the Add form's rule, /^[A-Za-z_][A-Za-z0-9_]*$/.
          const candidate = n === 0 ? fn.name : `${fn.name}_${n}`;
          const existing = functionsByName.value.get(candidate);

          if (existing) {
            if (!sameFunctionLogic(existing, fn)) continue;
            target = candidate;
            if (n > 0) {
              pipelineCreators.value.push({
                message: t("pipeline.importErrors.functionReusedCopy", {
                  index,
                  name: fn.name,
                  copy: candidate,
                }),
                success: true,
                warning: true,
              });
            }
            break;
          }

          try {
            await jstransform.create(
              store.state.selectedOrganization.identifier,
              bundledFunctionPayload(fn, candidate),
            );
          } catch (error: any) {
            // Under enterprise RBAC the list is filtered per user, so a name this
            // user cannot read is free as far as the map knows and taken as far as
            // the server is concerned. Same answer either way: try the next one.
            if (/already exist/i.test(error?.response?.data?.message ?? "")) continue;
            pipelineCreators.value.push({
              message: t("pipeline.importErrors.functionCreateFailed", {
                index,
                name: candidate,
                reason: error?.response?.data?.message || t("pipeline.importErrors.unknownError"),
              }),
              success: false,
            });
            return false;
          }

          // A later pipeline in the same file, and a re-import of it, then reuse
          // this one instead of creating another copy.
          functionsByName.value.set(candidate, { ...fn, name: candidate });
          if (!existingFunctions.value.includes(candidate)) {
            existingFunctions.value.push(candidate);
          }
          functionsCreatedInBatch.value = true;
          target = candidate;
          pipelineCreators.value.push({
            message:
              n === 0
                ? t("pipeline.importErrors.functionCreated", { index, name: candidate })
                : t("pipeline.importErrors.functionCreatedCopy", {
                    index,
                    name: fn.name,
                    copy: candidate,
                  }),
            success: true,
            // A copy is the only signal a duplicate now exists, so it cannot read as plain success.
            warning: n > 0,
          });
          break;
        }

        if (!target) {
          pipelineCreators.value.push({
            message: t("pipeline.importErrors.functionNoFreeName", {
              index,
              name: fn.name,
              limit: MAX_FUNCTION_COPY_SUFFIX,
            }),
            success: false,
          });
          return false;
        }
        renamed.set(fn.name, target);
      }

      // Point every function node at the name that was actually resolved.
      (input?.nodes ?? []).forEach((node: any) => {
        if (node?.data?.node_type === "function" && renamed.has(node.data.name)) {
          node.data.name = renamed.get(node.data.name);
        }
      });

      return true;
    };

    const createPipeline = async (input: any, index: any) => {
      // The functions this file bundles come first: the nodes may be rewritten to
      // point at a copy, and nothing should be created if they cannot be resolved.
      if (!(await resolveBundledFunctions(input, index))) return false;

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

            ensureUnaryConditionValues(node.data.conditions);

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
          message: t("pipeline.importErrors.createSuccess", { index, name: input.name }),
          success: true,
        });

        // Emit update after each successful creation
        emit("update:pipelines");
        await getScheduledPipelines();

        return true;
      } catch (error: any) {
        // Failure
        pipelineCreators.value.push({
          message: t("pipeline.importErrors.createFailed", {
            index,
            name: input.name,
            reason: error?.response?.data?.message || t("pipeline.importErrors.unknownError"),
          }),
          success: false,
        });
        return false;
      }
    };

    const getSourceStreamsList = async (streamType: string, index: number) => {
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
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
      try {
        const streamResponse: any = await getStreams(streamType, false);
        //these will be used for destination stream
        const streamsNames = streamResponse.list.map((stream: any) => stream.name);
        const usedStreams = await pipelinesService.getPipelineStreams(
          store.state.selectedOrganization.identifier,
        );
        const usedStreamNames = usedStreams.data.list.map((stream: any) => stream.stream_name);
        //this is used to disable the stream names which are already used in the source stream
        streamList.value = streamsNames.map((stream: any) => {
          return {
            label: raw(stream),
            value: stream,
            disable: usedStreamNames.includes(stream),
          };
        });
      } catch (error) {
        console.error("Error fetching streams:", error);
      }
    };

    const getDestinationStreamsList = async (streamType: string, index: number) => {
      //update the stream type if user selects a different stream type
      if (index != -1 && baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "output") {
            node.data.stream_type = streamType;
          }
        });
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
      try {
        const streamResponse: any = await getStreams(streamType, false);
        //these will be used for destination stream
        streamData.value = streamResponse.list.map((stream: any) => stream.name);
      } catch (error) {
        console.error("Error fetching streams:", error);
      }
    };

    const getOutputStreamsList = async (streamType: string, index: number) => {
      //update the stream type if user selects a different stream type
      if (index != -1 && baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].nodes.forEach((node: any) => {
          if (node.io_type == "output") {
            node.data.stream_type = streamType;
          }
        });

        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
      try {
        const streamResponse: any = await getStreams(streamType, false);
        streamData.value = streamResponse.list.map((stream: any) => stream.name);
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
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
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
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
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
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    return {
      t,
      raw,
      importJson,
      router,
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
      timezoneSelectOptions,
      handleDynamicStreamName,
      scheduledPipelines,
      userSelectedOrgId,
      organizationData,
      updateOrgId,
      userSelectedTimezone,
      touchedPipelineName,
      touchedStreamType,
      touchedDestinationStreamType,
      touchedRemoteDestination,
      touchedFunctionName,
      touchedTimezone,
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
      resolveBundledFunctions,
      bundledFunctionsByName,
      sameFunctionLogic,
      normaliseFunctionBody,
      functionsByName,
      getFunctions,
      getAlertDestinations,
      getScheduledPipelines,
    };
  },
});
</script>
