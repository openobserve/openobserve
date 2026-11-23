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
import { ref } from "vue";

import { fakeFlow } from "@/components/starterPacks/starterPackTestFlow";

import {
  packRowShown,
  packRowState,
  packSetUpCount,
  retrySetUp,
  setUpWithDefaults,
  type PackRowInput,
} from "./packChatRow";

const browser = vi.hoisted(() => ({ markInstalled: vi.fn() }));
vi.mock("./useBrowserMatches", () => ({ useBrowserMatches: () => browser }));

const input = (over: Partial<PackRowInput> = {}): PackRowInput => ({
  view: "offer",
  running: false,
  installed: false,
  interrupted: false,
  runningElsewhere: false,
  forbidden: false,
  installFailed: false,
  failedCount: 0,
  canUndo: false,
  askAdmin: false,
  ...over,
});

describe("packRowState", () => {
  it("offers set up on a matched pack", () => {
    expect(packRowState(input())).toEqual({
      kind: "idle",
      retryCount: 0,
      canUndo: false,
      installFailed: false,
    });
  });

  it("keeps the button after a failed start and says so", () => {
    expect(packRowState(input({ installFailed: true }))).toMatchObject({
      kind: "idle",
      installFailed: true,
    });
  });

  it("shows progress while setting up, even over a stopped record", () => {
    expect(packRowState(input({ running: true, interrupted: true })).kind).toBe("settingUp");
  });

  it("offers nothing while another tab or user runs the setup, even to a refused user", () => {
    expect(packRowState(input({ runningElsewhere: true })).kind).toBe("elsewhere");
    expect(packRowState(input({ runningElsewhere: true, forbidden: true })).kind).toBe("elsewhere");
  });

  it("is ready once set up, with Undo only while the window lasts", () => {
    expect(packRowState(input({ installed: true, view: "installed", canUndo: true }))).toEqual({
      kind: "ready",
      retryCount: 0,
      canUndo: true,
      installFailed: false,
    });
    expect(packRowState(input({ installed: true, canUndo: false })).canUndo).toBe(false);
  });

  it("offers a retry of the failed items on a partial set up", () => {
    expect(packRowState(input({ interrupted: true, failedCount: 2 }))).toMatchObject({
      kind: "failed",
      retryCount: 2,
    });
    expect(packRowState(input({ interrupted: true })).retryCount).toBe(0);
  });

  it("asks for an admin after a refused write, a refused read or when every pack was refused", () => {
    expect(packRowState(input({ forbidden: true })).kind).toBe("forbidden");
    expect(packRowState(input({ view: "forbidden" })).kind).toBe("forbidden");
    expect(packRowState(input({ askAdmin: true })).kind).toBe("forbidden");
    expect(packRowState(input({ forbidden: true, interrupted: true })).kind).toBe("forbidden");
  });
});

describe("packRowShown", () => {
  it("draws offer rows only while the org's offer is live", () => {
    expect(packRowShown("offer", false, true)).toBe(true);
    expect(packRowShown("forbidden", false, true)).toBe(true);
    expect(packRowShown("offer", false, false)).toBe(false);
    expect(packRowShown("forbidden", false, false)).toBe(false);
  });

  it("keeps set up, stopped and running rows after the offer ends", () => {
    expect(packRowShown("installed", false, false)).toBe(true);
    expect(packRowShown("interrupted", false, false)).toBe(true);
    expect(packRowShown("offer", true, false)).toBe(true);
  });

  it("draws nothing for a pack that is not matched or still loading", () => {
    expect(packRowShown("empty", false, true)).toBe(false);
    expect(packRowShown("loading", false, true)).toBe(false);
    expect(packRowShown("error", false, true)).toBe(false);
  });
});

describe("packSetUpCount", () => {
  it("adds the planned items once the preview counted them", () => {
    expect(packSetUpCount(fakeFlow())).toBe(4);
    expect(packSetUpCount(fakeFlow({ alertCount: ref(null) }))).toBeNull();
  });
});

describe("set up actions", () => {
  beforeEach(() => browser.markInstalled.mockClear());

  it("runs the flow's install with every item, alerts off and no destination", async () => {
    const flow = fakeFlow();
    await expect(setUpWithDefaults(flow)).resolves.toBe(true);
    expect(flow.install).toHaveBeenCalledWith(undefined, { exclude: [], enableAlerts: false });
    expect(browser.markInstalled).toHaveBeenCalledWith("kubernetes", "kubernetes");
  });

  it("marks nothing installed when the set up did not finish", async () => {
    const flow = fakeFlow({ install: vi.fn(async () => false) });
    await expect(setUpWithDefaults(flow)).resolves.toBe(false);
    expect(browser.markInstalled).not.toHaveBeenCalled();
  });

  it("retries through the flow's own retry", async () => {
    const flow = fakeFlow();
    await retrySetUp(flow);
    expect(flow.retry).toHaveBeenCalled();
    expect(browser.markInstalled).toHaveBeenCalledWith("kubernetes", "kubernetes");
  });
});
