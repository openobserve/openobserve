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
    title="Import Template"
    test-prefix="template"
    :is-importing="isTemplateImporting"
    container-class="o2-custom-bg"
    container-style="height: calc(100vh - 50px);"
    :editor-heights="{
      urlEditor: 'calc(100vh - 286px)',
      fileEditor: 'calc(100vh - 306px)',
      outputContainer: 'calc(100vh - 130px)',
      errorReport: 'calc(100vh - 130px)',
    }"
    @back="arrowBackFn"
    @cancel="router.back()"
    @import="importJson"
  >
    <!-- Output Section with Template-specific Error Display -->
    <template #output-content>
      <div class="tw:w-full" style="min-width: 400px;">
        <div
          v-if="templateErrorsToDisplay.length > 0 || tempalteCreators.length > 0"
          class="text-center text-h6 tw:py-2"
        >
          {{ templateErrorsToDisplay.length > 0 ? 'Error Validations' : 'Output Messages' }}
        </div>
        <div v-else class="text-center text-h6 tw:py-2">Output Messages</div>
        <q-separator class="q-mx-md q-mt-md" />
        <div class="error-report-container">
        <!-- Template Errors Section -->
        <div
          class="error-section"
          v-if="templateErrorsToDisplay.length > 0"
        >
          <div class="error-list">
            <!-- Iterate through the outer array -->
            <div
              v-for="(errorGroup, index) in templateErrorsToDisplay"
              :key="index"
              :data-test="`template-import-error-${index}`"
            >
              <!-- Iterate through each inner array (the individual error message) -->
              <div
                v-for="(errorMessage, errorIndex) in errorGroup"
                :key="errorIndex"
                class="error-item"
                :data-test="`template-import-error-${index}-${errorIndex}`"
              >
                <span
                  class="text-red"
                  v-if="
                    typeof errorMessage === 'object' &&
                    errorMessage.field == 'template_name'
                  "
                >
                  {{ errorMessage.message }}
                  <div style="width: 300px">
                    <q-input
                      data-test="template-import-name-input"
                      :model-value="userSelectedTemplateNames[index] || ''"
                      @update:model-value="(val) => {
                        userSelectedTemplateNames[index] = val;
                        updateTemplateName(val, index);
                      }"
                      :label="'Template Name *'"
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
                <span
                  class="text-red"
                  v-else-if="
                    typeof errorMessage === 'object' &&
                    errorMessage.field == 'body'
                  "
                >
                  {{ errorMessage.message }}
                  <div style="width: 300px">
                    <q-input
                      data-test="template-import-body-input"
                      :model-value="userSelectedTemplateBodies[index] || ''"
                      @update:model-value="(val) => {
                        userSelectedTemplateBodies[index] = val;
                        updateTemplateBody(val, index);
                      }"
                      :label="'Template Body *'"
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
                <!-- Check if the errorMessage is an object, if so, display the 'message' property -->
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
                      data-test="template-import-type-input"
                      :model-value="userSelectedTemplateTypes[index] || ''"
                      @update:model-value="(val) => {
                        userSelectedTemplateTypes[index] = val;
                        updateTemplateType(val, index);
                      }"
                      :options="destinationTypes"
                      :label="'Template Type *'"
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
                <span
                  class="text-red"
                  v-else-if="
                    typeof errorMessage === 'object' &&
                    errorMessage.field == 'title'
                  "
                >
                  {{ errorMessage.message }}
                  <div style="width: 300px">
                    <q-input
                      data-test="template-import-title-input"
                      :model-value="userSelectedTemplateTitles[index] || ''"
                      @update:model-value="(val) => {
                        userSelectedTemplateTitles[index] = val;
                        updateTemplateTitle(val, index);
                      }"
                      :label="'Template Title *'"
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
                <span class="text-red" v-else>{{ errorMessage }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="error-section" v-if="tempalteCreators.length > 0">
          <div
            class="section-title text-primary"
            data-test="template-import-creation-title"
          >
            Template Creation
          </div>
          <div
            class="error-list"
            v-for="(val, index) in tempalteCreators"
            :key="index"
            :data-test="`template-import-creation-${index}`"
          >
            <div
              :class="{
                'error-item text-bold': true,
                'text-green ': val.success,
                'text-red': !val.success,
              }"
              :data-test="`template-import-creation-${index}-message`"
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
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import templateService from "@/services/alert_templates";
import BaseImport from "../common/BaseImport.vue";
import {
  validateTemplateBody,
  getTemplateValidationErrorMessage,
} from "@/utils/templates/validation";

