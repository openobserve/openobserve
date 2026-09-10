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

export interface SearchResourcesParams {
  q: string;
  /** Comma-separated resource types; every type when omitted. */
  types?: string;
  /** Rows per type, 1 to 100. */
  limit?: number;
}

const resources = {
  search: (org_identifier: string, params: SearchResourcesParams, signal?: AbortSignal) => {
    const url = `/api/${org_identifier}/resources/_search`;
    return signal ? http().get(url, { params, signal }) : http().get(url, { params });
  },
};

export default resources;
