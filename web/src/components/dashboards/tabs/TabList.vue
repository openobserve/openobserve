<!-- Copyright 2023 Zinc Labs Inc.

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
  <div style="display: flex">
    <q-tabs
      v-model="selectedTabIdModel"
      :align="'left'"
      narrow-indicator
      dense
      inline-label
      outside-arrows
      mobile-arrows
      active-color="primary"
      @click.stop
      style="max-width: calc(100% - 40px)"
    >
      <q-tab
        no-caps
        :ripple="false"
        v-for="(tab, index) in tabs"
        :key="index"
        :name="tab.tabId"
        @click.stop
        :to="{ query: { ...route.query, tab: tab.tabId } }"
        content-class="tab_content"
        @mouseover="() => (hoveredTabId = tab.tabId)"
        @mouseleave="hoveredTabId = null"
      >
        <div class="full-width row justify-between no-wrap">
          <span
            style="
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
            :title="tab?.name"
            >{{ tab?.name }}</span
          >
          <div v-if="hoveredTabId === tab.tabId">
            <q-icon
              v-if="index"
              :name="outlinedEdit"
              class="q-ml-sm"
              @click.stop="editTab(tab.tabId)"
              style="cursor: pointer; justify-self: end"
            />
            <q-icon
              v-if="index"
              :name="outlinedDelete"
              class="q-ml-sm"
              @click.stop="showDeleteTabDialogFn(tab.tabId)"
              style="cursor: pointer; justify-self: end"
            />
          </div>
        </div>
      </q-tab>
    </q-tabs>
    <q-btn
      class="q-ml-sm"
      outline
      padding="xs"
      no-caps
      icon="add"
      @click="
        () => {
          isTabEditMode = false;
          showAddTabDialog = true;
        }
      "
    />
    <q-dialog v-model="showAddTabDialog" position="right" full-height maximized>
      <AddTab
        :edit-mode="isTabEditMode"
        :tabId="selectedTabIdToEdit"
        :dashboardData="dashboardData"
        @saveDashboard="updateTabList"
      />
    </q-dialog>

    <!-- delete tab dialog -->
    <ConfirmDialog
      title="Delete Tab"
      message="Are you sure you want to delete this Tab?"
      @update:ok="deleteTabFn"
      @update:cancel="confirmDeleteTabDialog = false"
      v-model="confirmDeleteTabDialog"
    />
  </div>
</template>

<script lang="ts">
import { computed, ref } from "vue";
import { defineComponent } from "vue";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";
import {
  outlinedDelete,
  outlinedEdit,
} from "@quasar/extras/material-icons-outlined";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useRoute, useRouter } from "vue-router";
import { watch } from "vue";
import { deleteTab } from "@/utils/commons";
import { useStore } from "vuex";

export default defineComponent({
  name: "TabList",
  components: {
    AddTab,
    ConfirmDialog,
  },
  props: {
    dashboardData: {
      required: true,
      type: Object,
    },
    selectedTabId: {
      required: true,
    },
  },
  emits: ["saveDashboard", "update:selectedTabId"],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const showAddTabDialog = ref(false);
    const isTabEditMode = ref(false);
    const selectedTabIdToEdit = ref(null);
    const selectedTabIdToDelete: any = ref(null);
    const confirmDeleteTabDialog = ref(false);
    const hoveredTabId: any = ref(null);

    // need one ref which will passed in tabList for selectedTab
    const selectedTabIdModel: any = ref(props.selectedTabId);

    // also, need to emit selectedTabId
    watch(selectedTabIdModel, (newVal) => {
      emit("update:selectedTabId", newVal);
    });

    const tabs: any = computed(() => {
      return props.dashboardData?.tabs ?? [];
    });

    const updateTabList = () => {
      emit("saveDashboard");
      showAddTabDialog.value = false;
      isTabEditMode.value = false;
    };

    const editTab = (tabId: any) => {
      selectedTabIdToEdit.value = tabId;
      isTabEditMode.value = true;
      showAddTabDialog.value = true;
    };

    const showDeleteTabDialogFn = (tabId: any) => {
      selectedTabIdToDelete.value = tabId;
      confirmDeleteTabDialog.value = true;
    };

    const deleteTabFn = async () => {
      await deleteTab(
        store,
        route.query.dashboard,
        route.query.folder,
        selectedTabIdToDelete.value,
        "default"
      );
      router.push({
        query: {
          ...route.query,
          tab: "default",
        },
      });
      confirmDeleteTabDialog.value = false;
    };

    return {
      showAddTabDialog,
      updateTabList,
      outlinedDelete,
      outlinedEdit,
      editTab,
      selectedTabIdToEdit,
      isTabEditMode,
      showDeleteTabDialogFn,
      confirmDeleteTabDialog,
      selectedTabIdToDelete,
      deleteTabFn,
      hoveredTabId,
      selectedTabIdModel,
      tabs,
      route,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-tabs {
  &--vertical {
    margin: 5px;
    .q-tab {
      justify-content: flex-start;
      padding: 0 1rem 0 1.25rem;
      border-radius: 0.5rem;
      text-transform: capitalize;
      &__content.tab_content {
        .q-tab {
          &__icon + &__label {
            padding-left: 0.875rem;
            font-weight: 600;
          }
        }
      }
      &--active {
        background-color: $accent;
        color: black;
      }
    }
  }
}
</style>
