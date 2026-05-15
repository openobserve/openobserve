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
  <div class="flex items-end tw:gap-2">
    <!-- select new folder -->
    <OSelect
      v-model="selectedFolder"
      :label="t('dashboard.selectFolderLabel')"
      :options="
        store.state.organizationData.folders.map((item: any) => {
          return { label: item.name, value: item.folderId };
        })
      "
      data-test="index-dropdown-stream_type"
      labelKey="label"
      class="tw:flex-1"
    />

    <OButton
      data-test="dashboard-folder-move-new-add"
      variant="outline"
      size="icon-sm"
      @click="
        () => {
          showAddFolderDialog = true;
        }
      "
    >
      <template #icon-left><q-icon name="add" /></template>
    </OButton>
  </div>
  <!-- add folder -->
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
import { defineComponent, onActivated, ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import AddFolder from "../../components/dashboards/AddFolder.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { useRoute } from "vue-router";

export default defineComponent({
  name: "SelectedFolderDropdown",
  components: { AddFolder, OButton, ODrawer, OSelect },
  emits: ["folder-selected"],
  props: {
    activeFolderId: {
      required: false,
      validator: (value) => {
        return typeof value === "string" || value === null;
      },
    },
  },
  setup(props, { emit }) {
    const store: any = useStore();
    const route = useRoute();
    const showAddFolderDialog: any = ref(false);

    const getInitialFolderValue = (): string => {
      // priority: activeFolderId > query.folder > default
      const folderId = props.activeFolderId ?? route.query.folder ?? "default";
      const activeFolderData = store.state.organizationData.folders.find(
        (item: any) => item.folderId === folderId,
      );
      return activeFolderData?.folderId ?? "default";
    };

    //dropdown selected folder id (primitive string for OSelect)
    const selectedFolder = ref<string>(getInitialFolderValue());
    const { t } = useI18n();

    const updateFolderList = async (newFolder: any) => {
      showAddFolderDialog.value = false;
      if (newFolder && newFolder.data) {
        selectedFolder.value = newFolder.data.folderId;
      }
    };

    const computedStyle = computed(() => {
      return "";
    });

    onActivated(() => {
      // refresh selected folder
      selectedFolder.value = getInitialFolderValue();
    });

    watch(
      () => store.state.organizationData.folders,
      () => {
        // refresh selected folder, on folders list change
        selectedFolder.value = getInitialFolderValue();
      },
    );

    watch(
      () => selectedFolder.value,
      (folderId) => {
        const folder = store.state.organizationData.folders.find(
          (item: any) => item.folderId === folderId,
        );
        // emit {label, value} for backward compatibility with parents
        emit("folder-selected", {
          label: folder?.name ?? folderId,
          value: folderId,
        });
      },
    );

    return {
      t,
      store,
      selectedFolder,
      updateFolderList,
      showAddFolderDialog,
      computedStyle,
    };
  },
});
</script>
