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
import {
  fullConfigLoad,
  markFullConfigFailed,
  markFullConfigLoaded,
  registerFullConfigLoader,
  reloadFullConfig,
} from "./useFullConfigLoad";

describe("useFullConfigLoad", () => {
  it("registering a loader starts from a clean load state", () => {
    markFullConfigLoaded("a");
    markFullConfigFailed("b");

    const unregister = registerFullConfigLoader(async () => {});

    expect(fullConfigLoad).toEqual({ loadedOrg: "", failedOrg: "" });
    unregister();
  });

  it("reloadFullConfig runs the registered loader and is a no-op once it unregisters", async () => {
    const load = vi.fn(async () => {});
    const unregister = registerFullConfigLoader(load);

    await reloadFullConfig();
    unregister();
    await reloadFullConfig();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("an older layout's unregister does not drop the newer layout's loader", async () => {
    const oldLoad = vi.fn(async () => {});
    const newLoad = vi.fn(async () => {});
    const unregisterOld = registerFullConfigLoader(oldLoad);
    const unregisterNew = registerFullConfigLoader(newLoad);

    unregisterOld();
    await reloadFullConfig();

    expect(newLoad).toHaveBeenCalledTimes(1);
    expect(oldLoad).not.toHaveBeenCalled();
    unregisterNew();
  });

  it("a load for the failed org clears the failure, a load for another org does not", () => {
    const unregister = registerFullConfigLoader(async () => {});
    markFullConfigFailed("a");

    markFullConfigLoaded("b");
    expect(fullConfigLoad.failedOrg).toBe("a");

    markFullConfigLoaded("a");
    expect(fullConfigLoad).toEqual({ loadedOrg: "a", failedOrg: "" });
    unregister();
  });
});
