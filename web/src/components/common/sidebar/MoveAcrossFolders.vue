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
    size="lg"
    :title="`Move ${type.charAt(0).toUpperCase() + type.slice(1)} To Another Folder`"
    :secondary-button-label="t('dashboard.cancel')"
    :primary-button-label="t('common.move')"
    :primary-button-loading="onSubmit.isLoading.value"
    :primary-button-disabled="activeFolderId === selectedFolder.value"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
    @click:primary="onSubmit.execute()"
  >
      <q-card-section
        class="q-w-md q-mx-lg"
        :data-test="`${type}-folder-move-body`"
      >
        <q-form
          ref="moveFolderForm"
          @submit.stop="onSubmit.execute()"
          :data-test="`${type}-folder-move-form`"
        >
          <q-input
            v-model="store.state.organizationData.foldersByType[type].find((item: any) => item.folderId === activeFolderId).name"
            :label="t('dashboard.currentFolderLabel')"
            color="input-border"
            bg-color="input-bg"
            class="q-py-md showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :disable="true"
            :data-test="`${type}-folder-move-name`"
          />
          <span>&nbsp;</span>

          <!-- select folder or create new folder and select -->
          <SelectFolderDropDown :type="type" @folder-selected="selectedFolder = $event"  :activeFolderId="activeFolderId"/>
        </q-form>
      </q-card-section>
  </ODrawer>
  </template>

  <script lang="ts">
  import { defineComponent, ref } from "vue";
  import { useI18n } from "vue-i18n";
  import { useStore } from "vuex";
  import { getImageURL } from "@/utils/zincutils";
  import { moveDashboardToAnotherFolder, moveModuleToAnotherFolder } from "@/utils/commons";
  import { useLoading } from "@/composables/useLoading";
  import useNotifications from "@/composables/useNotifications";
  import SelectFolderDropDown from "./SelectFolderDropDown.vue";
  import OButton from "@/lib/core/Button/OButton.vue";
  import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

  export default defineComponent({
    name: "MoveAcrossFolders",
    components: { SelectFolderDropDown, OButton, ODrawer },
    props: {
      activeFolderId: {
        type: String,
        default: "default",
      },
      moduleId: {
        type: Array,
        default: [],
      },
      anomalyConfigIds: {
        type: Array,
        default: [],
      },
      type: {
        type: String,
        default: "alerts",
      },
      open: {
        type: Boolean,
        default: false,
      },
    },
    emits: ["updated", "close", "update:open"],
    setup(props, { emit }) {
      const store: any = useStore();
      const moveFolderForm: any = ref(null);
      //dropdown selected folder
      const selectedFolder = ref({
        label: store.state.organizationData.foldersByType[props.type].find(
          (item: any) => item.folderId === props.activeFolderId
        ).name,
        value: props.activeFolderId,
      });
      const { t } = useI18n();
      const { showPositiveNotification, showErrorNotification } =
        useNotifications();

      const onSubmit = useLoading(async () => {
        await moveFolderForm.value.validate().then(async (valid: any) => {
          if (!valid) {
            return false;
          }

          try {
            const moduleIds = props.moduleId
            const data: Record<string, any> = {
              [getModuleName()]: moduleIds,
              dst_folder_id: selectedFolder.value.value,
            }
            if (props.anomalyConfigIds && (props.anomalyConfigIds as any[]).length > 0) {
              data.anomaly_config_ids = props.anomalyConfigIds;
            }
            await moveModuleToAnotherFolder(
              store,
              data,
              props.type,
              props.activeFolderId
            );

            showPositiveNotification(`${props.type} Moved successfully`, {
              timeout: 2000,
            });

            emit("updated", props.activeFolderId, selectedFolder.value.value);
            moveFolderForm.value.resetValidation();
          } catch (err: any) {
            showErrorNotification(err?.message ?? `${props.type} move failed.`, {
              timeout: 2000,
            });
          }
        });
      });
      //this will be used to get the module name based on the type
      const getModuleName = () => {
        switch(props.type) {
          case "alerts":
            return "alert_ids"
          case "pipelines":
            return "pipeline_ids"
          case "reports":
            return "report_ids"
          default:
            return "alert_ids"
        }
      }

      return {
        t,
        moveFolderForm,
        store,
        getImageURL,
        selectedFolder,
        onSubmit,
        getModuleName,
      };
    },
  });
  </script>