<template>
  <div>
    <!-- TODO OK : Add button to delete role in toolbar -->
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ editingRole.role_name }}
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <div
      class="q-px-md q-py-md"
      style="height: calc(100vh - 101px); overflow-y: auto"
    >
      <permissions-table />
      <div class="flex justify-end q-mt-lg">
        <q-btn
          data-test="add-alert-cancel-btn"
          class="text-bold"
          :label="t('alerts.cancel')"
          text-color="light-text"
          padding="sm md"
          no-caps
          @click="cancelPermissionsUpdate"
        />
        <q-btn
          data-test="add-alert-submit-btn"
          :label="t('alerts.save')"
          class="text-bold no-border q-ml-md"
          color="secondary"
          padding="sm xl"
          no-caps
          @click="updateRolePermissions"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { defineProps } from "vue";
import type { Resource, Entity, Permission } from "@/ts/interfaces";
import PermissionsTable from "@/components/iam/roles/PermissionsTable.vue";
import { permissionsResponse } from "./permissions";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";

const props = defineProps({
  role: {
    type: Object,
    default: () => ({
      role_name: "dev",
      permissions: [],
    }),
  },
});

const { t } = useI18n();

const { permissionsState } = usePermissions();

const store = useStore();

const editingRole = ref(cloneDeep(props.role));

const setEditingRole = () => {
  editingRole.value = cloneDeep(props.role);
  updateRolePermissions();
};

const getOrgId = () => {
  return store.state.selectedOrganization.identifier;
};

const updateRolePermissions = () => {
  let resourceMapper: { [key: string]: any } = {};

  permissionsState.permissions.forEach(
    (resource: Resource, index) =>
      (resourceMapper[resource.resourceName] =
        permissionsState.permissions[index])
  );

  (permissionsResponse as Permission[]).forEach((permission: Permission) => {
    const { resource, entity } = decodePermission(permission.object);

    if (resourceMapper[resource]) {
      // Check if entity is org_id
      if (entity === getOrgId()) {
        resourceMapper[resource].permission[permission.permission] = true;
      } else {
        let _entity: Entity | null = resourceMapper[resource].entities[entity];

        if (!_entity) {
          _entity = {
            name: entity,
            permission: {
              AllowAll: false,
              AllowGet: false,
              AllowDelete: false,
              AllowPut: false,
            },
            type: "entity",
            resourceName: resource,
            isSelected: true,
          };
        }

        _entity.permission[
          permission.permission as
            | "AllowAll"
            | "AllowGet"
            | "AllowDelete"
            | "AllowPut"
        ] = true;
        resourceMapper[resource].entities[entity] = cloneDeep(_entity);
        _entity = null;
      }
    }
  });

  resourceMapper = {};
};

const decodePermission = (permission: string) => {
  const [resource, entity] = permission.split(":");
  return { resource, entity };
};

const cancelPermissionsUpdate = () => {};

setEditingRole();

// Dynamic Resource and Entity permission updates on checkbox click
// 1. if any entity is selected add null to resource permission
// 2. if all entities are selected add true to resource permission
// 3. if no entity is selected add false to resource permission

// When entity of specific resource is selected
</script>

<style scoped></style>
