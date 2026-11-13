import { describe, expect, it } from "vitest";
import { resolveCompareArms } from "./useVersionCompareDrawer";

describe("resolveCompareArms", () => {
  it("resolves the unique known split across dot-bearing versions", () => {
    expect(resolveCompareArms("release..candidate..v1", ["release..candidate", "v1"])).toEqual({
      a: "release..candidate",
      b: "v1",
      ambiguous: false,
    });
  });
  it("rejects absent and multiple matching splits", () => {
    for (const known of [[], ["release", "candidate..v1", "release..candidate", "v1"]]) {
      expect(resolveCompareArms("release..candidate..v1", known)).toEqual({
        a: "",
        b: undefined,
        ambiguous: true,
      });
    }
  });
  it("accepts a backend-produced encoded notification link", () => {
    const url = new URL(
      "/web/traces?tab=services-catalog&cmp=v2..v1&cmpSvc=checkout&cmpWhere=k8s%3Aprod",
      "http://localhost",
    );
    expect(resolveCompareArms(url.searchParams.get("cmp")!, [])).toEqual({
      a: "v2",
      b: "v1",
      ambiguous: false,
    });
  });
});

import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { useVersionCompareDrawer } from "./useVersionCompareDrawer";
import { compareRequest } from "@/services/service_versions.queries";
async function location(query: Record<string, string>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/web/traces", name: "traces", component: { template: "<div />" } }],
  });
  await router.push({ name: "traces", query });
  let drawer!: ReturnType<typeof useVersionCompareDrawer>;
  const wrapper = mount(
    defineComponent({
      setup() {
        drawer = useVersionCompareDrawer();
        return () => null;
      },
    }),
    { global: { plugins: [router] } },
  );
  await flushPromises();
  return { router, drawer, wrapper };
}
describe("drawer URL ownership", () => {
  it("removes only compare keys on deep-link close and preserves org/time", async () => {
    window.history.replaceState({}, "");
    const { router, drawer, wrapper } = await location({
      cmp: "v2",
      cmpSvc: "svc",
      cmpWhere: "env:prod",
      org_identifier: "org",
      from: "123",
    });
    await drawer.close();
    expect(router.currentRoute.value.query).toEqual({ org_identifier: "org", from: "123" });
    wrapper.unmount();
  });
  it("normalizes dual panel/compare URLs with compare winning", async () => {
    const { router, wrapper } = await location({
      cmp: "v2",
      cmpSvc: "svc",
      cmpWhere: "env:prod",
      panel: "versions",
      panelSvc: "other",
      panelWhere: "elsewhere",
    });
    expect(router.currentRoute.value.query).toEqual({
      cmp: "v2",
      cmpSvc: "svc",
      cmpWhere: "env:prod",
    });
    wrapper.unmount();
  });
  it("replaces back-to-service after refresh instead of trusting stale history flags", async () => {
    window.history.replaceState({ o2CmpOpened: true, o2CmpFromPanel: true }, "");
    const { router, drawer, wrapper } = await location({
      cmp: "v2",
      cmpSvc: "svc",
      cmpWhere: "env:prod",
      cmpFrom: "panel",
      from: "123",
    });
    await drawer.backToService();
    expect(router.currentRoute.value.query).toEqual({
      panel: "versions",
      panelSvc: "svc",
      panelWhere: "env:prod",
      from: "123",
    });
    wrapper.unmount();
  });
  it("preserves the exact transition while opening a panel handoff", async () => {
    const { router, drawer, wrapper } = await location({
      panel: "versions",
      panelSvc: "svc",
      panelWhere: "env:prod",
      org_identifier: "org",
    });
    await drawer.open({
      service: "svc",
      where: "env:prod",
      a: "v2",
      deployKey: "deploy/a",
      fromPanel: true,
    });
    expect(router.currentRoute.value.query).toEqual({
      cmp: "v2",
      cmpSvc: "svc",
      cmpWhere: "env:prod",
      cmpDeploy: "deploy/a",
      cmpFrom: "panel",
      org_identifier: "org",
    });
    wrapper.unmount();
  });
});
it("browser Back restores Versions after an Operations marker handoff", async () => {
  const { router, drawer, wrapper } = await location({
    panel: "operations",
    panelSvc: "svc",
    panelWhere: "env:prod",
    from: "100",
  });
  await drawer.open({
    service: "svc",
    where: "env:prod",
    a: "v2",
    deployKey: "d2",
    fromPanel: true,
  });
  expect(router.currentRoute.value.query.panel).toBeUndefined();
  router.back();
  await flushPromises();
  expect(router.currentRoute.value.query).toEqual({
    panel: "versions",
    panelSvc: "svc",
    panelWhere: "env:prod",
    from: "100",
  });
  expect(drawer.isOpen.value).toBe(false);
  wrapper.unmount();
});
describe("a compare opened from a verdict never becomes a picked baseline", () => {
  it("keeps cmp=<version> + cmpDeploy from the catalog through reload and share, so no baseline is sent", async () => {
    window.history.replaceState({}, "");
    const first = await location({ org_identifier: "org", tab: "services-catalog" });
    // The catalog verdict chip's call (CatalogVersionsCell): version and deploy, no baseline.
    await first.drawer.open({
      service: "checkout",
      where: "k8s:c1/web",
      a: "2.0",
      deployKey: "dk",
    });
    const query = first.router.currentRoute.value.query;
    expect(query.cmp).toBe("2.0");
    expect(query.cmpDeploy).toBe("dk");
    const shared = new URL(first.router.currentRoute.value.fullPath, "http://localhost");
    first.wrapper.unmount();
    const reloaded = await location(Object.fromEntries(shared.searchParams));
    const state = reloaded.drawer.state.value;
    expect(state.b).toBeUndefined();
    const body = compareRequest({
      service: state.service,
      where: state.where,
      version: state.a,
      deployKey: state.deployKey,
      baselineVersion: state.b,
    });
    expect(body.b).toBeUndefined();
    expect(body.baseline).toBe("auto");
    expect(body.a).toEqual({ version: "2.0", deploy_key: "dk" });
    reloaded.wrapper.unmount();
  });
  it("writes a baseline into the URL only when one is picked", async () => {
    const { router, drawer, wrapper } = await location({
      cmp: "2.0",
      cmpSvc: "checkout",
      cmpWhere: "k8s:c1/web",
      cmpDeploy: "dk",
    });
    await drawer.update({ cmp: "2.0..1.0", cmpBase: undefined });
    expect(drawer.state.value.b).toBe("1.0");
    expect(router.currentRoute.value.query.cmp).toBe("2.0..1.0");
    wrapper.unmount();
  });
});
