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

/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";
import config from "../aws-exports";

const users = {
  list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string
  ) => {
    return http().get(
      `/api/users?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
    );
  },
  create: (data: any, org_identifier: string) => {
    return http().post(`/api/${org_identifier}/users`, data);
  },
  update: (data: any, org_identifier: string, user_email: string) => {
    return http().put(`/api/${org_identifier}/users/${user_email}`, data);
  },
  updateexistinguser: (
    data: any,
    org_identifier: string,
    user_email: string
  ) => {
    return http().post(`/api/${org_identifier}/users/${user_email}`, data);
  },
  delete: (org_identifier: string, user_email: string) => {
    return http().delete(`/api/${org_identifier}/users/${user_email}`);
  },
  verifyUser: (email: string) => {
    return http().get(`/api/users/verifyuser/${email}`);
  },
  addNewUser: (data: any) => {
    return http().post(`/api/users/new_user`, data);
  },
  orgUsers: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    org_identifier: string
  ) => {
    if (config.isCloud === "true") {
      return http().get(
        `/api/${org_identifier}/org_users?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`
      );
    } else {
      return http().get(`/api/${org_identifier}/users`);
    }
  },
  getRefreshToken: () => {
    return http().get(`/api/auth/refresh_token`);
  },
};

export default users;
