<template>
  <div style="font-size: 18px" class="q-py-sm q-px-md">
    {{ t("iam.roles") }}
  </div>
  <div class="full-width bg-grey-4" style="height: 1px" />

  <div class="q-mt-sm q-px-md">
    <div class="q-mb-sm row items-center">
      <q-input
        v-model="filterQuery"
        filled
        dense
        class="col-6 q-pr-sm"
        :placeholder="t('user.search')"
      >
        <template #prepend>
          <q-icon name="search" />
        </template>
      </q-input>

      <q-btn
        data-test="alert-list-add-alert-btn"
        class="q-ml-md q-mb-xs text-bold no-border q-mr-sm"
        padding="sm lg"
        color="secondary"
        no-caps
        :label="t(`iam.addRole`)"
        @click="addRole"
      />
    </div>
    <app-table
      :rows="rows"
      :columns="columns"
      pagination
      :rows-per-page="20"
      :filter="{
        value: filterQuery,
        method: filterRoles,
      }"
    >
      <template v-slot:actions="slotProps">
        <div>
          <q-icon
            size="14px"
            name="edit"
            class="cursor-pointer q-mr-md"
            :title="t('common.edit')"
            @click="() => editRole(slotProps.column.row)"
          />
          <q-icon
            size="14px"
            name="delete"
            class="cursor-pointer"
            :title="t('common.delete')"
          />
        </div>
      </template>
    </app-table>
  </div>
  <q-dialog v-model="showAddGroup" position="right" full-height maximized>
    <AddRole style="width: 30vw" />
  </q-dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import AddRole from "./AddRole.vue";
import { useI18n } from "vue-i18n";
import AppTable from "@/components/AppTable.vue";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import { getRoles } from "@/services/iam";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";

const { t } = useI18n();

const showAddGroup = ref(false);

const rows: any = ref([]);

const router = useRouter();

const store = useStore();

const columns: any = [
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left",
  },
  {
    name: "role_name",
    field: "role_name",
    label: t("iam.roleName"),
    align: "left",
    sortable: true,
  },
  {
    name: "actions",
    field: "actions",
    label: t("common.actions"),
    align: "right",
    sortable: false,
    slot: true,
    slotName: "actions",
  },
];

const { rolesState } = usePermissions();

onMounted(() => {
  setupRoles();
});

const filterQuery = ref("");

const updateTable = () => {
  rows.value = cloneDeep(
    rolesState.roles.map((role: { role_name: string }, index) => ({
      ...role,
      "#": index + 1,
    }))
  );
};

const addRole = () => {
  showAddGroup.value = true;
};

const editRole = (role: any) => {
  console.log(role);
  router.push({
    name: "editRole",
    params: {
      role_name: role.role_name,
    },
  });
};

const setupRoles = async () => {
  await getRoles(store.state.selectedOrganization.identifier)
    .then((res) => {
      rolesState.roles = res.data.map((role: string) => ({
        role_name: role,
      }));
      updateTable();
    })
    .catch((err) => {
      console.log(err);
    });
};

const filterRoles = (rows: any, terms: any) => {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]["role_name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
    }
  }
  return filtered;
};
</script>

<style scoped></style>
