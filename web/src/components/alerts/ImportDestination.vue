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
    title="Import Destination"
    test-prefix="destination"
    :is-importing="isDestinationImporting"
    container-class="o2-custom-bg"
    container-style="height: calc(100vh - 50px);"
    :editor-heights="{
      urlEditor: 'calc(100vh - 286px)',
      fileEditor: 'calc(100vh - 306px)',
      outputContainer: 'calc(100vh - 128px)',
      errorReport: 'calc(100vh - 128px)',
    }"
    @back="arrowBackFn"
    @cancel="router.back()"
    @import="importJson"
  >
    <!-- Output Section with Destination-specific Error Display -->
    <template #output-content>
      <div class="tw:w-full" style="min-width: 400px;">
        <div
          v-if="destinationErrorsToDisplay.length > 0 || destinationCreators.length > 0"
          class="text-center text-h6 tw:py-2"
        >
          {{ destinationErrorsToDisplay.length > 0 ? 'Error Validations' : 'Output Messages' }}
        </div>
        <div v-else class="text-center text-h6 tw:py-2">Output Messages</div>
        <q-separator class="q-mx-md q-mt-md" />
        <div class="error-report-container">
          <!-- Destination Errors Section -->
          <div
            class="error-section"
            v-if="destinationErrorsToDisplay.length > 0"
          >
            <div class="error-list">
              <!-- Iterate through the outer array -->
              <div
                v-for="(errorGroup, index) in destinationErrorsToDisplay"
                :key="index"
              >
                <!-- Iterate through each inner array (the individual error message) -->
                <div
                  v-for="(errorMessage, errorIndex) in errorGroup"
                  :key="errorIndex"
                  class="error-item"
                  :data-test="`destination-import-error-${index}-${errorIndex}`"
                >
                  <!-- Destination Name Error -->
                  <span
                    data-test="destination-import-name-error"
                    class="text-red"
                    v-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'destination_name'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <q-input
                        data-test="destination-import-name-input"
                        :model-value="userSelectedDestinationName[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedDestinationName[index] = val;
                          updateDestinationName(val, index);
                        }"
                        :label="'Destination Name *'"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                      />
                    </div>
                  </span>

                  <!-- URL Error -->
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'url'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <q-input
                        data-test="destination-import-url-input"
                        :model-value="userSelectedDestinationUrl[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedDestinationUrl[index] = val;
                          updateDestinationUrl(val, index);
                        }"
                        :label="'Destination URL *'"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                      />
                    </div>
                  </span>

                  <!-- Type Error -->
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'type'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <q-select
                        data-test="destination-import-type-input"
                        :model-value="userSelectedDestinationType[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedDestinationType[index] = val;
                          updateDestinationType(val, index);
                        }"
                        :options="destinationTypes"
                        :label="'Destination Type *'"
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
                        behavior="menu"
                      />
                    </div>
                  </span>

                  <!-- Method Error -->
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'method'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <q-select
                        data-test="destination-import-method-input"
                        :model-value="userSelectedDestinationMethod[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedDestinationMethod[index] = val;
                          updateDestinationMethod(val, index);
                        }"
                        :options="destinationMethods"
                        :label="'Destination Method *'"
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
                        behavior="menu"
                      />
                    </div>
                  </span>

                  <!-- Template Name Error -->
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'template_name'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <q-select
                        data-test="destination-import-template-input"
                        :model-value="userSelectedTemplates[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedTemplates[index] = val;
                          updateDestinationTemplate(val, index);
                        }"
                        :options="filteredTemplates"
                        label="Templates *"
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
                        input-debounce="400"
                        behavior="menu"
                        hide-selected
                        fill-input
                        @filter="filterTemplates"
                        :rules="[(val) => !!val || 'Field is required!']"
                        style="width: 300px"
                      >
                      </q-select>
                    </div>
                  </span>

                  <!-- Email Input Error -->
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'email_input'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <q-input
                        data-test="destination-import-emails-input"
                        :model-value="userSelectedEmails[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedEmails[index] = val;
                          updateDestinationEmails(val, index);
                        }"
                        :label="'Emails (comma separated) *'"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop"
                        stack-label
                        outlined
                        filled
                        dense
                        tabindex="0"
                      />
                    </div>
                  </span>

                  <!-- Action ID Error -->
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'action_id'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <q-select
                        data-test="destination-import-action-input"
                        :model-value="userSelectedActionId[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedActionId[index] = val;
                          updateDestinationAction(val, index);
                        }"
                        :options="filteredActions"
                        label="Actions *"
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
                        emit-value
                        map-options
                        input-debounce="400"
                        behavior="menu"
                        hide-selected
                        fill-input
                        @filter="filterActions"
                        :rules="[(val) => !!val || 'Field is required!']"
                        style="width: 300px"
                      >
                      </q-select>
                    </div>
                  </span>

                  <!-- Skip TLS Verify Error -->
                  <span
                    class="text-red"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'skip_tls_verify'
                    "
                  >
                    {{ errorMessage.message }}
                    <div style="width: 300px">
                      <q-toggle
                        data-test="destination-import-skip-tls-verify-input"
                        :model-value="
                          userSelectedSkipTlsVerify[index] ?? false
                        "
                        :label="t('alert_destinations.skip_tls_verify')"
                        class="q-mt-sm"
                        @update:model-value="
                          updateSkipTlsVerify($event, index)
                        "
                      />
                    </div>
                  </span>

                  <span class="text-red" v-else>{{ errorMessage }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Destination Creation Success Messages -->
          <div class="error-section" v-if="destinationCreators.length > 0">
            <div
              class="section-title text-primary"
              data-test="destination-import-creation-title"
            >
              Destination Creation
            </div>
            <div
              class="error-list"
              v-for="(val, index) in destinationCreators"
              :key="index"
              :data-test="`destination-import-creation-${index}`"
            >
              <div
                :class="{
                  'error-item text-bold': true,
                  'text-green ': val.success,
                  'text-red': !val.success,
                }"
                :data-test="`destination-import-creation-${index}-message`"
              >
                <pre>{{ val.message }}</pre>
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
  computed,
  onMounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import destinationService from "@/services/alert_destination";
