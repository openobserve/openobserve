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

const template = {
  create: ({ org_identifier, template_name, data }: any) => {
    return http().post(
      `/api/${org_identifier}/alerts/templates/${template_name}`,
      data
    );
  },
  list: ({ org_identifier }: any) => {
    return http().get(`/api/${org_identifier}/alerts/templates`);
  },
  get_by_name: ({ org_identifier, template_name }: any) => {
    return http().get(
      `/api/${org_identifier}/alerts/templates/${template_name}`
    );
  },
  delete: ({ org_identifier, template_name }: any) => {
    return http().delete(
      `/api/${org_identifier}/alerts/templates/${template_name}`
    );
  },
};

export default template;
