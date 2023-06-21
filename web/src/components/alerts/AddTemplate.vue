<!-- Copyright 2022 Zinc Labs Inc. and Contributors
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
     http:www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->
<template>
  <q-page class="q-pa-none" style="min-height: inherit">
    <div class="col-12 items-center no-wrap q-pt-md">
      <div class="col" data-test="add-template-title">
        <div v-if="isUpdatingTemplate" class="text-h6">
          {{ t("alert_templates.updateTitle") }}
        </div>
        <div v-else class="text-h6">
          {{ t("alert_templates.addTitle") }}
        </div>
      </div>
    </div>

    <q-separator style="width: 100%" />

    <q-splitter
      v-model="splitterModel"
      unit="%"
      style="min-height: calc(100vh - 122px)"
    >
      <template v-slot:before>
        <div class="row q-pa-md">
          <div class="col-12 q-pb-md q-pt-sm">
            <q-input
              data-test="add-template-name-input"
              v-model="formData.name"
              :label="t('alerts.name')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              v-bind:readonly="isUpdatingTemplate"
              v-bind:disable="isUpdatingTemplate"
              :rules="[(val: any) => !!val || 'Field is required!']"
              tabindex="0"
            />
          </div>
          <div class="col-12 q-pb-md q-pt-xs">
            <div
              class="q-pb-sm text-bold"
              data-test="add-template-body-input-title"
            >
              {{ t("alert_templates.body") }}
            </div>
            <div
              data-test="add-template-body-input"
              ref="editorRef"
              id="editor"
              :label="t('alerts.sql')"
              stack-label
              style="border: 1px solid #dbdbdb; border-radius: 5px"
              class="q-py-sm showLabelOnTop"
              resize
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>
          <div class="col-12 flex justify-center q-mt-lg">
            <q-btn
              data-test="add-template-cancel-btn"
              v-close-popup
              class="q-mb-md text-bold"
              :label="t('alerts.cancel')"
              text-color="light-text"
              padding="sm md"
              no-caps
              @click="$emit('cancel:hideform')"
            />
            <q-btn
              data-test="add-template-submit-btn"
              :label="t('alerts.save')"
              class="q-mb-md text-bold no-border q-ml-md"
              color="secondary"
              padding="sm xl"
              @click="saveTemplate"
              no-caps
            />
          </div>
        </div>
      </template>
      <template v-slot:after>
        <div class="q-px-sm q-pt-sm">
          <div class="text-bold q-py-sm q-px-xs text-subtitle2">
            {{ t("alert_templates.variable_guide_header") }}
          </div>
          <q-separator style="width: 100%" />
          <div class="q-py-md q-px-xs">
            <div>{{ t("alert_templates.stream_name_variable") }}</div>
            <div>{{ t("alert_templates.org_name_variable") }}</div>
            <div>{{ t("alert_templates.alert_name_variable") }}</div>
            <div>{{ t("alert_templates.alert_type_variable") }}</div>
            <div>{{ t("alert_templates.timestamp_variable") }}</div>
          </div>
          <div class="q-pb-md q-px-xs">
            <div class="text-bold text-body-1 q-pb-sm">
              {{ t("alert_templates.variable_usage_examples") }}:
            </div>
            <div
              v-for="template in sampleTemplates"
              class="q-pb-md"
              :key="template.name"
            >
              <div class="flex justify-between items-center">
                <div class="q-pb-xs">{{ template.name }}</div>
                <q-icon
                  class="cursor-pointer"
                  name="content_copy"
                  size="14px"
                  @click="copyTemplateBody(template.body)"
                />
              </div>
              <div class="add-template q-px-sm rounded-borders">
                <pre class="example-template-body q-my-0">
                    {{ template.body }}
                  </pre
                >
              </div>
            </div>
          </div>
        </div>
      </template>
    </q-splitter>
  </q-page>
