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

/** One entry of the server's SQL function catalog. */
export interface ServerQueryFunction {
  name: string;
  signature?: string;
  doc?: string;
  kind?: string;
  deprecated?: boolean;
}

const queryFunctions = {
  /**
   * The functions this organisation can actually call: the DataFusion registry,
   * the O2 UDFs, the SQL-rewriter aliases and the org's own VRL transforms.
   *
   * Served by the backend rather than hand-maintained in the frontend, which is
   * the only way the list can track the pinned DataFusion fork, build features
   * and per-org transforms.
   */
  list: (org_identifier: string) => {
    return http().get(`/api/${encodeURIComponent(org_identifier)}/query_functions`);
  },
};

export default queryFunctions;
