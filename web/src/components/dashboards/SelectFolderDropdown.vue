<!-- Copyright 2023 Zinc Labs Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="flex justify-center items-baseline">
    <!-- select new folder -->
    <q-select
      v-model="selectedFolder"
      :label="t('dashboard.selectFolderLabel')"
      :options="store.state.organizationData.folders.map((item: any)=> {return {label: item.name, value: item.folderId}})"
      data-test="index-dropdown-stream_type"
      input-debounce="0"
      behavior="menu"
      filled
      borderless
      dense
      class="q-mb-xs showLabelOnTop"
      style="width: 88%"
    >
    </q-select>

    <q-btn
      class="q-mb-md text-bold"
      data-test="dashboard-folder-move-new-add"
      label="+"
      text-color="light-text"
      padding="sm md"
      no-caps
      @click="
        () => {
          showAddFolderDialog = true;
        }
      "
    />
  </div>
  <!-- add/edit folder -->
  <q-dialog
    v-model="showAddFolderDialog"
    position="right"
    full-height
    maximized
    data-test="dashboard-folder-move-dialog"
  >
    <AddFolder @update:modelValue="updateFolderList" :edit-mode="false" />
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
  components: { AddFolder },
  emits: ["folder-selected"],
  setup(props, { emit }) {
    const store: any = useStore();
    const route = useRoute();
    const showAddFolderDialog: any = ref(false);
    //dropdown selected folder index
    const selectedFolder = ref({
      label:
        store.state.organizationData.folders.find(
          (item: any) => item.folderId === route.query.folder ?? "default"
        )?.name ?? "default",
      value: route.query.folder ?? "default",
    });
    const { t } = useI18n();

    const updateFolderList = async (newFolder: any) => {
      showAddFolderDialog.value = false;
      selectedFolder.value = {
        label: newFolder.data.name,
        value: newFolder.data.folderId,
      };
    };

    onActivated(() => {
      selectedFolder.value = {
        label:
          store.state.organizationData.folders.find(
            (item: any) => item.folderId === route.query.folder ?? "default"
          )?.name ?? "default",
        value: route.query.folder ?? "default",
      };
    });

    watch(
      () => store.state.organizationData.folders,
      () => {
        selectedFolder.value = {
          label:
            store.state.organizationData.folders.find(
              (item: any) => item.folderId === route.query.folder ?? "default"
            )?.name ?? "default",
          value: route.query.folder ?? "default",
        };
      }
    );

    watch(
      () => selectedFolder.value,
      () => {
        emit("folder-selected", selectedFolder.value);
      }
    );

    return {
      t,
      store,
      selectedFolder,
      updateFolderList,
      showAddFolderDialog,
    };
  },
});
</script>
