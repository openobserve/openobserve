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

const savedViews = {
  get: (org_identifier: string) => {
    const url = `/api/${org_identifier}/savedviews`;
    return http().get(url);
  },
  post: (org_identifier: string, data: any ) => {
    const url = `/api/${org_identifier}/savedviews`;
    return http().post(url, { ...data });
  },
  put: (org_identifier: string, id: string, data: any ) => {
    const url = `/api/${org_identifier}/savedviews/${id}`;
    return http().put(url, { ...data });
  },
  delete: (org_identifier: string, id: string ) => {
    const url = `/api/${org_identifier}/savedviews/${id}`;
    return http().delete(url);
  },
  getViewDetail: (org_identifier: string, id: string) => {
    const url = `/api/${org_identifier}/savedviews/${id}`;
    return http().get(url);
  },
};

export default savedViews;
