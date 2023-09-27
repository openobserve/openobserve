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
      <q-form ref="addFolderForm" @submit="onSubmit">
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
import dashboardService from "../../services/dashboards";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";

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
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    editMode: {
      type: Boolean,
      default: false
    }
  },
  emits: ["update:modelValue", "updated", "finish"],
  setup(props) {
    const store: any = useStore();
    // const beingUpdated: any = ref(false);
    const addFolderForm: any = ref(null);
    const disableColor: any = ref("");
    const folderData: any = ref(props.editMode ? props.modelValue : defaultValue());
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();

    return {
      t,
      disableColor,
      isPwd: ref(true),
      // beingUpdated,
      status,
      folderData,
      addFolderForm,
      store,
      isValidIdentifier,
      getImageURL,
    };
  },
  created() {
    if (this.modelValue && this.modelValue.id) {
      // this.beingUpdated = true;
      this.disableColor = "grey-5";
      this.folderData = {
        name: this.modelValue.name,
        description: this.modelValue.description,
      };
    }
  },
  methods: {
    onSubmit() {
      const dismiss = this.$q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
      this.addFolderForm.validate().then((valid: any) => {
        if (!valid) {
          return false;
        }

        //if edit mode
        if(this.$props.editMode) {
          dashboardService.edit_Folder(
            this.store.state.selectedOrganization.identifier,
            this.folderData.folderId,
            this.folderData
          )
            .then((res: { data: any }) => {
              this.folderData = {
                folderId: "",
                name: "",
                description: "",
              };

              dismiss();
              this.$q.notify({
                type: "positive",
                message: res.data.message || "Folder updated",
                timeout: 2000,
              });

              this.$emit("update:modelValue", this.folderData);
              
              this.addFolderForm.resetValidation();
            })
            .catch((err: any) => {
              this.$q.notify({
                type: "negative",
                message: JSON.stringify(
                  err.response.data["error"] || "Folder creation failed."
                  ),
              });
              dismiss();
            });
          }
        //else new folder
        else{
          dashboardService.new_Folder(
            this.store.state.selectedOrganization.identifier,
            this.folderData
          )
            .then((res: { data: any }) => {
              const data = res.data;
              this.folderData = {
                folderId: "",
                name: "",
                description: "",
              };
  
              this.$emit("update:modelValue", data);
              this.$emit("updated", data.folderId);
              this.addFolderForm.resetValidation();
              dismiss();

              this.$q.notify({
                type: "positive",
                message: `Folder added successfully.`,
              });
            })
            .catch((err: any) => {
              this.$q.notify({
                type: "negative",
                message: JSON.stringify(
                  err.response.data["error"] || "Folder creation failed."
                ),
              });
              dismiss();
            });
        }
      });
    },
  },
});
</script>
