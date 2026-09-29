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

import type { Ref } from "vue";
import type { ScopeRow } from "@/components/iam/roles/ModulePane.vue";
import type { I18nText } from "@/types/i18n";
import { STREAM_PARENT_KEY } from "@/components/iam/roles/roleModules";
import type { Resource } from "@/ts/interfaces";

type ScopeDeps = {
  /** Every loaded resource by key; a scope row points at one of these nodes. */
  resourceMapper: Ref<{ [key: string]: Resource }>;
  /** Grants held right now, which decides whether a parent scope locks anything below it. */
  isGranted: (node: any, action: string) => boolean;
  resourceLabel: (key: string) => string;
  moduleLabel: (key: string) => I18nText;
  t: (key: string, named?: Record<string, unknown>) => I18nText;
  ACTION_ORDER: readonly string[];
};

/** The pinned rows above a module's list, and the resource types each one's grants reach. */
export const useRoleScopes = (deps: ScopeDeps) => {
  const { resourceMapper, isGranted, resourceLabel, moduleLabel, t, ACTION_ORDER } = deps;

  const typeScope = (resourceKey: string, node: any): ScopeRow => ({
    key: resourceKey,
    node,
    resource: resourceKey,
    covers: [resourceKey],
    label: t("iam.editRole.scopeAllOf", {
      module: node?.display_name ?? resourceLabel(resourceKey),
    }),
    hint: t("iam.editRole.scopeIncludesFuture"),
  });

  const everyStreamScope = (covers: string[]): ScopeRow => ({
    key: STREAM_PARENT_KEY,
    node: resourceMapper.value[STREAM_PARENT_KEY],
    resource: STREAM_PARENT_KEY,
    covers,
    label: t("iam.editRole.scopeEveryStream"),
    hint: t("iam.editRole.scopeEveryStreamHint"),
  });

  // Stream types are type rows under the `stream` node, so they are the rows the Streams module lists.
  const streamTypeKeys = () =>
    (resourceMapper.value[STREAM_PARENT_KEY]?.entities ?? []).map((entity: any) => entity.name);

  const moduleScopes = (moduleKey: string): ScopeRow[] => {
    const node = resourceMapper.value[moduleKey];
    if (!node) return [];
    return moduleKey === STREAM_PARENT_KEY
      ? [everyStreamScope(streamTypeKeys())]
      : [typeScope(moduleKey, node)];
  };

  // A parent scope is edited on its own screen, so a drilled level hides it but still names it as the source of any lock.
  const underHiddenParent = (parent: ScopeRow, parentModule: string, own: ScopeRow): ScopeRow[] => {
    const grantsAnything = ACTION_ORDER.some(
      (action) => parent.node && isGranted(parent.node, action),
    );
    return [
      { ...parent, hidden: true },
      grantsAnything
        ? {
            ...own,
            hint: t("iam.editRole.scopeCoveredByParent", {
              scope: parent.label,
              module: moduleLabel(parentModule),
            }),
          }
        : own,
    ];
  };

  // model.fga defines each action on a folder item as `... or <ACTION> from parent`, so a folder grant reaches its items.
  const folderScopes = (moduleKey: string, folder: any): ScopeRow[] => {
    const [moduleScope] = moduleScopes(moduleKey);
    const items = folder.childName ? [folder.childName] : [];
    const thisFolder: ScopeRow = {
      key: `folder-${folder.name}`,
      node: folder,
      resource: moduleKey,
      covers: items,
      label: t("iam.editRole.scopeThisFolder"),
      hint: t("iam.editRole.scopeThisFolderHint"),
    };
    // The type level grant reaches every folder, and through each folder its items.
    return moduleScope
      ? underHiddenParent(
          { ...moduleScope, covers: [...moduleScope.covers, ...items] },
          moduleKey,
          thisFolder,
        )
      : [thisFolder];
  };

  // A stream type is an `_all_` scope in its own right, so everything beneath it inherits both rows.
  const streamTypeScopes = (typeNode: any): ScopeRow[] =>
    underHiddenParent(
      everyStreamScope([typeNode.name]),
      STREAM_PARENT_KEY,
      typeScope(typeNode.name, typeNode),
    );

  return {
    typeScope,
    everyStreamScope,
    streamTypeKeys,
    moduleScopes,
    underHiddenParent,
    folderScopes,
    streamTypeScopes,
  };
};
