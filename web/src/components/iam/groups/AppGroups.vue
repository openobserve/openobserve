<template>
  <div>
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ t("iam.groups") }}
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <div class="q-mt-lg q-px-md">
      <div class="flex justify-end q-mb-sm">
        <q-btn
          data-test="alert-list-add-alert-btn"
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :label="t(`iam.addGroup`)"
          @click="addGroup"
        />
      </div>
      <app-table :rows="rows" :columns="columns" pagination :rows-per-page="20">
        <template v-slot:actions="slotProps">
          <div>
            <q-icon
              size="14px"
              name="edit"
              class="cursor-pointer q-mr-md"
              :title="t('common.edit')"
              @click="editGroup(slotProps.column.row)"
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
      <AddGroup
        style="width: 30vw"
        :org_identifier="store.state.selectedOrganization.identifier"
      />
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import AddGroup from "./AddGroup.vue";
import { useI18n } from "vue-i18n";
import AppTable from "@/components/AppTable.vue";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getGroups } from "@/services/iam";

const showAddGroup = ref(false);

const { t } = useI18n();

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
    align: "right",
    sortable: false,
    slot: true,
    slotName: "actions",
  },
];

const groups = ref([]);

onMounted(() => {
  setupGroups();
});

const updateTable = () => {
  rows.value = cloneDeep(
    groups.value.map((group: { group_name: string }, index) => ({
      ...group,
      "#": index + 1,
    }))
  );
};

const addGroup = () => {
  showAddGroup.value = true;
};

const editGroup = (group: any) => {
  console.log(group);
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
      groups.value = res.data.map((group: string) => ({
        group_name: group,
      }));
      updateTable();
    })
    .catch((err) => {
      console.log(err);
    });
};
</script>

<style scoped></style>
