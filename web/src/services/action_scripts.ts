// Copyright 2023 OpenObserve Inc.
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

const actions = {
  create: (org_identifier: string, action_id: string = "", data: any) => {
    return http().post(`/api/${org_identifier}/actions/upload`, data);
  },
  update: (org_identifier: string, action_id: string, data: any) => {
    return http().put(`/api/${org_identifier}/actions/${action_id}`, data);
  },
  //as backend is not supporting the pagination,  page no, desc so as of now we removed it
  list: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/actions`);
  },
  get_by_id: (org_identifier: string, ksuid: string) => {
    return http().get(
      `/api/${org_identifier}/actions/${encodeURIComponent(ksuid)}`,
    );
  },
  delete: (org_identifier: string, action_id: string) => {
    return http().delete(
      `/api/${org_identifier}/actions/${encodeURIComponent(action_id)}`,
    );
  },
  bulkDelete: (org_identifier: string, data: any) => {
    return http().delete(`/api/${org_identifier}/actions/bulk`, { data });
  },
};

export default actions;
