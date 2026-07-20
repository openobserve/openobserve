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
  <ODialog data-test="move-dashboard-to-another-folder-dialog"
    :open="open"
    size="md"
    :title="t('dashboard.moveDashboardToAnotherFolder.moveDashboard')"
    :secondary-button-label="t('dashboard.cancel')"
    :primary-button-label="t('common.move')"
    :primary-button-loading="onSubmit.isLoading.value"
    :primary-button-disabled="isSameFolder"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
    @click:primary="onSubmit.execute()"
  >
  <div data-test="dashboard-folder-move-body">
      <div class="flex flex-col gap-3">
        <OInput
          :model-value="
            store.state.organizationData.folders.find(
              (item: { folderId: string; name: string }) =>
                item.folderId === activeFolderId,
            )?.name
          "
          :label="t('dashboard.currentFolderLabel')"
          disabled
          readonly
          data-test="dashboard-folder-move-name"
        />

        <!-- select folder or create new folder and select -->
        <SelectFolderDropdown
          @folder-selected="selectedFolder = $event"
          :activeFolderId="activeFolderId"
        />
      </div>
  </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import { moveDashboardToAnotherFolder } from "../../utils/commons";
import SelectFolderDropdown from "./SelectFolderDropdown.vue";
import { useLoading } from "@/composables/useLoading";
import useNotifications from "@/composables/useNotifications";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

export default defineComponent({
  name: "MoveDashboardToAnotherFolder",
  components: { SelectFolderDropdown, ODialog, OInput },
  props: {
    activeFolderId: {
      type: String,
      default: "default",
    },
    dashboardIds: {
      type: Array,
      default: () => [],
    },
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["updated", "close", "update:open"],
  setup(props, { emit }) {
    const store: any = useStore();
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

    // Reset selection to current folder whenever the drawer reopens so the
    // same-folder comparison is always accurate.
    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          const folder = store.state.organizationData.folders.find(
            (item: any) => item.folderId === props.activeFolderId,
          );
          selectedFolder.value = {
            label: folder?.name,
            value: props.activeFolderId,
          };
        }
      },
    );

    // Disable Move when the selected folder is the same as the current one.
    const isSameFolder = computed(
      () => props.activeFolderId === selectedFolder.value?.value,
    );

    const onSubmit = useLoading(async () => {
      // here  we send dashboard ids as array so it will work for both single and multiple dashboards move
      try {
        await moveDashboardToAnotherFolder(
          store,
          props.dashboardIds,
          props.activeFolderId,
          selectedFolder.value.value,
        );

        showPositiveNotification(t('dashboard.moveDashboardToAnotherFolder.movedSuccessfully'), {
          timeout: 2000,
        });

        emit("updated");
      } catch (err: any) {
        //this condition is kept to handle if 403 error is thrown we are showing unautorized message and we dont need this error explicitly
        if (err.status !== 403) {
          showErrorNotification(err?.message ?? t('dashboard.moveDashboardToAnotherFolder.moveFailed'), {
            timeout: 2000,
          });
        }
      }
    });

    return {
      t,
      store,
      getImageURL,
      selectedFolder,
      isSameFolder,
      onSubmit,
    };
  },
});
</script>

