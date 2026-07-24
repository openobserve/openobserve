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
  <OPageLayout
    class="overflow-hidden"
    :title="isUpdatingTemplate ? t('alert_templates.updateTitle') : isClone ? t('alert_templates.cloneTitle') : t('alert_templates.addTitle')"
    title-data-test="add-template-title"
    :back="{
      label: t('alert_templates.header'),
      onClick: () => emit('cancel:hideform'),
    }"
    bleed
  >
    <OSplitter class="h-full"
      v-model="splitterModel"
      unit="%"
      :horizontal="false"
    >
      <template v-slot:before>
        <OForm
          :form="form"
          v-slot="{ isSubmitting }"
          class="bg-card-glass-bg h-full flex flex-col"
        >
          <div class="p-3 overflow-auto">
            <div class="w-full pb-2 pt-2 o2-input">
            <OFormInput
              name="name"
              data-test="add-template-name-input"
              :label="t('alerts.name')"
              required
              :readonly="isUpdatingTemplate"
              :disabled="isUpdatingTemplate"
              tabindex="0"
            />
          </div>
          <div class="w-full pb-3">
            <div class="app-tabs-container w-fit">
              <app-tabs
                class="tabs-selection-container"
                :tabs="tabs"
                :active-tab="templateType"
                @update:active-tab="onTypeChange"
              />
            </div>
          </div>
          <div v-if="templateType === 'email'" class="w-full pt-1 o2-input">
            <OFormInput
              name="title"
              data-test="add-template-email-title-input"
              :label="t('alerts.title')"
              required
              tabindex="0"
            />
          </div>
          <div class="w-full py-3 ">
            <div
              class="pb-2 font-bold flex items-center gap-0.5"
              data-test="add-template-body-input-title"
            >
              <span>{{ t("alert_templates.body") }}</span>
              <span aria-hidden="true" class="select-none">*</span>
            </div>
            <!-- `:key` forces a remount when the type flips. CodeQueryEditor
                 reads `language` only at monaco.editor.create() — it never
                 watches the prop, and setModelLanguage is used nowhere — so
                 without this the editor keeps its mount-time language and paints
                 a markdown body with JSON errors (pre-migration got the remount
                 for free from two v-if/v-else editors). -->
            <query-editor
              :key="bodyLanguage"
              data-test="template-body-editor"
              editor-id="template-body-editor"
              class="w-full min-h-77.5! rounded-default border border-card-glass-border resize-y overflow-auto mb-3"
              :language="bodyLanguage"
              :query="body"
              @update:query="onBodyChange"
            />
            </div>
          </div>
          <div
            class="flex justify-end gap-2 px-4 py-4 w-full bg-surface-base border-t border-border-default"
          >
            <OButton
              v-close-popup
              variant="outline"
              size="sm-action"
              :disabled="isSubmitting"
              @click="$emit('cancel:hideform')"
              data-test="add-template-cancel-btn"
            >{{ t('alerts.cancel') }}</OButton>
            <OButton
              variant="primary"
              size="sm-action"
              :loading="isSubmitting"
              data-test="add-template-submit-btn"
              @click="handleSave"
            >{{ t('alerts.save') }}</OButton>
          </div>
        </OForm>
      </template>
      <template v-slot:after>
        <div
          class="px-2 pt-2 h-full overflow-auto bg-card-glass-bg border-l border-border-default"
        >
          <div class="font-bold py-2 px-1 text-sm font-medium">
            {{ t("alert_templates.variable_guide_header") }}
          </div>
          <OSeparator class="-ml-2 mr-2" />
          <div class="py-3 px-1">
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- template placeholder variable names, must stay identical in every language -->
            <div>org_name, stream_type, stream_name</div>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- template placeholder variable names, must stay identical in every language -->
            <div>alert_name, alert_type</div>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- template placeholder variable names, must stay identical in every language -->
            <div>alert_period, alert_operator, alert_threshold</div>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- template placeholder variable names, must stay identical in every language -->
            <div>alert_count, alert_agg_value</div>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- template placeholder variable names, must stay identical in every language -->
            <div>alert_start_time, alert_end_time, alert_url</div>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- template placeholder variable names, must stay identical in every language -->
            <div>
              alert_trigger_time, alert_trigger_time_millis,
              alert_trigger_time_seconds, alert_trigger_time_str
            </div>
            <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- "rows" is the literal template placeholder keyword, must stay identical in every language -->
            <div><b>rows</b> {{ t("alert_templates.variableRowsDescription") }}</div>
            <div><b>{{ t("alert_templates.variableStreamFields") }}</b></div>
            <div>{{ t("alert_templates.variableLimits") }}</div>
          </div>
          <div class="pb-3 px-1">
            <div class="font-bold text-body-1 pb-2">
              {{ t("alert_templates.variable_usage_examples") }}:
            </div>
            <div
              v-for="(template, index) in sampleTemplates"
              class="pb-3"
              :key="template.name"
              :data-test="`add-template-sample-template-${index}`"
            >
              <div class="flex justify-between items-center">
                <div class="pb-1">{{ template.name }}</div>
                <OIcon
                  data-test="add-template-sample-template-copy-btn"
                  class="cursor-pointer"
                  name="content-copy"
                  size="xs"
                  @click="copyTemplateBody(template.body)"
                />
              </div>
              <div
                data-test="add-template-sample-template-text"
                class="bg-black/[0.07] px-2 rounded-default"
              >
                <pre class="text-3xs my-0">
                    {{ template.body }}
                  </pre
                >
              </div>
            </div>
          </div>
        </div>
      </template>
    </OSplitter>
  </OPageLayout>
