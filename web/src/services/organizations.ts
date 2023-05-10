// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";
import config from "../aws-exports";

const organizations = {
  os_list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    org_identifier: string
  ) => {
    if (config.isZincObserveCloud === "true") {
      return http().get(
        `/api/organizations?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
      );
    } else {
      return http().get(
        `/api/${org_identifier}/organizations?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
      );
    }
  },
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string
  ) => {
    return http().get(
      `/api/organizations?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  create: (data: any) => {
    return http().post("/api/organizations", data);
  },
  add_members: (data: any, orgIdentifier: string) => {
    return http().post(`api/${orgIdentifier}/organizations/members`, data);
  },
  process_subscription: (s: string, action: string) => {
    return http().get(
      `api/organizations/member_subscription/${s}?action=${action}`
    );
  },
  get_associated_members: (orgIdentifier: string) => {
    return http().get(`api/${orgIdentifier}/organizations/associated_members`);
  },
  update_member_role: (data: any, orgIdentifier: string) => {
    return http().put(`api/${orgIdentifier}/users/${data.email}`, data);
  },
  verify_identifier: (name: string) => {
    return http().get(`api/organizations/verify_identifier/${name}`);
  },
  get_organization_passcode: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/organizations/passcode`);
  },
  update_organization_passcode: (orgIdentifier: string) => {
    return http().put(`api/${orgIdentifier}/organizations/passcode`, {});
  },
  get_organization_summary: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/summary`);
  },
};

export default organizations;
