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
  <div class="flex flex-col gap-2">
    <OSelect
      ref="folderSelect"
      v-model="selectedFolder"
      :label="t('dashboard.selectFolderLabel')"
      :options="folderOptions"
      data-test="index-dropdown-stream_type"
      labelKey="label"
      :disabled="disabled"
    >
      <template v-if="selectedFolder" #icon>
        <FolderIcon :token="selectedFolderIcon" class="text-select-text" />
      </template>
      <!-- A nested create stays in this dialog: a second dialog over it would chain two modals (O8). -->
      <template v-if="!disabled" #after-options>
        <OSeparator />
        <div class="p-2">
          <OButton
            variant="secondary"
            icon="add"
            block
            data-test="dashboard-folder-move-new-add"
            @click="startNewFolder"
          >
            {{ t("dashboard.newFolder") }}
          </OButton>
        </div>
      </template>
    </OSelect>

    <div v-if="addingFolder" class="flex items-end gap-2" data-test="dashboard-folder-new-inline">
      <OInput
        v-model="newFolderName"
        :label="t('dashboard.inlineCreate.folderName')"
        :error="newFolderError !== ''"
        :error-message="newFolderError || undefined"
        autofocus
        class="min-w-0 flex-1"
        data-test="dashboard-folder-add-name"
        @keydown.enter.prevent.stop="createNewFolder"
        @keydown.esc.stop="cancelNewFolder"
      />
      <OButton
        :loading="savingFolder"
        data-test="dashboard-folder-add-create"
        @click="createNewFolder"
      >
        {{ t("dashboard.inlineCreate.createFolder") }}
      </OButton>
      <OButton variant="ghost" data-test="dashboard-folder-add-cancel" @click="cancelNewFolder">
        {{ t("dashboard.cancel") }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onActivated, ref, watch, computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { createFolder } from "@/utils/commons";
import analytics from "@/services/product_analytics";
import useNotifications from "@/composables/useNotifications";
import { useRoute } from "vue-router";
import { useFolderIcons } from "@/composables/useFolderIcons";
import { folderIconOption } from "@/components/common/sidebar/folderIconOption";
import FolderIcon from "@/components/common/sidebar/FolderIcon.vue";

export default defineComponent({
  name: "SelectedFolderDropdown",
  components: { OButton, OInput, OSelect, OSeparator, FolderIcon },
  emits: ["folder-selected"],
  props: {
    activeFolderId: {
      required: false,
      validator: (value) => {
        return typeof value === "string" || value === null;
      },
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    const store: any = useStore();
    const { iconFor } = useFolderIcons();

    const selectedFolderIcon = computed(() =>
      iconFor(
        store.state.organizationData.folders.find(
          (item: any) => item.folderId === selectedFolder.value,
        ),
      ),
    );

    const folderOptions = computed(() =>
      store.state.organizationData.folders.map((item: any) => ({
        label: item.name,
        value: item.folderId,
        iconComponent: folderIconOption(iconFor(item)),
      })),
    );
    const route = useRoute();
    const folderSelect = ref<InstanceType<typeof OSelect> | null>(null);
    const addingFolder = ref(false);
    const newFolderName = ref("");
    const newFolderError = ref<I18nText | "">("");
    const savingFolder = ref(false);
    const { showPositiveNotification, showErrorNotification } = useNotifications();

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
    const { t } = useI18nTyped();

    const startNewFolder = () => {
      folderSelect.value?.close();
      newFolderName.value = "";
      newFolderError.value = "";
      addingFolder.value = true;
    };

    const cancelNewFolder = () => {
      addingFolder.value = false;
      newFolderError.value = "";
    };

    const createNewFolder = async () => {
      if (savingFolder.value) return;
      const name = newFolderName.value.trim();
      if (!name) {
        newFolderError.value = t("dashboard.nameRequired");
        return;
      }
      savingFolder.value = true;
      try {
        const newFolder: any = await createFolder(store, { name, description: "", icon: null });
        analytics.track("dashboard_folder_created");
        showPositiveNotification(t("dashboard.addFolder.folderAdded"), { timeout: 2000 });
        addingFolder.value = false;
        if (newFolder?.data) selectedFolder.value = newFolder.data.folderId;
      } catch (err: any) {
        showErrorNotification(err?.message ?? t("dashboard.addFolder.folderCreateFailed"), {
          timeout: 2000,
        });
      } finally {
        savingFolder.value = false;
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
      folderOptions,
      selectedFolderIcon,
      t,
      store,
      selectedFolder,
      folderSelect,
      addingFolder,
      newFolderName,
      newFolderError,
      savingFolder,
      startNewFolder,
      cancelNewFolder,
      createNewFolder,
      computedStyle,
    };
  },
});
</script>
