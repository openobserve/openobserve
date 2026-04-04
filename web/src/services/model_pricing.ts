// Copyright 2026 OpenObserve Inc.
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

const modelPricing = {
  list: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/llm/models`);
  },
  get: (org_identifier: string, model_id: string) => {
    return http().get(`/api/${org_identifier}/llm/models/${model_id}`);
  },
  create: (org_identifier: string, data: any) => {
    return http().post(`/api/${org_identifier}/llm/models`, data);
  },
  update: (org_identifier: string, model_id: string, data: any) => {
    return http().put(`/api/${org_identifier}/llm/models/${model_id}`, data);
  },
  delete: (org_identifier: string, model_id: string) => {
    return http().delete(`/api/${org_identifier}/llm/models/${model_id}`);
  },
  getBuiltIn: (org_identifier: string, search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : "";
    return http().get(`/api/${org_identifier}/llm/models/built-in${params}`);
  },
  refreshBuiltIn: (org_identifier: string) => {
    return http().post(`/api/${org_identifier}/llm/models/refresh-built-in`, {});
  },
};

export default modelPricing;
