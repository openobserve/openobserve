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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <ODialog data-test="single-panel-move-dialog" v-model:open="open" size="sm" :title="title"
    :secondary-button-label="t('confirmDialog.cancel')"
    primary-button-label="Move"
    :primary-button-disabled="selectedMoveTabId === null"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div>
      <p class="text-body2">{{ message }}</p>
      <div class="tw:flex tw:items-center tw:gap-2">
        <OSelect
          label="Select Tab"
          v-model="selectedMoveTabId"
          :options="moveTabOptions"
          class="tw:flex-1"
          data-test="dashboard-tab-move-select"
        />

        <OButton
          variant="outline"
          size="sm"
          @click="
            () => {
              isTabEditMode = false;
              showAddTabDialog = true;
            }
          "
          data-test="dashboard-tab-move-add-tab-btn"
          icon-left="add"
        >
          <template #icon-left><OIcon name="add" size="sm" /></template>
          <OTooltip content="Add Tab" />
        </OButton>
        <AddTab
          v-model:open="showAddTabDialog"
          :edit-mode="isTabEditMode"
          :tabId="selectedTabIdToEdit"
          :dashboard-id="currentDashboardData.data.dashboardId"
          @refresh="refreshRequired"
          data-test="dashboard-tab-move-add-tab-dialog"
        />
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { getDashboard } from "@/utils/commons";
import { reactive } from "vue";
import { onMounted } from "vue";
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export default defineComponent({
  name: "SinglePanelMove",
  components: { AddTab, OButton, OSelect, ODialog, OTooltip,
    OIcon,
},
  emits: ["update:ok", "update:cancel", "refresh"],
  props: ["title", "message", "modelValue"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const route = useRoute();
    const action = ref("delete");
    const selectedMoveTabId = ref<string | null>(null);
    const showAddTabDialog = ref(false);
    const isTabEditMode = ref(false);
    const selectedTabIdToEdit = ref(null);

    const open = computed({
      get: () => !!props.modelValue,
      set: (v: boolean) => emit("update:modelValue", v),
    });

    const moveTabOptions = ref([]);

    const currentDashboardData: any = reactive({
      data: {},
    });

    const getDashboardData = async () => {
      currentDashboardData.data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default",
      );
    };

    const getTabOptions = async () => {
      await getDashboardData();

      // update move tab options
      const newMoveTabOptions: any = [];
      currentDashboardData.data.tabs?.forEach((tab: any) => {
        // if tab is to be deleted, do not include it in the options
        if (tab.tabId != route.query.tab) {
          newMoveTabOptions.push({
            label: tab.name,
            value: tab.tabId,
          });
        }
      });

      moveTabOptions.value = newMoveTabOptions;
    };

    const refreshRequired = async (tabData: any) => {
      emit("refresh");
      // update move tab options
      await getTabOptions();

      // set selectedMoveTabId to newly created tab
      selectedMoveTabId.value = tabData.tabId;

      // close add tab dialog
      showAddTabDialog.value = false;
    };

    onMounted(async () => {
      await getTabOptions();
      // set selectedMoveTabId to first tab from move tab options
      selectedMoveTabId.value =
        moveTabOptions.value.length > 0 ? moveTabOptions.value[0] : null;
    });

    const onCancel = () => {
      emit("update:cancel");
    };

    const onConfirm = () => {
      emit("update:ok", selectedMoveTabId.value);
    };
    return {
      t,
      open,
      onCancel,
      onConfirm,
      action,
      selectedMoveTabId,
      moveTabOptions,
      currentDashboardData,
      showAddTabDialog,
      isTabEditMode,
      selectedTabIdToEdit,
      refreshRequired,
      store,
    };
  },
});
</script>

<style lang="scss" scoped>
.select-container {
  width: 100%;
}
</style>
