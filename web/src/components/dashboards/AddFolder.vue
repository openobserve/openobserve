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
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { createFolder, updateFolder } from "@/utils/commons";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useNotifications from "@/composables/useNotifications";
import { useReo } from "@/services/reodotdev_analytics";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { makeAddFolderSchema, type AddFolderForm } from "./AddFolder.schema";

export default defineComponent({
  name: "AddFolder",
  components: { OForm, OFormInput },
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
    const { t } = useI18n();
    const addFolderSchema = makeAddFolderSchema(t);
    const { showPositiveNotification, showErrorNotification } = useNotifications();
    const { track } = useReo();

    const findFolder = () =>
      store.state.organizationData.folders.find((item: any) => item.folderId === props.folderId);

    // The OForm is the single source of truth. OForm reads `defaultValues`
    // once at mount, so this computed seeds the fields (edit → the folder's
    // values, create → blank). No local model / no manual reset needed.
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
        //if edit mode
        if (props.editMode) {
          const found = findFolder();
          const payload = {
            ...(found ? JSON.parse(JSON.stringify(found)) : {}),
            folderId: props.folderId,
            name,
            description,
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
      onSubmit,
    };
  },
});
</script>
