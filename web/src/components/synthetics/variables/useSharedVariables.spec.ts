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

const service = vi.hoisted(() => ({
  listEnvironments: vi.fn(),
  listGlobalVariables: vi.fn(),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));
vi.mock("@/services/synthetics", () => ({ default: service }));

import { useSharedVariables } from "./useSharedVariables";

describe("useSharedVariables", () => {
  beforeEach(() => {
    service.listEnvironments.mockReset();
    service.listGlobalVariables.mockReset();
  });

  it("keeps the open global list when listing environments is refused", async () => {
    service.listEnvironments.mockRejectedValue({ response: { status: 403 } });
    service.listGlobalVariables.mockResolvedValue({ data: [{ name: "BASE_URL" }] });

    const shared = useSharedVariables();
    await shared.refresh();

    expect(shared.environments.value).toEqual([]);
    expect(shared.globals.value.map((v) => v.name)).toEqual(["BASE_URL"]);
    expect(shared.loaded.value).toBe(true);
  });

  it("reports nothing loaded when both lists fail", async () => {
    service.listEnvironments.mockRejectedValue(new Error("down"));
    service.listGlobalVariables.mockRejectedValue(new Error("down"));

    const shared = useSharedVariables();
    await shared.refresh();

    expect(shared.globals.value).toEqual([]);
    expect(shared.loaded.value).toBe(false);
  });
});
