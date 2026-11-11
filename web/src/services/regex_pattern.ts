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
import analytics from "./product_analytics";
type PatternPayload = {
  name: string;
  pattern: string;
  description: string;
};
const regexPatterns = {
  list: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/re_patterns`);
  },
  create: (org_identifier: string, payload: PatternPayload) => {
    return http()
      .post(`/api/${org_identifier}/re_patterns`, payload)
      .then((res) => {
        analytics.track("regex_pattern_created");
        return res;
      });
  },
  update: (org_identifier: string, id: string, payload: any) => {
    return http()
      .put(`/api/${org_identifier}/re_patterns/${id}`, payload)
      .then((res) => {
        analytics.track("regex_pattern_updated");
        return res;
      });
  },
  delete: (org_identifier: string, id: string) => {
    return http()
      .delete(`/api/${org_identifier}/re_patterns/${id}`)
      .then((res) => {
        analytics.track("regex_pattern_deleted", { count: 1 });
        return res;
      });
  },
  bulkDelete: (org_identifier: string, data: any) => {
    return http()
      .delete(`/api/${org_identifier}/re_patterns/bulk`, { data })
      .then((res) => {
        const count = res.data?.successful?.length ?? 0;
        if (count > 0) analytics.track("regex_pattern_deleted", { count });
        return res;
      });
  },
  test: (org_identifier: string, pattern: string, test_records: Array<string>, policy?: string) => {
    const payload: any = { pattern, test_records };
    if (policy) {
      payload.policy = policy;
    }
    return http()
      .post(`/api/${org_identifier}/re_patterns/test`, payload)
      .then((res) => {
        analytics.track("regex_pattern_tested", { with_policy: !!policy });
        return res;
      });
  },
  getBuiltInPatterns: (
    org_identifier: string,
    params?: {
      search?: string;
      tags?: string[];
    },
  ) => {
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append("search", params.search);
    if (params?.tags) params.tags.forEach((tag) => queryParams.append("tags", tag));

    const queryString = queryParams.toString();
    const url = `/api/${org_identifier}/re_patterns/built-in${queryString ? "?" + queryString : ""}`;

    return http().get(url);
  },
};

export default regexPatterns;
