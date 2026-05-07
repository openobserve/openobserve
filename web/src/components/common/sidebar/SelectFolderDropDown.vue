<!-- Copyright 2026 OpenObserve Inc.

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
    <div class="flex justify-center items-end">
      <!-- select new folder -->
      <q-select
        v-model="selectedFolder"
        :label="t('dashboard.selectFolderLabel') + ' *'"
        :options="store.state.organizationData.foldersByType[type]?.map((item: any)=> {return {label: item.name, value: item.folderId}})"
        :data-test="`${type}-index-dropdown-stream_type`"
        input-debounce="0"
        behavior="menu"
        borderless
        dense
        class="showLabelOnTop no-case tw:mr-1"
        style="width: calc(100% - 44px)"
        :disable="disableDropdown"
      >
        <template #no-option>
          <q-item>
            <q-item-section> {{ t("search.noResult") }}</q-item-section>
          </q-item>
        </template>
      </q-select>

      <div style="width: 40px; margin-bottom: -4px;" :style="computedStyle">
        <OButton
          variant="outline"
          size="icon"
          :data-test="`${type}-folder-move-new-add`"
          title="Add Folder"
          :disabled="disableDropdown"
          @click="() => { showAddFolderDialog = true; }"
        >
          <q-icon name="add" size="xs" />
        </OButton>
      </div>
    </div>
    <!-- add folder -->
    <ODrawer
      v-if="!disableDropdown"
      v-model:open="showAddFolderDialog"
      :width="30"
      :show-close="false"
      :data-test="`${type}-folder-move-dialog`"
    >
      <AddFolder ref="addFolderRef" :type="type" @update:modelValue="updateFolderList" @close="showAddFolderDialog = false" :edit-mode="false" />
      <template #footer>
        <div class="tw:flex tw:justify-start tw:gap-2">
          <OButton variant="outline" size="sm-action" @click="showAddFolderDialog = false" data-test="dashboard-folder-add-cancel">{{ t('dashboard.cancel') }}</OButton>
          <OButton variant="primary" size="sm-action" data-test="dashboard-folder-add-save" @click="addFolderRef?.submit()">{{ t('common.save') }}</OButton>
        </div>
      </template>
    </ODrawer>
  </template>

  <script lang="ts">
  import { defineComponent, onActivated, ref, watch } from "vue";
  import { useI18n } from "vue-i18n";
  import { useStore } from "vuex";
  import AddFolder from "./AddFolder.vue";
  import { useRoute } from "vue-router";
import { computed } from "vue";
import { getFoldersListByType } from "@/utils/commons";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

  export default defineComponent({
    name: "SelectedFolderDropdown",
    components: { AddFolder, OButton, ODrawer },
    emits: ["folder-selected"],
    props: {
      activeFolderId: {
        required: false,
        validator: (value) => {
          return typeof value === "string" || value === null;
        },
      },
      type: {
        type: String,
        default: "alerts"
      },
      disableDropdown: {
        type: Boolean,
        default: false,
      },
      style: {
        type: String,
        default: "",
      },
      class: {
        type: String,
        default: "",
      },
    },
    setup(props, { emit }) {
      const store: any = useStore();
      const route = useRoute();
      const showAddFolderDialog: any = ref(false);
      const addFolderRef: any = ref(null);

      const getInitialFolderValue = () => {
        // priority: activeFolderId > query.folder > default
        // use activeFolderId if available
        // else use router query if available
        // else use default
        const activeFolderData = store.state.organizationData.foldersByType[props.type]?.find(
          (item: any) =>
            item.folderId === (props.activeFolderId ?? route.query.folder ?? "default")
        );

        return {
          label: activeFolderData?.name ?? "default",
          value: activeFolderData?.folderId ?? "default",
        };
      };

      //dropdown selected folder index
      const selectedFolder = ref(getInitialFolderValue());
      const { t } = useI18n();

      const updateFolderList = async (newFolder: any) => {
        showAddFolderDialog.value = false;
        selectedFolder.value = {
          label: newFolder.data.name,
          value: newFolder.data.folderId,
        };
      };

      const computedStyle = computed (() => {
        const baseStyle = props.style ? props.style : 'height: 35px';
        return `${baseStyle}; margin-top: 23px`;
      });

      onActivated(async () => {
        // refresh selected folder
        selectedFolder.value = getInitialFolderValue();
        await getFoldersListByType(store, props.type);
      });

      watch(
        () => store.state.organizationData.foldersByType[props.type],
        () => {
          // refresh selected folder, on folders list change
          selectedFolder.value = getInitialFolderValue();
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
        addFolderRef,
        computedStyle,
      };
    },
  });
  </script>
