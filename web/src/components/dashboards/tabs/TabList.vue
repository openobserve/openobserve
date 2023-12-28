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
      v-model="selectedTab"
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
        :name="index"
        @click.stop
        content-class="tab_content"
        @mouseover="() => (hoveredTabIndex = index)"
        @mouseleave="hoveredTabIndex = -1"
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
          <div v-if="hoveredTabIndex === index">
            <q-icon
              v-if="index"
              :name="outlinedEdit"
              class="q-ml-sm"
              @click.stop="editTab(index)"
              style="cursor: pointer; justify-self: end"
            />
            <q-icon
              v-if="index"
              :name="outlinedDelete"
              class="q-ml-sm"
              @click.stop="showDeleteTabDialogFn(index)"
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
        :tabIndex="selectedTabIndexToEdit ?? -1"
        :dashboardData="dashboardData"
        @saveDashboard="updateTabList"
      />
    </q-dialog>

    <!-- delete tab dialog -->
    <ConfirmDialog
      title="Delete Tab"
      message="Are you sure you want to delete this Tab?"
      @update:ok="deleteTab"
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
    selectedTabIndex: {
      required: true,
      validator: (value) => {
        return typeof value === "number" || value === null;
      },
    },
  },
  emits: ["update:selectedTabIndex", "saveDashboard"],
  setup(props, { emit }) {
    const router = useRouter();
    const route = useRoute();
    const showAddTabDialog = ref(false);
    const isTabEditMode = ref(false);
    const selectedTabIndexToEdit = ref(null);
    const selectedTabIndexToDelete: any = ref(null);
    const confirmDeleteTabDialog = ref(false);
    const hoveredTabIndex = ref(-1);
    const selectedTab: any = ref(props.selectedTabIndex);

    const tabs: any = computed(() => {
      return props.dashboardData?.tabs ?? [];
    });

    const updateTabList = () => {
      emit("saveDashboard");
      showAddTabDialog.value = false;
      isTabEditMode.value = false;
    };

    const editTab = (index: any) => {
      selectedTabIndexToEdit.value = index;
      isTabEditMode.value = true;
      showAddTabDialog.value = true;
    };

    const showDeleteTabDialogFn = (index: any) => {
      selectedTabIndexToDelete.value = index;
      confirmDeleteTabDialog.value = true;
    };

    const deleteTab = () => {
      props?.dashboardData?.tabs?.splice(selectedTabIndexToDelete.value, 1);
      emit("saveDashboard");
      confirmDeleteTabDialog.value = false;
    };

    watch(selectedTab, () => {
      emit("update:selectedTabIndex", selectedTab.value);
      router.replace({
        query: {
          ...route.query,
          tab: tabs[selectedTab.value]?.name,
        }
      })
    });

    return {
      showAddTabDialog,
      updateTabList,
      outlinedDelete,
      outlinedEdit,
      editTab,
      selectedTabIndexToEdit,
      isTabEditMode,
      showDeleteTabDialogFn,
      confirmDeleteTabDialog,
      selectedTabIndexToDelete,
      deleteTab,
      hoveredTabIndex,
      selectedTab,
      tabs,
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
