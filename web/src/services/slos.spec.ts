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

import { describe, expect, it, beforeEach, vi } from "vitest";
import slos from "@/services/slos";
import http from "@/services/http";
import analytics from "@/services/product_analytics";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/services/http", () => ({
  default: vi.fn(),
}));

describe("slos service product analytics", () => {
  let mockHttpInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    (http as any).mockReturnValue(mockHttpInstance);
  });

  const cases: Array<[string, string, () => Promise<unknown>, unknown[]]> = [
    [
      "create",
      "post",
      () => slos.create("org1", { sli_type: "count" }),
      ["slo_created", { sli_type: "count" }],
    ],
    [
      "update",
      "put",
      () => slos.update("org1", "s1", { sli_type: "alert" }),
      ["slo_updated", { sli_type: "alert" }],
    ],
    ["delete", "delete", () => slos.delete("org1", "s1"), ["slo_deleted", { count: 1 }]],
    [
      "setEnabled enable",
      "put",
      () => slos.setEnabled("org1", "s1", true),
      ["slo_enabled", { count: 1 }],
    ],
    [
      "setEnabled disable",
      "put",
      () => slos.setEnabled("org1", "s1", false),
      ["slo_disabled", { count: 1 }],
    ],
  ];

  it.each(cases)("%s tracks once the request resolves", async (_label, verb, call, args) => {
    const response = { data: {} };
    mockHttpInstance[verb].mockResolvedValue(response);

    await expect(call()).resolves.toBe(response);

    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith(...args);
  });

  it.each(cases)("%s does not track when the request rejects", async (_label, verb, call) => {
    mockHttpInstance[verb].mockRejectedValue(new Error("boom"));

    await expect(call()).rejects.toThrow("boom");

    expect(analytics.track).not.toHaveBeenCalled();
  });

  it.each(cases)("%s does not track an error carried in a 200 body", async (_label, verb, call) => {
    mockHttpInstance[verb].mockResolvedValue({ data: { code: 400, message: "bad" } });

    await expect(call()).rejects.toThrow("bad");

    expect(analytics.track).not.toHaveBeenCalled();
  });
});
