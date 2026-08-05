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

import commonService from "@/services/common";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";
import { useOrgQuery } from "../useOrgQuery";

export interface Folder {
  folderId: string;
  name: string;
  description?: string;
  [extra: string]: unknown;
}

const DEFAULT_FOLDER: Folder = {
  name: "default",
  folderId: "default",
  description: "default",
};

/** "default" first, then the rest alphabetically — the order the sidebar expects. */
const normalizeFolders = (list: Folder[]): Folder[] => {
  const defaultFolder = list.find((f) => f.folderId === "default") ?? DEFAULT_FOLDER;
  const rest = list
    .filter((f) => f.folderId !== "default")
    .sort((a, b) => a.name.localeCompare(b.name));
  return [defaultFolder, ...rest];
};

export const foldersByTypeQueryOptions = (org: string, type: string) => ({
  queryKey: qk.folders.byType(org, type),
  queryFn: async (): Promise<Folder[]> =>
    normalizeFolders((await commonService.list_Folders(org, type)).data.list ?? []),
  ...tierOptions("ORG_CONFIG"),
});

/**
 * Imperative read for the many call sites that are not in a `setup()` — returns
 * cached folders when they are still fresh, otherwise fetches once and shares
 * that request with every concurrent caller.
 */
export const fetchFoldersByType = (org: string, type: string): Promise<Folder[]> =>
  queryClient.fetchQuery(foldersByTypeQueryOptions(org, type));

export const invalidateFolders = (org: string, type?: string) =>
  queryClient.invalidateQueries({
    queryKey: type ? qk.folders.byType(org, type) : qk.folders.root(org),
  });

export const useFoldersByType = (type: string) =>
  useOrgQuery<Folder[]>({
    key: (org) => qk.folders.byType(org, type),
    fetch: (org) => foldersByTypeQueryOptions(org, type).queryFn(),
    tier: "ORG_CONFIG",
  });
