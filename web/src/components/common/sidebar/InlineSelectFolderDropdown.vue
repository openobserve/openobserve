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
  <div class="tw:flex tw:items-center tw:gap-1">
    <q-select
      :model-value="modelValue"
      :options="folderOptions"
      class="alert-v3-select folder-select"
      dense
      borderless
      behavior="menu"
      input-debounce="0"
      emit-value
      map-options
      :disable="disable"
      @update:model-value="$emit('update:modelValue', $event)"
    />
    <OButton
      v-if="!disable"
      variant="outline"
      size="icon"
      class="tw:shrink-0"
      title="Add Folder"
      @click="showDialog = true"
    >
      <OIcon name="add" size="sm" />
    </OButton>
    <AddFolder
      v-if="!disable"
      data-test="inline-select-folder-dropdown-dialog"
      v-model:open="showDialog"
      :type="type"
      :edit-mode="false"
      @update:modelValue="onFolderAdded"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from "vue";
import { useStore } from "vuex";
import OButton from '@/lib/core/Button/OButton.vue';
import AddFolder from "./AddFolder.vue";
import { getFoldersListByType } from "@/utils/commons";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "InlineSelectFolderDropdown",
  components: { AddFolder, OButton,
    OIcon,
},
  emits: ["update:modelValue"],
  props: {
    modelValue: {
      type: String,
      default: "default",
    },
    type: {
      type: String,
      default: "alerts",
    },
    disable: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    const store: any = useStore();
    const showDialog = ref(false);

    const folderOptions = computed(() =>
      store.state.organizationData.foldersByType[props.type]?.map((f: any) => ({
        label: f.name,
        value: f.folderId,
      })) ?? []
    );

    const onFolderAdded = (newFolder: any) => {
      showDialog.value = false;
      if (newFolder?.data?.folderId) {
        emit("update:modelValue", newFolder.data.folderId);
      }
    };

    onMounted(async () => {
      await getFoldersListByType(store, props.type);
    });

    return {
      store,
      showDialog,
      folderOptions,
      onFolderAdded,
    };
  },
});
</script>

<style scoped>
.folder-select {
  width: 110px;
}

@media (max-width: 1500px) {
  .folder-select { width: 90px; }
}

@media (max-width: 1100px) {
  .folder-select { width: 75px; }
}

@media (max-width: 950px) {
  .folder-select { width: 65px; }
}
</style>
