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
      :options="folderOptions"
      :placeholder="excludeFolderId ? t('dashboard.selectFolderPlaceholder') : undefined"
      :data-test="`${type}-index-dropdown-stream_type`"
      labelKey="label"
      valueKey="value"
      class="mr-1 flex-1"
      :disabled="disableDropdown"
    >
      <!-- The trigger paints no per-option icon of its own, so the selected
           folder's icon comes in through #icon-left. Omitted entirely while
           nothing is selected — an empty field has no folder to stand for. -->
      <template v-if="selectedFolder" #icon-left>
        <FolderIcon :token="selectedFolderIcon" class="text-select-text" />
      </template>
      <template #empty>{{ t("search.noResult") }}</template>
    </OSelect>

    <div :style="computedStyle">
      <OButton
        variant="outline"
        size="icon-xs-sq"
        class="h-8! w-8!"
        :data-test="`${type}-folder-move-new-add`"
        :title="t('common.addFolder')"
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
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import AddFolder from "./AddFolder.vue";
import { useRoute } from "vue-router";
import { computed } from "vue";
import { getFoldersListByType } from "@/utils/commons";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { useFolderIcons } from "@/composables/useFolderIcons";
import { folderIconOption } from "./folderIconOption";
import FolderIcon from "./FolderIcon.vue";

export default defineComponent({
  name: "SelectedFolderDropdown",
  components: { AddFolder, OButton, OSelect, FolderIcon },
  emits: ["folder-selected"],
  props: {
    activeFolderId: {
      required: false,
      validator: (value) => {
        return typeof value === "string" || value === null;
      },
    },
    /**
     * A folder this picker must not offer — set by callers choosing a
     * DESTINATION, where the folder the module already sits in is not a
     * destination at all.
     *
     * Opt-in on purpose. Most callers here pick a folder to file something into
     * and are right to open on the active one; only a move is choosing somewhere
     * else. Leaving it unset keeps every one of those call sites exactly as it
     * was — the filter and the blank initial selection both key off this prop.
     */
    excludeFolderId: {
      type: String,
      required: false,
      default: undefined,
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
    const { iconFor } = useFolderIcons();

    const selectedFolderIcon = computed(() =>
      iconFor(
        (store.state.organizationData.foldersByType[props.type] ?? []).find(
          (item: any) => item.folderId === selectedFolder.value,
        ),
      ),
    );

    const folderOptions = computed(() =>
      (store.state.organizationData.foldersByType[props.type] ?? [])
        // `!== undefined` is every folder, so an unset prop filters nothing.
        .filter((item: any) => item.folderId !== props.excludeFolderId)
        .map((item: any) => ({
          label: item.name,
          value: item.folderId,
          iconComponent: folderIconOption(iconFor(item)),
        })),
    );

    const getInitialFolderId = () => {
      // priority: activeFolderId > query.folder > default
      const resolved =
        store.state.organizationData.foldersByType[props.type]?.find(
          (item: any) =>
            item.folderId === (props.activeFolderId ?? route.query.folder ?? "default"),
        )?.folderId ?? "default";
      // Opening already pointed at the excluded folder would show its name as the
      // choice while the list cannot offer it — the state that made a move dialog
      // read as "move this to where it already is". Start blank and make the
      // caller's disabled-submit guard do the rest.
      return resolved === props.excludeFolderId ? "" : resolved;
    };

    //dropdown selected folder index (holds primitive folderId string)
    const selectedFolder = ref<string>(getInitialFolderId());
    const { t } = useI18nTyped();

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
        // A destination picker keeps a choice that is still offerable. Creating a
        // folder from the + button lands here as a list change, and the re-seed
        // below would clear the very folder that was just created and selected.
        if (
          props.excludeFolderId &&
          folderOptions.value.some((option: any) => option.value === selectedFolder.value)
        ) {
          return;
        }
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
      selectedFolderIcon,
      folderOptions,
      updateFolderList,
      showAddFolderDialog,
      computedStyle,
    };
  },
});
</script>
