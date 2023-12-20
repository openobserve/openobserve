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
      >
        <div class="full-width row justify-between no-wrap">
          <span
            style="
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
            :title="tab.name"
            >{{ tab.name }}</span
          >
          <div>
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
        @update:tabs="updateTabList"
        :edit-mode="isTabEditMode"
        :tab-id="selectedTabToEdit ?? 'default'"
        :tabs="tabs"
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
import { ref } from "vue";
import { defineComponent } from "vue";
import AddTab from "@/components/dashboards/tabs/AddTab.vue";
import {
  outlinedDelete,
  outlinedEdit,
} from "@quasar/extras/material-icons-outlined";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

export default defineComponent({
  name: "TabList",
  components: {
    AddTab,
    ConfirmDialog,
  },
  setup() {
    const showAddTabDialog = ref(false);
    const isTabEditMode = ref(false);
    const selectedTabToEdit = ref(null);
    const selectedTab = ref(0);
    const selectedTabIdToDelete: any = ref(null);
    const confirmDeleteTabDialog = ref(false);

    const tabs = ref([
      {
        tabId: "default",
        name: "default",
        description: "",
      },
      {
        tabId: "default 2",
        name: "default 2",
        description: "",
      },
      {
        tabId: "default 3",
        name: "default 3",
        description: "",
      },
      {
        tabId: "default 4",
        name: "default 4",
        description: "",
      },
    ]);

    const removeTab = (index: number) => {
      tabs.value.splice(index, 1);
    };

    const updateTabList = (newFolder: any) => {
      showAddTabDialog.value = false;
      isTabEditMode.value = false;
    };

    const editTab = (tabId: any) => {
      selectedTabToEdit.value = tabId;
      isTabEditMode.value = true;
      showAddTabDialog.value = true;
    };

    const showDeleteTabDialogFn = (tabId: any) => {
      selectedTabIdToDelete.value = tabId;
      confirmDeleteTabDialog.value = true;
    };

    const deleteTab = () => {
      tabs.value.splice(
        tabs.value.findIndex(
          (tab: any) => tab.tabId === selectedTabIdToDelete.value
        ),
        1
      );
      confirmDeleteTabDialog.value = false;
    };

    return {
      tabs,
      selectedTab,
      removeTab,
      showAddTabDialog,
      updateTabList,
      outlinedDelete,
      outlinedEdit,
      editTab,
      selectedTabToEdit,
      isTabEditMode,
      showDeleteTabDialogFn,
      confirmDeleteTabDialog,
      selectedTabIdToDelete,
      deleteTab,
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
