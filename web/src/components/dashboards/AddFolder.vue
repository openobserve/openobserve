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
  <div>
    <OForm
      id="add-folder-dashboards-form"
      class="flex flex-col gap-5"
      :schema="addFolderSchema"
      :default-values="addFolderDefaults"
      @submit="onSubmit"
    >
      <div class="flex items-start gap-3">
        <FolderIconField :start-touched="startIconTouched" />
        <div class="min-w-0 flex-1">
          <OFormInput
            name="name"
            :label="t('dashboard.nameOfVariable')"
            required
            data-test="dashboard-folder-add-name"
          />
        </div>
      </div>
      <OFormInput
        name="description"
        :label="t('dashboard.typeDesc')"
        data-test="dashboard-folder-add-description"
      />
    </OForm>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { createFolder, updateFolder } from "@/utils/commons";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import useNotifications from "@/composables/useNotifications";
import { useReo } from "@/services/reodotdev_analytics";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { makeAddFolderSchema, type AddFolderForm } from "./AddFolder.schema";
import FolderIconField from "@/components/common/sidebar/FolderIconField.vue";
import { useFolderIcons } from "@/composables/useFolderIcons";

export default defineComponent({
  name: "AddFolder",
  components: { OForm, OFormInput, FolderIconField },
  props: {
    folderId: {
      type: String,
      default: "default",
    },
    editMode: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue", "close"],
  setup(props, { emit }) {
    const store: any = useStore();
    const { t } = useI18nTyped();
    const addFolderSchema = makeAddFolderSchema(t);
    const { showPositiveNotification, showErrorNotification } = useNotifications();
    const { track } = useReo();

    const { iconFor } = useFolderIcons();

    const findFolder = () =>
      store.state.organizationData.folders.find((item: any) => item.folderId === props.folderId);

    // Renaming a folder that already carries an icon must not re-suggest one.
    const startIconTouched = computed(() => props.editMode && !!iconFor(findFolder()));

    // The OForm is the single source of truth. OForm reads `defaultValues`
    // once at mount, so this computed seeds the fields (edit → the folder's
    // values, create → blank). No local model / no manual reset needed.
    const addFolderDefaults = computed((): AddFolderForm => {
      if (props.editMode) {
        const found = findFolder();
        return {
          name: found?.name ?? "",
          description: found?.description ?? "",
          icon: iconFor(found),
        };
      }
      return { name: "", description: "", icon: null };
    });

    // Plain async @submit handler — the validated `value` is the source of
    // truth. `folderId` (not a form field) comes from the prop.
    const onSubmit = async (value: AddFolderForm) => {
      const name = (value.name ?? "").trim();
      const description = value.description ?? "";
      // Sent to the API as well as stored locally: the field is ignored by the
      // current backend, so the payload is already right for the day it lands.
      const icon = value.icon ?? null;
      try {
        //if edit mode
        if (props.editMode) {
          const found = findFolder();
          const payload = {
            ...(found ? JSON.parse(JSON.stringify(found)) : {}),
            folderId: props.folderId,
            name,
            description,
            icon,
          };
          await updateFolder(store, props.folderId, payload);
          showPositiveNotification(t("dashboard.addFolder.folderUpdated"), {
            timeout: 2000,
          });
          emit("update:modelValue", payload);
        }
        //else new folder
        else {
          const newFolder: any = await createFolder(store, {
            name,
            description,
            icon,
          });
          emit("update:modelValue", newFolder);
          showPositiveNotification(t("dashboard.addFolder.folderAdded"), {
            timeout: 2000,
          });
        }
      } catch (err: any) {
        showErrorNotification(
          err?.message ??
            (props.editMode
              ? t("dashboard.addFolder.folderUpdateFailed")
              : t("dashboard.addFolder.folderCreateFailed")),
          { timeout: 2000 },
        );
      }
      track("Button Click", {
        button: "Save New Folder",
        page: "Dashboards",
      });
    };

    return {
      t,
      addFolderSchema,
      store,
      addFolderDefaults,
      startIconTouched,
      onSubmit,
    };
  },
});
</script>
