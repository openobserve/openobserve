<template>
  <div>
    <!-- TODO OK : Add button to delete role in toolbar -->
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ editingRole }}
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <div
      class="q-px-md q-py-md"
      style="height: calc(100vh - 101px); overflow-y: auto"
    >
      <permissions-table
        ref="permissionTableRef"
        :selectedPermissionsHash="aggregatedPermissionHash"
        @updated:permission="handlePermissionChange"
      />
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
          @click="saveRolePermissions"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Resource, Entity, Permission } from "@/ts/interfaces";
import PermissionsTable from "@/components/iam/roles/PermissionsTable.vue";
import { permissionsResponse } from "./permissions";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import { useRouter } from "vue-router";
import { onBeforeMount } from "vue";
import {
  updateRole,
  getResources,
  getResourcePermission,
} from "@/services/iam";
import { useQuasar } from "quasar";
import type { AxiosPromise } from "axios";

onBeforeMount(() => {
  permissionsState.permissions = [];
  editingRole.value = router.currentRoute.value.params.role_name as string;
  getRoleDetails();
});

const permissionTableRef: any = ref(null);

const { t } = useI18n();

const { permissionsState } = usePermissions();

const router = useRouter();

const q = useQuasar();

const store = useStore();

const editingRole = ref("");

const permissions: Ref<Permission[]> = ref([]);

const permissionsHash = ref(new Set()); // Saved permissions of role

const aggregatedPermissionHash = ref(new Set()); // Saved + new added permission hash

const addedPermissions: any = ref({});

const removedPermissions: any = ref({});

const getRoleDetails = () => {
  getResources(store.state.selectedOrganization.identifier).then(
    async (res) => {
      permissionsState.resources = res.data;
      setDefaultPermissions();
      await getResourcePermissions();
      updateRolePermissions();
    }
  );
};

const setDefaultPermissions = () => {
  permissionsState.resources.forEach((resource: string) => {
    const resourcePermission = getDefaultResource();
    resourcePermission.name = resource;
    resourcePermission.resourceName = resource;

    permissionsState.permissions.push(resourcePermission as Resource);
  });
};

const getResourcePermissions = () => {
  const promises: AxiosPromise<any>[] = [];
  permissionsState.resources.forEach((resourceName) => {
    promises.push(
      getResourcePermission({
        role_name: editingRole.value,
        org_identifier: store.state.selectedOrganization.identifier,
        resource: resourceName,
      })
    );
  });

  return new Promise((resolve, reject) => {
    Promise.all(promises)
      .then((res) => {
        res.forEach((resourcePermissions: { data: Permission[] }) => {
          permissions.value.push(...resourcePermissions.data);
        });
        promises.length = 0;
        resolve(true);
      })
      .catch((err) => {
        reject(err);
      });
  });
};

const getDefaultResource = () => {
  return {
    name: "",
    permission: {
      AllowAll: false,
      AllowList: false,
      AllowGet: false,
      AllowDelete: false,
      AllowPost: false,
      AllowPut: false,
    },
    type: "resource",
    resourceName: "",
    isSelected: false,
    entities: [],
  };
};

const getOrgId = () => {
  return store.state.selectedOrganization.identifier;
};

const updateRolePermissions = () => {
  console.log("updateRolePermissions");
  let resourceMapper: { [key: string]: any } = {};

  permissionsState.permissions.forEach(
    (resource: Resource, index) =>
      (resourceMapper[resource.resourceName] =
        permissionsState.permissions[index])
  );

  permissions.value.forEach((permission: Permission) => {
    const { resource, entity } = decodePermission(permission.object);

    if (resourceMapper[resource]) {
      // Creating permissions hash to check if permission is selected at the time of save as we need to send only added and removed permissions
      const permissionHash = `${resource}:${entity}:${permission.permission}`;
      permissionsHash.value.add(permissionHash);
      aggregatedPermissionHash.value.add(permissionHash);

      // Check if entity is org_id
      if (entity === getOrgId()) {
        resourceMapper[resource].permission[permission.permission] = true;
      } else {
        let _entity: Entity | null = resourceMapper[resource].entities.find(
          (e: Entity) => e.name === entity
        );

        const isEntityPresent = !!_entity;

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

        if (!isEntityPresent)
          resourceMapper[resource].entities.push(cloneDeep(_entity));
        _entity = null;
      }
    }
  });

  permissionTableRef.value.updateTableData();
  resourceMapper = {};
};

const decodePermission = (permission: string) => {
  const [resource, entity] = permission.split(":");
  return { resource, entity };
};

const cancelPermissionsUpdate = () => {};

const handlePermissionChange = (row: any, permission: string) => {
  let entity = "";

  if (row.type === "resource")
    entity = store.state.selectedOrganization.identifier;
  else entity = row.name;

  const permissionHash = `${row.resourceName}:${entity}:${permission}`;
  const object = `${row.resourceName}:${entity}`;

  // Add permission to addedPermissions if not present
  if (
    !addedPermissions.value[permissionHash] &&
    !permissionsHash.value.has(permissionHash)
  ) {
    aggregatedPermissionHash.value.add(permissionHash);
    addedPermissions.value[permissionHash] = {
      object,
      permission: permission,
    };
    return;
  }

  // Remove permission from removedPermissions if present
  if (removedPermissions.value[permissionHash]) {
    delete removedPermissions.value[permissionHash];
    return;
  }

  // Remove permission from addedPermissions if present
  if (permissionsHash.value.has(permissionHash)) {
    aggregatedPermissionHash.value.delete(permissionHash);
    removedPermissions.value[permissionHash] = {
      object,
      permission: permission,
    };

    return;
  }

  // Remove permission from addedPermissions if present
  if (addedPermissions.value[permissionHash]) {
    aggregatedPermissionHash.value.delete(permissionHash);
    delete addedPermissions.value[permissionHash];
    return;
  }
};

const saveRolePermissions = () => {
  const payload = {
    add: Object.values(addedPermissions.value),
    remove: Object.values(removedPermissions.value),
  };

  updateRole({
    role_id: editingRole.value,
    org_identifier: store.state.selectedOrganization.identifier,
    payload,
  })
    .then((res) => {
      q.notify({
        type: "positive",
        message: `Updated "${editingRole.value}" role permissions successfully!"`,
        timeout: 3000,
      });
      router.push({
        name: "roles",
        params: {
          org_name: store.state.selectedOrganization.name,
        },
      });
    })
    .catch((err) => {
      q.notify({
        type: "negative",
        message: `Error While updating "${editingRole.value}" role permissions!`,
        timeout: 3000,
      });
      console.log(err);
    });
};
</script>

<style scoped></style>
