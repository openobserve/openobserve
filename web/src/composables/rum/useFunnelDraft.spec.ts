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
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { createStore } from "vuex";
import i18n from "@/locales";

const { confirmMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async (_o: Record<string, unknown>) => true),
}));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

import useFunnelDraft, {
  forwardFunnelLink,
  isProductAnalyticsPath,
  useFunnelLeaveGuard,
} from "./useFunnelDraft";
import useProductAnalytics, { resetProductAnalytics } from "./useProductAnalytics";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import type { SavedFunnel } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", zoConfig: {} },
});

const def = (...keys: string[]): FunnelDef => ({
  steps: keys.map((key) => ({ kind: "p", key })),
  unit: "sessions",
  window: "session",
  breakdown: null,
});
const saved = (id: string, name: string, d: FunnelDef): SavedFunnel => ({
  id,
  app: "web",
  name,
  def: d,
  sql: "SELECT 1",
  eventIds: [],
  version: 1,
  createdBy: "a@x.com",
  createdAt: 1,
  updatedBy: "a@x.com",
  updatedAt: 1,
});
const A = saved("Alpha000000000000000000001", "Alpha", def("/a", "/b"));
const B = saved("Beta0000000000000000000001", "Beta", def("/x", "/y"));

let draft: ReturnType<typeof useFunnelDraft>;
const Builder = defineComponent({
  setup() {
    draft = useFunnelDraft();
    useFunnelLeaveGuard(draft);
    return () => h("div", { "data-test": "builder" });
  },
});
const List = defineComponent({
  beforeRouteEnter: forwardFunnelLink,
  setup() {
    draft = useFunnelDraft();
    return () => h("div", { "data-test": "list" });
  },
});
const openEdited = () => {
  const pa = useProductAnalytics();
  pa.openSavedFunnel(A);
  pa.funnel.value = def("/a", "/changed");
};
const Blank = defineComponent({ render: () => h("div") });

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: Blank },
      { path: "/logs", name: "logs", component: Blank },
      {
        path: "/product-analytics",
        name: PA_ROUTES.shell,
        component: RouterView,
        children: [
          { path: "funnels", name: PA_ROUTES.funnels, component: List },
          { path: "funnels/build", name: PA_ROUTES.funnelBuilder, component: Builder },
          { path: "paths", name: PA_ROUTES.paths, component: Blank },
        ],
      },
      { path: "/product-analytics/events/new", name: PA_ROUTES.eventNew, component: Blank },
      {
        path: "/rum/analytics/:paPath(.*)*",
        redirect: (to) => ({
          path: `/product-analytics/${[to.params.paPath].flat().join("/")}`,
          query: to.query,
        }),
      },
    ],
  });

