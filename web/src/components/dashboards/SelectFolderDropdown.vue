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
  <div class="flex justify-center q-mt-lg">
    <!-- select new folder -->
    <q-select v-model="selectedFolder" label="Select Folder"
      :options="store.state.organizationData.folders.map((item: any)=> {return {label: item.name, value: item.folderId}})" data-test="index-dropdown-stream_type" input-debounce="0" behavior="menu" filled borderless dense
      class="q-mb-xs" style="width: 88%">
    </q-select>

    <q-btn
      class="q-mb-md text-bold"
      label="+"
      text-color="light-text"
      padding="sm md"
      no-caps
      @click="()=>{showAddFolderDialog = true}"
    />
  </div>

  <!-- add/edit folder -->
  <q-dialog
      v-model="showAddFolderDialog"
      position="right"
      full-height
      maximized
    >
    <AddFolder @update:modelValue="updateFolderList" :edit-mode="false"/>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, onActivated, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import AddFolder from "../../components/dashboards/AddFolder.vue";
import { useRoute } from "vue-router";

export default defineComponent({
  name: "SelectedFolderDropdown",
  components:{AddFolder},
  props: {
    activeFolderId: {
      type: String,
      default: "default",
    },
  },
  emits: ["folder-selected"],
  setup(props, { emit }) {

    const store: any = useStore();
    const route = useRoute();
    const showAddFolderDialog: any = ref(false);
    //dropdown selected folder index
    const selectedFolder = ref({
      label: store.state.organizationData.folders.find((item: any) => item.folderId === route.query.folder ?? "default")?.name ?? "default",
      value: route.query.folder ?? "default",
    });
    const { t } = useI18n();    

    const updateFolderList = async (newFolder: any) => {
      showAddFolderDialog.value = false;
      selectedFolder.value = {label: newFolder.data.name, value: newFolder.data.folderId};
    }
    
    onActivated(() => {
      selectedFolder.value = {label: store.state.organizationData.folders.find((item: any) => item.folderId === route.query.folder ?? "default")?.name, value: route.query.folder ?? "default"};
    })
    

    watch(()=>selectedFolder.value,()=>{
      emit("folder-selected", selectedFolder.value);
    })

    return {
      t,
      store,
      selectedFolder,
      updateFolderList,
      showAddFolderDialog
    };
  },
});
</script>
