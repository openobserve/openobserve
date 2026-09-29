// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getServicesListMock = vi.fn();
vi.mock("@/services/service_streams", () => ({
  default: { getServicesList: (org: string) => getServicesListMock(org) },
}));

import { queryClient } from "@/composables/query/queryClient";
import { servicesListQuery } from "./service_streams.queries";

describe("servicesListQuery", () => {
  const rows = [{ service_name: "checkout", set_id: "k8s", disambiguation: {} }];

  beforeEach(() => {
    getServicesListMock.mockReset();
  });

  // Two orgs, so the second read cannot be served from the first one's cache entry.
  it("unwraps the `{ list }` envelope and a bare array to the same rows", async () => {
    getServicesListMock.mockResolvedValueOnce({ data: { list: rows } });
    getServicesListMock.mockResolvedValueOnce({ data: rows });

    const wrapped = await queryClient.fetchQuery(servicesListQuery("org-a"));
    const bare = await queryClient.fetchQuery(servicesListQuery("org-b"));

    expect(wrapped).toEqual(rows);
    expect(bare).toEqual(rows);
    expect(getServicesListMock).toHaveBeenCalledTimes(2);
  });
});
