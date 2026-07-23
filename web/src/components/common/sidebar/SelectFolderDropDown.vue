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
  <div class="flex items-end justify-start">
    <!-- select new folder -->
    <OSelect
      v-model="selectedFolder"
      :label="t('dashboard.selectFolderLabel')"
      :options="
        store.state.organizationData.foldersByType[type]?.map((item: any) => ({
          label: item.name,
          value: item.folderId,
        })) ?? []
      "
      :data-test="`${type}-index-dropdown-stream_type`"
      labelKey="label"
      valueKey="value"
      class="mr-1 flex-1"
      :disabled="disableDropdown"
    >
      <template #empty>{{ t("search.noResult") }}</template>
    </OSelect>

    <div :style="computedStyle">
      <OButton
        variant="outline"
        size="icon-xs-sq"
        class="h-8! w-8!"
        :data-test="`${type}-folder-move-new-add`"
        title="Add Folder"
        :disabled="disableDropdown"
        @mousedown.prevent
        @click="
          () => {
            showAddFolderDialog = true;
          }
        "
        icon-left="add"
      />
    </div>
  </div>
  <!-- add folder -->
  <AddFolder
    v-if="!disableDropdown"
    v-model:open="showAddFolderDialog"
    :data-test="`${type}-folder-move-dialog`"
    :type="type"
    @update:modelValue="updateFolderList"
    :edit-mode="false"
  />
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
import OSelect from "@/lib/forms/Select/OSelect.vue";

export default defineComponent({
  name: "SelectedFolderDropdown",
  components: { AddFolder, OButton, OSelect },
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
      default: "alerts",
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

    const getInitialFolderId = () => {
      // priority: activeFolderId > query.folder > default
      return (
        store.state.organizationData.foldersByType[props.type]?.find(
          (item: any) =>
            item.folderId === (props.activeFolderId ?? route.query.folder ?? "default"),
        )?.folderId ?? "default"
      );
    };

    //dropdown selected folder index (holds primitive folderId string)
    const selectedFolder = ref<string>(getInitialFolderId());
    const { t } = useI18n();

    const updateFolderList = async (newFolder: any) => {
      showAddFolderDialog.value = false;
      selectedFolder.value = newFolder.data.folderId;
    };

    const computedStyle = computed(() => {
      return props.style ? props.style : "";
    });

    onActivated(async () => {
      // refresh selected folder
      selectedFolder.value = getInitialFolderId();
      await getFoldersListByType(store, props.type);
    });

    watch(
      () => store.state.organizationData.foldersByType[props.type],
      () => {
        // refresh selected folder, on folders list change
        selectedFolder.value = getInitialFolderId();
      },
    );

    watch(
      () => selectedFolder.value,
      (folderId) => {
        const folderItem = store.state.organizationData.foldersByType[props.type]?.find(
          (item: any) => item.folderId === folderId,
        );
        emit("folder-selected", {
          label: folderItem?.name ?? folderId,
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
