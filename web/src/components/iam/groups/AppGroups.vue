<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="q-pa-none">
    <div class="tw-flex tw-justify-between tw-items-center tw-px-4 tw-py-3 tw-h-[71px] tw-border-b-[1px]"
      :class="store.state.theme =='dark' ? 'o2-table-header-dark tw-border-gray-500' : 'o2-table-header-light tw-border-gray-200'"
      >
    <div
      data-test="iam-groups-section-title"
      class="q-table__title tw-font-[600]"
    >
      {{ t("iam.groups") }}
    </div>
    <div class=" row items-center justify-end">
        <div data-test="iam-groups-search-input">
          <q-input
              v-model="filterQuery"
              borderless
              dense
              class="q-ml-auto no-border o2-search-input tw-h-[36px]"
              :placeholder="t('iam.searchGroup')"
              :class="store.state.theme === 'dark' ? 'o2-search-input-dark' : 'o2-search-input-light'"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" :class="store.state.theme === 'dark' ? 'o2-search-input-icon-dark' : 'o2-search-input-icon-light'" name="search" />
              </template>
            </q-input>
        </div>
        <q-btn
          data-test="iam-groups-add-group-btn"
          class="q-ml-md o2-primary-button tw-h-[36px]"
          flat
          :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
          no-caps
          :label="t(`iam.addGroup`)"
          @click="addGroup"
        />
      </div>
    </div>
    <div>
      <app-table
        data-test="iam-groups-table-section"
        class="iam-table o2-quasar-app-table o2-quasar-table-header-sticky"
        :class="store.state.theme == 'dark' ? 'o2-quasar-app-table-dark o2-quasar-table-header-sticky-dark o2-last-row-border-dark' : 'o2-quasar-app-table-light o2-quasar-table-header-sticky-light o2-last-row-border-light'"
        :tableStyle="hasVisibleRows ? 'height: calc(100vh - 114px); overflow-y: auto;' : ''"
        :rows="visibleRows"
        :columns="columns"
        pagination
        :rows-per-page="25"
        :filter="{
          value: filterQuery,
          method: filterGroups,
        }"
        :bordered="false"
        :title="t('iam.groups')"
        :hideTopPagination="true"
        :showBottomPaginationWithTitle="true"
      >
        <template v-slot:actions="slotProps: any">
          <div>
            <q-icon
              :data-test="`iam-groups-edit-${slotProps.column.row.group_name}-role-icon`"
              size="14px"
              name="edit"
              class="cursor-pointer q-mr-md"
              :title="t('common.edit')"
              @click="editGroup(slotProps.column.row)"
            />
            <q-icon
              :data-test="`iam-groups-delete-${slotProps.column.row.group_name}-role-icon`"
              size="14px"
              name="delete"
              class="cursor-pointer"
              :title="t('common.delete')"
              @click="showConfirmDialog(slotProps.column.row)"
            />
          </div>
        </template>
      </app-table>
    </div>

    <q-dialog v-model="showAddGroup" position="right" full-height maximized>
      <AddGroup
        style="width: 30vw"
        :org_identifier="store.state.selectedOrganization.identifier"
        @cancel:hideform="hideAddGroup"
        @added:group="setupGroups"
      />
    </q-dialog>
    <ConfirmDialog
      title="Delete Group"
      :message="`Are you sure you want to delete '${deleteConformDialog?.data?.group_name as string}'?`"
      @update:ok="_deleteGroup"
      @update:cancel="deleteConformDialog.show = false"
      v-model="deleteConformDialog.show"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeMount, computed } from "vue";
import AddGroup from "./AddGroup.vue";
import { useI18n } from "vue-i18n";
import AppTable from "@/components/AppTable.vue";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getGroups, deleteGroup } from "@/services/iam";
import usePermissions from "@/composables/iam/usePermissions";
import { useQuasar } from "quasar";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";

const showAddGroup = ref(false);

const { t } = useI18n();

const { track } = useReo();

const rows: any = ref([]);

const router = useRouter();

const store = useStore();

const { groupsState } = usePermissions();

const filterQuery = ref("");

const q = useQuasar();

const deleteConformDialog = ref({
  show: false,
  data: null as any,
});

const columns: any = [
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left",
    style: "width: 67px;",
  },
  {
    name: "group_name",
    field: "group_name",
    label: t("iam.groupName"),
    align: "left",
    sortable: true,
  },
  {
    name: "actions",
    field: "actions",
    label: t("alerts.actions"),
    align: "center",
    sortable: false,
    slot: true,
    slotName: "actions",
    classes: "actions-column",
  },
];

const groups = ref([]);

onBeforeMount(() => {
  setupGroups();
});

const updateTable = () => {
  let counter = 1;
  rows.value = cloneDeep(
    groupsState.groups.map((group: { group_name: string }, index: number) => ({
      ...group,
      "#": counter <= 9 ? `0${counter++}` : counter++,
    }))
  );
};

const addGroup = () => {
  track("Button Click", {
    button: "Add Group",
    page: "Groups"
  });
  showAddGroup.value = true;
};

const editGroup = (group: any) => {
  router.push({
    name: "editGroup",
    params: {
      group_name: group.group_name,
    },
  });
};

const setupGroups = async () => {
  await getGroups(store.state.selectedOrganization.identifier)
    .then((res) => {
      groupsState.groups = res.data.map((group: string) => ({
        group_name: group,
      }));
      updateTable();
    })
    .catch((err) => {
      console.log(err);
    });
};

const hideAddGroup = () => {
  showAddGroup.value = false;
};

const filterGroups = (rows: any, terms: any) => {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]["group_name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
    }
  }
  return filtered;
};

const deleteUserGroup = (group: any) => {
  deleteGroup(group.group_name, store.state.selectedOrganization.identifier)
    .then(() => {
      q.notify({
        message: "Group deleted successfully!",
        color: "positive",
        position: "bottom",
      });
      setupGroups();
    })
    .catch((error: any) => {
      if (error.response.status != 403) {
        q.notify({
          message: "Error while deleting group!",
          color: "negative",
          position: "bottom",
        });
      }
    });
};

const showConfirmDialog = (row: any) => {
  deleteConformDialog.value.show = true;
  deleteConformDialog.value.data = row;
};

const _deleteGroup = () => {
  deleteUserGroup(deleteConformDialog.value.data);
  deleteConformDialog.value.data = null;
};

const visibleRows = computed(() => {
  if (!filterQuery.value) return rows.value || []
  return filterGroups(rows.value || [], filterQuery.value)
})

const hasVisibleRows = computed(() => visibleRows.value.length > 0)
</script>

<style scoped></style>
<style lang="scss">
.iam-table {
  .thead-sticky,
  .tfoot-sticky {
    position: sticky;
    top: 0;
    opacity: 1;
    z-index: 1;
    background: transparent !important;
  }

  .q-table--dark .thead-sticky,
  .q-table--dark .tfoot-sticky {
    background: transparent !important;
  }
}
</style>
