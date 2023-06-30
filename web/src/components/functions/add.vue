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
  <div class="q-mx-md q-my-md">
    <div class="row items-center no-wrap">
      <div class="col">
        <div v-if="beingUpdated" class="text-h6">
          {{ t("function.updateTitle") }}
        </div>
        <div v-else class="text-h6">{{ t("function.addTitle") }}</div>
      </div>
    </div>

    <q-separator />
    <div>
      <q-form ref="addJSTransformForm" @submit="onSubmit">
        <div class="row q-pb-sm q-pt-md q-col-gutter-md">
          <q-input
            v-model="formData.name"
            :label="t('function.name')"
            color="input-border"
            bg-color="input-bg"
            class="col-4 q-py-md showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            :rules="[(val: any) => !!val || 'Field is required!', isValidMethodName,]"
            tabindex="0"
          />

          <!--  <q-select v-if="formData.ingest" v-model="formData.stream_type" :options="streamTypes"
                                :label="t('alerts.stream_type')" :popup-content-style="{ textTransform: 'capitalize' }" color="input-border"
                                bg-color="input-bg" class="col-4 q-py-sm showLabelOnTop" stack-label outlined filled dense
                                @update:model-value="updateStreams" :rules="[(val: any) => !!val || 'Field is required!']" />

                              <q-select v-if="formData.ingest" v-model="formData.stream_name" :loading="isFetchingStreams"
                                :options="indexOptions" :label="t('function.stream_name')" color="input-border" bg-color="input-bg"
                                class="col-4 q-py-md showLabelOnTop no-case" stack-label outlined filled dense />-->
        </div>

        <div class="q-gutter-sm">
          <q-radio
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            v-model="formData.transType"
            :checked="formData.transType === '0'"
            val="0"
            :label="t('function.vrl')"
            class="q-ml-none"
            @update:model-value="updateFunction"
          />
          <q-radio
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            v-model="formData.transType"
            :checked="formData.transType === '1'"
            val="1"
            :label="t('function.lua')"
            class="q-ml-none"
            @update:model-value="updateFunction"
          />
        </div>

        <q-input
          v-model="formData.params"
          :label="t('function.params')"
          color="input-border"
          bg-color="input-bg"
          class="col-4 q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          v-bind:readonly="beingUpdated"
          v-bind:disable="beingUpdated"
          :rules="[(val: any) => !!val || 'Field is required!', isValidMethodName,]"
          tabindex="0"
        />

        <div class="q-py-md showLabelOnTop text-bold text-h7">Function:</div>
        <div
          ref="editorRef"
          id="editor"
          :label="t('function.jsfunction')"
          stack-label
          style="border: 1px solid #dbdbdb; border-radius: 5px"
          @keyup="editorUpdate"
          class="q-py-md showLabelOnTop"
          resize
        ></div>

        <q-input
          v-if="formData.ingest"
          v-model="formData.order"
          :label="t('function.order')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          type="number"
          min="1"
        />

        <div class="flex justify-center q-mt-lg">
          <q-btn
            v-close-popup
            class="q-mb-md text-bold no-border"
            :label="t('function.cancel')"
            text-color="light-text"
            padding="sm md"
            color="accent"
            no-caps
            @click="$emit('cancel:hideform')"
          />
          <q-btn
            :label="t('function.save')"
            class="q-mb-md text-bold no-border q-ml-md"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
          />
        </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import jsTransformService from "../../services/jstransform";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

import streamService from "../../services/stream";
import { update } from "plotly.js";
import segment from "../../services/segment_analytics";

const defaultValue: any = () => {
  return {
    name: "",
    function: "",
    params: "",
    stream_name: "",
    order: 1,
    ingest: false,
    stream_type: "logs",
    transType: "1",
  };
};

let callTransform: Promise<{ data: any }>;

