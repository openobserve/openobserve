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

const regexPatterns = {
  list: (
    org_identifier: string
  ) => {
    return http().get(
      `/api/${org_identifier}/re_patterns`
    );
  },
  create: (
    org_identifier: string,
    name: string,
    pattern: string,
  ) => {
    return http().post(
      `/api/${org_identifier}/re_patterns`,
      {
        name,
        pattern,
      }
    );
  },
  update: (
    org_identifier: string,
    id: string,
    name: string,
    pattern: string,
  ) => {
    return http().put(
      `/api/${org_identifier}/re_patterns/${id}`,
      {
        name,
        pattern,
      }
    );
  },
  delete: (
    org_identifier: string,
    id: string,
  ) => {
    return http().delete(
      `/api/${org_identifier}/re_patterns/${id}`
    );
  }
};

export default regexPatterns;
