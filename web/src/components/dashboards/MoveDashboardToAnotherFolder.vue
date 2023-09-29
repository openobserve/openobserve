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
      <q-form ref="moveFolderForm" @submit="onSubmit">
        <q-input
          v-model="folderList[currentFolderIndex].name"
          label="Current Folder"
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
        <!-- select new folder -->
        <q-select v-model="selectedFolderIndex" label="Select Another Folder"
          :options="folderList.map((item,index)=> {return {label: item.name, value: index}})" data-test="index-dropdown-stream_type" input-debounce="0" behavior="menu" filled borderless dense
          class="q-mb-xs">
        </q-select>

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
            :disable="currentFolderIndex === selectedFolderIndex.value"
            label="Move"
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

export default defineComponent({
  name: "MoveDashboardToAnotherFolder",
  props: {
    currentFolderIndex: {
      type: Number,
      default: 0,
    },
    folderList: {
      default: [
      {
        name: "default",
        folderId: "default",
        description: "default",
      }
      ]
    },
    dashobardId:{
      type: String,
      default: ""
    }
  },
  emits: ["updated"],
  setup(props) {
    const store: any = useStore();
    const moveFolderForm: any = ref(null);
    //dropdown selected folder index
    const selectedFolderIndex = ref({label: props.folderList[props.currentFolderIndex].name, value: props.currentFolderIndex});
    const { t } = useI18n();

    return {
      t,
      isPwd: ref(true),
      status,
      moveFolderForm,
      store,
      getImageURL,
      selectedFolderIndex,
    };
  },
  methods: {
    onSubmit() {
      const dismiss = this.$q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });
      this.moveFolderForm.validate().then((valid: any) => {
        if (!valid) {
          return false;
        }

        dashboardService.move_Dashboard(
          this.store.state.selectedOrganization.identifier,
          this.$props.dashobardId,
          {
            from: this.$props.folderList[this.currentFolderIndex].folderId,
            to: this.$props.folderList[this.selectedFolderIndex.value].folderId
          }
        ).then((res: any) => {
          dismiss();
          this.$q.notify({
            type: "positive",
            message: res.message || "Dashboard Moved successfully",
            timeout: 2000,
          });

          this.$emit("updated");
          this.moveFolderForm.resetValidation();
          
        }).catch((err) => {
          dismiss();
          this.$q.notify({
            type: "negative",
            message: JSON.stringify(
              err.response.data.message || "Dashboard move failed."
              ),
            timeout: 2000,
          });
        });
      }
      );
    },
  },
});
</script>