export default defineComponent({
  name: "ComponentAddUpdateFunction",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:list", "cancel:hideform"],
  setup() {
    const store: any = useStore();
    let beingUpdated: boolean = false;
    const addJSTransformForm: any = ref(null);
    const disableColor: any = ref("");
    const formData: any = ref(defaultValue());
    const indexOptions = ref([]);
    const { t } = useI18n();
    const $q = useQuasar();
    const editorRef: any = ref(null);
    let editorobj: any = null;
    const streams: any = ref({});
    const isFetchingStreams = ref(false);

    const streamTypes = ["logs", "metrics"];

    const editorUpdate = (e: any) => {
      formData.value.function = e.target.value;
    };
    const editorData = ref("");
    const prefixCode = ref("");
    const suffixCode = ref("");

    onMounted(async () => {
      monaco.editor.defineTheme("myCustomTheme", {
        base: "vs", // can also be vs-dark or hc-black
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [
          {
            token: "comment",
            foreground: "ffa500",
            fontStyle: "italic underline",
          },
          { token: "comment.js", foreground: "008800", fontStyle: "bold" },
          { token: "comment.css", foreground: "0000ff" }, // will inherit fontStyle from `comment` above
        ],
        colors: {
          "editor.foreground": "#000000",
        },
      });
      editorobj = monaco.editor.create(editorRef.value, {
        value: ``,
        language: "lua",
        minimap: {
          enabled: false,
        },
        theme: (store.state.theme == 'dark' ? 'vs-dark' : 'myCustomTheme'),
      });

      editorobj.onKeyUp((e: any) => {
        if (editorobj.getValue() != "") {
          editorData.value = editorobj.getValue();
          formData.value.function = editorobj.getValue();
        }
      });

      editorobj.setValue(formData.value.function);
    });

    const updateFunction = (e: any) => {
      updateEditorContent();
    };
    const updateEditorContent = () => {
      if (editorData.value != "") {
        editorData.value = editorData.value
          .replace(prefixCode.value, "")
          .trim();
        editorData.value = editorData.value
          .replace(suffixCode.value, "")
          .trim();
      }

      if (formData.value.transType == "1") {
        if (formData.value.ingest) {
          prefixCode.value = `function(row)`;
          suffixCode.value = `
end`;
        } else {
          prefixCode.value = `function()`;
          suffixCode.value = `
end`;
        }
      } else {
        if (formData.value.ingest) {
          prefixCode.value = "";
          suffixCode.value = "";
        } else {
          prefixCode.value = `function()`;
          suffixCode.value = "";
        }
      }

      const someCode = `${prefixCode.value}
    ${editorData.value}
    ${suffixCode.value}`;
      editorobj.setValue(someCode);
      formData.value.function = editorobj.getValue();
    };

    const updateStreams = (resetStream = true) => {
      if (resetStream) formData.value.stream_name = "";

      if (streams.value[formData.value.stream_type]) {
        indexOptions.value = streams.value[formData.value.stream_type].map(
          (data: any) => {
            return data.name;
          }
        );
        return;
      }

      isFetchingStreams.value = true;
      streamService
        .nameList(
          store.state.selectedOrganization.identifier,
          formData.value.stream_type,
          true
        )
        .then((res) => {
          streams.value[formData.value.stream_type] = res.data.list;
          indexOptions.value = res.data.list.map((data: any) => {
            return data.name;
          });
        })
        .finally(() => (isFetchingStreams.value = false));
    };

    return {
      t,
      $q,
      disableColor,
      beingUpdated,
      formData,
      addJSTransformForm,
      store,
      indexOptions,
      editorRef,
      editorobj,
      prefixCode,
      suffixCode,
      editorData,
      editorUpdate,
      updateFunction,
      updateEditorContent,
      streamTypes,
      updateStreams,
      isFetchingStreams,
    };
  },
  created() {
    this.formData.ingest = ref(false);
    this.formData = { ...defaultValue, ...this.modelValue };
    this.updateStreams(false);
    this.beingUpdated = this.isUpdated;

    if (
      this.modelValue &&
      this.modelValue.name != undefined &&
      this.modelValue.name != ""
    ) {
      this.beingUpdated = true;
      this.disableColor = "grey-5";
      this.formData = this.modelValue;
    }
  },
  methods: {
    onRejected(rejectedEntries: string | any[]) {
      this.$q.notify({
        type: "negative",
        message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
      });
    },
    isValidMethodName() {
      const methodPattern = /^[$A-Z_][0-9A-Z_$]*$/i;
      return methodPattern.test(this.formData.name) || "Invalid method name.";
    },
    onSubmit() {
      if (this.formData.ingest && this.formData.stream_name == "") {
        this.$q.notify({
          type: "negative",
          message: "Please select stream name.",
          timeout: 1500,
        });
        return false;
      }

      if (
        this.formData.trans_type == "0" &&
        this.formData.function.indexOf("function") == -1
      ) {
        this.$q.notify({
          type: "negative",
          message:
            "You are not allowed to change the function name or return statement in function body.",
          timeout: 4000,
        });
        return false;
      }

      const dismiss = this.$q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
      this.addJSTransformForm.validate().then((valid: any) => {
        if (!valid) {
          return false;
        }

        this.formData.order = parseInt(this.formData.order);
        this.formData.transType = parseInt(this.formData.transType);
        if (this.formData.ingest) {
          callTransform = jsTransformService.create_with_index(
            this.store.state.selectedOrganization.identifier,
            this.formData.stream_name,
            this.formData.stream_type,
            this.formData
          );
        } else {
          this.formData.stream_name = "";
          callTransform = jsTransformService.create(
            this.store.state.selectedOrganization.identifier,
            this.formData
          );
        }
        callTransform.then((res: { data: any }) => {
          const data = res.data;
          this.formData = { ...defaultValue };

          this.$emit("update:list");
          this.addJSTransformForm.resetValidation();
          dismiss();
          this.$q.notify({
            type: "positive",
            message: res.data.message,
          });
        });

        segment.track("Button Click", {
          button: "Save Function",
          user_org: this.store.state.selectedOrganization.identifier,
          user_id: this.store.state.userInfo.email,
          stream_name: this.formData.stream_name,
          function_name: this.formData.name,
          is_ingest_fn: this.formData.ingest,
          page: "Add/Update Function",
        });
      });
    },
  },
});
</script>

<style scoped>
#editor {
  width: 100%;
  min-height: 15rem;
  padding-bottom: 14px;
  resize: both;
}
</style>
<style>
.no-case .q-field__native span {
  text-transform: none !important;
}
</style>
