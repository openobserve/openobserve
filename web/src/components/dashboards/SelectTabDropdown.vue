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
    <q-select
      v-model="selectedTab"
      :label="t('dashboard.selectTabLabel')"
      :options="tabList"
      data-test="dashboard-dropdown-tab-selection"
      input-debounce="0"
      behavior="menu"
      borderless
      dense
      class="q-mb-xs showLabelOnTop o2-custom-select-dashboard tw:flex-1"
      :loading="getTabList.isLoading.value"
      hide-bottom-space
    >
      <template #no-option>
        <q-item>
          <q-item-section> {{ t("search.noResult") }}</q-item-section>
        </q-item>
      </template>
    </q-select>

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
    >
      <template #icon-left><q-icon name="add" /></template>
    </OButton>
  </div>
  <!-- add/edit tab -->
  <ODrawer
    v-model:open="showAddTabDialog"
    size="md"
    :show-close="false"
    data-test="dashboard-tab-add-dialog"
  >
    <AddTab
      ref="addTabRef"
      :edit-mode="false"
      :dashboard-id="dashboardId"
      :folder-id="folderId"
      @refresh="updateTabList"
      @close="showAddTabDialog = false"
    />
    <template #footer>
      <div class="tw:flex tw:justify-start tw:gap-2">
        <OButton variant="outline" size="sm-action" @click="showAddTabDialog = false" data-test="dashboard-add-cancel">{{ t('dashboard.cancel') }}</OButton>
        <OButton variant="primary" size="sm-action" data-test="dashboard-add-tab-submit" @click="addTabRef?.submit()">{{ t('dashboard.save') }}</OButton>
      </div>
    </template>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, onActivated, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import AddTab from "../../components/dashboards/tabs/AddTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { useRoute } from "vue-router";
import { getDashboard } from "@/utils/commons";
import { onMounted } from "vue";
import { useLoading } from "@/composables/useLoading";

export default defineComponent({
  name: "SelectTabDropdown",
  components: { AddTab, OButton, ODrawer },
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
    const addTabRef: any = ref(null);
    const tabList: any = ref([]);

    //dropdown selected folder index
    const selectedTab: any = ref(null);
    const { t } = useI18n();

    // on add tab, select added tab
    const updateTabList = async (newTab: any) => {
      showAddTabDialog.value = false;
      await getTabList.execute();
      selectedTab.value = {
        label: newTab.name,
        value: newTab.tabId,
      };
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
        selectedTab.value = {
          label: tabList?.value[0]?.label,
          value: tabList?.value[0]?.value,
        };
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
      () => {
        emit("tab-selected", selectedTab?.value);
      },
    );

    return {
      t,
      store,
      selectedTab,
      updateTabList,
      showAddTabDialog,
      addTabRef,
      tabList,
      getTabList,
    };
  },
});
</script>
