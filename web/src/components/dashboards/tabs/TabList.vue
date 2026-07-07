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
  <div
    data-test="dashboard-tab-list-container"
    style="display: flex; align-items: center"
    @mouseover="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <OTabs
      v-model="selectedTabId"
      :align="'left'"
      dense
      mobile-arrows
      @click.stop
      style="max-width: calc(100% - 40px)"
      data-test="dashboard-tab-list"
    >
      <OTab
        v-for="(tab, index) in tabs"
        :key="index"
        :name="tab.tabId"
        @click.stop
        :data-test="`dashboard-tab-${tab.tabId}`"
      >
        <div class="w-full flex justify-between flex-nowrap">
          <span
            style="
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              width: 100%;
            "
            :title="tab?.name"
            :data-test="`dashboard-tab-${tab.tabId}-name`"
            :data-test-tab-name="tab?.name"
            >{{ tab?.name }}</span
          >
        </div>
      </OTab>
    </OTabs>
    <OButton
      v-if="!viewOnly"
      v-show="isHovered"
      variant="ghost"
      size="icon"
      class="ml-1"
      @click="
        () => {
          showAddTabDialog = true;
        }
      "
      data-test="dashboard-tab-add-btn"
      icon-left="add"
    >
      <OTooltip content="Add Tab" />
    </OButton>
    <AddTab
      v-model:open="showAddTabDialog"
      :dashboard-id="dashboardData?.dashboardId"
      @refresh="refreshDashboard"
    />
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { computed, inject, ref } from "vue";
import { defineComponent } from "vue";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useRoute } from "vue-router";

export default defineComponent({
  name: "TabList",
  components: {
    AddTab,
    ConfirmDialog,
    OTabs,
    OTab,
    OButton,
    OTooltip,
  },
  props: {
    dashboardData: {
      required: true,
      type: Object,
    },
    viewOnly: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["refresh"],
  setup(props, { emit }) {
    const route = useRoute();
    const showAddTabDialog = ref(false);
    const isHovered = ref(false);

    // inject selected tab, default will be default tab
    const selectedTabId: any = inject("selectedTabId", ref("default"));

    const tabs: any = computed(() => {
      return props.dashboardData?.tabs ?? [];
    });

    const refreshDashboard = () => {
      emit("refresh");
      showAddTabDialog.value = false;
    };

    return {
      showAddTabDialog,
      refreshDashboard,
      tabs,
      route,
      isHovered,
      selectedTabId,
    };
  },
});
</script>
