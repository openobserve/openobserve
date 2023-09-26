// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import http from "./http";

const dashboards = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    organization: string,
    folder: string
  ) => {
    return http().get(
      `/api/${organization}/dashboards?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}&folder=${folder}`
    );
  },
  create: (organization: string, data: any, folderId? : string) => {
    return http().post(`/api/${organization}/dashboards?folder=${folderId ?? "default"}`, data, { headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
  },
  delete: (organization: string, dashboardID: string) => {
    return http().delete(`/api/${organization}/dashboards/${dashboardID}`);
  },
  get_Dashboard: (org_identifier: string) => {
    return http().get(`/api/dashboards/passcode/${org_identifier}`);
  },
  save: (organization: string, dashboardID: string, data: any) => {
    return http().put(`/api/${organization}/dashboards/${dashboardID}`, data, { headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
  },
  list_Folders: (organization: string) => {
    return http().get(`/api/${organization}/folders`);
  },
  new_Folder: (organization: string, data: any) => {
    return http().post(`/api/${organization}/folders`, data, { headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
  },
  move_Dashboard: (organization: string, data: any) => {
    return http().put(`/api/${organization}/folders/dashboards`, data, { headers: { 'Content-Type': 'application/json; charset=UTF-8' } });
  }

};

export default dashboards;
