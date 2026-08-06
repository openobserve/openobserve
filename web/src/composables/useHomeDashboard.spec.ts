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

vi.mock("@/services/settings", () => ({
  default: {
    getSetting: vi.fn(),
    setOrgSetting: vi.fn(),
    deleteOrgSetting: vi.fn(),
  },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import settings from "@/services/settings";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useHomeDashboard } from "@/composables/useHomeDashboard";

const D = { dashboardId: "abc", folderId: "default", label: "Payments" };

describe("useHomeDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHomeDashboard().homeDashboard.value = null; // reset shared state
  });

  it("load populates the ref from getSetting.setting_value", async () => {
    (settings.getSetting as any).mockResolvedValue({ data: { setting_value: D } });
    const { load, homeDashboard } = useHomeDashboard();
    await load("org1");
    expect(settings.getSetting).toHaveBeenCalledWith("org1", "home_dashboard");
    expect(homeDashboard.value).toEqual(D);
  });

  it("load sets null when the setting is absent (404/null)", async () => {
    (settings.getSetting as any).mockResolvedValue({ data: null });
    const { load, homeDashboard } = useHomeDashboard();
    await load("org1");
    expect(homeDashboard.value).toBeNull();
  });

  it("setHomeDashboard optimistically sets the ref and writes the org setting", async () => {
    (settings.setOrgSetting as any).mockResolvedValue({});
    const { setHomeDashboard, homeDashboard } = useHomeDashboard();
    const p = setHomeDashboard("org1", D);
    expect(homeDashboard.value).toEqual(D); // optimistic — set before await resolves
    await p;
    expect(settings.setOrgSetting).toHaveBeenCalledWith("org1", "home_dashboard", D, "ui");
  });

  it("setHomeDashboard reverts the ref and toasts on failure", async () => {
    const prev = { dashboardId: "old", folderId: "default", label: "Old" };
    const { setHomeDashboard, homeDashboard } = useHomeDashboard();
    homeDashboard.value = prev;
    (settings.setOrgSetting as any).mockRejectedValue({ response: { status: 500 } });
    await setHomeDashboard("org1", D);
    expect(homeDashboard.value).toEqual(prev); // reverted
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("setHomeDashboard shows a permission message on 403", async () => {
    const { setHomeDashboard, homeDashboard } = useHomeDashboard();
    homeDashboard.value = null;
    (settings.setOrgSetting as any).mockRejectedValue({ response: { status: 403 } });
    await setHomeDashboard("org1", D);
    expect(homeDashboard.value).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: expect.stringMatching(/permission/i) }),
    );
  });

  it("setHomeDashboard no-ops (no API call, no ref change) when org is falsy", async () => {
    const { setHomeDashboard, homeDashboard } = useHomeDashboard();
    homeDashboard.value = null;
    await setHomeDashboard("", D);
    expect(settings.setOrgSetting).not.toHaveBeenCalled();
    expect(homeDashboard.value).toBeNull(); // no optimistic flash
  });

  it("clearHomeDashboard no-ops when org is falsy", async () => {
    const { clearHomeDashboard, homeDashboard } = useHomeDashboard();
    homeDashboard.value = D;
    await clearHomeDashboard("");
    expect(settings.deleteOrgSetting).not.toHaveBeenCalled();
    expect(homeDashboard.value).toEqual(D); // unchanged
  });

  it("clearHomeDashboard optimistically nulls and deletes the org setting", async () => {
    (settings.deleteOrgSetting as any).mockResolvedValue({});
    const { clearHomeDashboard, homeDashboard } = useHomeDashboard();
    homeDashboard.value = D;
    const p = clearHomeDashboard("org1");
    expect(homeDashboard.value).toBeNull(); // optimistic
    await p;
    expect(settings.deleteOrgSetting).toHaveBeenCalledWith("org1", "home_dashboard");
  });

  it("clearHomeDashboard reverts on failure", async () => {
    const { clearHomeDashboard, homeDashboard } = useHomeDashboard();
    homeDashboard.value = D;
    (settings.deleteOrgSetting as any).mockRejectedValue({ response: { status: 500 } });
    await clearHomeDashboard("org1");
    expect(homeDashboard.value).toEqual(D); // restored
  });

  it("clearHomeDashboard treats a 404 as already-cleared (no revert, no toast)", async () => {
    // The backend clears home_dashboard itself when the pinned dashboard is
    // deleted, so the client's delete can race and 404. That is the desired end
    // state — keep the optimistic null, do not revert, do not toast.
    const { clearHomeDashboard, homeDashboard } = useHomeDashboard();
    homeDashboard.value = D;
    (settings.deleteOrgSetting as any).mockRejectedValue({
      response: { status: 404 },
    });
    await clearHomeDashboard("org1");
    expect(homeDashboard.value).toBeNull(); // stays cleared
    expect(toast).not.toHaveBeenCalled();
  });

  it("isHome reflects the current value", () => {
    const { isHome, homeDashboard } = useHomeDashboard();
    homeDashboard.value = D;
    expect(isHome("abc")).toBe(true);
    expect(isHome("xyz")).toBe(false);
  });

  it("updateLabel changes the stored label AND persists it when different", () => {
    (settings.setOrgSetting as any).mockResolvedValue({});
    const { updateLabel, homeDashboard } = useHomeDashboard();
    homeDashboard.value = { ...D };
    updateLabel("org1", "abc", "Renamed");
    expect(homeDashboard.value?.label).toBe("Renamed");
    // Persisted so the fresh label survives the next load().
    expect(settings.setOrgSetting).toHaveBeenCalledWith(
      "org1",
      "home_dashboard",
      { ...D, label: "Renamed" },
      "ui",
    );
  });

  it("updateLabel does nothing when the label is unchanged", () => {
    const { updateLabel, homeDashboard } = useHomeDashboard();
    homeDashboard.value = { ...D };
    updateLabel("org1", "abc", D.label);
    expect(settings.setOrgSetting).not.toHaveBeenCalled();
  });
});
