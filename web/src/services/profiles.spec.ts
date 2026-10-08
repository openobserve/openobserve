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
import profiles from "@/services/profiles";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/services/http", () => ({
  default: () => ({
    get: mocks.get,
    post: mocks.post,
  }),
}));

describe("profiles service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ data: { tag: "process_name", values: [], took: 0 } });
  });

  it("percent-encodes commas inside tag filter values", async () => {
    await profiles.tagValues("default", "profiles", {
      start_time: 1,
      end_time: 2,
      tag: "process_name",
      filters: [{ key: "k8s_pod_name", op: "=", value: "a,b" }],
    });

    const url = mocks.get.mock.calls[0][0] as string;
    const filters = new URL(url, "http://local").searchParams.get("filters");
    expect(filters).toBe("k8s_pod_name=a%2Cb");
  });
});
