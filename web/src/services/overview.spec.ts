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

import { describe, expect, it, vi } from "vitest";
import overview from "./overview";

const get = vi.fn().mockResolvedValue({ data: {} });
vi.mock("./http", () => ({ default: () => ({ get }) }));

describe("overview service", () => {
  it("requests the org overview and keeps a 403 out of the access toast", async () => {
    await overview.getOrgOverview("acme", { top: 5, refresh: true });
    expect(get).toHaveBeenCalledWith("/api/acme/overview", {
      params: { top: 5, refresh: true },
      silentForbidden: true,
    });
  });

  it("omits refresh and top when not asked", async () => {
    await overview.getOrgOverview("acme");
    expect(get).toHaveBeenLastCalledWith("/api/acme/overview", {
      params: {},
      silentForbidden: true,
    });
  });
});
