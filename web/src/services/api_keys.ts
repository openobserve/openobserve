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

const apiKeys = {
  list: () => {
    return http().get(`/api/api_keys`);
  },
  listRUMTokens: (org_id: string) => {
    return http().get(`/api/${org_id}/organizations/rumtoken`);
  },
  createUserAPIKey: (data: object) => {
    return http().post(`/api/user_api_key`, data);
  },
  createRUMToken: (org_id: string) => {
    return http().post(`/api/${org_id}/organizations/rumtoken`);
  },
  updateRUMToken: (org_id: string, id: string) => {
    return http().put(`/api/${org_id}/organizations/rumtoken`);
  },
  deleteUserAPIKey: (id: string) => {
    return http().delete(`/api/api_key/${id}`);
  },
};

export default apiKeys;
