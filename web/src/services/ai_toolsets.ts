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

export type ToolsetKind = "mcp" | "cli" | "skill" | "generic";

export interface ToolsetCreateRequest {
  name: string;
  kind: ToolsetKind;
  description?: string;
  data?: Record<string, any>;
}

export interface ToolsetUpdateRequest {
  description?: string;
  data?: Record<string, any>;
}

const aiToolsets = {
  list: (org_identifier: string, params?: { name?: string; kind?: string; limit?: number }) => {
    return http().get(`/api/${org_identifier}/ai/toolsets`, { params });
  },
  get: (org_identifier: string, id: string) => {
    return http().get(`/api/${org_identifier}/ai/toolsets/${id}`);
  },
  create: (org_identifier: string, data: ToolsetCreateRequest) => {
    return http().post(`/api/${org_identifier}/ai/toolsets`, data);
  },
  update: (org_identifier: string, id: string, data: ToolsetUpdateRequest) => {
    return http().put(`/api/${org_identifier}/ai/toolsets/${id}`, data);
  },
  delete: (org_identifier: string, id: string) => {
    return http().delete(`/api/${org_identifier}/ai/toolsets/${id}`);
  },
};

export default aiToolsets;
