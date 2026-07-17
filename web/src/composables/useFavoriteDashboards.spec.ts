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
    setUserSetting: vi.fn(),
  },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import settings from "@/services/settings";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useFavoriteDashboards } from "@/composables/useFavoriteDashboards";

const D1 = { dashboardId: "abc", folderId: "default", label: "Payments" };
const D2 = { dashboardId: "def", folderId: "prod", label: "Latency" };

describe("useFavoriteDashboards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFavoriteDashboards().favorites.value = []; // reset shared state
  });

  it("load populates the list from the user-resolved setting", async () => {
    (settings.getSetting as any).mockResolvedValue({
      data: { setting_value: [D1, D2] },
    });
    const { load, favorites } = useFavoriteDashboards();
    await load("org1", "me@example.com");
    expect(settings.getSetting).toHaveBeenCalledWith(
      "org1",
      "favorite_dashboards",
      "me@example.com",
    );
    expect(favorites.value).toEqual([D1, D2]);
  });

  it("load drops malformed entries and non-array payloads", async () => {
    (settings.getSetting as any).mockResolvedValue({
      data: { setting_value: [D1, null, { folderId: "x" }] },
    });
    const { load, favorites } = useFavoriteDashboards();
    await load("org1", "me@example.com");
    expect(favorites.value).toEqual([D1]);

    (settings.getSetting as any).mockResolvedValue({
      data: { setting_value: { not: "an array" } },
    });
    await load("org1", "me@example.com");
    expect(favorites.value).toEqual([]);
  });

  it("load resets to empty when the setting is absent (404)", async () => {
    (settings.getSetting as any).mockRejectedValue({
      response: { status: 404 },
    });
    const { load, favorites } = useFavoriteDashboards();
    favorites.value = [D1];
    await load("org1", "me@example.com");
    expect(favorites.value).toEqual([]);
  });

  it("load no-ops without an org or user id", async () => {
    const { load } = useFavoriteDashboards();
    await load("", "me@example.com");
    await load("org1", "");
    expect(settings.getSetting).not.toHaveBeenCalled();
  });

  it("toggleFavorite adds optimistically and persists the full list", async () => {
    (settings.setUserSetting as any).mockResolvedValue({});
    const { toggleFavorite, favorites } = useFavoriteDashboards();
    favorites.value = [D1];
    const p = toggleFavorite("org1", "me@example.com", D2);
    expect(favorites.value).toEqual([D1, D2]); // optimistic — before resolve
    await p;
    expect(settings.setUserSetting).toHaveBeenCalledWith(
      "org1",
      "me@example.com",
      "favorite_dashboards",
      [D1, D2],
      "ui",
    );
  });

  it("toggleFavorite removes an existing favorite", async () => {
    (settings.setUserSetting as any).mockResolvedValue({});
    const { toggleFavorite, favorites } = useFavoriteDashboards();
    favorites.value = [D1, D2];
    await toggleFavorite("org1", "me@example.com", D1);
    expect(favorites.value).toEqual([D2]);
    expect(settings.setUserSetting).toHaveBeenCalledWith(
      "org1",
      "me@example.com",
      "favorite_dashboards",
      [D2],
      "ui",
    );
  });

  it("toggleFavorite reverts and toasts on failure", async () => {
    (settings.setUserSetting as any).mockRejectedValue({
      response: { status: 500 },
    });
    const { toggleFavorite, favorites } = useFavoriteDashboards();
    favorites.value = [D1];
    await toggleFavorite("org1", "me@example.com", D2);
    expect(favorites.value).toEqual([D1]); // reverted
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
  });

  it("toggleFavorite shows a permission message on 403", async () => {
    (settings.setUserSetting as any).mockRejectedValue({
      response: { status: 403 },
    });
    const { toggleFavorite, favorites } = useFavoriteDashboards();
    await toggleFavorite("org1", "me@example.com", D1);
    expect(favorites.value).toEqual([]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: expect.stringMatching(/permission/i),
      }),
    );
  });

  it("toggleFavorite no-ops (no API call, no flash) without org or user", async () => {
    const { toggleFavorite, favorites } = useFavoriteDashboards();
    await toggleFavorite("", "me@example.com", D1);
    await toggleFavorite("org1", "", D1);
    expect(settings.setUserSetting).not.toHaveBeenCalled();
    expect(favorites.value).toEqual([]);
  });

  it("isFavorite reflects the current list", () => {
    const { isFavorite, favorites } = useFavoriteDashboards();
    favorites.value = [D1];
    expect(isFavorite("abc")).toBe(true);
    expect(isFavorite("def")).toBe(false);
  });

  it("state is shared across consumers (module-level ref)", () => {
    const a = useFavoriteDashboards();
    const b = useFavoriteDashboards();
    a.favorites.value = [D1];
    expect(b.isFavorite("abc")).toBe(true);
  });
});
