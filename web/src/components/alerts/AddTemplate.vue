<!-- Copyright 2023 Zinc Labs Inc.

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
  <q-page class="q-pa-none" style="min-height: inherit">
    <div class="row items-center no-wrap q-mx-md q-my-sm">
      <div class="flex items-center">
        <div
          class="flex justify-center items-center q-mr-md cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="router.back()"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div class="col" data-test="add-template-title">
          <div v-if="isUpdatingTemplate" class="text-h6">
            {{ t("alert_templates.updateTitle") }}
          </div>
          <div v-else class="text-h6">
            {{ t("alert_templates.addTitle") }}
          </div>
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
              :label="t('alerts.name') + ' *'"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              v-bind:readonly="isUpdatingTemplate"
              v-bind:disable="isUpdatingTemplate"
              :rules="[(val: any) => !!val.trim() || 'Field is required!']"
              tabindex="0"
            />
          </div>
          <div class="col-12 q-pb-md q-pt-xs">
            <div
              class="q-pb-sm text-bold"
              data-test="add-template-body-input-title"
            >
              {{ t("alert_templates.body") + " *" }}
            </div>
            <div
              data-test="add-template-body-input"
              ref="editorRef"
              id="editor"
              :label="t('alerts.sql')"
              stack-label
              style="border: 1px solid #dbdbdb; border-radius: 5px"
              class="showLabelOnTop"
              resize
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>
          <div class="col-12 flex justify-center q-mt-lg">
            <q-btn
              data-test="add-template-cancel-btn"
              v-close-popup="true"
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
            <div>org_name, stream_type, stream_name</div>
            <div>alert_name, alert_type</div>
            <div>alert_period, alert_operator, alert_threshold</div>
            <div>alert_count, alert_agg_value</div>
            <div>alert_start_time, alert_end_time, alert_url</div>
            <div><b>rows</b> multiple lines of row template</div>
            <div><b>All of the stream fields are variables.</b></div>
            <div>{rows:N} {var:N} used to limit rows or string length.</div>
          </div>
          <div class="q-pb-md q-px-xs">
            <div class="text-bold text-body-1 q-pb-sm">
              {{ t("alert_templates.variable_usage_examples") }}:
            </div>
            <div
              v-for="(template, index) in sampleTemplates"
              class="q-pb-md"
              :key="template.name"
              :data-test="`add-template-sample-template-${index}`"
            >
              <div class="flex justify-between items-center">
                <div class="q-pb-xs">{{ template.name }}</div>
                <q-icon
                  data-test="add-template-sample-template-copy-btn"
                  class="cursor-pointer"
                  name="content_copy"
                  size="14px"
                  @click="copyTemplateBody(template.body)"
                />
              </div>
              <div
                data-test="add-template-sample-template-text"
                class="add-template q-px-sm rounded-borders"
              >
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
  defineProps,
  onBeforeMount,
  onActivated,
  defineEmits,
  watch,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";

import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "monaco-editor/esm/vs/language/json/jsonMode.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import { copyToClipboard, useQuasar } from "quasar";
import type { TemplateData, Template } from "@/ts/interfaces/index";
import { useRouter } from "vue-router";
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
    language: "json",
    minimap: {
      enabled: false,
    },
    theme: store.state.theme == "dark" ? "vs-dark" : "myCustomTheme",
    automaticLayout: true,
    suggestOnTriggerCharacters: false,
    wordWrap: "on",
  });
  editorobj.onKeyUp((e: any) => {
    editorData.value = editorobj.getValue();
    formData.value.body = editorobj.getValue();
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

watch(
  () => store.state.theme,
  () => {
    monaco.editor.setTheme(
      store.state.theme == "dark" ? "vs-dark" : "myCustomTheme"
    );
  }
);

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

const router = useRouter();

const isTemplateFilled = () =>
  formData.value.name.trim().trim().length &&
  formData.value.body.trim().trim().length;

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

  if (isUpdatingTemplate.value) {
    templateService
      .update({
        org_identifier: store.state.selectedOrganization.identifier,
        template_name: formData.value.name,
        data: {
          name: formData.value.name.trim(),
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
          message: err.response?.data?.error || err.response?.data?.message,
        });
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
            message: err.response?.data?.error || err.response?.data?.message,
          });
        });
    }
  }
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
  // padding-bottom: 14px;
  resize: vertical;
  overflow: auto;
  max-height: 350px;
}

.example-template-body {
  font-size: 10px;
}

.add-template {
  background: rgba(0, 0, 0, 0.07);
}
</style>
