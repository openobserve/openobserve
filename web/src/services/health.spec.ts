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

const get = vi.fn();
vi.mock("./http", () => ({ default: () => ({ get }) }));

import { pingBackend } from "./health";

describe("pingBackend", () => {
  it("asks /healthz with a short timeout and never lets a status reject", async () => {
    get.mockResolvedValue({ status: 200 });
    await expect(pingBackend()).resolves.toBe(true);
    const [url, config] = get.mock.calls[0];
    expect(url).toBe("/healthz");
    expect(config.timeout).toBe(5000);
    expect(config.validateStatus(503)).toBe(true);
  });

  it("counts any non-5xx answer as reachable", async () => {
    get.mockResolvedValue({ status: 404 });
    await expect(pingBackend()).resolves.toBe(true);
  });

  it("counts a 5xx as down", async () => {
    get.mockResolvedValue({ status: 502 });
    expect(await pingBackend()).toBe(false);
  });

  it("counts a network failure as down", async () => {
    get.mockImplementation(async () => {
      throw new TypeError("offline");
    });
    expect(await pingBackend()).toBe(false);
  });
});
