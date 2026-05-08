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
    title="Move Dashboard"
    :secondary-button-label="t('dashboard.cancel')"
    :primary-button-label="t('common.move')"
    :primary-button-loading="onSubmit.isLoading.value"
    :primary-button-disabled="activeFolderId === selectedFolder.value"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
    @click:primary="onSubmit.execute()"
  >
  <div class="q-w-md q-mx-lg" data-test="dashboard-folder-move-body">
      <q-form
        ref="moveFolderForm"
        @submit.stop="onSubmit.execute()"
        data-test="dashboard-folder-move-form"
      >
        <q-input
          v-model="
            store.state.organizationData.folders.find(
              (item) => item.folderId === activeFolderId,
            ).name
          "
          :label="t('dashboard.currentFolderLabel')"
          class="q-py-none showLabelOnTop"
          stack-label
          borderless
          hide-bottom-space
          dense
          :disable="true"
          data-test="dashboard-folder-move-name"
        />
        <span>&nbsp;</span>

        <!-- select folder or create new folder and select -->
        <SelectFolderDropdown
          @folder-selected="selectedFolder = $event"
          :activeFolderId="activeFolderId"
        />
      </q-form>
  </div>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import { moveDashboardToAnotherFolder } from "../../utils/commons";
import SelectFolderDropdown from "./SelectFolderDropdown.vue";
import { useLoading } from "@/composables/useLoading";
import useNotifications from "@/composables/useNotifications";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

export default defineComponent({
  name: "MoveDashboardToAnotherFolder",
  components: { SelectFolderDropdown, OButton, ODrawer },
  props: {
    activeFolderId: {
      type: String,
      default: "default",
    },
    dashboardIds: {
      type: Array,
      default: [],
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
      label: store.state.organizationData.folders.find(
        (item: any) => item.folderId === props.activeFolderId,
      )?.name,
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
        // here  we send dashboard ids as array so it will work for both single and multiple dashboards move

        try {
          await moveDashboardToAnotherFolder(
            store,
            props.dashboardIds,
            props.activeFolderId,
            selectedFolder.value.value,
          );

          showPositiveNotification("Dashboard Moved successfully", {
            timeout: 2000,
          });

          emit("updated");
          moveFolderForm.value?.resetValidation();
        } catch (err: any) {
          //this condition is kept to handle if 403 error is thrown we are showing unautorized message and we dont need this error explicitly
          if (err.status !== 403) {
            showErrorNotification(err?.message ?? "Dashboard move failed.", {
              timeout: 2000,
            });
          }
        }
      });
    });

    return {
      t,
      moveFolderForm,
      store,
      getImageURL,
      selectedFolder,
      onSubmit,
    };
  },
});
</script>

<style scoped lang="scss">
:deep(.flex.justify-center.items-start) {
  align-items: center !important;
}
:deep(.add-folder-btn) {
  margin-bottom: 0 !important;
  margin-top: 30px !important;
}
</style>