export default defineComponent({
  name: "ImportTemplate",
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
    type templateCreator = {
      message: string;
      success: boolean;
    }[];
    type templateErrors = (ErrorMessage | string)[][];

    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const q = useQuasar();

    const baseImportRef = ref<any>(null);
    const templateErrorsToDisplay = ref<templateErrors>([]);
    const destinationTypes = ["http", "email"];
    const tempalteCreators = ref<templateCreator>([]);
    const userSelectedTemplateTypes = ref<any[]>([]);
    const userSelectedTemplateNames = ref<any[]>([]);
    const userSelectedTemplateBodies = ref<any[]>([]);
    const userSelectedTemplateTitles = ref<any[]>([]);
    const isTemplateImporting = ref(false);

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
      return props.templates.map((template: any) => {
        return template.name;
      });
    });

    const updateTemplateType = (type: string, index: number) => {
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

    const updateTemplateName = (name: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = name;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateTemplateBody = (body: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].body = body;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const updateTemplateTitle = (title: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].title = title;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(
          baseImportRef.value.jsonArrayOfObj,
          null,
          2
        );
      }
    };

    const importJson = async ({ jsonStr: jsonString, jsonArray }: any) => {
      templateErrorsToDisplay.value = [];
      tempalteCreators.value = [];

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

      let successCount = 0;
      const totalCount = jsonArrayOfObj.value.length;
      isTemplateImporting.value = true;

      for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
        const success = await processJsonObject(jsonObj, index + 1);
        if (success) {
          successCount++;
        }
      }

      // Only redirect and show success message if ALL templates were imported successfully
      if (successCount === totalCount) {
        q.notify({
          message: `Successfully imported template(s)`,
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });

        setTimeout(() => {
          router.push({
            name: "alertTemplates",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
            },
          });
        }, 400);
      }

      isTemplateImporting.value = false;

      if (baseImportRef.value) {
        baseImportRef.value.isImporting = false;
      }
    };

    const processJsonObject = async (jsonObj: any, index: number) => {
      try {
        const isValidTemplate = await validateTemplateInputs(jsonObj, index);
        if (!isValidTemplate) {
          return false;
        }

        const hasCreatedTemplate = await createTemplate(jsonObj, index);
        return hasCreatedTemplate;
      } catch (e: any) {
        q.notify({
          message: "Error importing Template please check the JSON",
          color: "negative",
          position: "bottom",
          timeout: 2000,
        });
        return false;
      }
    };

    const validateTemplateInputs = async (input: any, index: number) => {
      let templateErrors: (string | { message: string; field: string })[] = [];

      // Validate name using the updated props.templates
      if (
        !input.name ||
        typeof input.name !== "string" ||
        input.name.trim() === ""
      ) {
        templateErrors.push({
          message: `Template - ${index}: The "name" field is required and should be a valid string.`,
          field: "template_name",
        });
      } else if (
        props.templates.some((template: any) => template.name === input.name)
      ) {
        templateErrors.push({
          message: `Template - ${index}: "${input.name}" already exists`,
          field: "template_name",
        });
      }

      // Validate type
      if (!input.type || (input.type !== "email" && input.type !== "http")) {
        templateErrors.push({
          message: `Template - ${index}: The "type" field must be either "email" or "http"`,
          field: "type",
        });
      }

      // Validate body
      if (
        !input.body ||
        typeof input.body !== "string" ||
        input.body.trim() === ""
      ) {
        templateErrors.push({
          message: `Template - ${index}: The "body" field is required and should be a valid JSON string.`,
          field: "body",
        });
      } else {
        const result = validateTemplateBody(input.body);
        if (!result.valid) {
            templateErrors.push({
            message: `Template - ${index}: The "body" field should contain valid JSON. Placeholders like {value} for numbers and "{name}" for strings are supported.`,
            field: "body",
          });
        }
      }

      // Validate title for email type
      if (input.type === "email") {
        if (
          !input.title ||
          typeof input.title !== "string" ||
          input.title.trim() === ""
        ) {
          templateErrors.push({
            message: `Template - ${index}: The "title" field is required for email type templates.`,
            field: "title",
          });
        }
      }

      if (templateErrors.length > 0) {
        templateErrorsToDisplay.value.push(templateErrors);
        return false;
      }

      return true;
    };

    const checkTemplatesInList = (templates: any, templateName: any) => {
      const templatesList = templates.map((template: any) => template.name);
      return templatesList.includes(templateName);
    };

    const createTemplate = async (input: any, index: number) => {
      try {
        await templateService.create({
          org_identifier: store.state.selectedOrganization.identifier,
          template_name: input.name,
          data: {
            name: input.name.trim(),
            body: input.body,
            type: input.type,
            title: input.title,
          },
        });

        tempalteCreators.value.push({
          message: `Template - ${index}: "${input.name}" created successfully \nNote: please remove the created alert object ${input.name} from the json file `,
          success: true,
        });

        // Emit update after each successful creation
        emit("update:templates");

        return true;
      } catch (error: any) {
        tempalteCreators.value.push({
          message: `Template - ${index}: "${input.name}" creation failed --> \n Reason: ${error?.response?.data?.message || "Unknown Error"}`,
          success: false,
        });
        return false;
      }
    };

    const arrowBackFn = () => {
      router.push({
        name: "alertTemplates",
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
      templateErrorsToDisplay,
      tempalteCreators,
      getFormattedTemplates,
      jsonArrayOfObj,
      userSelectedTemplateTypes,
      updateTemplateType,
      updateTemplateName,
      arrowBackFn,
      userSelectedTemplateNames,
      userSelectedTemplateBodies,
      userSelectedTemplateTitles,
      destinationTypes,
      updateTemplateBody,
      updateTemplateTitle,
      isTemplateImporting,
      store,
      // Exposed validation and helper functions for testing
      validateTemplateInputs,
      checkTemplatesInList,
      createTemplate,
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
