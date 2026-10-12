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

import aiToolsets from "./ai_toolsets";
import http from "./http";
import analytics from "./product_analytics";

vi.mock("./http", () => {
  const mockClient = { post: vi.fn() };
  return { default: vi.fn(() => mockClient) };
});
vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

describe("aiToolsets.create", () => {
  const client = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tracks the toolset kind once the server confirms", async () => {
    client.post.mockResolvedValue({ data: {} });

    await aiToolsets.create("default", { name: "t", kind: "mcp" });

    expect(analytics.track).toHaveBeenCalledWith("ai_toolset_created", { kind: "mcp" });
  });

  it("does not track a rejected create", async () => {
    client.post.mockRejectedValue(new Error("boom"));

    await expect(aiToolsets.create("default", { name: "t", kind: "mcp" })).rejects.toThrow("boom");

    expect(analytics.track).not.toHaveBeenCalled();
  });
});
