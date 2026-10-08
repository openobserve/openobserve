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
import sourcemaps from "./sourcemaps";

vi.mock("./http", () => ({ default: vi.fn() }));
vi.mock("./product_analytics", () => ({ default: { track: vi.fn() } }));

import http from "./http";
import analytics from "./product_analytics";

describe("sourcemaps service analytics", () => {
  let mockHttp: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = { post: vi.fn().mockResolvedValue({ data: {} }) };
    (http as any).mockReturnValue(mockHttp);
  });

  it("tracks sourcemaps_uploaded once the upload succeeds", async () => {
    await sourcemaps.uploadSourceMaps("org", new FormData());
    expect(analytics.track).toHaveBeenCalledWith("sourcemaps_uploaded");
  });

  it("does not track a failed upload and still rejects", async () => {
    mockHttp.post.mockRejectedValue(new Error("boom"));
    await expect(sourcemaps.uploadSourceMaps("org", new FormData())).rejects.toThrow("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });
});
