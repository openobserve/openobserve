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
  <div class="flex items-end tw:gap-2">
    <!-- select new dashboard -->
    <OSelect
      v-model="selectedDashboard"
      :label="t('dashboard.selectDashboardLabel')"
      :options="dashboardList"
      data-test="dashboard-dropdown-dashboard-selection"
      labelKey="label"
      class="tw:flex-1"
    />

    <OButton
      data-test="dashboard-dashboard-new-add"
      variant="outline"
      size="icon-sm"
      class="q-mb-xs"
      @click="
        () => {
          showAddDashboardDialog = true;
        }
      "
    >
      <template #icon-left><q-icon name="add" /></template>
    </OButton>
  </div>
  <!-- add dashboard -->
  <q-dialog
    v-model="showAddDashboardDialog"
    position="right"
    full-height
    maximized
    data-test="dashboard-dashboard-add-dialog"
  >
    <AddDashboard
      :active-folder-id="folderId as any"
      @updated="updateDashboardList"
      :show-folder-selection="false"
    />
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, onActivated, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import AddDashboard from "@/components/dashboards/AddDashboard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { getAllDashboardsByFolderId } from "@/utils/commons";
import { onMounted } from "vue";
import { useLoading } from "@/composables/useLoading";

export default defineComponent({
  name: "SelectDashboardDropdown",
  components: { AddDashboard, OButton, ODrawer, OSelect },
  emits: ["dashboard-selected", "dashboard-list-updated"],
  props: {
    folderId: {
      required: true,
      validator: (value: any) => {
        return typeof value === "string" || value === null;
      },
    },
  },
  setup(props, { emit }) {
    const store: any = useStore();
    const showAddDashboardDialog: any = ref(false);
    const dashboardList: any = ref([]);

    //dropdown selected dashboard id (primitive string for OSelect)
    const selectedDashboard = ref<string | null>(null);
    const { t } = useI18n();

    // on add dashboard, select added dashboard
    const updateDashboardList = async (dashboardId: any, folderId: any) => {
      showAddDashboardDialog.value = false;
      await getDashboardList.execute();
      selectedDashboard.value = dashboardId ?? null;
    };

    // get all dashboards based on selected folderId
    const getDashboardList = useLoading(async () => {
      if (!props.folderId) return;

      const allDashboardDataByFolderId = await getAllDashboardsByFolderId(
        store,
        props.folderId,
      );

      dashboardList.value = allDashboardDataByFolderId?.map(
        (dashboard: any) => ({
          label: dashboard.title,
          value: dashboard.dashboardId,
        }),
      );

      // select first dashboard
      if (dashboardList.value.length > 0) {
        selectedDashboard.value = dashboardList?.value[0]?.value ?? null;
      } else {
        selectedDashboard.value = null;
      }

      emit("dashboard-list-updated");
    });

    onMounted(() => {
      getDashboardList.execute();
    });

    onActivated(() => {
      getDashboardList.execute();
    });

    // get all dashboards based on selected folderId
    watch(
      () => [props.folderId],
      () => {
        getDashboardList.execute();
      },
    );

    watch(
      () => selectedDashboard.value,
      (dashboardId) => {
        const dashboard = dashboardList.value.find(
          (d: any) => d.value === dashboardId,
        );
        // emit {label, value} for backward compatibility with parents
        emit("dashboard-selected", dashboard ?? (dashboardId ? { label: dashboardId, value: dashboardId } : null));
      },
    );

    return {
      t,
      store,
      selectedDashboard,
      updateDashboardList,
      showAddDashboardDialog,
      dashboardList,
      getDashboardList,
    };
  },
});
</script>