</template>
<script lang="ts" setup>
import {
  ref,
  onMounted,
  computed,
  defineProps,
  onBeforeMount,
  onActivated,
  defineEmits,
  nextTick,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import { copyToClipboard, useQuasar } from "quasar";
import type { TemplateData, Template } from "@/ts/interfaces/index";
import type { DomEvent } from "@vue/test-utils/dist/constants/dom-events";
const props = defineProps<{ template: TemplateData | null }>();
const emit = defineEmits(["get:templates", "cancel:hideform"]);
const { t } = useI18n();
const splitterModel: Ref<number> = ref(75);
const formData: Ref<Template> = ref({
  name: "",
  body: "",
});
const store = useStore();
const q = useQuasar();
const editorRef: any = ref(null);
let editorobj: any = null;
const editorData = ref("");
const isUpdatingTemplate = ref(false);
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
onMounted(async () => {
  monaco.editor.defineTheme("myCustomTheme", {
    base: "vs", // can also be vs-dark or hc-black
    inherit: true, // can also be false to completely replace the builtin rules
    rules: [
      {
        token: "comment",
        foreground: "ffa500",
        background: "FFFFFF",
        fontStyle: "italic underline",
      },
      {
        token: "comment.js",
        foreground: "008800",
        fontStyle: "bold",
        background: "FFFFFF",
      },
      { token: "comment.css", foreground: "0000ff", background: "FFFFFF" }, // will inherit fontStyle from `comment` above
    ],
    colors: {
      "editor.foreground": "#000000",
      "editor.background": "#FFFFFF",
      "editorCursor.foreground": "#000000",
      "editor.lineHighlightBackground": "#FFFFFF",
      "editorLineNumber.foreground": "#000000",
      "editor.border": "#FFFFFF",
    },
  });
  editorobj = monaco.editor.create(editorRef.value, {
    value: ``,
    language: "sql",
    minimap: {
      enabled: false,
    },
    theme: (store.state.theme == 'dark' ? 'vs-dark' : 'myCustomTheme'),
    automaticLayout: true,
    suggestOnTriggerCharacters: false,
  });
  editorobj.onKeyUp((e: any) => {
    if (editorobj.getValue() != "") {
      editorData.value = editorobj.getValue();
      formData.value.body = editorobj.getValue();
    }
  });
  editorobj.setValue(formData.value.body);
});
const setupTemplateData = () => {
  if (props.template) {
    isUpdatingTemplate.value = true;
    formData.value.name = props.template.name;
    formData.value.body = props.template.body;
  }
};

const isTemplateBodyValid = () => {
  try {
    JSON.parse(formData.value.body);
    return true;
  } catch (e) {
    q.notify({
      type: "negative",
      message: "Please enter valid JSON in template body",
      timeout: 1500,
    });
    return false;
  }
};

const isTemplateFilled = () => formData.value.name && formData.value.body;

const saveTemplate = () => {
  if (!isTemplateFilled()) {
    q.notify({
      type: "negative",
      message: "Please fill required fields",
      timeout: 1500,
    });
    return;
  }

  // Here checking is template body json valid
  if (!isTemplateBodyValid()) return;

  const dismiss = q.notify({
    spinner: true,
    message: "Please wait...",
    timeout: 2000,
  });

  templateService
    .create({
      org_identifier: store.state.selectedOrganization.identifier,
      template_name: formData.value.name,
      data: {
        name: formData.value.name,
        body: formData.value.body,
      },
    })
    .then(() => {
      dismiss();
      emit("get:templates");
      emit("cancel:hideform");
      q.notify({
        type: "positive",
        message: `Template Saved Successfully.`,
      });
    })
    .catch((err) => {
      dismiss();
      q.notify({
        type: "negative",
        message: err.response.data.error,
      });
    });
};
const copyTemplateBody = (text: any) => {
  copyToClipboard(JSON.parse(JSON.stringify(text))).then(() =>
    q.notify({
      type: "positive",
      message: "Content Copied Successfully!",
      timeout: 1000,
    })
  );
};
</script>
<style lang="scss" scoped>
#editor {
  width: 100%;
  min-height: 310px;
  padding-bottom: 14px;
  resize: vertical;
  overflow: auto;
  max-height: 350px;
}

.example-template-body {
  font-size: 10px;
}

.add-template{
  background: rgba(0,0,0,0.07);
}
</style>
