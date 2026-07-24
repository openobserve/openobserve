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
    :title="t('alert_templates.importTemplateTitle')"
    test-prefix="template"
    :is-importing="isTemplateImporting"
    container-class=""
    @back="arrowBackFn"
    @cancel="router.back()"
    @import="importJson"
  >
    <!-- Output Section with Template-specific Error Display -->
    <template #output-content>
      <div class="border-border-default flex h-full w-full min-w-100 flex-col border-l">
        <div
          v-if="templateErrorsToDisplay.length > 0 || tempalteCreators.length > 0"
          class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold"
        >
          {{ templateErrorsToDisplay.length > 0 ? "Error Validations" : "Output Messages" }}
        </div>
        <div v-else class="text-text-heading shrink-0 py-3 text-center text-sm font-semibold">
          {{ t("alert_templates.outputMessages") }}
        </div>
        <OSeparator class="mt-1 shrink-0" />
        <div class="min-h-0 w-full min-w-100 flex-1 [resize:none] overflow-auto">
          <!-- Template Errors Section -->
          <div class="error-section mb-2.5 p-2.5" v-if="templateErrorsToDisplay.length > 0">
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
                  class="error-item px-0 py-1.25 text-sm wrap-break-word"
                  :data-test="`template-import-error-${index}-${errorIndex}`"
                >
                  <span
                    class="text-status-negative"
                    v-if="typeof errorMessage === 'object' && errorMessage.field == 'template_name'"
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OInput
                        data-test="template-import-name-input"
                        :model-value="userSelectedTemplateNames[index] || ''"
                        @update:model-value="
                          (val) => {
                            userSelectedTemplateNames[index] = val;
                            updateTemplateName(val, index);
                          }
                        "
                        :label="t('alert_templates.importNameLabel')"
                        class="showLabelOnTop"
                        tabindex="0"
                      />
                    </div>
                  </span>
                  <span
                    class="text-status-negative"
                    v-else-if="typeof errorMessage === 'object' && errorMessage.field == 'body'"
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OInput
                        data-test="template-import-body-input"
                        :model-value="userSelectedTemplateBodies[index] || ''"
                        @update:model-value="
                          (val) => {
                            userSelectedTemplateBodies[index] = val;
                            updateTemplateBody(val, index);
                          }
                        "
                        :label="t('alert_templates.importBodyLabel')"
                        class="showLabelOnTop"
                        tabindex="0"
                      />
                    </div>
                  </span>
                  <!-- Check if the errorMessage is an object, if so, display the 'message' property -->
                  <span
                    class="text-status-negative"
                    v-else-if="typeof errorMessage === 'object' && errorMessage.field == 'type'"
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OSelect
                        data-test="template-import-type-input"
                        :model-value="userSelectedTemplateTypes[index] || ''"
                        @update:model-value="
                          (val) => {
                            userSelectedTemplateTypes[index] = val;
                            updateTemplateType(val as string, index);
                          }
                        "
                        :options="destinationTypes"
                        :label="t('alert_templates.importTypeLabel')"
                        class="showLabelOnTop no-case py-2"
                      />
                    </div>
                  </span>
                  <span
                    class="text-status-negative"
                    v-else-if="typeof errorMessage === 'object' && errorMessage.field == 'title'"
                  >
                    {{ errorMessage.message }}
                    <div class="w-75">
                      <OInput
                        data-test="template-import-title-input"
                        :model-value="userSelectedTemplateTitles[index] || ''"
                        @update:model-value="
                          (val) => {
                            userSelectedTemplateTitles[index] = val;
                            updateTemplateTitle(val, index);
                          }
                        "
                        :label="t('alert_templates.importTitleLabel')"
                        class="showLabelOnTop"
                        tabindex="0"
                      />
                    </div>
                  </span>
                  <span class="text-status-negative" v-else>{{ errorMessage }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="error-section mb-2.5 p-2.5" v-if="tempalteCreators.length > 0">
            <div
              class="text-primary mb-2.5 text-base uppercase"
              data-test="template-import-creation-title"
            >
              {{ t("alert_templates.templateCreationTitle") }}
            </div>
            <div
              class="error-list"
              v-for="(val, index) in tempalteCreators"
              :key="index"
              :data-test="`template-import-creation-${index}`"
            >
              <div
                :class="{
                  'error-item px-0 py-1.25 text-sm font-bold wrap-break-word': true,
                  'text-green': val.success,
                  'text-status-negative': !val.success,
                }"
                :data-test="`template-import-creation-${index}-message`"
              >
                <pre
                  class="m-0 font-[inherit] [overflow-wrap:break-word] [word-break:break-word] [white-space:pre-wrap] [word-wrap:break-word]"
                  >{{ val.message }}</pre
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseImport>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import templateService from "@/services/alert_templates";
import BaseImport from "../common/BaseImport.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { validateTemplateBody } from "@/utils/templates/validation";

export default defineComponent({
  name: "ImportTemplate",
  components: { OSeparator, OInput, OSelect, BaseImport },
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
      },
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
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const updateTemplateName = (name: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].name = name;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const updateTemplateBody = (body: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].body = body;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const updateTemplateTitle = (title: any, index: number) => {
      if (baseImportRef.value?.jsonArrayOfObj[index]) {
        baseImportRef.value.jsonArrayOfObj[index].title = title;
        // Directly update jsonStr without triggering editor re-render
        baseImportRef.value.jsonStr = JSON.stringify(baseImportRef.value.jsonArrayOfObj, null, 2);
      }
    };

    const importJson = async ({ jsonStr: jsonString }: any) => {
      templateErrorsToDisplay.value = [];
      tempalteCreators.value = [];

      try {
        // Check if jsonStr is empty or null
        if (!jsonString || jsonString.trim() === "") {
          throw new Error("JSON string is empty");
        }

        const parsedJson = JSON.parse(jsonString);
        // Convert single object to array if needed
        jsonArrayOfObj.value = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      } catch (e: any) {
        toast({
          message: e.message || "Invalid JSON format",
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
      isTemplateImporting.value = true;

      for (const [index, jsonObj] of jsonArrayOfObj.value.entries()) {
        const success = await processJsonObject(jsonObj, index + 1);
        if (success) {
          successCount++;
        }
      }

      // Only redirect and show success message if ALL templates were imported successfully
      if (successCount === totalCount) {
        toast({
          message: `Successfully imported template(s)`,
          variant: "success",
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
        toast({
          message: "Error importing Template please check the JSON",
          variant: "error",
        });
        return false;
      }
    };

    const validateTemplateInputs = async (input: any, index: number) => {
      let templateErrors: (string | { message: string; field: string })[] = [];

      // Validate name using the updated props.templates
      if (!input.name || typeof input.name !== "string" || input.name.trim() === "") {
        templateErrors.push({
          message: `Template - ${index}: The "name" field is required and should be a valid string.`,
          field: "template_name",
        });
      } else if (props.templates.some((template: any) => template.name === input.name)) {
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
      if (!input.body || typeof input.body !== "string" || input.body.trim() === "") {
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
        if (!input.title || typeof input.title !== "string" || input.title.trim() === "") {
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
});
</script>
