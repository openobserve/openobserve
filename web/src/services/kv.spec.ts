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

const fake = vi.hoisted(() => ({ get: vi.fn(async () => ({ data: [] })) }));
vi.mock("./http", () => ({ default: () => fake }));

import kv from "./kv";

describe("kv", () => {
  beforeEach(() => fake.get.mockClear());

  it("lists keys without raising the page's access notice on a 403", async () => {
    await kv.list("org", "starter_pack.");
    expect(fake.get).toHaveBeenCalledWith("/api/org/kv", {
      params: { prefix: "starter_pack." },
      silentForbidden: true,
    });
  });

  it("reads a value without raising the page's access notice on a 403", async () => {
    await kv.get("org", "a/b");
    expect(fake.get).toHaveBeenCalledWith("/api/org/kv/a%2Fb", {
      responseType: "text",
      silentForbidden: true,
    });
  });
});
