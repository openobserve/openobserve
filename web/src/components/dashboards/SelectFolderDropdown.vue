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
    <q-select
      v-model="selectedFolder"
      :label="t('dashboard.selectFolderLabel')"
      :options="
        store.state.organizationData.folders.map((item: any) => {
          return { label: item.name, value: item.folderId };
        })
      "
      data-test="index-dropdown-stream_type"
      input-debounce="0"
      behavior="menu"
      borderless
      dense
      class="showLabelOnTop no-case o2-custom-select-dashboard tw:flex-1"
    >
      <template #no-option>
        <q-item>
          <q-item-section> {{ t("search.noResult") }}</q-item-section>
        </q-item>
      </template>
    </q-select>

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
  <ODrawer
    v-model:open="showAddFolderDialog"
    :width="30"
    :show-close="false"
    @close="showAddFolderDialog = false"
    data-test="dashboard-folder-move-dialog"
  >
    <AddFolder @update:modelValue="updateFolderList" @close="showAddFolderDialog = false" :edit-mode="false" />
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, onActivated, ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import AddFolder from "../../components/dashboards/AddFolder.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { useRoute } from "vue-router";

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
  },
  setup(props, { emit }) {
    const store: any = useStore();
    const route = useRoute();
    const showAddFolderDialog: any = ref(false);

    const getInitialFolderValue = () => {
      // priority: activeFolderId > query.folder > default
      // use activeFolderId if available
      // else use router query if available
      // else use default
      const activeFolderData = store.state.organizationData.folders.find(
        (item: any) =>
          item.folderId ===
          (props.activeFolderId ?? route.query.folder ?? "default"),
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
      if (newFolder && newFolder.data) {
        selectedFolder.value = {
          label: newFolder.data.name,
          value: newFolder.data.folderId,
        };
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
      () => {
        emit("folder-selected", selectedFolder.value);
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

<style scoped lang="scss">
.q-select .q-field__control-container .q-field__native {
  height: 1rem !important;
  min-height: 1rem !important;
}
</style>
