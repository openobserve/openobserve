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

const syslogService = {
  // To start/stop syslog route
  toggle: (org_identifier: string, data: any) => {
    return http().post(`/api/${org_identifier}/syslog-server`, data);
  },
  list: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/syslog-routes`);
  },
  create: (org_identifier: string, data: any) => {
    return http().post(`/api/${org_identifier}/syslog-routes`, data);
  },
  update: (org_identifier: string, routeId: string, data: any) => {
    return http().put(`/api/${org_identifier}/syslog-routes/${routeId}`, data);
  },
  delete: (org_identifier: string, routeId: string) => {
    return http().delete(`/api/${org_identifier}/syslog-routes/${routeId}`);
  },
};

export default syslogService;
