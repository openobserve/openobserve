// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { readonly, ref, type Ref } from "vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import analytics from "@/services/product_analytics";
import type { TranslateFn } from "@/types/i18n";

type Staged = { object: string; permission: string };

type SaveDeps = {
  editingRole: Ref<string>;
  permissionsUiType: Ref<string>;
  /** Flushes the JSON editor into the grant store, so a save from JSON sends what was typed. */
  updateJsonInTable: () => void;
  grants: { payload: () => { add: Staged[]; remove: Staged[] }; commit: () => void };
  addedUsers: Ref<Set<unknown>>;
  removedUsers: Ref<Set<unknown>>;
  addedServiceAccounts: Ref<Set<unknown>>;
  removedServiceAccounts: Ref<Set<unknown>>;
  /** Rewritten after a save so the Users tab shows the new membership without a refetch. */
  roleUsers: Ref<string[]>;
  updateRoleOne: {
    mutateAsync: (vars: { role_id: string; payload: Record<string, unknown> }) => Promise<unknown>;
  };
  /** The rail module a resource is counted under, so "in 2 modules" matches the rail. */
  moduleKeyOf: (resource: string) => string;
  /** Resolves once a preset still staging has finished, so the save carries its grants. */
  presetSettled: () => Promise<void>;
  t: TranslateFn;
};

/** Sends the staged grant and membership changes, then makes them the new baseline. */
export const useRoleSave = (deps: SaveDeps) => {
  const {
    editingRole,
    permissionsUiType,
    updateJsonInTable,
    grants,
    addedUsers,
    removedUsers,
    addedServiceAccounts,
    removedServiceAccounts,
    roleUsers,
    updateRoleOne,
    moduleKeyOf,
    presetSettled,
    t,
  } = deps;

  // Counted before commit() clears the staging: two keys on `logs:app` and one on `dashboard:f1/d1` -> 3 changes in 2 modules.
  const savedMessage = (changed: Staged[]) => {
    const count = changed.length;
    if (!count) return t("iam.editRole.updateSuccess");
    const modules = new Set(changed.map(({ object }) => moduleKeyOf(object.split(":")[0]))).size;
    return t("iam.editRole.saveSuccessCounts", {
      changes: t("iam.editRole.permissionChangeCount", { count }, count),
      modules: t("iam.editRole.presetModuleCount", { count: modules }, modules),
    });
  };

  const send = () => {
    if (permissionsUiType.value === "json") updateJsonInTable();

    // Users and service accounts are both sent as users; merge the two staging
    // sets (dedup via Set) for the request payload.
    const payload = {
      ...grants.payload(),
      add_users: Array.from(
        new Set([...addedUsers.value, ...addedServiceAccounts.value]),
      ) as string[],
      remove_users: Array.from(
        new Set([...removedUsers.value, ...removedServiceAccounts.value]),
      ) as string[],
    };

    if (!(
      payload.add.length ||
      payload.remove.length ||
      payload.add_users.length ||
      payload.remove_users.length
    )) {
      toast({
        variant: "info",
        message: t("iam.editRole.noUpdatesDetected"),
      });

      return;
    }

    const message = savedMessage([...payload.add, ...payload.remove]);

    // Was: invalidate, then update — the refetch raced the write.
    return updateRoleOne
      .mutateAsync({ role_id: editingRole.value, payload })
      .then(async () => {
        analytics.track("role_updated", {
          permissions_changed: payload.add.length + payload.remove.length > 0,
          members_changed: payload.add_users.length + payload.remove_users.length > 0,
        });
        // combine permissionsHash and selectedPermissionsHash

        toast({ variant: "success", message });

        // Resetting permissions state on save

        grants.commit();

        roleUsers.value = roleUsers.value.filter(
          (user) => !removedUsers.value.has(user) && !removedServiceAccounts.value.has(user),
        );

        addedUsers.value.forEach((value: any) => {
          roleUsers.value.push(value);
        });

        addedServiceAccounts.value.forEach((value: any) => {
          roleUsers.value.push(value);
        });

        addedUsers.value = new Set([]);

        removedUsers.value = new Set([]);

        addedServiceAccounts.value = new Set([]);

        removedServiceAccounts.value = new Set([]);
      })
      .catch((err) => {
        if (err.response.status != 403) {
          toast({
            variant: "error",
            message: t("iam.editRole.updateError"),
          });
        }
        console.log(err);
      });
  };

  const isSaving = ref(false);

  // A preset staging past the payload would be absorbed by commit() unsent, so the save waits for it.
  const saveRole = async () => {
    // A second click while the PUT is in flight would send the same changes twice.
    if (isSaving.value) return;
    isSaving.value = true;
    try {
      await presetSettled();
      await send();
    } finally {
      isSaving.value = false;
    }
  };

  return {
    saveRole,
    /** True from the click until the PUT settles; preset Add stays off meanwhile. */
    isSaving: readonly(isSaving),
  };
};
