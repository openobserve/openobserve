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
  <div class="tw:rounded-md tw:p-0 o2-custom-bg"
    style="height: calc(100vh - 48px); min-height: inherit"
  >
    <AppPageHeader
      :back="{
        label: t('alert_templates.header'),
        onClick: () => emit('cancel:hideform'),
      }"
      class="card-container tw:px-3 tw:border-b tw:border-border-default"
    >
      <template #title>
        <span data-test="add-template-title">
          <template v-if="isUpdatingTemplate">{{
            t("alert_templates.updateTitle")
          }}</template>
          <template v-else-if="isClone">{{
            t("alert_templates.cloneTitle")
          }}</template>
          <template v-else>{{ t("alert_templates.addTitle") }}</template>
        </span>
      </template>
    </AppPageHeader>

    <OSplitter
      v-model="splitterModel"
      unit="%"
      :horizontal="false"
      style="height: calc(100vh - 106px)"
    >
      <template v-slot:before>
        <div class="card-container tw:h-full tw:flex tw:flex-col">
          <div class="tw:p-3 tw:overflow-auto">
            <div class="tw:w-full tw:pb-2 tw:pt-2 o2-input">
            <OInput
              data-test="add-template-name-input"
              v-model="formData.name"
              :label="t('alerts.name') + ' *'"
              :readonly="isUpdatingTemplate"
              :disabled="isUpdatingTemplate"
              tabindex="0"
              :error="!!nameError"
              :error-message="nameError"
              @update:model-value="nameError = ''"
            />
          </div>
          <div class="tw:w-full tw:pb-3">
            <div class="app-tabs-container tw:w-fit">
              <app-tabs
                class="tabs-selection-container"
                :tabs="tabs"
                v-model:active-tab="formData.type"
              />
            </div>
          </div>
          <div v-if="formData.type === 'email'" class="tw:w-full tw:pt-1 o2-input">
            <OInput
              data-test="add-template-email-title-input"
              v-model="formData.title"
              :label="t('alerts.title') + ' *'"
              tabindex="0"
              :error="!!titleError"
              :error-message="titleError"
              @update:model-value="titleError = ''"
            />
          </div>
          <div class="tw:w-full tw:py-3 ">
            <div
              class="tw:pb-2 tw:font-bold"
              data-test="add-template-body-input-title"
            >
              {{ t("alert_templates.body") + " *" }}
            </div>
            <template v-if="formData.type === 'email'">
              <query-editor
                data-test="template-body-editor"
                ref="queryEditorRef"
                editor-id="template-body-editor"
                class="monaco-editor tw:mb-3"
                language="markdown"
                v-model:query="formData.body"
              />
            </template>
            <template v-else>
              <query-editor
                data-test="template-body-editor"
                ref="queryEditorRef"
                editor-id="template-body-editor"
                class="monaco-editor tw:mb-3"
                language="json"
                v-model:query="formData.body"
              />
            </template>
            </div>
          </div>
          <div
            class="tw:flex tw:justify-end tw:gap-2 tw:px-4 tw:py-4 tw:w-full tw:bg-[var(--q-card-background)] tw:border-t tw:border-border-default"
          >
            <OButton
              v-close-popup
              variant="outline"
              size="sm-action"
              @click="$emit('cancel:hideform')"
              data-test="add-template-cancel-btn"
            >{{ t('alerts.cancel') }}</OButton>
            <OButton
              variant="primary"
              size="sm-action"
              @click="saveTemplate"
              data-test="add-template-submit-btn"
            >{{ t('alerts.save') }}</OButton>
          </div>
        </div>
      </template>
      <template v-slot:after>
        <div
          class="tw:px-2 tw:pt-2 tw:h-full tw:overflow-auto card-container tw:border-l tw:border-border-default"
        >
          <div class="tw:font-bold tw:py-2 tw:px-1 tw:text-sm tw:font-medium">
            {{ t("alert_templates.variable_guide_header") }}
          </div>
          <OSeparator class="tw:-ml-2 tw:mr-2" />
          <div class="tw:py-3 tw:px-1">
            <div>org_name, stream_type, stream_name</div>
            <div>alert_name, alert_type</div>
            <div>alert_period, alert_operator, alert_threshold</div>
            <div>alert_count, alert_agg_value</div>
            <div>alert_start_time, alert_end_time, alert_url</div>
            <div>
              alert_trigger_time, alert_trigger_time_millis,
              alert_trigger_time_seconds, alert_trigger_time_str
            </div>
            <div><b>rows</b> multiple lines of row template</div>
            <div><b>All of the stream fields are variables.</b></div>
            <div>{rows:N} {var:N} used to limit rows or string length.</div>
          </div>
          <div class="tw:pb-3 tw:px-1">
            <div class="tw:font-bold text-body-1 tw:pb-2">
              {{ t("alert_templates.variable_usage_examples") }}:
            </div>
            <div
              v-for="(template, index) in sampleTemplates"
              class="tw:pb-3"
              :key="template.name"
              :data-test="`add-template-sample-template-${index}`"
            >
              <div class="tw:flex tw:justify-between tw:items-center">
                <div class="tw:pb-1">{{ template.name }}</div>
                <OIcon
                  data-test="add-template-sample-template-copy-btn"
                  class="tw:cursor-pointer"
                  name="content-copy"
                  size="xs"
                  @click="copyTemplateBody(template.body)"
                />
              </div>
              <div
                data-test="add-template-sample-template-text"
                class="add-template tw:px-2 tw:rounded"
              >
                <pre class="example-template-body tw:my-0">
                    {{ template.body }}
                  </pre
                >
              </div>
            </div>
          </div>
        </div>
      </template>
    </OSplitter>
  </div>
