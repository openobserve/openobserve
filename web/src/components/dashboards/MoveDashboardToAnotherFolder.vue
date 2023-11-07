<!-- Copyright 2023 Zinc Labs Inc.

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
  <q-card class="column full-height">
    <q-card-section class="q-px-md q-py-md">
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="text-body1 text-bold">
            Move Dashboard To Another Folder
          </div>
        </div>
        <div class="col-auto">
          <q-btn v-close-popup="true" round flat icon="cancel" />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <q-card-section class="q-w-md q-mx-lg">
      <q-form ref="moveFolderForm" @submit.stop="onSubmit.execute()">
        <q-input
          v-model="store.state.organizationData.folders.find((item: any) => item.folderId === activeFolderId).name"
          :label="t('dashboard.currentFolderLabel')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :disable="true"
        />
        <span>&nbsp;</span>

        <!-- select folder or create new folder and select -->
        <SelectFolderDropdown @folder-selected="selectedFolder = $event" />

        <div class="flex justify-center q-mt-lg">
          <q-btn
            v-close-popup="true"
            class="q-mb-md text-bold"
            :label="t('dashboard.cancel')"
            text-color="light-text"
            padding="sm md"
            no-caps
          />
          <q-btn
            data-test="dashboard-add-submit"
            :disable="activeFolderId === selectedFolder.value"
            :loading="onSubmit.isLoading.value"
            :label="t('common.move')"
            class="q-mb-md text-bold no-border q-ml-md"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
          />
        </div>
      </q-form>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import { moveDashboardToAnotherFolder } from "../../utils/commons";
import SelectFolderDropdown from "./SelectFolderDropdown.vue";
import { useLoading } from "@/composables/useLoading";
import { useQuasar } from "quasar";

export default defineComponent({
  name: "MoveDashboardToAnotherFolder",
  components: { SelectFolderDropdown },
  props: {
    activeFolderId: {
      type: String,
      default: "default",
    },
    dashboardId: {
      type: String,
      default: "",
    },
  },
  emits: ["updated"],
  setup(props, { emit }) {
    const store: any = useStore();
    const moveFolderForm: any = ref(null);
    //dropdown selected folder
    const selectedFolder = ref({
      label: store.state.organizationData.folders.find(
        (item: any) => item.folderId === props.activeFolderId
      ).name,
      value: props.activeFolderId,
    });
    const { t } = useI18n();
    const $q = useQuasar();

    const onSubmit = useLoading(async () => {
      await moveFolderForm.value.validate().then(async (valid: any) => {
        if (!valid) {
          return false;
        }

        try {
          await moveDashboardToAnotherFolder(
            store,
            props.dashboardId,
            props.activeFolderId,
            selectedFolder.value.value
          );
          $q.notify({
            type: "positive",
            message: "Dashboard Moved successfully",
            timeout: 2000,
          });

          emit("updated");
          moveFolderForm.value.resetValidation();
        } catch (err: any) {
          $q.notify({
            type: "negative",
            message: JSON.stringify(
              err.response.data.message || "Dashboard move failed."
            ),
            timeout: 2000,
          });
        }
      });
    });

    return {
      t,
      moveFolderForm,
      store,
      getImageURL,
      selectedFolder,
      onSubmit,
    };
  },
});
</script>
