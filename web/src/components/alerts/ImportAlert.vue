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
    title="Import Alert"
    test-prefix="alert"
    :is-importing="isAlertImporting"
    :editor-heights="{
      urlEditor: 'calc(100vh - 286px)',
      fileEditor: 'calc(100vh - 308px)',
      outputContainer: 'calc(100vh - 130px)',
      errorReport: 'calc(100vh - 192px)',
    }"
    @back="router.back()"
    @cancel="router.back()"
    @import="importJson"
  >
    <!-- Custom URL Input Section with Folder Dropdown -->
    <template #url-input-section="{ url, updateUrl }">
      <div class="flex tw:mt-[0.725rem] tw:h-[64px]">
        <div style="width: calc(69%)" class="q-pr-sm">
          <q-input
            data-test="alert-import-url-input"
            :model-value="url"
            @update:model-value="updateUrl"
            :placeholder="t('dashboard.addURL')"
            borderless
            style="padding: 10px 0px;"
          />
        </div>

        <div
          style="width: calc(30%);position: relative; bottom: 21px;"
          data-test="alert-folder-dropdown"
        >
          <SelectFolderDropDown
            :type="'alerts'"
            @folder-selected="updateActiveFolderId"
            :activeFolderId="activeFolderId"
          />
        </div>
      </div>
    </template>

    <!-- Custom File Input Section with Folder Dropdown -->
    <template #file-input-section="{ jsonFiles, updateFiles }">
      <div style="width: calc(100% - 10px)" class="q-mb-xs flex">
        <div style="width: calc(69%)" class="q-pr-sm">
          <q-file
            data-test="alert-import-json-file-input"
            :model-value="jsonFiles"
            @update:model-value="updateFiles"
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
                @click.stop.prevent="updateFiles(null)"
                class="cursor-pointer"
              />
            </template>
            <template v-slot:hint> .json files only </template>
          </q-file>
        </div>
        <div style="width: calc(30%); position: relative; bottom: 21px;">
          <SelectFolderDropDown
            :type="'alerts'"
            @folder-selected="updateActiveFolderId"
            :activeFolderId="activeFolderId"
          />
        </div>
      </div>
    </template>

    <!-- Output Section with Alert-specific Error Display -->
    <template #output-content>
      <div
        v-if="alertErrorsToDisplay.length > 0"
        class="text-center text-h6 tw:py-2"
      >
        Error Validations
      </div>
      <div v-else class="text-center text-h6 tw:py-2">Output Messages</div>
      <q-separator class="q-mx-md q-mt-md" />
      <div class="error-report-container" style="height: calc(100vh - 192px) !important; overflow: auto; resize: none;">
        <!-- Alert Errors Section -->
        <div class="error-section" v-if="alertErrorsToDisplay.length > 0">
          <div class="error-list">
            <!-- Iterate through the outer array -->
            <div
              v-for="(errorGroup, index) in alertErrorsToDisplay"
              :key="index"
              :data-test="`alert-import-error-${index}`"
            >
              <!-- Iterate through each inner array (the individual error message) -->
              <div
                v-for="(errorMessage, errorIndex) in errorGroup"
                :key="errorIndex"
                class="error-item"
                :data-test="`alert-import-error-${index}-${errorIndex}`"
              >
                <span
                  class="text-red"
                  v-if="
                    typeof errorMessage === 'object' &&
                    errorMessage.field == 'alert_name'
                  "
                >
                  {{ errorMessage.message }}

                  <div style="width: 300px">
                    <q-input
                      data-test="alert-import-name-input"
                      :model-value="userSelectedAlertName[index] || ''"
                      :label="t('alerts.name') + ' *'"
                      color="input-border"
                      bg-color="input-bg"
                      class="showLabelOnTop"
                      stack-label
                      outlined
                      filled
                      dense
                      tabindex="0"
                      @update:model-value="(val) => {
                        userSelectedAlertName[index] = val;
                        updateAlertName(val, index);
                      }"
                    />
                  </div>
                </span>
                <!-- Check if the errorMessage is an object, if so, display the 'message' property -->
                <span
                  class="text-red"
                  v-else-if="
                    typeof errorMessage === 'object' &&
                    errorMessage.field == 'stream_name'
                  "
                >
                  {{ errorMessage.message }}
                  <div style="width: 300px">
                    <q-select
                      data-test="alert-import-stream-name-input"
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
                    />
                  </div>
                </span>
                <span
                  class="text-red"
                  v-else-if="
                    typeof errorMessage === 'object' &&
                    errorMessage.field == 'destination_name'
                  "
                >
                  {{ errorMessage.message }}
                  <div>
                    <q-select
                      data-test="alert-import-destination-name-input"
                      :model-value="userSelectedDestinations[index] || []"
                      :options="filteredDestinations"
                      @filter="filterDestinations"
                      label="Destinations *"
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
                      multiple
                      :input-debounce="400"
                      behavior="menu"
                      :rules="[
                        (val: any) => !!val || 'Field is required!',
                      ]"
                      style="width: 300px"
                      @update:model-value="(val) => {
                        userSelectedDestinations[index] = val;
                        updateUserSelectedDestinations(val, index);
                      }"
                    >
                      <template v-slot:option="scope">
                        <q-item
                          v-bind="scope.itemProps"
                          :data-test="`add-alert-destination-${scope.opt}-select-item`"
                        >
                          <q-item-section side>
                            <q-checkbox
                              data-test="alert-import-destination-checkbox"
                              :model-value="
                                userSelectedDestinations[index]?.includes(
                                  scope.opt,
                                ) ?? false
                              "
                              dense
                              @update:model-value="
                                toggleDestination(scope.opt, index)
                              "
                            />
                          </q-item-section>
                          <q-item-section>
                            <q-item-label
                              data-test="alert-import-destination-label"
                              >{{ scope.opt }}</q-item-label
                            >
                          </q-item-section>
                        </q-item>
                      </template>
                    </q-select>
                  </div>
                </span>
                <span
                  class="text-red"
                  v-else-if="
                    typeof errorMessage === 'object' &&
                    errorMessage.field == 'stream_type'
                  "
                >
                  {{ errorMessage.message }}
                  <div>
                    <q-select
                      data-test="alert-import-stream-type-input"
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
                        updateStreams(val, index);
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
                    errorMessage.field == 'timezone'
                  "
                >
                  {{ errorMessage.message }}
                  <div>
                    <q-select
                      data-test="alert-import-timezone-input"
                      :model-value="userSelectedTimezone[index] || ''"
                      :options="filteredTimezone"
                      :label="'Timezone *'"
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
                      @filter="timezoneFilterFn"
                      use-input
                      hide-selected
                      fill-input
                      :input-debounce="400"
                      behavior="menu"
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
                    errorMessage.field == 'org_id'
                  "
                >
                  {{ errorMessage.message }}
                  <div style="width: 300px">
                    <q-select
                      data-test="alert-import-org-id-input"
                      :model-value="userSelectedOrgId[index] || null"
                      :options="organizationDataList"
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

                <span v-else>{{ errorMessage }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="error-section" v-if="alertCreators.length > 0">
          <div
            class="section-title text-primary"
            data-test="alert-import-creation-title"
          >
            Alert Creation
          </div>
          <div
            class="error-list"
            v-for="(val, index) in alertCreators"
            :key="index"
            :data-test="`alert-import-creation-${index}`"
          >
            <div
              :class="{
                'error-item text-bold': true,
                'text-green ': val.success,
                'text-red': !val.success,
              }"
              :data-test="`alert-import-creation-${index}-message`"
            >
              <pre>{{ val.message }}</pre>
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
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import alertsService from "../../services/alerts";
import useStreams from "@/composables/useStreams";
import BaseImport from "../common/BaseImport.vue";
import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import {
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
} from "@/utils/alerts/alertDataTransforms";

