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
    <ODrawer
      :open="open"
      :width="20"
      :title="editMode ? t('dashboard.updateFolder') : t('common.addFolder')"
      secondary-button-label="Cancel"
      primary-button-label="Save"
      :primary-button-loading="onSubmit.isLoading.value"
      data-test="dashboard-folder-dialog"
      @update:open="$emit('update:open', $event)"
      @click:secondary="$emit('update:open', false)"
      @click:primary="submit()"
    >
      <div class="tw:p-4">
        <q-form ref="addFolderForm" @submit.stop="onSubmit.execute">
          <q-input
            v-model="folderData.name"
            :label="t('dashboard.nameOfVariable') + '*'"
            class="q-py-none showLabelOnTop"
            data-test="dashboard-folder-add-name"
            stack-label
            borderless
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
            dense
          />
        </q-form>
      </div>
    </ODrawer>
  </template>
  
  <script lang="ts">
  import { defineComponent, ref } from "vue";
  import OButton from '@/lib/core/Button/OButton.vue';
  import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue';
  import { createFolder, createFolderByType, updateFolder, updateFolderByType } from "@/utils/commons";
  import { useI18n } from "vue-i18n";
  import { useStore } from "vuex";
  import { getImageURL } from "@/utils/zincutils";
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
    name: "CommonAddFolder",
    components: { ODrawer },
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
      const addFolderForm: any = ref(null);
      const disableColor: any = ref("");
      const folderData: any = ref(
        props.editMode
          ? JSON.parse(
              JSON.stringify(
                store.state.organizationData.foldersByType[props.type].find(
                  (item: any) => item.folderId === props.folderId
                )
              )
            )
          : defaultValue()
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
              await updateFolderByType (
                store,
                folderData.value.folderId,
                folderData.value,
                props.type
              );
              showPositiveNotification("Folder updated successfully", {
                timeout: 2000,
              });
              emit("update:modelValue", folderData.value);
              emit("update:open", false);
            }
            //else new folder
            else {
              //trim the folder name here
              folderData.value.name = folderData.value.name.trim();
              const newFolder: any = await createFolderByType(store, folderData.value, props.type);
              emit("update:modelValue", newFolder);
              emit("update:open", false);
              showPositiveNotification("Folder added successfully", {
                timeout: 2000,
              });
            }
            folderData.value = {
              folderId: "",
              name: "",
              description: "",
            };
            await addFolderForm.value.resetValidation();
          } catch (err: any) {
            showErrorNotification(
              err?.response?.data?.message ??
                (props.editMode
                  ? "Folder updation failed"
                  : "Folder creation failed"),
              { timeout: 2000 }
            );
          }
          track("Button Click", {
            button: "Save New Folder",
            page: "Folders",
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
        defaultValue,
        submit,
      };
    },
  });
  </script>