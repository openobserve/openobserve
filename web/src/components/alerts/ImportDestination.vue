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
  <base-import
    ref="baseImportRef"
    :title="t('alert_destinations.import.title')"
    test-prefix="destination"
    :is-importing="isDestinationImporting"
    container-class=""
    @back="arrowBackFn"
    @cancel="router.back()"
    @import="importJson"
  >
    <!-- Output Section with Destination-specific Error Display -->
    <template #output-content>
      <div class="w-full h-full flex flex-col border-l border-border-default min-w-100">
        <div
          v-if="destinationErrorsToDisplay.length > 0 || destinationCreators.length > 0"
          class="text-center text-sm font-semibold text-text-heading py-3 shrink-0"
        >
          {{ destinationErrorsToDisplay.length > 0 ? t('alert_destinations.import.errorValidations') : t('alert_destinations.import.outputMessages') }}
        </div>
        <div v-else class="text-center text-sm font-semibold text-text-heading py-3 shrink-0">{{ t('alert_destinations.import.outputMessages') }}</div>
        <OSeparator class="mt-1 shrink-0" />
        <div class="flex-1 min-h-0 overflow-auto [resize:none] w-full min-w-100">
          <!-- Destination Errors Section -->
          <div
            class="error-section p-2.5 mb-2.5"
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
                  class="py-1.25 px-0 text-sm wrap-break-word"
                  :data-test="`destination-import-error-${index}-${errorIndex}`"
                >
                  <!-- Destination Name Error -->
                  <span
                    data-test="destination-import-name-error"
                    class="text-status-negative"
                    v-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'destination_name'
                    "
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OInput
                        data-test="destination-import-name-input"
                        :model-value="userSelectedDestinationName[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedDestinationName[index] = val;
                          updateDestinationName(val, index);
                        }"
                        :label="t('alert_destinations.import.destinationName') + ' *'"
                        class="showLabelOnTop"
                        tabindex="0"
                      />
                    </div>
                  </span>

                  <!-- URL Error -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'url'
                    "
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OInput
                        data-test="destination-import-url-input"
                        :model-value="userSelectedDestinationUrl[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedDestinationUrl[index] = val;
                          updateDestinationUrl(val, index);
                        }"
                        :label="t('alert_destinations.import.destinationUrl') + ' *'"
                        class="showLabelOnTop"
                        tabindex="0"
                      />
                    </div>
                  </span>

                  <!-- Type Error -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'type'
                    "
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OSelect
                        data-test="destination-import-type-input"
                        :model-value="userSelectedDestinationType[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedDestinationType[index] = val;
                          updateDestinationType(val, index);
                        }"
                        :options="destinationTypes"
                        :label="t('alert_destinations.destination_type') + ' *'"
                        class="py-2 showLabelOnTop no-case"
                      />
                    </div>
                  </span>

                  <!-- Method Error -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'method'
                    "
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OSelect
                        data-test="destination-import-method-input"
                        :model-value="userSelectedDestinationMethod[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedDestinationMethod[index] = val;
                          updateDestinationMethod(val, index);
                        }"
                        :options="destinationMethods"
                        :label="t('alert_destinations.import.destinationMethod') + ' *'"
                        class="py-2 showLabelOnTop no-case"
                      />
                    </div>
                  </span>

                  <!-- Template Name Error -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'template_name'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <OSelect
                        data-test="destination-import-template-input"
                        :model-value="userSelectedTemplates[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedTemplates[index] = val;
                          updateDestinationTemplate(val, index);
                          templateErrors[index] = getCorrectionRequiredError(val);
                        }"
                        :options="filteredTemplates"
                        :label="t('alert_destinations.import.templates') + ' *'"
                        class="py-2 showLabelOnTop no-case"
                        :error="!!templateErrors[index]"
                        :error-message="templateErrors[index]"
                        @search="filterTemplates"
                      />
                    </div>
                  </span>

                  <!-- Email Input Error -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'email_input'
                    "
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OInput
                        data-test="destination-import-emails-input"
                        :model-value="userSelectedEmails[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedEmails[index] = val;
                          updateDestinationEmails(val, index);
                        }"
                        :label="t('alert_destinations.import.emails') + ' *'"
                        class="showLabelOnTop"
                        tabindex="0"
                      />
                    </div>
                  </span>

                  <!-- Action ID Error -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'action_id'
                    "
                  >
                    {{ errorMessage.message }}
                    <div>
                      <OSelect
                        data-test="destination-import-action-input"
                        :model-value="userSelectedActionId[index] || ''"
                        @update:model-value="(val) => {
                          userSelectedActionId[index] = val;
                          updateDestinationAction(val, index);
                          actionErrors[index] = getCorrectionRequiredError(val);
                        }"
                        :options="filteredActions"
                        :label="t('alert_destinations.import.actions') + ' *'"
                        labelKey="label"
                        valueKey="value"
                        class="py-2 showLabelOnTop no-case w-75!"
                        :error="!!actionErrors[index]"
                        :error-message="actionErrors[index]"
                        @search="filterActions"
                      />
                    </div>
                  </span>

                  <!-- Skip TLS Verify Error -->
                  <span
                    class="text-status-negative"
                    v-else-if="
                      typeof errorMessage === 'object' &&
                      errorMessage.field == 'skip_tls_verify'
                    "
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OSwitch
                        data-test="destination-import-skip-tls-verify-input"
                        :model-value="userSelectedSkipTlsVerify[index] ?? false"
                        :label="t('alert_destinations.skip_tls_verify')"
                        class="mt-2"
                        @update:model-value="updateSkipTlsVerify($event, index)"
                      />
                    </div>
                  </span>

                  <span class="text-status-negative" v-else>{{ errorMessage }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Destination Creation Success Messages -->
          <div class="error-section p-2.5 mb-2.5" v-if="destinationCreators.length > 0">
            <div
              class="text-base mb-2.5 uppercase text-primary"
              data-test="destination-import-creation-title"
            >
              {{ t('alert_destinations.import.destinationCreation') }}
            </div>
            <div
              class="error-list"
              v-for="(val, index) in destinationCreators"
              :key="index"
              :data-test="`destination-import-creation-${index}`"
            >
              <div
                :class="{
                  'font-bold py-1.25 px-0 text-sm wrap-break-word': true,
                  'text-green ': val.success,
                  'text-status-negative': !val.success,
                }"
                :data-test="`destination-import-creation-${index}-message`"
              >
                <pre class="[white-space:pre-wrap] [word-wrap:break-word] [word-break:break-word] [overflow-wrap:break-word] font-[inherit] m-0">{{ val.message }}</pre>
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
  reactive,
  onMounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import destinationService from "@/services/alert_destination";
