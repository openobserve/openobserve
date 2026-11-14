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
import { ref, shallowRef } from "vue";

const gate = vi.hoisted(() => ({ on: true }));
const api = vi.hoisted(() => ({ appendToInstall: vi.fn(async () => ({})) }));
vi.mock("@/constants/starterPacks", () => ({
  get STARTER_PACKS_ENABLED() {
    return gate.on;
  },
}));
vi.mock("./useStarterPacks", () => ({
  useStarterPacks: () => ({
    applyUpdates: vi.fn(),
    checkUpdates: vi.fn(async () => []),
    revertUpdates: vi.fn(),
    appendToInstall: api.appendToInstall,
  }),
}));

import type { StarterPackFlow } from "./useStarterPackFlow";
import { usePackUpdates } from "./usePackUpdates";

const flowWith = (licensed: boolean, dashboardId?: string) =>
  ({
    pack: { id: "kubernetes", dashboards: [{ id: "overview" }] },
    licensed: ref(licensed),
    record: shallowRef({
      packId: "kubernetes",
      installId: "i1",
      status: "complete",
      items: [{ kind: "dashboard", itemId: "overview", status: "created", id: dashboardId }],
    }),
    load: vi.fn(async () => {}),
  }) as unknown as StarterPackFlow;

describe("usePackUpdates plan change", () => {
  it("offers the pack dashboard when the plan lost the built-in view and adds it to the same install", async () => {
    gate.on = true;
    const updates = usePackUpdates("org", flowWith(false));
    expect(updates.needsDashboard.value).toBe(true);
    expect(await updates.addDashboard()).toBe(true);
    expect(api.appendToInstall).toHaveBeenCalledWith(expect.anything(), "i1", ["overview"]);
  });

  it("offers nothing while the plan has the view or the install has its dashboard", () => {
    gate.on = true;
    expect(usePackUpdates("org", flowWith(true)).needsDashboard.value).toBe(false);
    expect(usePackUpdates("org", flowWith(false, "d1")).needsDashboard.value).toBe(false);
  });

  it("does nothing with the constant off", async () => {
    gate.on = false;
    api.appendToInstall.mockClear();
    const updates = usePackUpdates("org", flowWith(false));
    expect(updates.needsDashboard.value).toBe(false);
    expect(await updates.addDashboard()).toBe(false);
    expect(api.appendToInstall).not.toHaveBeenCalled();
  });
});
