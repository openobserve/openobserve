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

import { describe, it, expect, vi, beforeEach } from "vitest";

const getSemanticGroupsMock = vi.fn();
vi.mock("@/services/service_streams", () => ({
  default: { getSemanticGroups: (org: string) => getSemanticGroupsMock(org) },
}));

import { loadSemanticGroups, clearSemanticGroupsCache } from "./semanticGroupsCache";

describe("semanticGroupsCache — concurrent failure reporting", () => {
  beforeEach(() => {
    clearSemanticGroupsCache();
    getSemanticGroupsMock.mockReset();
  });

  it("reports the failure to EVERY concurrent caller, not just the originator", async () => {
    // A second caller short-circuits onto the in-flight promise. It used to get
    // `[]` with no error signal — indistinguishable from "this org genuinely has
    // no groups" — so it raised a false groups-missing warning AND never added
    // the org to its 403 negative cache, defeating "exactly one 403 per session".
    const err: any = new Error("forbidden");
    err.response = { status: 403 };
    // Deferred one microtask so both callers are attached before it settles —
    // the second must land on the SAME in-flight promise, which is the seam.
    getSemanticGroupsMock.mockImplementation(
      () => new Promise((_resolve, rej) => setTimeout(() => rej(err), 0)),
    );

    const firstErrors: any[] = [];
    const secondErrors: any[] = [];
    const first = loadSemanticGroups("org-a", (e) => firstErrors.push(e));
    const second = loadSemanticGroups("org-a", (e) => secondErrors.push(e));

    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(firstErrors).toHaveLength(1);
    expect(secondErrors).toHaveLength(1);
    // The SAME failure, so both callers classify the 403 identically.
    expect(secondErrors[0]?.response?.status).toBe(403);
    // ...and one request served both.
    expect(getSemanticGroupsMock).toHaveBeenCalledTimes(1);
  });

  it("a successful shared request reports NO error to either caller", async () => {
    // Paired with the case above so it cannot pass by always invoking onError.
    const groups = [{ id: "host", display: "Host", fields: ["host_name"] }];
    getSemanticGroupsMock.mockResolvedValue({ data: groups });

    const firstErrors: any[] = [];
    const secondErrors: any[] = [];
    const [a, b] = await Promise.all([
      loadSemanticGroups("org-b", (e) => firstErrors.push(e)),
      loadSemanticGroups("org-b", (e) => secondErrors.push(e)),
    ]);

    expect(a).toEqual(groups);
    expect(b).toEqual(groups);
    expect(firstErrors).toEqual([]);
    expect(secondErrors).toEqual([]);
  });
});
