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
    <ODialog
      :open="open"
      size="sm"
      :title="editMode ? t('dashboard.updateFolder') : t('common.addFolder')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="t('common.save')"
      form-id="add-folder-sidebar-form"
      data-test="dashboard-folder-dialog"
      @update:open="$emit('update:open', $event)"
      @click:secondary="$emit('update:open', false)"
    >
      <div>
        <OForm
          id="add-folder-sidebar-form"
          :schema="addFolderSchema"
          :default-values="addFolderDefaults"
          @submit="onSubmit"
        >
          <OFormInput
            name="name"
            :label="t('dashboard.nameOfVariable')"
            required
            data-test="dashboard-folder-add-name"
          />
          <span>&nbsp;</span>
          <OFormInput
            name="description"
            :label="t('dashboard.typeDesc')"
            data-test="dashboard-folder-add-description"
          />
        </OForm>
      </div>
    </ODialog>
  </template>

  <script lang="ts">
  import { defineComponent, computed } from "vue";
  import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
  import OForm from "@/lib/forms/Form/OForm.vue";
  import OFormInput from "@/lib/forms/Input/OFormInput.vue";
  import { createFolderByType, updateFolderByType } from "@/utils/commons";
  import { useI18n } from "vue-i18n";
  import { useStore } from "vuex";
  import useNotifications from "@/composables/useNotifications";
  import { useReo } from "@/services/reodotdev_analytics";
  import { makeAddFolderSchema, type AddFolderForm } from "./AddFolder.schema";

  export default defineComponent({
    name: "CommonAddFolder",
    components: { ODialog, OForm, OFormInput },
    props: {
      open: {
        type: Boolean,
        default: false,
      },
      folderId: {
        type: String,
        default: "default",
      },
      editMode: {
        type: Boolean,
        default: false,
      },
      type: {
        type: String,
        default: "alerts",
      },
    },
    emits: ["update:modelValue", "update:open"],
    setup(props, { emit }) {
      const store: any = useStore();
      const { t } = useI18n();
      const addFolderSchema = makeAddFolderSchema(t);
      const { showPositiveNotification, showErrorNotification } =
        useNotifications();
      const { track } = useReo();

      const findFolder = () =>
        store.state.organizationData.foldersByType[props.type]?.find(
          (item: any) => item.folderId === props.folderId,
        );

      // The OForm is the single source of truth. OForm reads `defaultValues`
      // once at mount, and ODialog remounts the body on open — so this computed
      // seeds the fields each time the dialog opens (edit → the folder's values,
      // create → blank). No local model / no manual reset needed.
      const addFolderDefaults = computed((): AddFolderForm => {
        if (props.editMode) {
          const found = findFolder();
          return { name: found?.name ?? "", description: found?.description ?? "" };
        }
        return { name: "", description: "" };
      });

      // Plain async @submit handler — the validated `value` is the source of
      // truth. `folderId` (not a form field) comes from the prop.
      const onSubmit = async (value: AddFolderForm) => {
        const name = (value.name ?? "").trim();
        const description = value.description ?? "";
        try {
          if (props.editMode) {
            const found = findFolder();
            const payload = {
              ...(found ? JSON.parse(JSON.stringify(found)) : {}),
              folderId: props.folderId,
              name,
              description,
            };
            await updateFolderByType(store, props.folderId, payload, props.type);
            showPositiveNotification("Folder updated successfully", {
              timeout: 2000,
            });
            emit("update:modelValue", payload);
            emit("update:open", false);
          } else {
            const newFolder: any = await createFolderByType(
              store,
              { name, description },
              props.type,
            );
            emit("update:modelValue", newFolder);
            emit("update:open", false);
            showPositiveNotification("Folder added successfully", {
              timeout: 2000,
            });
          }
        } catch (err: any) {
          showErrorNotification(
            err?.response?.data?.message ??
              (props.editMode
                ? "Folder updation failed"
                : "Folder creation failed"),
            { timeout: 2000 },
          );
        }
        track("Button Click", {
          button: "Save New Folder",
          page: "Folders",
        });
      };

      return {
        t,
        addFolderSchema,
        store,
        addFolderDefaults,
        onSubmit,
      };
    },
  });
  </script>
