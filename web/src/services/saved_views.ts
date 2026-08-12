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
import { defineQuery } from "@/composables/query/queryClient";

const savedViews = {
  get: (org_identifier: string) => {
    const url = `/api/${org_identifier}/savedviews`;
    return http().get(url);
  },
  post: (org_identifier: string, data: any) => {
    const url = `/api/${org_identifier}/savedviews`;
    return http().post(url, { ...data });
  },
  put: (org_identifier: string, id: string, data: any) => {
    const url = `/api/${org_identifier}/savedviews/${id}`;
    return http().put(url, { ...data });
  },
  delete: (org_identifier: string, id: string) => {
    const url = `/api/${org_identifier}/savedviews/${id}`;
    return http().delete(url);
  },
  getViewDetail: (org_identifier: string, id: string) => {
    const url = `/api/${org_identifier}/savedviews/${id}`;
    return http().get(url);
  },
};

export default savedViews;

export const savedViewsQuery = defineQuery<[], any[]>({
  key: ["search", "savedViews"],
  fetch: async (org) => (await savedViews.get(org)).data?.views ?? [],
  refetchOnWindowFocus: true,
  scope: ["search", "savedViews"],
});
