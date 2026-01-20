// Copyright 2023 OpenObserve Inc.
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

import http from "./http";

const dashboards = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    organization: string,
    folderId: string,
    title: string
  ) => {
    const params: any = {
      page_num,
      page_size,
      sort_by,
      desc,
      name,
    };
    if (folderId) {
      params.folder = folderId;
    }
    // Only add title if it is provided
    if (title) {
      params.title = title;
    }
    return http().get(`/api/${organization}/dashboards`, { params });
  },
  create: (organization: string, data: any, folderId?: string) => {
    return http().post(
      `/api/${organization}/dashboards?folder=${folderId ?? "default"}`,
      data,
      { headers: { "Content-Type": "application/json; charset=UTF-8" } }
    );
  },
  delete: (organization: string, dashboardID: string, folderId?: string) => {
    return http().delete(
      `/api/${organization}/dashboards/${dashboardID}?folder=${folderId ?? "default"
      }`
    );
  },
  bulkDelete: (organization: string, data: any, folder?: string) => {
    let url = `/api/${organization}/dashboards/bulk`;
    if (folder) {
      url += `?folder=${folder}`;
    }
    return http().delete(url, { data });
  },
  get_Dashboard: (org_identifier: string, dashboardID: string, folderId?: string) => {
    return http().get(`/api/${org_identifier}/dashboards/${dashboardID}?folder=${folderId ?? "default"}`);
  },
  save: (
    organization: string,
    dashboardID: string,
    data: any,
    folderId?: string,
    hash?: any
  ) => {
    return http().put(
      `/api/${organization}/dashboards/${dashboardID}?folder=${folderId ?? "default"
      }&hash=${hash}`,
      data,
      { headers: { "Content-Type": "application/json; charset=UTF-8" } }
    );
  },
  list_Folders: (organization: string) => {
    return http().get(`/api/v2/${organization}/folders/dashboards`);
  },
  new_Folder: (organization: string, data: any) => {
    return http().post(`/api/v2/${organization}/folders/dashboards`, data, {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    });
  },
  edit_Folder: (organization: string, folderId: any, data: any) => {
    return http().put(`/api/v2/${organization}/folders/dashboards/${folderId}`, data, {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    });
  },
  delete_Folder: (organization: string, folderId: any) => {
    return http().delete(`/api/v2/${organization}/folders/dashboards/${folderId}`);
  },
  move_Dashboard: (organization: string, dashboardIds: string[], from: string, dstFolderId: string) => {
    return http().patch(
      `/api/${organization}/dashboards/move?folder=${from}`,
      {
        "dashboard_ids": dashboardIds,
        "dst_folder_id": dstFolderId
      },
      { headers: { "Content-Type": "application/json; charset=UTF-8" } }
    );
  },
};

export default dashboards;
