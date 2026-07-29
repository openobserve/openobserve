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

const slos = {
  list: (org_identifier: string, folder?: string) => {
    const q = folder ? `?folder=${encodeURIComponent(folder)}` : "";
    return http().get(`/api/${org_identifier}/slos${q}`);
  },

  get: (org_identifier: string, slo_id: string) => {
    return http().get(`/api/${org_identifier}/slos/${slo_id}`);
  },

  create: (org_identifier: string, data: object) => {
    return http().post(`/api/${org_identifier}/slos`, data);
  },

  update: (org_identifier: string, slo_id: string, data: object) => {
    return http().put(`/api/${org_identifier}/slos/${slo_id}`, data);
  },

  delete: (org_identifier: string, slo_id: string) => {
    return http().delete(`/api/${org_identifier}/slos/${slo_id}`);
  },

  // Separate from update so a relocation can never carry a definition change,
  // which would bump the SLO's generation and discard its measurement.
  move: (org_identifier: string, slo_ids: string[], dst_folder_id: string) => {
    return http().post(`/api/${org_identifier}/slos/move`, {
      slo_ids,
      dst_folder_id,
    });
  },

  // Separate from update so pausing can never carry a definition change with
  // it — and therefore can never bump the generation or discard measurement.
  setEnabled: (org_identifier: string, slo_id: string, value: boolean) => {
    return http().put(`/api/${org_identifier}/slos/${slo_id}/enable?value=${value}`);
  },

  groups: (org_identifier: string, slo_id: string) => {
    return http().get(`/api/${org_identifier}/slos/${slo_id}/groups`);
  },
};

export default slos;
