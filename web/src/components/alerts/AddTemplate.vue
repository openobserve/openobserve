<template>
  <q-page class="q-pa-none q-pa-md" style="min-height: inherit">
    <div class="row">
      <div class="col-12 items-center no-wrap">
        <div class="col">
          <div v-if="isUpdatingTemplate" class="text-h6">
            {{ t("alert_templates.updateTitle") }}
          </div>
          <div v-else class="text-h6">{{ t("alert_templates.addTitle") }}</div>
        </div>
      </div>

      <q-separator style="width: 100%" />

      <div class="col-12 q-pb-md q-pt-sm">
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
      <div class="col-12 q-pb-md q-pt-xs">
        <div class="q-pb-sm text-bold">Body</div>
        <div
          ref="editorRef"
          id="editor"
          :label="t('alerts.sql')"
          stack-label
          @keyup="editorUpdate"
          style="border: 1px solid #dbdbdb; border-radius: 5px"
          class="q-py-sm showLabelOnTop"
          resize
          :rules="[(val: any) => !!val || 'Field is required!']"
        />
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
import {
  ref,
  onMounted,
  computed,
  defineProps,
  onBeforeMount,
  onActivated,
  defineEmits,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import templateService from "@/services/alert_templates";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import type { TemplateData, Template } from "@/ts/interfaces/index";
const props = defineProps<{ template: TemplateData | null }>();
const emit = defineEmits(["get:templates", "cancel:hideform"]);
const { t } = useI18n();
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
    theme: "myCustomTheme",
    automaticLayout: true,
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
const editorUpdate = (e: any) => {
  formData.value.body = e.target.value;
};
const isValidTemplate = computed(
  () => formData.value.name && formData.value.body
);
const saveTemplate = () => {
  if (!isValidTemplate.value) {
    q.notify({
      type: "negative",
      message: "Please fill required fields",
      timeout: 1500,
    });
    return;
  }
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
        message: `Template saved successfully.`,
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
</script>
<style lang="scss" scoped>
#editor {
  width: 100%;
  min-height: 5rem;
  padding-bottom: 14px;
  resize: vertical;
  overflow: auto;
  max-height: 350px;
}
</style>
