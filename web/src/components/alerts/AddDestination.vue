<template>
  <q-page class="q-pa-none q-pa-md" style="min-height: inherit">
    <div class="page-content" style="">
      <div class="col-12 items-center no-wrap">
        <div class="col">
          <div v-if="isUpdatingTemplate" class="text-h6">
            {{ t("alert_destinations.updateTitle") }}
          </div>
          <div v-else class="text-h6">
            {{ t("alert_destinations.addTitle") }}
          </div>
        </div>
      </div>
      <q-separator />
      <div class="row q-col-gutter-sm q-pt-lg">
        <div class="col-6 q-py-xs">
          <q-input
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
        <div class="col-6 row q-py-xs">
          <div class="col-12">
            <q-select
              v-model="formData.template"
              :label="t('alert_destinations.template')"
              :options="alertTemplates"
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
        </div>
        <div class="col-6 q-py-xs">
          <q-input
            v-model="formData.url"
            :label="t('alert_destinations.url')"
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
        <div class="col-6 q-py-xs">
          <q-select
            v-model="formData.method"
            :label="t('alert_destinations.method')"
            :options="apiMethods"
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
        <div class="col-12 q-py-sm">
          <div class="text-bold q-py-xs" style="paddingleft: 10px">Headers</div>
          <div
            v-for="(header, index) in apiHeaders"
            :key="header.uuid"
            class="row q-col-gutter-sm"
          >
            <div class="col-5 q-ml-none">
              <q-input
                v-model="header.key"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop"
                stack-label
                outlined
                filled
                :placeholder="t('alert_destinations.api_header')"
                dense
                v-bind:readonly="isUpdatingTemplate"
                v-bind:disable="isUpdatingTemplate"
                :rules="[(val: any) => !!val || 'Field is required!']"
                tabindex="0"
              />
            </div>
            <div class="col-5 q-ml-none">
              <q-input
                v-model="header.value"
                :placeholder="t('alert_destinations.api_header_value')"
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
            <div class="col-2 q-ml-none">
              <q-btn
                icon="delete"
                class="q-ml-xs iconHoverBtn"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                :title="t('alert_templates.edit')"
                @click="deleteApiHeader(header)"
              />
              <q-btn
                v-if="index === apiHeaders.length - 1"
                icon="add"
                class="q-ml-xs iconHoverBtn"
                padding="sm"
                unelevated
                size="sm"
                round
                flat
                :title="t('alert_templates.edit')"
                @click="addApiHeader"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="flex justify-center q-mt-lg">
      <q-btn
        v-close-popup
        class="q-mb-md text-bold no-border"
        :label="t('alerts.cancel')"
        text-color="light-text"
        padding="sm md"
        color="accent"
        no-caps
        @click="$emit('cancel:hideform')"
      />
      <q-btn
        :label="t('alerts.save')"
        class="q-mb-md text-bold no-border q-ml-md"
        color="secondary"
        padding="sm xl"
        @click="saveTemplate"
        no-caps
      />
    </div>
  </q-page>
</template>
<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { getUUID } from "@/utils/zincutils";

// const defaultFormData = {
//   name: "",
//   body: "",
// };

const apiMethods = ["GET", "POST", "PUT"];

const { t } = useI18n();
const formData = ref({
  name: "",
  url: "",
  method: "POST",
  template: "",
  headers: {
    key: "",
  },
});

const editorRef: any = ref(null);

let editorobj: any = null;
const editorData = ref("");
const isUpdatingTemplate = ref(false);
const apiHeaders = ref([{ key: "", value: "", uuid: getUUID() }]);
const alertTemplates = ref([]);

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
    theme: "myCustomTheme",
  });

  editorobj.onKeyUp((e: any) => {
    if (editorobj.getValue() != "") {
      editorData.value = editorobj.getValue();
      formData.value.body = editorobj.getValue();
    }
  });

  editorobj.setValue(formData.value.body);
});

const editorUpdate = (e: any) => {
  formData.value.body = e.target.value;
};

const saveTemplate = () => {};

const addApiHeader = () => {
  const defaultHeader = { key: "", value: "", uuid: getUUID() };
  apiHeaders.value.push(defaultHeader);
};

const deleteApiHeader = (header: any) => {
  apiHeaders.value = apiHeaders.value.filter(
    (_header) => _header.uuid !== header.uuid
  );
  if (formData.value.headers[header.key])
    delete formData.value.headers[header.key];
  if (!apiHeaders.value.length) addApiHeader();
};
</script>
<style lang="scss" scoped>
#editor {
  width: 100%;
  min-height: 5rem;
  padding-bottom: 14px;
  resize: both;
}
.page-content {
  height: calc(100vh - 112px);
}
</style>