import BaseImport from "../common/BaseImport.vue";
import useActions from "@/composables/useActions";

export default defineComponent({
  name: "ImportDestination",
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
    type destinationCreator = {
      message: string;
      success: boolean;
    }[];
    type destinationErrors = (ErrorMessage | string)[][];

    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const q = useQuasar();
    const { isActionsEnabled } = useActions();

    const baseImportRef = ref<any>(null);
    const destinationErrorsToDisplay = ref<destinationErrors>([]);
    const destinationCreators = ref<destinationCreator>([]);
    const isDestinationImporting = ref(false);

    const destinationTypes = ["http", "email"];
    const destinationMethods = ["post", "get", "put"];

    const userSelectedTemplates = ref<string[]>([]);
    const userSelectedDestinationType = ref<any[]>([]);
    const userSelectedDestinationMethod = ref<any[]>([]);
    const userSelectedDestinationName = ref<any[]>([]);
    const userSelectedDestinationUrl = ref<any[]>([]);
    const userSelectedEmails = ref<any[]>([]);
    const userSelectedActionId = ref<any[]>([]);
    const userSelectedSkipTlsVerify = ref<boolean[]>([]);
    const filteredTemplates = ref<string[]>([]);
    const filteredActions = ref<any[]>([]);

    // Use computed to directly reference BaseImport's jsonArrayOfObj
    const jsonArrayOfObj = computed({
      get: () => baseImportRef.value?.jsonArrayOfObj || [],
      set: (val) => {
        if (baseImportRef.value) {
          baseImportRef.value.jsonArrayOfObj = val;
        }
      }
    });

    const getFormattedTemplates = computed(() => {
      return props.templates
        .filter((template: any) => {
          const currentDestinationType =
            jsonArrayOfObj.value[destinationErrorsToDisplay.value.length - 1]
              ?.type;

          if (currentDestinationType === "email" && template.type === "email") {
            return true;
          } else if (currentDestinationType !== "email") {
            return true;
          }
          return false;
        })
        .map((template: any) => template.name);
    });

    const userSelectedActionOptions = ref([]);

    onMounted(async () => {
      try {
        const actionsData = await store.dispatch("getActions", {
          org_identifier: store.state.selectedOrganization.identifier,
        });
        // Filter to only show service-type actions
        userSelectedActionOptions.value = actionsData.list
          .filter((action: any) => action.execution_details_type === "service")
          .map((action: any) => ({
            label: action.name,
            value: action.id,
          }));
        filteredActions.value = userSelectedActionOptions.value;
      } catch (error) {
        console.error("Error fetching actions:", error);
      }
    });

    const getServiceActions = () => {
      return (
        store.state.organizationData.actions.filter(
          (action: any) => action.execution_details_type === "service",
        ) || []
      );
    };

    const updateDestinationType = (type: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].type = type;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateDestinationMethod = (method: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].method = method;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateDestinationName = (destinationName: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = destinationName;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateDestinationUrl = (url: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].url = url;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateDestinationTemplate = (template: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].template = template;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateDestinationAction = (id: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].action_id = id;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateDestinationEmails = (emails: string, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].emails = emails
          .split(",")
          .map((email) => email.trim());
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateSkipTlsVerify = (value: boolean, index: number) => {
      userSelectedSkipTlsVerify.value[index] = value;
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].skip_tls_verify = value;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const filterTemplates = (val: string, update: Function) => {
      if (val === "") {
        update(() => {
          filteredTemplates.value = getFormattedTemplates.value;
        });
        return;
      }

      update(() => {
        const needle = val.toLowerCase();
        filteredTemplates.value = getFormattedTemplates.value.filter(
          (v: string) => v.toLowerCase().indexOf(needle) > -1,
        );
      });
    };

    const filterActions = (val: string, update: Function) => {
      if (val === "") {
        update(() => {
          filteredActions.value = userSelectedActionOptions.value;
        });
        return;
      }

      update(() => {
        const needle = val.toLowerCase();
        filteredActions.value = userSelectedActionOptions.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
        );
      });
    };

    const importJson = async ({ jsonStr: jsonString, jsonArray }: any) => {
      destinationErrorsToDisplay.value = [];
      destinationCreators.value = [];

      try {
        if (!jsonString || jsonString.trim() === "") {
          throw new Error("JSON string is empty");
        }

        const parsedJson = JSON.parse(jsonString);
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

      let successCount = 0;
      const totalCount = jsonArrayOfObj.value.length;
      isDestinationImporting.value = true;

      for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
        const success = await processJsonObject(jsonObj, index + 1);
        if (success) {
          successCount++;
        }
      }

      if (successCount === totalCount) {
        q.notify({
          message: `Successfully imported destination(s)`,
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });

        setTimeout(() => {
          router.push({
            name: "alertDestinations",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
            },
          });
        }, 400);
      }

      isDestinationImporting.value = false;

      if (baseImportRef.value) {
        baseImportRef.value.isImporting = false;
      }
    };

    const processJsonObject = async (jsonObj: any, index: number) => {
      try {
        const isValidDestination = await validateDestinationInputs(
          jsonObj,
          index,
        );
        if (!isValidDestination) {
          return false;
        }

        if (destinationErrorsToDisplay.value.length === 0) {
          const hasCreatedDestination = await createDestination(jsonObj, index);
          return hasCreatedDestination;
        }
        return false;
      } catch (e: any) {
        q.notify({
          message: "Error importing Destination please check the JSON",
          color: "negative",
          position: "bottom",
          timeout: 2000,
        });
        return false;
      }
    };

    const validateDestinationInputs = async (input: any, index: number) => {
      let destinationErrors: (string | { message: string; field: string })[] =
        [];

      // Validate name
      if (
        !input.name ||
        typeof input.name !== "string" ||
        input.name.trim() === ""
      ) {
        destinationErrors.push({
          message: `Destination - ${index}: The "name" field is required and should be a valid string.`,
          field: "destination_name",
        });
      } else if (
        props.destinations.some(
          (destination: any) => destination.name === input.name,
        )
      ) {
        destinationErrors.push({
          message: `Destination - ${index}: "${input.name}" already exists`,
          field: "destination_name",
        });
      }

      // Validate type
      if (
        !input.type ||
        (input.type !== "email" &&
         input.type !== "http" &&
         input.type !== "action")
      ) {
        destinationErrors.push({
          message: `Destination - ${index}: The "type" field must be either "email", "http", or "action"`,
          field: "type",
        });
      }

      // Check if action type is supported when actions are not enabled
      if (input.type === "action" && !isActionsEnabled.value) {
        destinationErrors.push(
          `Destination - ${index}: 'action' type is not supported.`,
        );
      }

      // Validate action_id exists when type is action
      const availableActions = getServiceActions().map(
        (action: any) => action.id,
      );

      if (
        isActionsEnabled.value &&
        input.type === "action" &&
        !availableActions.includes(input.action_id)
      ) {
        destinationErrors.push({
          message: `Destination - ${index}: action "${input.action_id}" does not exist for type "${input.type}"`,
          field: "action_id",
        });
      }

      // Validate URL for http type
      if (input.type === "http") {
        if (!input.url || typeof input.url !== "string" || input.url.trim() === "") {
          destinationErrors.push({
            message: `Destination - ${index}: The "url" field is required for http type destinations.`,
            field: "url",
          });
        }

        if (
          !input.method ||
          !["post", "get", "put"].includes(input.method.toLowerCase())
        ) {
          destinationErrors.push({
            message: `Destination - ${index}: The "method" field must be one of "post", "get", or "put"`,
            field: "method",
          });
        }

        if (!input.template || typeof input.template !== "string") {
          destinationErrors.push({
            message: `Destination - ${index}: The "template" field is required for http type destinations.`,
            field: "template_name",
          });
        }

        // Validate skip_tls_verify is required and must be boolean
        if (
          input.skip_tls_verify === undefined ||
          typeof input.skip_tls_verify !== "boolean"
        ) {
          destinationErrors.push({
            message: `Destination - ${index}: The "skip_tls_verify" field is required and should be a boolean value`,
            field: "skip_tls_verify",
          });
        }

        // Validate headers should be an object if present
        if (input.headers !== undefined) {
          if (typeof input.headers !== "object" || Array.isArray(input.headers)) {
            destinationErrors.push(
              `Destination - ${index}: 'headers' should be an object for http type`,
            );
          }
        }
      }

      // Validate email type
      if (input.type === "email") {
        // Validate URL should not be present for email type
        if (input.url) {
          destinationErrors.push(
            `Destination - ${index}: 'url' should not be provided for email type`,
          );
        }

        // Validate headers should not be present for email type
        if (
          input.hasOwnProperty("headers") &&
          Object.keys(input.headers).length !== 0
        ) {
          destinationErrors.push(
            `Destination - ${index}: 'headers' should not be provided for email type`,
          );
        }

        // Validate emails array with stricter validation
        if (!input.emails || !Array.isArray(input.emails) || input.emails.length === 0) {
          destinationErrors.push({
            message: `Destination - ${index}: The "emails" field is required and should be an array for email type destinations.`,
            field: "email_input",
          });
        } else if (input.emails.some((email: any) => typeof email !== "string")) {
          destinationErrors.push({
            message: `Destination - ${index}: 'emails' should be an array of strings for email type`,
            field: "email_input",
          });
        }

        if (!input.template || typeof input.template !== "string") {
          destinationErrors.push({
            message: `Destination - ${index}: The "template" field is required for email type destinations.`,
            field: "template_name",
          });
        }
      }

      // Validate template exists in available templates
      if (input.template) {
        const availableTemplates = props.templates
          .filter((template: any) => {
            if (input.type === "email" && template.type === "email") return true;
            else if (input.type !== "email") return true;
            return false;
          })
          .map((template: any) => template.name);

        if (!availableTemplates.includes(input.template)) {
          destinationErrors.push({
            message: `Destination - ${index}: template "${input.template}" does not exist for type "${input.type}"`,
            field: "template_name",
          });
        }
      }

      // Validate action_id if actions are enabled
      if (isActionsEnabled.value) {
        if (input.action_id && typeof input.action_id !== "string") {
          destinationErrors.push({
            message: `Destination - ${index}: The "action_id" field must be a valid string.`,
            field: "action_id",
          });
        }
      }

      if (destinationErrors.length > 0) {
        destinationErrorsToDisplay.value.push(destinationErrors);
        return false;
      }

      return true;
    };

    const createDestination = async (input: any, index: number) => {
      try {
        await destinationService.create({
          org_identifier: store.state.selectedOrganization.identifier,
          destination_name: input.name,
          data: input,
        });

        destinationCreators.value.push({
          message: `Destination - ${index}: "${input.name}" created successfully \nNote: please remove the created destination object ${input.name} from the json file `,
          success: true,
        });

        emit("update:destinations");

        return true;
      } catch (error: any) {
        destinationCreators.value.push({
          message: `Destination - ${index}: "${input.name}" creation failed --> \n Reason: ${error?.response?.data?.message || "Unknown Error"}`,
          success: false,
        });
        return false;
      }
    };

    const arrowBackFn = () => {
      router.push({
        name: "alertDestinations",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    return {
      t,
      importJson,
      router,
      q,
      baseImportRef,
      destinationErrorsToDisplay,
      destinationCreators,
      jsonArrayOfObj,
      destinationTypes,
      destinationMethods,
      userSelectedDestinationType,
      userSelectedDestinationMethod,
      userSelectedDestinationName,
      userSelectedDestinationUrl,
      userSelectedTemplates,
      userSelectedEmails,
      userSelectedActionId,
      userSelectedSkipTlsVerify,
      filteredTemplates,
      filteredActions,
      updateDestinationType,
      updateDestinationMethod,
      updateDestinationName,
      updateDestinationUrl,
      updateDestinationTemplate,
      updateDestinationAction,
      updateDestinationEmails,
      updateSkipTlsVerify,
      filterTemplates,
      filterActions,
      getServiceActions,
      arrowBackFn,
      isDestinationImporting,
      store,
      getFormattedTemplates,
      // Exposed validation and helper functions for testing
      validateDestinationInputs,
      createDestination,
      processJsonObject,
    };
  },
  components: {
    BaseImport,
  },
});
</script>

<style scoped lang="scss">
.error-report-container {
  height: calc(60vh - 8px) !important;
  overflow: auto;
  resize: none;
  width: 100%;
  min-width: 400px;
}

.error-section {
  padding: 10px;
  margin-bottom: 10px;

  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
    font-family: inherit;
    margin: 0;
  }
}

.section-title {
  font-size: 16px;
  margin-bottom: 10px;
  text-transform: uppercase;
}

.error-item {
  padding: 5px 0px;
  font-size: 14px;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
}
</style>
