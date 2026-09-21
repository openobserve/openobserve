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

import { computed, watch, type Ref } from "vue";
import { raw, type I18nText } from "@/types/i18n";
import type { ScopeRow } from "@/components/iam/roles/ModulePane.vue";
import { STREAM_PARENT_KEY, type RoleModule } from "@/components/iam/roles/roleModules";
import type { Resource, Entity } from "@/ts/interfaces";

type NavigationDeps = {
  /** The module picked in the rail; "" is the summary. */
  activeModule: Ref<string>;
  /** The folder or stream type drilled into, or null at a module's top level. */
  openFolder: Ref<any>;
  /** The module or folder whose rows are in flight, so only the newest load clears the spinner. */
  loadingFor: Ref<string>;
  resourceMapper: Ref<{ [key: string]: Resource }>;
  /** The full list per stream type; a stream type's own `entities` is filter-shaped. */
  heavyResourceEntities: Ref<{ [key: string]: Entity[] }>;
  moduleOf: (moduleKey: string) => RoleModule | undefined;
  moduleLabel: (key: string) => I18nText;
  moduleScopes: (moduleKey: string) => ScopeRow[];
  folderScopes: (moduleKey: string, folder: any) => ScopeRow[];
  streamTypeScopes: (typeNode: any) => ScopeRow[];
  getResourceEntities: (resource: Resource | Entity) => Promise<unknown>;
};

/** What the pane shows for the open module and folder, and the moves that change it. */
export const useModuleNavigation = (deps: NavigationDeps) => {
  const {
    activeModule,
    openFolder,
    loadingFor,
    resourceMapper,
    heavyResourceEntities,
    moduleOf,
    moduleLabel,
    moduleScopes,
    folderScopes,
    streamTypeScopes,
    getResourceEntities,
  } = deps;

  const activeModuleView = computed(() => {
    const module = moduleOf(activeModule.value);
    if (!module) return null;

    const title = moduleLabel(module.key);

    // An org-wide resource has no items, so its only row is its own grant.
    if (!module.hasEntities) {
      return {
        trail: [title],
        scopes: [] as ScopeRow[],
        entities: [resourceMapper.value[module.key]].filter(Boolean),
      };
    }

    const child = openFolder.value;
    if (child && module.key === STREAM_PARENT_KEY) {
      return {
        trail: [title, raw(child.display_name ?? child.name)],
        scopes: streamTypeScopes(child),
        entities: heavyResourceEntities.value[child.name] ?? [],
      };
    }

    if (child) {
      return {
        trail: [title, raw(child.display_name ?? child.name)],
        scopes: folderScopes(module.key, child),
        entities: child.entities ?? [],
      };
    }

    return {
      trail: [title],
      scopes: moduleScopes(module.key),
      entities: resourceMapper.value[module.key]?.entities ?? [],
    };
  });

  const openModule = async (moduleKey: string) => {
    openFolder.value = null;
    const module = moduleOf(moduleKey);
    if (!module || !module.hasEntities) return;

    loadingFor.value = moduleKey;
    try {
      await getResourceEntities(resourceMapper.value[module.key]);
    } finally {
      // Only the newest open clears the flag, or a slower module would hide the one on screen.
      if (loadingFor.value === moduleKey) loadingFor.value = "";
    }
  };

  watch(activeModule, openModule);

  const openFolderRow = async (child: any) => {
    openFolder.value = child;
    // A stream type keeps its full list in heavyResourceEntities; its own `entities` is filter-shaped.
    if (activeModule.value === STREAM_PARENT_KEY && heavyResourceEntities.value[child.name]) return;

    loadingFor.value = child.name;
    try {
      await getResourceEntities(child);
    } finally {
      if (loadingFor.value === child.name) loadingFor.value = "";
    }
  };

  const navigateTrail = (index: number) => {
    if (index === 0) openFolder.value = null;
  };

  return {
    activeModuleView,
    openModule,
    openFolderRow,
    navigateTrail,
  };
};
