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
  <div class="flex items-center gap-1">
    <OSelect
      :model-value="modelValue"
      :options="folderOptions"
      labelKey="label"
      valueKey="value"
      class="alert-v3-select folder-select"
      :disabled="disable"
      @update:model-value="$emit('update:modelValue', $event)"
    />
    <OButton
      v-if="!disable"
      variant="outline"
      size="icon"
      class="shrink-0"
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
import OButton from "@/lib/core/Button/OButton.vue";
import AddFolder from "./AddFolder.vue";
import { getFoldersListByType } from "@/utils/commons";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

export default defineComponent({
  name: "InlineSelectFolderDropdown",
  components: { AddFolder, OButton, OIcon, OSelect },
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

    const folderOptions = computed(
      () =>
        store.state.organizationData.foldersByType[props.type]?.map((f: any) => ({
          label: f.name,
          value: f.folderId,
        })) ?? [],
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
/* keep(lib-override:o2-select): narrows OSelect's own `w-full` root utility at three
   breakpoints the theme registers no `--breakpoint-*` screens for; a plain `w-*` utility
   would sit in the same layer as `w-full` and collide non-deterministically. */
.folder-select {
  width: 6.875rem;
}

@media (max-width: 93.75rem) {
  .folder-select {
    width: 5.625rem;
  }
}

@media (max-width: 68.75rem) {
  .folder-select {
    width: 4.6875rem;
  }
}

@media (max-width: 59.375rem) {
  .folder-select {
    width: 4.0625rem;
  }
}
</style>
