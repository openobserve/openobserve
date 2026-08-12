import http from "./http";
import { defineQuery } from "@/composables/query/queryClient";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

const common = {
  list_Folders: (organization: string, folder_type: string) => {
    return http().get(`/api/v2/${organization}/folders/${folder_type}`);
  },
  new_Folder: (organization: string, folder_type: string, data: any) => {
    return http().post(`/api/v2/${organization}/folders/${folder_type}`, data, {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    });
  },
  edit_Folder: (organization: string, folder_type: string, folderId: any, data: any) => {
    return http().put(`/api/v2/${organization}/folders/${folder_type}/${folderId}`, data, {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    });
  },
  delete_Folder: (organization: string, folder_type: string, folderId: any) => {
    return http().delete(`/api/v2/${organization}/folders/${folder_type}/${folderId}`);
  },
  get_Folder: (organization: string, folder_type: string, folderId: any) => {
    return http().get(`/api/v2/${organization}/folders/${folder_type}/${folderId}`);
  },
  move_across_folders: (organization: string, type: string, data: any, folder_id?: any) => {
    let url = `/api/v2/${organization}/${type}/move`;
    if (folder_id) {
      url += `?folder=${folder_id}`;
    }
    return http().patch(url, data);
  },
  list_nodes: (organization: string) => {
    const url = `/api/${organization}/node/list`;
    return http().get(url);
  },
};

export default common;

export interface Folder {
  folderId: string;
  name: string;
  description?: string;
  [extra: string]: unknown;
}

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
export const foldersQuery = defineQuery<[type: string], Folder[]>({
  key: (type) => ["folders", type],
  fetch: async (org, type) =>
    normalizeFolders((await common.list_Folders(org, type)).data.list ?? []),
  staleTime: CONFIG_STALE_TIME,
  gcTime: LONG_GC_TIME,
  persister: localStoragePersister,
  scope: ["folders"],
});

export const nodesQuery = defineQuery<[], any>({
  key: ["settings", "nodes"],
  fetch: async (org) => (await common.list_nodes(org)).data,
  // Not persisted: stale cluster state is more confusing than a second of loading.
  staleTime: CONFIG_STALE_TIME,
  gcTime: LONG_GC_TIME,
  scope: ["settings", "nodes"],
});
