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
import modelPricing from "@/services/model_pricing";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/http", () => ({ default: vi.fn() }));

describe("model_pricing analytics", () => {
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = {
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    vi.mocked(http).mockReturnValue(client as any);
  });

  it("tracks create, update, delete and built-in refresh on success", async () => {
    await modelPricing.create("o", {});
    await modelPricing.update("o", "m", {});
    await modelPricing.delete("o", "m");
    await modelPricing.refreshBuiltIn("o");

    expect(vi.mocked(analytics.track).mock.calls).toEqual([
      ["model_pricing_created"],
      ["model_pricing_updated"],
      ["model_pricing_deleted"],
      ["model_pricing_built_in_refreshed"],
    ]);
  });

  it("does not track the match test, which runs as the user types", async () => {
    await modelPricing.test("o", { model_name: "gpt" });

    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("does not track a failed delete", async () => {
    client.delete.mockRejectedValue(new Error("boom"));

    await expect(modelPricing.delete("o", "m")).rejects.toThrow("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