</template>
<script lang="ts" setup>
import {
  ref,
  onBeforeMount,
  onActivated,
  computed,
  defineAsyncComponent,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";

import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import type { TemplateData, Template } from "@/ts/interfaces/index";
import { useRouter } from "vue-router";
import { isValidResourceName } from "@/utils/zincutils";
import AppTabs from "@/components/common/AppTabs.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { useReo } from "@/services/reodotdev_analytics";
import {
  validateTemplateBody,
  getTemplateValidationErrorMessage,
} from "@/utils/templates/validation";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";

const props = withDefaults(
  defineProps<{
    template: TemplateData | null;
    /**
     * When true, the form is in "clone" mode: it pre-fills body/type/title
     * from `template` but treats the save as a new template (so a renamed
     * "Copy of X" is created instead of overwriting X).
     */
    isClone?: boolean;
  }>(),
  { isClone: false },
);
const emit = defineEmits(["get:templates", "cancel:hideform"]);

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);
const { t } = useI18n();
const splitterModel: Ref<number> = ref(75);
const formData: Ref<Template> = ref({
  name: "",
  body: "",
  type: "http",
  title: "",
});
const store = useStore();
const editorRef: any = ref(null);
const isUpdatingTemplate = ref(false);
const nameError = ref('');
const titleError = ref('');
const { track } = useReo();
const sampleTemplates = [
  {
    name: "Slack",
    body: `
{
  "text": "{alert_name} is active"
}`,
  },
  {
    name: "Alert Manager",
    body: `
[
  {
    "labels": {
        "alertname": "{alert_name}",
        "stream": "{stream_name}",
        "organization": "{org_name}",
        "alerttype": "{alert_type}",
        "severity": "critical"
    },
    "annotations": {
        "timestamp": "{timestamp}"
    }
  }
]`,
  },
];
onActivated(() => setupTemplateData());
onBeforeMount(() => {
  setupTemplateData();
});

const tabs = computed(() => [
  {
    label: "Web Hook",
    value: "http",
    style: {},
    icon: "webhook",
  },
  {
    label: "Email",
    value: "email",
    style: {},
    icon: "mail",
  },
]);

