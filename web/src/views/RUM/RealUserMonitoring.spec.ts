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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRouter, createWebHistory, type Router } from "vue-router";
import { createStore } from "vuex";

const streams: Record<string, { name: string; schema: { name: string }[] } | undefined> = {};
let streamGate: Promise<void> = Promise.resolve();
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn(async (name: string) => {
      await streamGate;
      const s = streams[name];
      if (!s) throw new Error("not found");
      return s;
    }),
  }),
}));

import RealUserMonitoring from "./RealUserMonitoring.vue";

const Stub = { template: "<div />" };

const makeRouter = () =>
  createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: "/rum",
        name: "RUM",
        component: RealUserMonitoring,
        children: [
          { path: "sessions", name: "Sessions", component: Stub },
          { path: "sessions/view/:id", name: "SessionViewer", component: Stub },
          { path: "errors", name: "ErrorTracking", component: Stub },
          { path: "source-maps", name: "SourceMaps", component: Stub },
          {
            path: "performance",
            name: "RumPerformance",
            component: Stub,
            children: [{ path: "overview", name: "rumPerformanceSummary", component: Stub }],
          },
        ],
      },
      { path: "/product-analytics/paths", name: "productAnalyticsPaths", component: Stub },
    ],
  });

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: {},
    timezone: "UTC",
  },
});

describe("RealUserMonitoring tabs", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;

  const mountAt = async (path: string) => {
    router = makeRouter();
    await router.push(path);
    wrapper = mount({ template: "<router-view />" }, { global: { plugins: [router, store] } });
    await flushPromises();
    await flushPromises();
  };

  beforeEach(() => {
    streamGate = Promise.resolve();
    streams._rumdata = { name: "_rumdata", schema: [{ name: "application_id" }] };
    streams._sessionreplay = { name: "_sessionreplay", schema: [{ name: "session_id" }] };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("no longer carries a Product Analytics tab: it has its own menu", async () => {
    await mountAt("/rum/sessions");
    const tabs = wrapper!.findAll('[role="tab"]').map((t) => t.text());
    expect(tabs).toEqual(["Performance", "Sessions", "Error Tracking", "Source Maps"]);
    expect(wrapper!.find('[data-test="rum-tab-product-analytics"]').exists()).toBe(false);
  });

  it("keeps Performance as the default landing tab", async () => {
    await mountAt("/rum");
    expect(router.currentRoute.value.name).toBe("rumPerformanceSummary");
  });

  it("a user who leaves RUM while its stream checks are in flight is not pulled back to Performance", async () => {
    let release: () => void = () => undefined;
    streamGate = new Promise((r) => (release = r));
    router = makeRouter();
    await router.push("/rum");
    wrapper = mount({ template: "<router-view />" }, { global: { plugins: [router, store] } });
    await flushPromises();
    await router.push("/product-analytics/paths");
    release();
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsPaths");
  });

  it("a Retention hand-off that cold-mounts RUM keeps its absolute range and filter", async () => {
    await mountAt("/rum/sessions?org_identifier=org1&query=YWJj&from=1000&to=2000");
    expect(router.currentRoute.value.name).toBe("Sessions");
    expect(router.currentRoute.value.query).toEqual({
      org_identifier: "org1",
      query: "YWJj",
      from: "1000",
      to: "2000",
    });
  });

  it("a Retention hand-off that cold-mounts RUM keeps its relative period", async () => {
    await mountAt("/rum/sessions?org_identifier=org1&query=YWJj&period=30d");
    expect(router.currentRoute.value.query).toEqual({
      org_identifier: "org1",
      query: "YWJj",
      period: "30d",
    });
  });

  it("a bare Sessions link still gets the shared time range", async () => {
    await mountAt("/rum/sessions");
    expect(router.currentRoute.value.name).toBe("Sessions");
    expect(router.currentRoute.value.query.org_identifier).toBe("org1");
    expect(
      router.currentRoute.value.query.period ?? router.currentRoute.value.query.from,
    ).toBeTruthy();
  });

  it("still shows the no-RUM empty state when _rumdata does not exist", async () => {
    streams._rumdata = undefined;
    streams._sessionreplay = undefined;
    await mountAt("/rum/sessions");
    expect(wrapper!.find('[data-test="rum-empty-web-card"]').exists()).toBe(true);
    expect(wrapper!.find('[role="tab"]').exists()).toBe(false);
  });
});
