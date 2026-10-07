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

import { queryOptions } from "@tanstack/vue-query";
import common from "./common";
import type { Folder } from "./common";
import { folderKeys, nodeKeys } from "./common.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";

const DEFAULT_FOLDER: Folder = { name: "default", folderId: "default", description: "default" };

/** "default" first, then the rest alphabetically — the order the sidebar expects. */
const normalizeFolders = (list: Folder[]): Folder[] => {
  const defaultFolder = list.find((f) => f.folderId === "default") ?? DEFAULT_FOLDER;
  const rest = list
    .filter((f) => f.folderId !== "default")
    .sort((a, b) => a.name.localeCompare(b.name));
  return [defaultFolder, ...rest];
};

/** Needed before the sidebar can paint on Dashboards, Alerts, Reports and Synthetics. */
export const foldersQuery = (org: string, type: string) =>
  queryOptions({
    queryKey: folderKeys.list(org, type),
    queryFn: async (): Promise<Folder[]> =>
      normalizeFolders((await common.list_Folders(org, type)).data.list ?? []),
    staleTime: NORMAL_STALE_TIME,
  });

/** The folders as the server lists them for this user, without the injected "default". */
export const permittedFoldersQuery = (org: string, type: string) =>
  queryOptions({
    queryKey: folderKeys.permitted(org, type),
    queryFn: async (): Promise<Folder[]> =>
      ((await common.list_Folders(org, type)).data.list ?? []) as Folder[],
    staleTime: NORMAL_STALE_TIME,
  });

/** A module's folders for a page that works without that module; `forbidden` is a 403. */
export interface OptionalFolders {
  folders: Folder[];
  forbidden: boolean;
}

/** Like `foldersQuery`, but a 403 means no access to the module: no toast, and no error. */
export const optionalFoldersQuery = (org: string, type: string) =>
  queryOptions({
    queryKey: folderKeys.optional(org, type),
    queryFn: async (): Promise<OptionalFolders> => {
      try {
        const res = await common.list_Folders(org, type, { skipAccessToast: true });
        return { folders: normalizeFolders(res.data.list ?? []), forbidden: false };
      } catch (err: any) {
        if (err?.response?.status === 403) return { folders: [], forbidden: true };
        throw err;
      }
    },
    staleTime: NORMAL_STALE_TIME,
  });

export const nodesQuery = (org: string) =>
  queryOptions({
    queryKey: nodeKeys.list(org),
    queryFn: async () => (await common.list_nodes(org)).data,
    staleTime: NORMAL_STALE_TIME,
  });
