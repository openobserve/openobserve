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

import { computed, ref, type ComputedRef, type Ref } from "vue";

export type StagedGrant = { object: string; permission: string };

export type ResourceGrantStat = { granted: number; added: number; removed: number };

/** `resource:entity:action`, with `_all_<org>` as the entity of a type-level grant. */
export const buildGrantKey = (resource: string, permission: string, entity: string) =>
  `${resource}:${entity}:${permission}`;

/** Only the first and last `:` split, since ids contain "/": `dashboard:f1/d1:AllowPut` -> resource `dashboard`, entity `f1/d1`, permission `AllowPut`, object `dashboard:f1/d1`. */
export const splitGrantKey = (key: string) => {
  const first = key.indexOf(":");
  const last = key.lastIndexOf(":");
  return {
    resource: key.slice(0, first),
    entity: key.slice(first + 1, last),
    permission: key.slice(last + 1),
    object: key.slice(0, last),
  };
};

const emptyStat: ResourceGrantStat = { granted: 0, added: 0, removed: 0 };

/** Single source of truth for one role's grants: saved, staged, and the payload between them. */
export const useRoleGrants = () => {
  // The grants the role held on load. It only changes on a successful save.
  const saved = ref(new Set<string>()) as Ref<Set<string>>;
  // What the checkboxes show right now: saved, plus added, minus removed.
  const current = ref(new Set<string>()) as Ref<Set<string>>;
  // Ticked but never saved. Keyed by grant key, valued as the backend wants it, so the payload needs no re-parsing.
  const added = ref<Record<string, StagedGrant>>({});
  // Saved but unticked here. It stays out of `current` until the save lands or the user undoes it.
  const removed = ref<Record<string, StagedGrant>>({});

  const isDirty = computed(
    () => Object.keys(added.value).length > 0 || Object.keys(removed.value).length > 0,
  );

  const grantCount = computed(() => current.value.size);

  // One pass per change, so none of the ~50 rail badges ever scans the whole grant set.
  const statsByResource: ComputedRef<Map<string, ResourceGrantStat>> = computed(() => {
    const stats = new Map<string, ResourceGrantStat>();
    const bump = (key: string, field: keyof ResourceGrantStat) => {
      const { resource } = splitGrantKey(key);
      const stat = stats.get(resource) ?? { granted: 0, added: 0, removed: 0 };
      stat[field] += 1;
      stats.set(resource, stat);
    };
    current.value.forEach((key) => bump(key, "granted"));
    Object.keys(added.value).forEach((key) => bump(key, "added"));
    Object.keys(removed.value).forEach((key) => bump(key, "removed"));
    return stats;
  });

  const has = (key: string) => current.value.has(key);

  const statFor = (resource: string) => statsByResource.value.get(resource) ?? emptyStat;

  const stage = (key: string) => {
    const { object, permission } = splitGrantKey(key);
    return { object, permission };
  };

  /** Staging is relative to `saved`, so toggling back to the saved state leaves nothing staged. */
  const toggle = (key: string) => {
    if (!added.value[key] && !saved.value.has(key)) {
      current.value.add(key);
      added.value[key] = stage(key);
      return;
    }

    // Only a saved key is ever staged for removal, so re-ticking one just undoes that staging.
    if (removed.value[key]) {
      delete removed.value[key];
      current.value.add(key);
      return;
    }

    if (saved.value.has(key)) {
      // A key staged before seeding landed is already saved, so drop the add or the payload sends both.
      delete added.value[key];
      current.value.delete(key);
      removed.value[key] = stage(key);
      return;
    }

    if (added.value[key]) {
      current.value.delete(key);
      delete added.value[key];
    }
  };

  /** Records the grants the backend returned as both the baseline and the current set. */
  const seedSaved = (keys: string[]) => {
    keys.forEach((key) => {
      saved.value.add(key);
      current.value.add(key);
    });
  };

  const payload = () => ({
    add: Object.values(added.value),
    remove: Object.values(removed.value),
  });

  /** Promotes the staged changes to the baseline once the backend accepted them. */
  const commit = () => {
    Object.keys(removed.value).forEach((key) => {
      saved.value.delete(key);
      current.value.delete(key);
    });
    saved.value = new Set([...saved.value, ...current.value]);
    current.value = new Set(saved.value);
    added.value = {};
    removed.value = {};
  };

  const reset = () => {
    saved.value = new Set();
    current.value = new Set();
    added.value = {};
    removed.value = {};
  };

  return {
    saved,
    current,
    added,
    removed,
    isDirty,
    grantCount,
    statsByResource,
    has,
    statFor,
    toggle,
    seedSaved,
    payload,
    commit,
    reset,
  };
};

export default useRoleGrants;
