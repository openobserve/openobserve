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
  <div class="q-px-md q-py-sm">
      <q-form ref="addFolderForm" @submit.stop="onSubmit.execute">
        <q-input
          v-model="folderData.name"
          :label="t('dashboard.nameOfVariable') + '*'"
          class="q-py-none showLabelOnTop"
          data-test="dashboard-folder-add-name"
          stack-label
          borderless
          hide-bottom-space
          dense
          :rules="[(val: any) => !!val.trim() || t('dashboard.nameRequired')]"
          :lazy-rules="true"
        />
        <span>&nbsp;</span>
        <q-input
          v-model="folderData.description"
          :label="t('dashboard.typeDesc')"
          color="input-border"
          bg-color="input-bg"
          data-test="dashboard-folder-add-description"
          class="q-py-md showLabelOnTop"
          stack-label
          borderless
          hide-bottom-space
          dense
        />


      </q-form>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { createFolder, updateFolder } from "@/utils/commons";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import { useLoading } from "@/composables/useLoading";
import useNotifications from "@/composables/useNotifications";
import { useReo } from "@/services/reodotdev_analytics";

const defaultValue = () => {
  return {
    folderId: "",
    name: "",
    description: "",
  };
};

export default defineComponent({
  name: "AddFolder",
  components: {},
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
    const addFolderForm: any = ref(null);
    const disableColor: any = ref("");
    const folderData: any = ref(
      props.editMode
        ? JSON.parse(
            JSON.stringify(
              store.state.organizationData.folders.find(
                (item: any) => item.folderId === props.folderId,
              ),
            ),
          )
        : defaultValue(),
    );
    const isValidIdentifier: any = ref(true);
    const { t } = useI18n();
    const { showPositiveNotification, showErrorNotification } =
      useNotifications();
    const { track } = useReo();

    const onSubmit = useLoading(async () => {
      await addFolderForm.value.validate().then(async (valid: any) => {
        if (!valid) {
          return false;
        }

        try {
          //if edit mode
          if (props.editMode) {
            await updateFolder(
              store,
              folderData.value.folderId,
              folderData.value,
            );
            showPositiveNotification("Folder updated successfully", {
              timeout: 2000,
            });
            emit("update:modelValue", folderData.value);
          }
          //else new folder
          else {
            const newFolder: any = await createFolder(store, folderData.value);
            emit("update:modelValue", newFolder);
            showPositiveNotification("Folder added successfully", {
              timeout: 2000,
            });
          }
          folderData.value = {
            folderId: "",
            name: "",
            description: "",
          };
          await addFolderForm.value?.resetValidation();
        } catch (err: any) {
          showErrorNotification(
            err?.message ??
              (props.editMode
                ? "Folder updation failed"
                : "Folder creation failed"),
            { timeout: 2000 },
          );
        }
        track("Button Click", {
          button: "Save New Folder",
          page: "Dashboards",
        });
      });
    });

    const submit = () => onSubmit.execute();

    return {
      t,
      disableColor,
      isPwd: ref(true),
      status,
      folderData,
      addFolderForm,
      store,
      isValidIdentifier,
      getImageURL,
      onSubmit,
      submit,
    };
  },
});
</script>
