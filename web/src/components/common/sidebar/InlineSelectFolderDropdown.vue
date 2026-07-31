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
  <!-- INLINE variant — the SAME OSelect as the default branch, just wearing its
       `inline` appearance: a word inside running text rather than a control
       parked beside one. Search, keyboard handling and the options list all
       come from OSelect; the only thing added here is the "New folder" row in
       its #after-options slot. -->
  <span v-if="variant === 'inline'" class="inline-flex shrink-0 items-center">
    <OSelect
      :model-value="modelValue"
      :options="folderOptions"
      appearance="inline"
      labelKey="label"
      valueKey="value"
      searchable
      :search-placeholder="t('dashboard.searchFolder')"
      :disabled="disable"
      data-test="inline-select-folder-dropdown"
      @update:model-value="$emit('update:modelValue', $event)"
    >
      <template v-if="!disable" #after-options>
        <OSeparator />
        <!-- Padded, outlined and at the standard 34px control height: flush
             against the option list it read as one more option rather than as
             the action that leaves the list. -->
        <div class="p-2">
          <OButton
            variant="outline"
            size="sm"
            icon-left="add"
            block
            data-test="inline-select-folder-dropdown-add"
            @click="showDialog = true"
          >
            {{ t("dashboard.newFolder") }}
          </OButton>
        </div>
      </template>
    </OSelect>

    <!-- OUTSIDE the select, deliberately. The options list is unmounted while
         closed and choosing "New folder" closes it — a dialog nested in there
         is destroyed in the same tick it is asked to appear, and never shows. -->
    <AddFolder
      v-if="!disable"
      data-test="inline-select-folder-dropdown-dialog"
      v-model:open="showDialog"
      :type="type"
      :edit-mode="false"
      @update:modelValue="onFolderAdded"
    />
  </span>

  <div v-else class="flex items-center gap-1">
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
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import AddFolder from "./AddFolder.vue";
import { getFoldersListByType } from "@/utils/commons";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

export default defineComponent({
  name: "InlineSelectFolderDropdown",
  components: {
    AddFolder,
    OButton,
    OIcon,
    OSelect,
    OSeparator,
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
    /**
     * `select` (default) — a labelled OSelect plus a separate "+" button, for
     * form rows and toolbars.
     * `inline` — a text-styled dropdown that sits inside running text (a page
     * header's description line), with "New folder" folded into the menu.
     */
    variant: {
      type: String as () => "select" | "inline",
      default: "select",
    },
  },
  setup(props, { emit }) {
    const store: any = useStore();
    const { t } = useI18n();
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
      t,
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
