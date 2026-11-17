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

import { beforeEach, describe, expect, it, vi } from "vitest";
import http from "@/services/http";
import analytics from "@/services/product_analytics";
import orgStorage from "@/services/org_storage";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/http", () => ({ default: vi.fn() }));
vi.mock("@/stores", () => ({
  default: { state: { selectedOrganization: { identifier: "meta" } } },
}));

describe("org_storage analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(http).mockReturnValue({
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
    } as any);
  });

  it("tracks create and update with the provider, and enable", async () => {
    await orgStorage.create("o", { provider: "s3", data: {} });
    await orgStorage.update("o", { provider: "gcs", data: {} });
    await orgStorage.enable("o");

    expect(vi.mocked(analytics.track).mock.calls).toEqual([
      ["storage_settings_created", { provider: "s3" }],
      ["storage_settings_updated", { provider: "gcs" }],
      ["storage_settings_enabled"],
    ]);
  });
});