const setupTemplateData = () => {
  const params = router.currentRoute.value.query;
  if (props.template) {
    // Clone mode pre-fills the form but stays in create mode so save
    // produces a new template; edit mode would overwrite the original.
    isUpdatingTemplate.value = !props.isClone;
    formData.value.name = props.template.name;
    formData.value.body = props.template.body;
    formData.value.type = props.template.type;
    formData.value.title = props.template.title;
  }

  if (params.type) {
    formData.value.type = params.type as "email" | "http";
  }
};

const isTemplateBodyValid = () => {
  const result = validateTemplateBody(formData.value.body);

  if (!result.valid) {
    toast({
      variant: "error",
      message: getTemplateValidationErrorMessage(),
      timeout: 1500,
    });
  }

  return result.valid;
};

const router = useRouter();

const isTemplateFilled = () =>
  formData.value.name.trim().trim().length &&
  formData.value.body.trim().trim().length;

const saveTemplate = () => {
  if (!isTemplateFilled()) {
    const name = formData.value.name;
    nameError.value = !name.trim() ? t('common.nameRequired')
      : (!isValidResourceName(name) ? 'Characters like :, ?, /, #, and spaces are not allowed.' : '');
    titleError.value = (formData.value.type === 'email' && !formData.value.title?.trim()) ? 'Field is required!' : '';
    toast({
      variant: "error",
      message: "Please fill required fields",
      timeout: 1500,
    });
    return;
  }

  // Here checking is template body json valid
  if (formData.value.type !== "email" && !isTemplateBodyValid()) return;

  const dismiss = toast({
    variant: "loading",
    message: "Please wait...",
      timeout: 0,
});

  if (isUpdatingTemplate.value) {
    templateService
      .update({
        org_identifier: store.state.selectedOrganization.identifier,
        template_name: formData.value.name,
        data: {
          name: formData.value.name.trim(),
          body: formData.value.body,
          type: formData.value.type,
          title: formData.value.title,
        },
      })
      .then(() => {
        dismiss();
        emit("get:templates");
        emit("cancel:hideform");
        toast({
          variant: "success",
          message: `Template Saved Successfully.`,
        });
      })
      .catch((err) => {
        if (err.response?.status == 403) {
          return;
        }
        dismiss();
        toast({
          variant: "error",
          message: err.response?.data?.error || err.response?.data?.message,
        });
      });
    track("Button Click", {
      button: "Update Template",
      page: "Add Template",
    });
  } else {
    {
      templateService
        .create({
          org_identifier: store.state.selectedOrganization.identifier,
          template_name: formData.value.name,
          data: {
            name: formData.value.name.trim(),
            body: formData.value.body,
            type: formData.value.type,
            title: formData.value.title,
          },
        })
        .then(() => {
          dismiss();
          emit("get:templates");
          emit("cancel:hideform");
          toast({
            variant: "success",
            message: `Template Saved Successfully.`,
          });
        })
        .catch((err) => {
          if (err.response?.status == 403) {
            return;
          }
          dismiss();
          toast({
            variant: "error",
            message: err.response?.data?.error || err.response?.data?.message,
          });
        });
      track("Button Click", {
        button: "Create Template",
        page: "Add Template",
      });
    }
  }
};
const copyTemplateBody = (text: any) => {
  copyToClipboard(JSON.parse(JSON.stringify(text)), {
    successMessage: "Content Copied Successfully!",
    timeout: 1000,
  });
};
</script>
<style lang="scss" scoped>
.monaco-editor {
  width: 100%;
  min-height: 310px !important;
  border-radius: 5px;
  border: 1px solid var(--o2-border-color);
  // padding-bottom: 14px;
  resize: vertical;
  overflow: auto;
}

.example-template-body {
  font-size: 10px;
}

.add-template {
  background: rgba(0, 0, 0, 0.07);
}
</style>