import BaseImport from "../common/BaseImport.vue";
import useActions from "@/composables/useActions";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

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
    const templateErrors = reactive<Record<number, string>>({});
    const actionErrors = reactive<Record<number, string>>({});

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

    const filterTemplates = (val: string) => {
      if (!val) {
        filteredTemplates.value = getFormattedTemplates.value;
        return;
      }
      const needle = val.toLowerCase();
      filteredTemplates.value = getFormattedTemplates.value.filter(
        (v: string) => v.toLowerCase().indexOf(needle) > -1,
      );
    };

    const filterActions = (val: string) => {
      if (!val) {
        filteredActions.value = userSelectedActionOptions.value;
        return;
      }
      const needle = val.toLowerCase();
      filteredActions.value = userSelectedActionOptions.value.filter(
        (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
      );
    };

    const importJson = async ({ jsonStr: jsonString, jsonArray }: any) => {
      // Validate correction fields that are currently displayed
      let hasCorrectionErrors = false;
      destinationErrorsToDisplay.value.forEach((errorGroup, idx) => {
        for (const msg of errorGroup) {
          if (typeof msg === 'object') {
            if (msg.field === 'template_name') {
              const requiredError = getCorrectionRequiredError(userSelectedTemplates.value[idx]);
              if (requiredError) {
                templateErrors[idx] = requiredError;
                hasCorrectionErrors = true;
              }
            }
            if (msg.field === 'action_id') {
              const requiredError = getCorrectionRequiredError(userSelectedActionId.value[idx]);
              if (requiredError) {
                actionErrors[idx] = requiredError;
                hasCorrectionErrors = true;
              }
            }
          }
        }
      });
      if (hasCorrectionErrors) {
        if (baseImportRef.value) baseImportRef.value.isImporting = false;
        return;
      }

      destinationErrorsToDisplay.value = [];
      destinationCreators.value = [];

      try {
        if (!jsonString || jsonString.trim() === "") {
          throw new Error(t("alert_destinations.import.jsonStringEmpty"));
        }

        const parsedJson = JSON.parse(jsonString);
        jsonArrayOfObj.value = Array.isArray(parsedJson)
          ? parsedJson
          : [parsedJson];
      } catch (e: any) {
        toast({
          message: e.message || t("alert_destinations.import.invalidJsonFormat"),
          variant: "error",
        });
        // Reset BaseImport's importing flag on validation error
        if (baseImportRef.value) {
          baseImportRef.value.isImporting = false;
        }
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
        toast({
          message: t("alert_destinations.import.importSuccess"),
          variant: "success",
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
        toast({
          message: t("alert_destinations.import.importError"),
          variant: "error",
        });
        return false;
      }
    };

    // Single source of truth for the correction "required" rule. The template
    // and action correction controls plus the pre-import correction gate below
    // all defer to this instead of re-deriving the required message inline, so
    // the destination JS validator owns the rule in one place.
    const getCorrectionRequiredError = (value: any): string =>
      value ? "" : t("alerts.validation.fieldRequired");

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
          message: t("alert_destinations.import.nameRequired", { index }),
          field: "destination_name",
        });
      } else if (
        props.destinations.some(
          (destination: any) => destination.name === input.name,
        )
      ) {
        destinationErrors.push({
          message: t("alert_destinations.import.nameExists", {
            index,
            name: input.name,
          }),
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
          message: t("alert_destinations.import.typeInvalid", { index }),
          field: "type",
        });
      }

      // Check if action type is supported when actions are not enabled
      if (input.type === "action" && !isActionsEnabled.value) {
        destinationErrors.push(
          t("alert_destinations.import.actionTypeNotSupported", { index }),
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
          message: t("alert_destinations.import.actionNotFound", {
            index,
            actionId: input.action_id,
            type: input.type,
          }),
          field: "action_id",
        });
      }

      // Validate URL for http type
      if (input.type === "http") {
        if (!input.url || typeof input.url !== "string" || input.url.trim() === "") {
          destinationErrors.push({
            message: t("alert_destinations.import.urlRequired", { index }),
            field: "url",
          });
        }

        if (
          !input.method ||
          !["post", "get", "put"].includes(input.method.toLowerCase())
        ) {
          destinationErrors.push({
            message: t("alert_destinations.import.methodInvalid", { index }),
            field: "method",
          });
        }

        if (!input.template || typeof input.template !== "string") {
          destinationErrors.push({
            message: t("alert_destinations.import.templateRequiredHttp", { index }),
            field: "template_name",
          });
        }

        // Validate skip_tls_verify is required and must be boolean
        if (
          input.skip_tls_verify === undefined ||
          typeof input.skip_tls_verify !== "boolean"
        ) {
          destinationErrors.push({
            message: t("alert_destinations.import.skipTlsVerifyRequired", { index }),
            field: "skip_tls_verify",
          });
        }

        // Validate headers should be an object if present
        if (input.headers !== undefined) {
          if (typeof input.headers !== "object" || Array.isArray(input.headers)) {
            destinationErrors.push(
              t("alert_destinations.import.headersMustBeObject", { index }),
            );
          }
        }
      }

      // Validate email type
      if (input.type === "email") {
        // Validate URL should not be present for email type
        if (input.url) {
          destinationErrors.push(
            t("alert_destinations.import.urlNotAllowedEmail", { index }),
          );
        }

        // Validate headers should not be present for email type
        if (
          input.hasOwnProperty("headers") &&
          Object.keys(input.headers).length !== 0
        ) {
          destinationErrors.push(
            t("alert_destinations.import.headersNotAllowedEmail", { index }),
          );
        }

        // Validate emails array with stricter validation
        if (!input.emails || !Array.isArray(input.emails) || input.emails.length === 0) {
          destinationErrors.push({
            message: t("alert_destinations.import.emailsRequired", { index }),
            field: "email_input",
          });
        } else if (input.emails.some((email: any) => typeof email !== "string")) {
          destinationErrors.push({
            message: t("alert_destinations.import.emailsMustBeStrings", { index }),
            field: "email_input",
          });
        }

        if (!input.template || typeof input.template !== "string") {
          destinationErrors.push({
            message: t("alert_destinations.import.templateRequiredEmail", { index }),
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
            message: t("alert_destinations.import.templateNotFound", {
              index,
              template: input.template,
              type: input.type,
            }),
            field: "template_name",
          });
        }
      }

      // Validate action_id if actions are enabled
      if (isActionsEnabled.value) {
        if (input.action_id && typeof input.action_id !== "string") {
          destinationErrors.push({
            message: t("alert_destinations.import.actionIdInvalid", { index }),
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
          message: t("alert_destinations.import.createSuccess", {
            index,
            name: input.name,
          }),
          success: true,
        });

        emit("update:destinations");

        return true;
      } catch (error: any) {
        destinationCreators.value.push({
          message: t("alert_destinations.import.createFailed", {
            index,
            name: input.name,
            reason:
              error?.response?.data?.message ||
              t("alert_destinations.import.unknownError"),
          }),
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
      templateErrors,
      actionErrors,
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
      getCorrectionRequiredError,
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
    OSeparator,
    BaseImport,
    OInput,
    OSelect,
    OSwitch,
  },
});
</script>
