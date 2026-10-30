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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import TvPlaylist from "./TvPlaylist.vue";

const { route, replace } = vi.hoisted(() => ({
  route: { path: "/dashboards/tv", query: {} as Record<string, string> },
  replace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useRoute: () => route,
    useRouter: () => ({
      replace,
      resolve: ({ path, query }: { path: string; query: Record<string, string> }) => ({
        href: `/web${path}?${new URLSearchParams(query).toString()}`,
      }),
    }),
  };
});

describe("TvPlaylist view", () => {
  let wrapper: VueWrapper<any> | null = null;
  let dispatch: ReturnType<typeof vi.spyOn>;

  const mountView = async (query: Record<string, string>) => {
    route.query = query;
    wrapper = shallowMount(TvPlaylist, { global: { plugins: [i18n, store] } });
    await flushPromises();
    return wrapper;
  };

  beforeEach(() => {
    replace.mockClear();
    dispatch = vi.spyOn(store, "dispatch");
    store.state.selectedOrganization = { ...store.state.selectedOrganization, identifier: "acme" };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    dispatch.mockRestore();
  });

  it("explains a link without dashboards and never enters kiosk", async () => {
    await mountView({ playlist: ",," });
    expect(wrapper!.find('[data-test="dashboard-tv-invalid"]').exists()).toBe(true);
    expect(dispatch).not.toHaveBeenCalledWith("setKioskMode", true);
  });

  it("enters kiosk with the link's theme and plays the parsed playlist", async () => {
    await mountView({ playlist: "d1:default,d2:ops", interval: "30s", slide: "2", theme: "dark" });

    expect(dispatch).toHaveBeenCalledWith("setKioskMode", true);
    expect(store.state.themeOverride).toBe("dark");
    const player = wrapper!.findComponent({ name: "PlaylistPlayer" });
    expect(player.props("config")).toMatchObject({
      org: "acme",
      intervalSeconds: 30,
      slideIndex: 1,
      entries: [
        { dashboardId: "d1", folderId: "default" },
        { dashboardId: "d2", folderId: "ops" },
      ],
    });
  });

  it("keeps the shown slide in the URL so a reload resumes there", async () => {
    await mountView({ org_identifier: "acme", playlist: "d1,d2", interval: "1m" });
    wrapper!.findComponent({ name: "PlaylistPlayer" }).vm.$emit("slide", 1);

    expect(replace).toHaveBeenCalledWith({
      path: "/dashboards/tv",
      query: {
        org_identifier: "acme",
        playlist: "d1:default,d2:default",
        interval: "1m",
        slide: "2",
      },
    });
  });

  it("falls back to a full page per slide when framing is blocked", async () => {
    const locationReplace = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...realLocation, origin: realLocation.origin, replace: locationReplace },
      configurable: true,
    });
    try {
      await mountView({ org_identifier: "acme", playlist: "d1,d2", interval: "1m" });
      wrapper!.findComponent({ name: "PlaylistPlayer" }).vm.$emit("fallback", 1);

      const url = new URL(locationReplace.mock.calls[0][0]);
      expect(url.pathname).toBe("/web/dashboards/view");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        dashboard: "d2",
        kiosk: "true",
        playlist: "d1:default,d2:default",
        slide: "2",
        tvpage: "1",
      });
    } finally {
      Object.defineProperty(window, "location", { value: realLocation, configurable: true });
    }
  });

  it("offers no edit on the TV: the player gets no dialog and no hold", async () => {
    await mountView({ org_identifier: "acme", playlist: "d1,d2", interval: "1m" });
    expect(wrapper!.findComponent({ name: "PlaylistDialog" }).exists()).toBe(false);
    expect(wrapper!.findComponent({ name: "PlaylistPlayer" }).props()).not.toHaveProperty("hold");
  });

  it("exits to the dashboard list and leaves kiosk on the way out", async () => {
    await mountView({ org_identifier: "acme", playlist: "d1" });
    wrapper!.findComponent({ name: "PlaylistPlayer" }).vm.$emit("exit");
    expect(replace).toHaveBeenCalledWith({
      path: "/dashboards",
      query: { org_identifier: "acme" },
    });

    wrapper!.unmount();
    wrapper = null;
    expect(dispatch).toHaveBeenCalledWith("setKioskMode", false);
  });
});
