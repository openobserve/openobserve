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

import http from "./http";

const dashboards = {
  list: (organization: string) => {
    return http().get(
      `/api/${organization}/dashboards`
    );
  },
  create: (organization: string,dashboardID:String,data: any) => {
    return http().post(`/api/${organization}/dashboards/${dashboardID}`, data ,{ headers: { 'Content-Type': 'application/json; charset=UTF-8' }});
  },
  delete: (organization: string,dashboardID:String) => {
    console.log(dashboardID)
    return http().delete(`/api/${organization}/dashboards/${dashboardID}`);
  },
  get_Dashboard: (org_identifier: string) => {
    return http().get(`/api/dashboards/passcode/${org_identifier}`);
  },
  save: (organization: string,dashboardID:String,data: any) => {
    return http().post(`/api/${organization}/dashboards/${dashboardID}`, data ,{ headers: { 'Content-Type': 'application/json; charset=UTF-8' }});
  }

};

export default dashboards;