describe("useFunnelDraft", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;

  const mountAt = async (path: string) => {
    router = makeRouter();
    await router.push(path);
    useProductAnalytics().initFromRoute(router.currentRoute.value.query);
    wrapper = mount(RouterView, { global: { plugins: [router, store, i18n] } });
    await flushPromises();
  };

  beforeEach(() => {
    resetProductAnalytics();
    confirmMock.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("knows which paths belong to Product Analytics, the named-event editor included", () => {
    expect(isProductAnalyticsPath("/product-analytics")).toBe(true);
    expect(isProductAnalyticsPath("/product-analytics/funnels/build")).toBe(true);
    expect(isProductAnalyticsPath("/product-analytics/events/new")).toBe(true);
    expect(isProductAnalyticsPath("/product-analyticsx")).toBe(false);
    expect(isProductAnalyticsPath("/logs")).toBe(false);
    expect(isProductAnalyticsPath("/rum/sessions")).toBe(false);
  });

  describe("a funnels-list link that names a funnel", () => {
    it.each([
      ["/product-analytics/funnels?app=web&sf=Alpha000000000000000000001", "sf"],
      ["/product-analytics/funnels?app=web&funnel=abc", "funnel"],
      ["/rum/analytics/funnels?app=web&sf=Alpha000000000000000000001", "sf"],
    ])("arriving from outside opens the builder with the same query: %s", async (path, key) => {
      router = makeRouter();
      await router.push("/logs");
      await router.push(path);
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
      expect(router.currentRoute.value.query.app).toBe("web");
      expect(router.currentRoute.value.query[key]).toBeDefined();
    });

    it("a fresh page load forwards too", async () => {
      router = makeRouter();
      await router.push("/product-analytics/funnels?sf=Alpha000000000000000000001");
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
    });

    it("stays on the list when it carries no funnel, or when the move is inside Product Analytics", async () => {
      router = makeRouter();
      await router.push("/product-analytics/funnels?app=web");
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);
      await router.push("/product-analytics/funnels/build?app=web&sf=Alpha000000000000000000001");
      await router.push("/product-analytics/funnels?app=web&sf=Alpha000000000000000000001");
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);
    });
  });

  describe("the leave guard", () => {
    it("asks before leaving Product Analytics with a saved funnel's edits, and stays when declined", async () => {
      await mountAt("/product-analytics/funnels/build?app=web");
      openEdited();
      expect(draft.dirty.value).toBe(true);
      confirmMock.mockResolvedValueOnce(false);
      await router.push("/logs");
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(confirmMock.mock.calls[0][0]).toMatchObject({
        title: "Discard unsaved changes?",
        message: 'Your changes to "Alpha" are not saved. Discard them?',
        confirmLabel: "Discard",
      });
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
      await router.push("/logs");
      expect(router.currentRoute.value.name).toBe("logs");
    });

    it("never asks inside Product Analytics, where the draft survives", async () => {
      await mountAt("/product-analytics/funnels/build?app=web");
      openEdited();
      await router.push("/product-analytics/paths?app=web");
      await router.push("/product-analytics/funnels/build?app=web");
      await router.push("/product-analytics/funnels?app=web");
      await router.push("/product-analytics/funnels/build?app=web");
      await router.push("/product-analytics/events/new");
      expect(confirmMock).not.toHaveBeenCalled();
    });

    it("never asks for an unsaved funnel or an unedited saved one", async () => {
      await mountAt("/product-analytics/funnels/build?app=web");
      useProductAnalytics().funnel.value = def("/a", "/b", "/c");
      await router.push("/logs");
      await router.push("/product-analytics/funnels/build?app=web");
      useProductAnalytics().openSavedFunnel(A);
      await router.push("/logs");
      expect(confirmMock).not.toHaveBeenCalled();
      expect(router.currentRoute.value.name).toBe("logs");
    });
  });

  describe("opening and starting funnels", () => {
    it("opening another saved funnel over edits asks first; the same one keeps the edits", async () => {
      await mountAt("/product-analytics/funnels?app=web");
      const pa = useProductAnalytics();
      openEdited();
      expect(await draft.openSaved(A)).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
      expect(pa.funnel.value).toEqual(def("/a", "/changed"));
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);

      await router.push("/product-analytics/funnels?app=web");
      confirmMock.mockResolvedValueOnce(false);
      expect(await draft.openSaved(B)).toBe(false);
      expect(pa.openedFunnel.value?.id).toBe(A.id);
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);

      expect(await draft.openSaved(B)).toBe(true);
      expect(pa.openedFunnel.value?.id).toBe(B.id);
      expect(pa.funnel.value).toEqual(B.def);
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
      expect(router.currentRoute.value.query).toMatchObject({ app: "web", sf: B.id });
    });

    it("an unedited open funnel is replaced without asking", async () => {
      await mountAt("/product-analytics/funnels?app=web");
      useProductAnalytics().openSavedFunnel(A);
      await draft.openSaved(B);
      expect(confirmMock).not.toHaveBeenCalled();
      expect(useProductAnalytics().openedFunnel.value?.id).toBe(B.id);
    });

    it("New funnel opens an empty unsaved builder, asking first over edits", async () => {
      await mountAt("/product-analytics/funnels?app=web");
      const pa = useProductAnalytics();
      openEdited();
      expect(await draft.startNew()).toBe(true);
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(pa.openedFunnel.value).toBeNull();
      expect(pa.funnel.value).toEqual(def());
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
      expect(router.currentRoute.value.query.sf).toBeUndefined();
      expect(router.currentRoute.value.query.funnel).toBeUndefined();
    });

    it("a quick start opens the builder with its steps", async () => {
      await mountAt("/product-analytics/funnels?app=web");
      await draft.startNew(def("/login"));
      expect(useProductAnalytics().funnel.value).toEqual(def("/login"));
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
      expect(router.currentRoute.value.query.funnel).toBeDefined();
    });

    it("the link to a funnel is the builder's, never the list's", async () => {
      await mountAt("/product-analytics/funnels?app=web");
      useProductAnalytics().openSavedFunnel(A);
      const link = new URL(draft.builderLink());
      expect(link.pathname).toBe("/product-analytics/funnels/build");
      expect(link.searchParams.get("sf")).toBe(A.id);
      expect(link.searchParams.get("org_identifier")).toBe("org1");
    });
  });
});
