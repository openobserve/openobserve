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
        </div>

        <div v-if="store.state.zoConfig.lua_fn_enabled" class="q-gutter-sm">
          <q-radio
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            v-model="formData.transType"
            :checked="formData.transType === '0'"
            val="0"
            :label="t('function.vrl')"
            class="q-ml-none"
            @update:model-value="updateEditorContent"
          />
          <q-radio
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            v-model="formData.transType"
            :checked="formData.transType === '1'"
            val="1"
            :label="t('function.lua')"
            class="q-ml-none"
            @update:model-value="updateEditorContent"
          />
        </div>

        <q-input
          v-if="formData.transType === '0'"
          v-model="formData.params"
          :label="t('function.params')"
          :placeholder="t('function.paramsHint')"
          color="input-border"
          bg-color="input-bg"
          class="col-4 q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          v-bind:readonly="beingUpdated"
          v-bind:disable="beingUpdated"
          :rules="[(val: any) => !!val || 'Field is required!', isValidParam,]"
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

        <!-- <q-input v-if="formData.ingest" v-model="formData.order" :label="t('function.order')" color="input-border"
                                                                                    bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense type="number" min="1" /> -->
        <pre class="q-py-md showLabelOnTop text-bold text-h7">{{
          compilationErr
        }}</pre>
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
import { defineComponent, ref, onMounted, computed } from "vue";
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
    params: "row",
    transType: "0",
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
  setup(props, { emit }) {
    const store: any = useStore();
    // let beingUpdated: boolean = false;
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

    let compilationErr = ref("");

    const beingUpdated = computed(() => props.isUpdated);

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
        language: "vrl",
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

    const isValidParam = () => {
      const methodPattern = /^[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*$/g;
      return methodPattern.test(formData.value.params) || "Invalid params.";
    };

    const isValidMethodName = () => {
      const methodPattern = /^[$A-Z_][0-9A-Z_$]*$/i;
      return methodPattern.test(formData.value.name) || "Invalid method name.";
    };
    const updateEditorContent = () => {
      if (formData.value.transType == "1") {
        prefixCode.value = `function(row)`;
        suffixCode.value = `
end`;
      } else {
        prefixCode.value = ``;
        suffixCode.value = ``;
      }

      const someCode = `${prefixCode.value}
    ${editorData.value}
    ${suffixCode.value}`;
      editorobj.setValue(someCode);
      formData.value.function = editorobj.getValue();
    };

    const onSubmit = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      addJSTransformForm.value.validate().then((valid: any) => {
        if (!valid) {
          return false;
        }

        if (!beingUpdated.value) {
          formData.value.transType = parseInt(formData.value.transType);
          //trans type is lua remove params from form
          if (formData.value.transType == 1) {
            formData.value.params = "";
          }

          callTransform = jsTransformService.create(
            store.state.selectedOrganization.identifier,
            formData.value
          );
        } else {
          formData.value.transType = parseInt(formData.value.transType);
          //trans type is lua remove params from form
          if (formData.value.transType == 1) {
            formData.value.params = "";
          }

          callTransform = jsTransformService.update(
            store.state.selectedOrganization.identifier,
            formData.value
          );
        }

        callTransform
          .then((res: { data: any }) => {
            const data = res.data;
            formData.value = { ...defaultValue() };

            emit("update:list");
            addJSTransformForm.value.resetValidation();
            dismiss();
            $q.notify({
              type: "positive",
              message: res.data.message,
            });
          })
          .catch((err) => {
            compilationErr.value = err.response.data["message"];
            $q.notify({
              type: "negative",
              message:
                JSON.stringify(err.response.data["error"]) ||
                "Function creation failed",
            });
            dismiss();
          });

        segment.track("Button Click", {
          button: "Save Function",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          function_name: formData.value.name,
          page: "Add/Update Function",
        });
      });
    };

    return {
      t,
      $q,
      disableColor,
      beingUpdated,
      formData,
      addJSTransformForm,
      store,
      compilationErr,
      indexOptions,
      editorRef,
      editorobj,
      prefixCode,
      suffixCode,
      editorData,
      editorUpdate,
      updateEditorContent,
      streamTypes,
      isFetchingStreams,
      isValidParam,
      isValidMethodName,
      onSubmit,
    };
  },
  created() {
    this.formData = { ...defaultValue(), ...this.modelValue };
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