export default defineComponent({
  name: "ImportAlert",
  components: {
    BaseImport,
    SelectFolderDropDown,
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
  emits: ["update:destinations", "update:templates", "update:alerts"],
  setup(props, { emit }) {
    type ErrorMessage = {
      field: string;
      message: string;
    };
    type alertCreator = {
      message: string;
      success: boolean;
    }[];

    type AlertErrors = (ErrorMessage | string)[][];
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    const q = useQuasar();
    const { getStreams } = useStreams();

    const baseImportRef = ref<any>(null);
    const alertErrorsToDisplay = ref<AlertErrors>([]);
    const templateErrorsToDisplay = ref<any>([]);
    const destinationErrorsToDisplay = ref<any>([]);
    const userSelectedDestinations = ref<string[][]>([]);
    const userSelectedAlertName = ref<string[]>([]);

    const alertCreators = ref<alertCreator>([]);
    const destinationCreators = ref<any>([]);
    const streamList = ref<any>([]);
    const streams = ref<any>({});
    const userSelectedStreamName = ref<string[]>([]);
    const userSelectedStreamType = ref<string[]>([]);
    const filteredDestinations = ref<string[]>([]);

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
    const selectedFolderId = ref<any>(
      router.currentRoute.value.query.folder || "default",
    );
    const activeFolderId = ref(
      router.currentRoute.value.query.folder ||
        router.currentRoute.value.query?.folderId,
    );
    const activeFolderAlerts = ref<any>([]);
    const isAlertImporting = ref(false);
    const userSelectedOrgId = ref<any[]>([]);
    const organizationDataList = computed(() => {
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

    const updateUserSelectedDestinations = (
      destinations: string[],
      index: number,
    ) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].destinations = destinations;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateStreamFields = (stream_name: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].stream_name = stream_name;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateAlertName = (alertName: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = alertName;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    onMounted(() => {
      activeFolderId.value =
        router.currentRoute.value.query?.folder ||
        router.currentRoute.value.query?.folderId;
      getActiveFolderAlerts(activeFolderId.value as string);
    });

    const importJson = async ({ jsonStr: jsonString, jsonArray }: any) => {
      alertErrorsToDisplay.value = [];
      templateErrorsToDisplay.value = [];
      destinationErrorsToDisplay.value = [];
      alertCreators.value = [];
      destinationCreators.value = [];

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

      let allAlertsCreated = true;
      isAlertImporting.value = true;

      // Process each object in the array
      for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
        const success = await processJsonObject(jsonObj, index + 1);
        if (!success) {
          allAlertsCreated = false;
        }
      }

      if (allAlertsCreated) {
        q.notify({
          message: "Alert(s) imported successfully",
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });

        // Delay navigation to allow Monaco editor to complete all debounced operations
        // Monaco has a 300ms debounce, so we wait 400ms to be safe
        setTimeout(() => {
          router.push({
            name: "alertList",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
              folder: selectedFolderId.value,
            },
          });
        }, 400);
      }

      isAlertImporting.value = false;

      // Reset BaseImport's importing flag
      if (baseImportRef.value) {
        baseImportRef.value.isImporting = false;
      }
    };

    const processJsonObject = async (jsonObj: any, index: number) => {
      try {
        const isValidAlert = await validateAlertInputs(jsonObj, index);
        if (!isValidAlert) {
          return false;
        }

        if (alertErrorsToDisplay.value.length === 0 && isValidAlert) {
          return await createAlert(jsonObj, index, selectedFolderId.value);
        }
      } catch (e: any) {
        q.notify({
          message: "Error importing Alert(s) please check the JSON",
          color: "negative",
          position: "bottom",
          timeout: 2000,
        });
        return false;
      }
      return false;
    };

    const validateAlertInputs = async (input: any, index: number) => {
      let alertErrors: (string | { message: string; field: string })[] = [];

      // 1. Validate 'name' field
      if (
        !input.name ||
        typeof input.name !== "string" ||
        input.name.trim() === ""
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Name is mandatory and should be a valid string.`,
          field: "alert_name",
        });
      }
      const organizationData = store.state.organizations;
      const orgList = organizationData.map((org: any) => org.identifier);

      // 2. Validate 'org_id' field
      if (
        !input.org_id ||
        typeof input.org_id !== "string" ||
        input.org_id.trim() === "" ||
        input.org_id != store.state.selectedOrganization.identifier
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Organization Id is mandatory, should exist in organization list and should be equal to ${store.state.selectedOrganization.identifier}.`,
          field: "org_id",
        });
      }

      // 3. Validate 'stream_type' field
      const validStreamTypes = ["logs", "metrics", "traces"];
      if (!input.stream_type || !validStreamTypes.includes(input.stream_type)) {
        alertErrors.push({
          message: `Alert - ${index}: Stream Type is mandatory and should be one of: 'logs', 'metrics', 'traces'.`,
          field: "stream_type",
        });
      }

      try {
        const streamResponse: any = await getStreams(input.stream_type, false);
        streamList.value = streamResponse.list.map(
          (stream: any) => stream.name,
        );
      } catch (e) {
        const err: any = {
          message: `Alert - ${index}: Error fetching stream list. Please try again.`,
          field: "stream_list",
        };
        alertErrors.push(err);
      }

      // 4. Validate 'stream_name' field
      if (
        !input.stream_name ||
        typeof input.stream_name !== "string" ||
        !streamList.value.includes(input.stream_name)
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Stream Name is mandatory, should exist in the stream list and should be a valid string.`,
          field: "stream_name",
        });
      }

      // 5. Validate 'is_real_time' field
      if (typeof input.is_real_time !== "boolean") {
        alertErrors.push(
          `Alert - ${index}: Is Real-Time is mandatory and should be a boolean value.`,
        );
      }

      // 6. Validate 'query_condition' field
      if (input.query_condition && input.query_condition.conditions) {
        const validateV2Condition = (item: any): boolean => {
          if (item.filterType === 'group') {
            // V2 group - validate it has conditions array
            if (!Array.isArray(item.conditions)) {
              alertErrors.push(
                `Alert - ${index}: V2 group must have a conditions array.`,
              );
              return false;
            }
            // Recursively validate nested conditions
            return item.conditions.every((nestedItem: any) => validateV2Condition(nestedItem));
          } else if (item.filterType === 'condition') {
            // V2 condition - validate required fields
            if (!item.column || !item.operator || item.value === undefined) {
              alertErrors.push(
                `Alert - ${index}: V2 condition must have column, operator, and value.`,
              );
              return false;
            }
            // Validate operator for custom type
            if (
              input.query_condition.type === "custom" &&
              !["=", ">", "<", ">=", "<=", "Contains", "NotContains","contains","not_contains"].includes(
                item.operator,
              )
            ) {
              alertErrors.push(
                `Alert - ${index}: Invalid operator '${item.operator}'. Allowed: '=', '>', '<', '>=', '<=', 'Contains', 'NotContains'.`,
              );
              return false;
            }
            return true;
          }
          return true;
        };

        const validateV1Condition = (condition: any) => {
          // Check if it's a simple condition (V0/V1 format)
          if (condition.column && condition.operator && condition.value !== undefined) {
            if (
              input.query_condition.type === "custom" &&
              !["=", ">", "<", ">=", "<=", "Contains", "NotContains","contains","not_contains"].includes(
                condition.operator,
              )
            ) {
              alertErrors.push(
                `Alert - ${index}: Invalid operator in query condition. Allowed operators: '=', '>', '<', '>=', '<=', 'Contains', 'NotContains'.`,
              );
            }
            return;
          }

          // Check if it's a nested condition with 'and' or 'or' (V1 format)
          if (condition.and || condition.or) {
            const conditions = condition.and || condition.or;
            if (!Array.isArray(conditions)) {
              alertErrors.push(
                `Alert - ${index}: 'and'/'or' conditions must be an array.`,
              );
              return;
            }
            conditions.forEach(validateV1Condition);
            return;
          }

          // If neither a simple condition nor a nested condition
          alertErrors.push(
            `Alert - ${index}: Invalid condition format. Must have either column/operator/value or and/or operators.`,
          );
        };

        let conditionsToValidate = input.query_condition.conditions;

        // Check if conditions is wrapped with version field (new format from backend)
        if (conditionsToValidate.version !== undefined) {
          // Wrapped format: { version: 2, conditions: {...} }
          conditionsToValidate = conditionsToValidate.conditions;
        }

        // Determine format and validate accordingly
        if (Array.isArray(conditionsToValidate)) {
          // V0 format - flat array of conditions
          conditionsToValidate.forEach((condition:any) => {
            if (!condition.column || !condition.operator || condition.value === undefined) {
              alertErrors.push(
                `Alert - ${index}: Each query condition must have 'column', 'operator', and 'value'.`,
              );
            }
          });
        } else if (conditionsToValidate.filterType === 'group') {
          // V2 format - new structure with filterType
          validateV2Condition(conditionsToValidate);
        } else if (conditionsToValidate.and || conditionsToValidate.or) {
          // V1 format - nested conditions with and/or
          validateV1Condition(conditionsToValidate);
        } else {
          // Unknown format
          alertErrors.push(
            `Alert - ${index}: Unrecognized query condition format.`,
          );
        }
      }
      // 7. Validate 'sql' and 'promql'
      if (
        input.query_condition.type === "sql" &&
        typeof input.query_condition.sql !== "string"
      ) {
        alertErrors.push(
          `Alert - ${index}: SQL should be provided when the type is 'sql'.`,
        );
      }

      if (
        input.query_condition.type === "promql" &&
        typeof input.query_condition.promql !== "string"
      ) {
        alertErrors.push(
          `Alert - ${index}: PromQL should be provided when the type is 'promql'.`,
        );
      }

      // 8. Validate 'vrl_function'
      if (
        input.query_condition.vrl_function &&
        typeof input.query_condition.vrl_function !== "string"
      ) {
        alertErrors.push(
          `Alert - ${index}: VRL function should be a string or null.`,
        );
      }

      // 9. Validate 'multi_time_range'
      if (
        input.query_condition.type === "custom" &&
        input.query_condition.multi_time_range !== null &&
        (!Array.isArray(input.query_condition.multi_time_range) ||
          input.query_condition.multi_time_range.length > 0)
      ) {
        alertErrors.push(
          `Alert - ${index}: Multi Time Range should be an empty array or null.`,
        );
      }

      // 10. Validate 'trigger_condition'
      const triggerCondition = input.trigger_condition;
      if (!triggerCondition) {
        alertErrors.push(`Alert - ${index}: Trigger Condition is required.`);
      }
      if (
        isNaN(Number(triggerCondition.period)) ||
        triggerCondition.period < 1 ||
        typeof triggerCondition.period !== "number"
      ) {
        alertErrors.push(
          `Alert - ${index}: Period should be a positive number greater than 0 and should be a number.`,
        );
      }

      const validOperators = [
        "=",
        "!=",
        ">=",
        "<=",
        ">",
        "<",
        "Contains",
        "NotContains",
      ];
      if (!validOperators.includes(triggerCondition.operator)) {
        alertErrors.push(
          `Alert - ${index}: Operator should be one of: '=', '!=', '>=', '<=', '>', '<', 'Contains', 'NotContains'.`,
        );
      }

      if (
        isNaN(Number(triggerCondition.frequency)) ||
        triggerCondition.frequency < 1 ||
        typeof triggerCondition.frequency !== "number"
      ) {
        alertErrors.push(
          `Alert - ${index}: Frequency should be a positive number greater than 0 and should be a number.`,
        );
      }

      if (triggerCondition.cron && typeof triggerCondition.cron !== "string") {
        alertErrors.push(
          `Alert - ${index}: Cron expression should be a string.`,
        );
      }

      if (
        isNaN(Number(triggerCondition.threshold)) ||
        triggerCondition.threshold < 1 ||
        typeof triggerCondition.threshold !== "number"
      ) {
        alertErrors.push(
          `Alert - ${index}: Threshold should be a positive number greater than 0 and should be a number.`,
        );
      }

      if (
        isNaN(Number(triggerCondition.silence)) ||
        triggerCondition.silence < 0 ||
        typeof triggerCondition.silence !== "number"
      ) {
        alertErrors.push(
          `Alert - ${index}: Silence should be a positive number greater than or equal to 0 and should be a number.`,
        );
      }

      if (
        (triggerCondition.frequency_type !== "minutes" &&
          triggerCondition.frequency_type !== "cron") ||
        typeof triggerCondition.frequency_type !== "string"
      ) {
        alertErrors.push(
          `Alert - ${index}: Frequency Type must be 'minutes' or 'cron' and should be a string.`,
        );
      }

      if (
        triggerCondition.frequency_type === "cron" &&
        (triggerCondition.cron.trim() === "" ||
          typeof triggerCondition.cron !== "string")
      ) {
        alertErrors.push(
          `Alert - ${index}: Cron expression should be a valid cron expression.`,
        );
      }

      if (
        !input.destinations ||
        !Array.isArray(input.destinations) ||
        input.destinations.length === 0
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Destinations are required and should be an array.`,
          field: "destination_name",
        });
      }

      if (typeof input.enabled !== "boolean") {
        alertErrors.push(`Alert - ${index}: Enabled should be Boolean.`);
      }

      if (
        input.tz_offset &&
        (typeof input.tz_offset !== "number" || input.tz_offset < 0)
      ) {
        alertErrors.push(
          `Alert - ${index}: Timezone offset should be a number.`,
        );
      }

      if (
        (input.trigger_condition.frequency_type == "cron" &&
          !input.trigger_condition.hasOwnProperty("timezone")) ||
        input.trigger_condition.timezone === ""
      ) {
        alertErrors.push({
          message: `Alert - ${index}: Timezone is required when frequency type is 'cron'.`,
          field: "timezone",
        });
      }

      input.destinations.forEach((destination: any) => {
        if (!checkDestinationInList(props.destinations, destination)) {
          alertErrors.push({
            message: `Alert - ${index}: "${destination}" destination does not exist`,
            field: "destination_name",
          });
        }
      });

      // This condition is added to avoid the error when the updated_at is not a number
      if (typeof input.updated_at !== "number") {
        input.updated_at = null;
      }

      // Log all alert errors at the end
      if (alertErrors.length > 0) {
        alertErrorsToDisplay.value.push(alertErrors);
        return false;
      }

      return true;
    };

    const checkDestinationInList = (
      destinations: any,
      destinationName: any,
    ) => {
      const destinationsList = destinations.map(
        (destination: any) => destination.name,
      );
      return destinationsList.includes(destinationName);
    };

    const createAlert = async (input: any, index: any, folderId: any) => {
      if (!input.hasOwnProperty("context_attributes")) {
        input.context_attributes = {};
      }
      if (!input.trigger_condition.hasOwnProperty("timezone")) {
        input.trigger_condition.timezone = store.state.timezone;
      }
      if (!input.trigger_condition.hasOwnProperty("tolerance_in_secs")) {
        input.trigger_condition.tolerance_in_secs = null;
      }
      input.folder_id = folderId;
      input.owner = store.state.userInfo.email;
      input.last_edited_by = store.state.userInfo.email;

      // VERSION DETECTION AND CONVERSION
      // Convert V0 and V1 conditions to V2 format before creating alert
      if (input.query_condition && input.query_condition.conditions) {
        let convertedConditions = input.query_condition.conditions;

        // Check if it's already wrapped with version
        if (convertedConditions.version === 2 || convertedConditions.version === "2") {
          // Already wrapped, extract the inner conditions for detection
          convertedConditions = convertedConditions.conditions;
        }

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

        // Backend expects: query_condition: { conditions: { version: 2, conditions: {...} } }
        input.query_condition.conditions = {
          version: 2,
          conditions: convertedConditions,
        };
      }

      try {
        await alertsService.create_by_alert_id(
          store.state.selectedOrganization.identifier,
          input,
          folderId,
        );

        // Success
        alertCreators.value.push({
          message: `Alert - ${index}: "${input.name}" created successfully \nNote: please remove the created alert object ${input.name} from the json file`,
          success: true,
        });
        // Emit update after each successful creation
        emit("update:alerts", store, selectedFolderId.value);
        getActiveFolderAlerts(selectedFolderId.value);
        return true;
      } catch (error: any) {
        // Failure
        alertCreators.value.push({
          message: `Alert - ${index}: "${input.name}" creation failed --> \n Reason: ${error?.response?.data?.message || "Unknown Error"}`,
          success: false,
        });
        return false;
      }
    };

    const updateStreams = async (streamType: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].stream_type = streamType;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }

      try {
        const streamResponse: any = await getStreams(streamType, false);
        streamList.value = streamResponse.list.map(
          (stream: any) => stream.name,
        );
      } catch (error) {
        console.error("Error fetching streams:", error);
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
        filteredDestinations.value = getFormattedDestinations.value.filter(
          (destination: string) =>
            destination.toLowerCase().includes(val.toLowerCase()),
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
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        if (!baseImportRef.value.jsonArrayOfObj[index].trigger_condition) {
          baseImportRef.value.jsonArrayOfObj[index].trigger_condition = {};
        }
        baseImportRef.value.jsonArrayOfObj[index].trigger_condition.timezone = timezone;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const timezoneFilterFn = (val: string, update: Function) => {
      if (val === "") {
        update(() => {
          filteredTimezone.value = timezoneOptions;
        });
        return;
      }

      update(() => {
        const needle = val.toLowerCase();
        filteredTimezone.value = timezoneOptions.filter((timezone: string) =>
          timezone.toLowerCase().includes(needle),
        );
      });
    };

    const updateActiveFolderId = (newVal: any) => {
      selectedFolderId.value = newVal.value;
      getActiveFolderAlerts(selectedFolderId.value);
    };

    const getActiveFolderAlerts = async (folderId: string) => {
      if (!store.state.organizationData.allAlertsListByNames[folderId]) {
        const response: any = await alertsService.listByFolderId(
          1,
          1000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier,
          folderId,
          "",
        );

        store.dispatch("setAllAlertsListByNames", {
          ...store.state.organizationData.allAlertsListByNames,
          [folderId]: response.data.list.map((alert: any) => alert.name),
        });
      }
      activeFolderAlerts.value =
        store.state.organizationData.allAlertsListByNames[folderId];
    };

    const updateOrgId = (orgId: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].org_id = orgId;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    // Additional helper functions for testing
    const checkAlertsInList = (alerts: string[], alertName: string) => {
      return alerts.includes(alertName);
    };

    const onSubmit = (event: any) => {
      if (event?.preventDefault) {
        event.preventDefault();
      }
    };

    return {
      t,
      importJson,
      router,
      q,
      baseImportRef,
      alertErrorsToDisplay,
      templateErrorsToDisplay,
      destinationErrorsToDisplay,
      alertCreators,
      destinationCreators,
      userSelectedDestinations,
      getFormattedDestinations,
      jsonArrayOfObj,
      streamList,
      streams,
      userSelectedStreamName,
      updateStreamFields,
      updateAlertName,
      userSelectedAlertName,
      streamTypes,
      userSelectedStreamType,
      updateStreams,
      filterDestinations,
      filteredDestinations,
      updateUserSelectedDestinations,
      toggleDestination,
      userSelectedTimezone,
      filteredTimezone,
      updateTimezone,
      timezoneFilterFn,
      activeFolderId,
      updateActiveFolderId,
      selectedFolderId,
      getActiveFolderAlerts,
      activeFolderAlerts,
      store,
      isAlertImporting,
      organizationDataList,
      userSelectedOrgId,
      updateOrgId,
      // Exposed validation functions for testing
      validateAlertInputs,
      checkDestinationInList,
      checkAlertsInList,
      createAlert,
      onSubmit,
    };
  },
});
</script>

<style scoped lang="scss">
.error-report-container {
  height: calc(100vh - 192px) !important;
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
