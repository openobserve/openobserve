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
        <div v-if="isUpdating" class="text-h6">
          {{ t("function.updateEnrichmentTable") }}
        </div>
        <div v-else class="text-h6">{{ t("function.addEnrichmentTable") }}</div>
      </div>
    </div>

    <q-separator />
    <div>
      <q-form ref="addJSTransformForm" @submit="onSubmit">
        <div class="row">
          <q-input
            v-model="formData.name"
            :label="t('function.name')"
            color="input-border"
            bg-color="input-bg"
            class="col-12 q-py-md showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            v-bind:readonly="isUpdating"
            v-bind:disable="isUpdating"
            :rules="[(val: any) => !!val || 'Field is required!']"
            tabindex="0"
          />

          <q-file
            color="lime-11"
            filled
            v-model="formData.file"
            label="Upload CSV file"
            bg-color="input-bg"
            class="col-12 q-py-md showLabelOnTop lookup-table-file-uploader"
            stack-label
            outlined
            dense
          >
            <template v-slot:prepend>
              <q-icon name="attachment" />
            </template>
          </q-file>
        </div>

        <pre class="q-py-md showLabelOnTop text-bold text-h7">{{
          compilationErr
        }}</pre>
        <div class="flex justify-center q-mt-lg">
          <q-btn
            v-close-popup
            class="q-mb-md text-bold"
            :label="t('function.cancel')"
            text-color="light-text"
            padding="sm md"
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
import { defineComponent, ref, computed } from "vue";
import jsTransformService from "../../services/jstransform";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import segment from "../../services/segment_analytics";

const defaultValue: any = () => {
  return {
    name: "",
    file: "",
  };
};

export default defineComponent({
  name: "AddEnrichmentTable",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdating: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:list", "cancel:hideform"],
  setup(props, { emit }) {
    const store: any = useStore();
    const addJSTransformForm: any = ref(null);
    const disableColor: any = ref("");
    const formData: any = ref(defaultValue());
    const indexOptions = ref([]);
    const { t } = useI18n();
    const q = useQuasar();
    const editorRef: any = ref(null);
    let editorobj: any = null;
    const isFetchingStreams = ref(false);

    let compilationErr = ref("");

    const editorUpdate = (e: any) => {
      formData.value.function = e.target.value;
    };

    const onSubmit = () => {
      const dismiss = q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
      let reqformData = new FormData();
      reqformData.append("file", formData.value.file);

      jsTransformService
        .create_enrichment_table(
          store.state.selectedOrganization.identifier,
          formData.value.name,
          reqformData
        )
        .then((res) => {
          formData.value = { ...defaultValue() };
          emit("update:list");

          dismiss();
          q.notify({
            type: "positive",
            message: res.data.message,
          });
        })
        .catch((err) => {
          compilationErr.value = err.response.data["message"];
          q.notify({
            type: "negative",
            message:
              JSON.stringify(err.response.data["error"]) ||
              "Enrichment Table creation failed",
          });
          dismiss();
        });

      segment.track("Button Click", {
        button: "Save Enrichment Table",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        function_name: formData.value.name,
        page: "Add/Update Enrichment Table",
      });
    };

    return {
      t,
      q,
      disableColor,
      formData,
      addJSTransformForm,
      store,
      compilationErr,
      indexOptions,
      editorRef,
      editorobj,
      editorUpdate,
      isFetchingStreams,
      onSubmit,
    };
  },
  created() {
    this.formData = { ...defaultValue(), ...this.modelValue };

    if (this.isUpdating) {
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
<style lang="scss">
.no-case .q-field__native span {
  text-transform: none !important;
}
.lookup-table-file-uploader {
  .q-field__label {
    left: -30px;
  }
}
</style>
