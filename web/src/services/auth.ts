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

const auth = {
  sign_in_user: (orgIdentifier: string, payload: any) => {
    return http().post(`/auth/${orgIdentifier}/authentication`, payload);
  },
  get_organization_by_username: (userName: string) => {
    return http().get(`/auth/organizarions_by_username/${encodeURIComponent(userName)}`);
  }
};

export default auth;