</template>
<script lang="ts" setup>
import {
  ref,
  onActivated,
  computed,
  watch,
  defineAsyncComponent,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";

import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from '@/lib/core/Button/OButton.vue';
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import type { TemplateData } from "@/ts/interfaces/index";
import { useRouter } from "vue-router";
import AppTabs from "@/components/common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useReo } from "@/services/reodotdev_analytics";
import {
  validateTemplateBody,
  getTemplateValidationErrorMessage,
} from "@/utils/templates/validation";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import {
  makeAddTemplateSchema,
  addTemplateDefaults,
  type AddTemplateForm,
} from "./AddTemplate.schema";

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
const store = useStore();
const router = useRouter();
const isUpdatingTemplate = ref(false);
const { track } = useReo();

// Owner pattern (Rule ③): AddTemplate OWNS <OForm>, and it needs to read `type`
// at setup to drive conditional rendering (the email title input v-if + the
// Monaco editor language). So the form is created here via useOForm and handed
// to <OForm :form="form">; state is read with form.useStore (single source of
// truth — no mirror), written with form.setFieldValue.
const addTemplateSchema = makeAddTemplateSchema(t);
const form = useOForm<AddTemplateForm>({
  defaultValues: addTemplateDefaults(),
  schema: addTemplateSchema,
  onSubmit: saveTemplate,
});

// Reactive views of the two bridged values.
const templateType = form.useStore((s: any) => s.values.type as "http" | "email");
const body = form.useStore((s: any) => (s.values.body as string) ?? "");
const bodyLanguage = computed(() =>
  templateType.value === "email" ? "markdown" : "json",
);

// app-tabs is a UI toggle whose value is the schema discriminator (not an
// <input>) → bridge it into the form (sanctioned Rule-② bridge).
const onTypeChange = (value: unknown) => {
  form.setFieldValue("type", value as "http" | "email");
};

// PARITY with pre-migration saveTemplate (HEAD ~:334-346): an unfilled required
// field ALWAYS toasted "Please fill required fields". Post-migration the schema
// rejects the submit BEFORE onSubmit(saveTemplate) runs — and saveTemplate owns
// every toast — so a rejected save said nothing at all. `body` is the sharp edge:
// it's a bare Monaco bridged in via setFieldValue with no name= binding, so it has
// no field to highlight either. Restore the toast on a rejected submit.
const handleSave = async () => {
  await form.handleSubmit();
  if (!form.state.isValid) {
    toast({
      variant: "error",
      message: t("common.fillRequiredFields"),
      timeout: 1500,
    });
  }
};

// Bare Monaco body → bridge its value into the form so schema min(1) covers it.
const onBodyChange = (value: unknown) => {
  form.setFieldValue("body", (value as string) ?? "");
};

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

const tabs = computed(() => [
  {
    label: t("alerts.webhook"),
    value: "http",
    style: {},
    icon: "webhook",
  },
  {
    label: t("alerts.email"),
    value: "email",
    style: {},
    icon: "mail",
  },
]);

// Edit/clone prefill arrives via the `template` prop (possibly async). Seed the
// form with form.reset(record) when it loads — NOT a per-field setFieldValue
// loop (playbook §4 "Resetting / repopulating form values").
const applyTemplateData = () => {
  const params = router.currentRoute.value.query;
  const next = addTemplateDefaults();
  if (props.template) {
    // Clone mode pre-fills the form but stays in create mode so save
    // produces a new template; edit mode would overwrite the original.
    isUpdatingTemplate.value = !props.isClone;
    next.name = props.template.name;
    next.body = props.template.body;
    next.type = props.template.type as "http" | "email";
    next.title = props.template.title;
  } else {
    isUpdatingTemplate.value = false;
  }

  // A ?type= query param (e.g. deep link) preselects the tab. Guard the cast so
  // an unexpected value can never enter the enum-typed form.
  if (params.type === "email" || params.type === "http") {
    next.type = params.type;
  }

  form.reset(next);
};

watch(() => props.template, applyTemplateData, { immediate: true });
onActivated(() => applyTemplateData());

// http bodies must be valid JSON (with template placeholders). This stays a
// submit-time toast side-effect — NOT a schema rule — to preserve the exact
// pre-migration behaviour (Rule ④).
const isTemplateBodyValid = (bodyValue: string) => {
  const result = validateTemplateBody(bodyValue);

  if (!result.valid) {
    toast({
      variant: "error",
      message: getTemplateValidationErrorMessage(),
      timeout: 1500,
    });
  }

  return result.valid;
};

// @submit(value) is the source of truth. OForm awaits this, so the inline Save
// button's spinner (v-slot isSubmitting) spans the whole request.
async function saveTemplate(value: AddTemplateForm) {
  // Here checking is template body json valid (http only).
  if (value.type !== "email" && !isTemplateBodyValid(value.body)) return;

  const dismiss = toast({
    variant: "loading",
    message: t("common.pleaseWait"),
    timeout: 0,
  });

  // Same payload the pre-migration form built (identical for http/email):
  // template_name = raw name; data.name = trimmed name.
  const data = {
    name: value.name.trim(),
    body: value.body,
    type: value.type,
    title: value.title,
  };

  const onSuccess = () => {
    dismiss();
    emit("get:templates");
    emit("cancel:hideform");
    toast({
      variant: "success",
      message: t("alert_templates.savedSuccessfully"),
    });
  };

  const onError = (err: any) => {
    if (err.response?.status == 403) {
      return;
    }
    dismiss();
    toast({
      variant: "error",
      message: err.response?.data?.error || err.response?.data?.message,
    });
  };

  if (isUpdatingTemplate.value) {
    const request = templateService
      .update({
        org_identifier: store.state.selectedOrganization.identifier,
        template_name: value.name,
        data,
      })
      .then(onSuccess)
      .catch(onError);
    track("Button Click", {
      button: "Update Template",
      page: "Add Template",
    });
    return request;
  }

  const request = templateService
    .create({
      org_identifier: store.state.selectedOrganization.identifier,
      template_name: value.name,
      data,
    })
    .then(onSuccess)
    .catch(onError);
  track("Button Click", {
    button: "Create Template",
    page: "Add Template",
  });
  return request;
}

const copyTemplateBody = (text: any) => {
  copyToClipboard(JSON.parse(JSON.stringify(text)), {
    successMessage: t("alert_templates.contentCopied"),
    timeout: 1000,
  });
};
</script>
