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

// S3 gallery fetch/cache extracted out of AddDashboardFromGitHub.vue (design
// 4.3/§6) — the drawer and the empty-state cards must share ONE implementation.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  useDashboardGallery,
  CATEGORY_ORDER,
  getCategoryInfo,
} from "@/composables/useDashboardGallery";

const mockFetch = vi.fn();

const s3FolderListXml = (folders: string[]): string => {
  const prefixes = folders
    .map((f) => `  <CommonPrefixes><Prefix>dashboards/${f}/</Prefix></CommonPrefixes>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n${prefixes}\n</ListBucketResult>`;
};

const makeStore = (gallery: Partial<Record<string, any>> = {}) =>
  createStore({
    state: {
      selectedOrganization: { identifier: "default" },
      githubDashboardGallery: {
        dashboards: [],
        lastFetched: null,
        cacheExpiry: 300000,
        dashboardJsonCache: {},
        ...gallery,
      },
    },
    mutations: {
      setGithubDashboardGallery(state: any, payload: any) {
        state.githubDashboardGallery.dashboards = payload;
        state.githubDashboardGallery.lastFetched = Date.now();
      },
      setDashboardJsonCache(state: any, payload: any) {
        state.githubDashboardGallery.dashboardJsonCache[payload.key] = payload.json;
      },
    },
  });

// useStore() needs an app context — capture the composable inside a probe mount.
function withGallery(store: any) {
  let gallery!: ReturnType<typeof useDashboardGallery>;
  const wrapper = mount(
    defineComponent({
      setup() {
        gallery = useDashboardGallery();
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  return { gallery, wrapper };
}

describe("useDashboardGallery", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(new Response(s3FolderListXml([]), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves from the Vuex cache inside the TTL without touching S3", async () => {
    const cached = [{ name: "cached", displayName: "Cached", folderPath: "cached", jsonFiles: [] }];
    const store = makeStore({ dashboards: cached, lastFetched: Date.now() });
    const { gallery, wrapper } = withGallery(store);
    await gallery.loadDashboards();
    expect(gallery.dashboards.value).toEqual(cached);
    expect(mockFetch).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("fetches and parses the S3 XML listing when the cache is cold or expired", async () => {
    mockFetch.mockResolvedValue(
      new Response(s3FolderListXml(["aws", "nginx", ".github"]), { status: 200 }),
    );
    const store = makeStore({ lastFetched: Date.now() - 400000 });
    const { gallery, wrapper } = withGallery(store);
    await gallery.loadDashboards();
    await flushPromises();
    expect(mockFetch).toHaveBeenCalled();
    expect(String(mockFetch.mock.calls[0][0])).toContain(
      "openobserve-datasources-bucket.s3.amazonaws.com",
    );
    const names = gallery.dashboards.value.map((d: any) => d.name);
    expect(names).toContain("aws");
    expect(names).toContain("nginx");
    // Dot-prefixed directories are repo plumbing, not templates.
    expect(names).not.toContain(".github");
    wrapper.unmount();
  });

  it("commits setGithubDashboardGallery after a fetch", async () => {
    mockFetch.mockResolvedValue(new Response(s3FolderListXml(["aws"]), { status: 200 }));
    const store = makeStore();
    const commitSpy = vi.spyOn(store, "commit");
    const { gallery, wrapper } = withGallery(store);
    await gallery.loadDashboards();
    await flushPromises();
    expect(commitSpy).toHaveBeenCalledWith(
      "setGithubDashboardGallery",
      expect.arrayContaining([expect.objectContaining({ name: "aws" })]),
    );
    wrapper.unmount();
  });

  it("surfaces fetch errors instead of swallowing them", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const store = makeStore();
    const { gallery, wrapper } = withGallery(store);
    await gallery.loadDashboards();
    await flushPromises();
    expect(gallery.error.value).toBe("Network error");
    wrapper.unmount();
  });

  it("exports CATEGORY_ORDER and getCategoryInfo for card ranking", () => {
    // The gallery row picks its top N by this order — must stay exported.
    expect(CATEGORY_ORDER[0]).toBe("aws");
    expect(CATEGORY_ORDER).toContain("kubernetes");
    expect(getCategoryInfo({ name: "kubernetes cluster" }).category).toBe("kubernetes");
    expect(getCategoryInfo({ name: "cloudwatch logs" }).category).toBe("cloudwatch");
  });

  it("is consumed by the drawer instead of a silently re-forked copy", () => {
    const drawerSource = readFileSync(
      fileURLToPath(
        new URL("../components/dashboards/AddDashboardFromGitHub.vue", import.meta.url),
      ),
      "utf-8",
    );
    expect(drawerSource).toContain("useDashboardGallery");
    // A local re-declaration would fork cache behavior between the two surfaces.
    expect(drawerSource).not.toMatch(/const CATEGORY_ORDER\s*=/);
    expect(drawerSource).not.toMatch(/function getCategoryInfo\s*\(/);
  });
});
