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
          <div v-if="editMode" class="text-body1 text-bold">
            Update Folder
          </div>
          <div v-else class="text-body1 text-bold">
            New Folder
          </div>
        </div>
        <div class="col-auto">
          <q-btn
            v-close-popup
            round
            flat
            icon="cancel"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <q-card-section class="q-w-md q-mx-lg">
      <q-form ref="addFolderForm" @submit.stop="onSubmit.execute">
        <q-input
          v-model="folderData.name"
          label="Name *"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val) => !!(val.trim()) || t('dashboard.nameRequired')]"
          :lazy-rules="true"
        />
        <span>&nbsp;</span>
        <q-input
          v-model="folderData.description"
          :label="t('dashboard.typeDesc')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
        />

        <div class="flex justify-center q-mt-lg">
          <q-btn
            v-close-popup
            class="q-mb-md text-bold"
            :label="t('dashboard.cancel')"
            text-color="light-text"
            padding="sm md"
            no-caps
          />
          <q-btn
            data-test="dashboard-add-submit"
            :disable="folderData.name.trim() === ''"
            :loading="onSubmit.isLoading.value"
            :label="t('dashboard.save')"
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
import { createFolder, updateFolder } from "@/utils/commons";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import { useQuasar } from "quasar";
import { useLoading } from "@/composables/useLoading";

const defaultValue = () => {
  return {
    folderId:"",
    name: "",
    description: "",
  };
};

export default defineComponent({
  name: "AddFolder",
  props: {
    folderId: {
      type: String,
      default: "default",
    },
    editMode: {
      type: Boolean,
      default: false
    }
  },
  emits: ["update:modelValue"],
  setup(props, {emit}) {
    const store: any = useStore();
    const addFolderForm: any = ref(null);
    const disableColor: any = ref("");
    const folderData: any = ref(props.editMode ? JSON.parse(JSON.stringify(store.state.organizationData.folders.find((item: any) => item.folderId === props.folderId))) : defaultValue());
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();
    const $q = useQuasar();

    const onSubmit = useLoading(async () => {
      await addFolderForm.value.validate().then(async (valid: any) => {
        if (!valid) {
          return false;
        }

        try {
          //if edit mode
          if(props.editMode) {            
            await updateFolder(store, folderData.value.folderId, folderData.value);            
            $q.notify({
              type: "positive",
              message: "Folder updated",
              timeout: 2000,
            });
            emit("update:modelValue", folderData.value);
          }
          //else new folder
          else{
            const newFolder: any = await createFolder(store, folderData.value);
            emit("update:modelValue", newFolder);
            $q.notify({
              type: "positive",
              message: `Folder added successfully.`,
              timeout: 2000,
            });
          }
          
        } catch (err: any) {
          $q.notify({
            type: "negative",
            message: JSON.stringify(
              err?.response?.data["error"] || "Folder creation failed."
            ),
            timeout: 2000,
          });
        } finally {
          folderData.value = {
            folderId: "",
            name: "",
            description: "",
          };
          await addFolderForm.value.resetValidation();
        }
      });
    });

    return {
      t,
      disableColor,
      isPwd: ref(true),
      status,
      folderData,
      addFolderForm,
      store,
      isValidIdentifier,
      getImageURL,
      onSubmit
    };
  }
});
</script>
