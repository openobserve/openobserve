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
    <q-select
      v-model="selectedDashboard"
      :label="t('dashboard.selectDashboardLabel')"
      :options="dashboardList"
      data-test="dashboard-dropdown-dashboard-selection"
      input-debounce="0"
      behavior="menu"
      borderless
      dense
      class="q-mb-xs showLabelOnTop o2-custom-select-dashboard tw:flex-1"
      :loading="getDashboardList.isLoading.value"
      hide-bottom-space
    >
      <template #no-option>
        <q-item>
          <q-item-section> {{ t("search.noResult") }}</q-item-section>
        </q-item>
      </template>
    </q-select>

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
  <ODrawer
    v-model:open="showAddDashboardDialog"
    size="lg"
    :show-close="false"
    @close="showAddDashboardDialog = false"
    data-test="dashboard-dashboard-add-dialog"
  >
    <AddDashboard
      :active-folder-id="folderId as any"
      @updated="updateDashboardList"
      @close="showAddDashboardDialog = false"
      :show-folder-selection="false"
    />
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, onActivated, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import AddDashboard from "@/components/dashboards/AddDashboard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { getAllDashboardsByFolderId, getDashboard } from "@/utils/commons";
import { onMounted } from "vue";
import { useLoading } from "@/composables/useLoading";

export default defineComponent({
  name: "SelectDashboardDropdown",
  components: { AddDashboard, OButton, ODrawer },
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

    //dropdown selected dashboard
    const selectedDashboard: any = ref(null);
    const { t } = useI18n();

    // on add dashboard, select added dashboard
    const updateDashboardList = async (dashboardId: any, folderId: any) => {
      showAddDashboardDialog.value = false;
      await getDashboardList.execute();

      const dashboardData = await getDashboard(store, dashboardId, folderId);

      selectedDashboard.value = {
        label: dashboardData?.title,
        value: dashboardData?.dashboardId,
      };
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
        selectedDashboard.value = {
          label: dashboardList?.value[0]?.label,
          value: dashboardList?.value[0]?.value,
        };
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
      () => {
        emit("dashboard-selected", selectedDashboard.value);
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
