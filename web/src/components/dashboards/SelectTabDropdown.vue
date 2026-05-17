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
    <!-- select new tab -->
    <OSelect
      v-model="selectedTab"
      :label="t('dashboard.selectTabLabel')"
      :options="tabList"
      data-test="dashboard-dropdown-tab-selection"
      labelKey="label"
      class="tw:flex-1"
    />

    <OButton
      data-test="dashboard-tab-new-add"
      variant="outline"
      size="icon-sm"
      class="q-mb-xs"
      @click="
        () => {
          showAddTabDialog = true;
        }
      "
      icon-left="add"
    >
    </OButton>
  </div>
  <!-- add/edit tab -->
  <AddTab
    v-model:open="showAddTabDialog"
    :edit-mode="false"
    :dashboard-id="dashboardId"
    :folder-id="folderId"
    data-test="dashboard-tab-add-dialog"
    @refresh="updateTabList"
  />
</template>

<script lang="ts">
import { defineComponent, onActivated, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import AddTab from "../../components/dashboards/tabs/AddTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { useRoute } from "vue-router";
import { getDashboard } from "@/utils/commons";
import { onMounted } from "vue";
import { useLoading } from "@/composables/useLoading";

export default defineComponent({
  name: "SelectTabDropdown",
  components: { AddTab, OButton, OSelect },
  emits: ["tab-selected", "tab-list-updated"],
  props: {
    folderId: {
      required: true,
      validator: (value) => {
        return typeof value === "string" || value === null;
      },
    },
    dashboardId: {
      required: true,
      validator: (value) => {
        return typeof value === "string" || value === null;
      },
    },
  },
  setup(props, { emit }) {
    const store: any = useStore();
    const route = useRoute();
    const showAddTabDialog: any = ref(false);
    const tabList: any = ref([]);

    //dropdown selected tab id (primitive string for OSelect)
    const selectedTab = ref<string | null>(null);
    const { t } = useI18n();

    // on add tab, select added tab
    const updateTabList = async (newTab: any) => {
      showAddTabDialog.value = false;
      await getTabList.execute();
      selectedTab.value = newTab.tabId ?? null;
    };

    // get all tabs based on selected dashboardId
    const getTabList = useLoading(async () => {
      if (!props.dashboardId || !props.folderId) return;

      const dashboardData = await getDashboard(
        store,
        props.dashboardId,
        props.folderId,
      );

      tabList.value = dashboardData?.tabs?.map((tab: any) => ({
        label: tab.name,
        value: tab.tabId,
      }));

      // select first tab
      if (tabList?.value?.length > 0) {
        selectedTab.value = tabList?.value[0]?.value ?? null;
      } else {
        selectedTab.value = null;
      }

      emit("tab-list-updated");
    });

    onMounted(() => {
      getTabList.execute();
    });

    onActivated(() => {
      getTabList.execute();
    });

    // get all tabs based on selected dashboardId
    watch(
      () => [props?.dashboardId],
      () => {
        getTabList.execute();
      },
    );

    watch(
      () => selectedTab.value,
      (tabId) => {
        const tab = tabList.value?.find((t: any) => t.value === tabId);
        // emit {label, value} for backward compatibility with parents
        emit("tab-selected", tab ?? (tabId ? { label: tabId, value: tabId } : null));
      },
    );

    return {
      t,
      store,
      selectedTab,
      updateTabList,
      showAddTabDialog,
      tabList,
      getTabList,
    };
  },
});
</script>
