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

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h } from "vue";
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import { internalPrefill, prefillLocations } from "@/test/unit/mockData/syntheticPrefill";
import { SYNTHETIC_PREFILL_KEY } from "@/components/synthetics/prefill/syntheticPrefillContract";
import { useSyntheticPrefillView } from "@/components/synthetics/prefill/useSyntheticPrefill";
import type { ProtocolCheck, SyntheticsLocation } from "@/types/synthetics";

const { routeState, configState, breakpoint, mocks } = vi.hoisted(() => ({
  routeState: { query: {} as Record<string, string> },
  configState: { isEnterprise: "true" },
  breakpoint: { lgUp: true },
  mocks: {
    push: vi.fn(),
    getLocations: vi.fn(),
    save: vi.fn(),
    destinations: vi.fn(),
  },
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useRoute: () => ({ params: {}, query: routeState.query }),
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return {
    default: new Proxy(actual.default, {
      get: (target, key) =>
        key === "isEnterprise" ? configState.isEnterprise : target[key as string],
    }),
  };
});

vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({ lgUp: computed(() => breakpoint.lgUp) }),
}));

vi.mock("@/services/synthetics", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getLocations: mocks.getLocations, get: vi.fn().mockResolvedValue({ data: {} }) },
  });
});

vi.mock("@/services/synthetics.queries", () => ({
  saveMonitorMutation: () => ({ mutationFn: mocks.save }),
}));

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: mocks.destinations },
  });
});

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn().mockResolvedValue([
    { folderId: "default", name: "default" },
    { folderId: "ops", name: "ops" },
  ]),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

import CreateProtocolCheck from "./CreateProtocolCheck.vue";

const drawerRoute = {
  name: "autoobserve",
  query: { page: "coverage", service: "svc-c", org_identifier: "default" },
};

const stubs = {
  OPageLayout: {
    template:
      '<div data-test="page" :data-title="title" :data-back="back?.label"><button data-test="page-back" @click="$emit(\'back\')" /><slot /></div>',
    props: ["title", "back", "bleed"],
  },
  CheckConfigure: {
    template:
      '<div data-test="synthetics-check-configure"><slot name="before-sections" /><slot name="type-config" /><slot name="after-sections" /></div>',
    props: ["check", "checkType", "locations", "destinations", "folders"],
  },
  CheckHttpConfig: { template: "<div />", props: ["check"] },
  AgentSetupDrawer: true,
  EditorDraftDialogs: true,
  CreateBrowserTestSkeleton: true,
  RouterLink: RouterLinkStub,
  OButton: {
    template:
      "<button :data-test=\"$attrs['data-test']\" @click=\"$emit('click')\"><slot /></button>",
    emits: ["click"],
  },
};

function mountPage() {
  return mount(CreateProtocolCheck, {
    props: { checkType: "http" },
    global: { plugins: [store], stubs },
  });
}

const configured = (w: VueWrapper) =>
  w.findComponent('[data-test="synthetics-check-configure"]').props("check");

describe("CreateProtocolCheck opened from AutoObserve", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    store.state.selectedOrganization.identifier = "default";
    routeState.query = { type: "http", prefill: "autoobserve" };
    configState.isEnterprise = "true";
    breakpoint.lgUp = true;
    sessionStorage.setItem(SYNTHETIC_PREFILL_KEY, JSON.stringify(internalPrefill));
    mocks.getLocations.mockResolvedValue({ data: { locations: prefillLocations } });
    mocks.destinations.mockResolvedValue({ data: [{ name: "ops-webhook" }] });
    mocks.save.mockResolvedValue({ data: { id: "check-1" } });
  });

  afterEach(() => {
    wrapper?.unmount();
    sessionStorage.clear();
  });

  it("shows the banner and the After you save panel at first paint", () => {
    wrapper = mountPage();
    expect(wrapper.find('[data-test="synthetics-prefill-banner"]').text()).toContain(
      "Suggested by AutoObserve for svc-c (cluster-k / ns-a). A synthetic check sends a request on a schedule and alerts when it fails.",
    );
    expect(wrapper.find('[data-test="synthetics-prefill-banner"]').text()).toContain(
      "Nothing is created until you click Save & Exit.",
    );
    expect(wrapper.find('[data-test="synthetics-prefill-after-save"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="page"]').attributes("data-title")).toBe(
      "New synthetic check · HTTP",
    );
  });

  it("fills the form and keeps only the location that can run the check", async () => {
    wrapper = mountPage();
    await flushPromises();
    expect(configured(wrapper)).toMatchObject({
      name: "svc-c health",
      folder: "ops",
      url: "http://svc-c.ns-a.svc.cluster.local:8080/healthz",
      tags: ["service:svc-c", "namespace:ns-a", "cluster:cluster-k"],
      locations: ["cluster-k-agents"],
      notifications: { destinations: ["ops-webhook"] },
      alertIfFails: 2,
    });
    expect(configured(wrapper).description).toMatch(
      /^Created from an AutoObserve suggestion for svc-c on \w+ \d+\.$/,
    );
  });

  it("shows the plain form after a reload, because the prefill is read once", async () => {
    wrapper = mountPage();
    await flushPromises();
    wrapper.unmount();
    wrapper = mountPage();
    await flushPromises();
    expect(configured(wrapper).name).toBe("");
    expect(wrapper.find('[data-test="synthetics-prefill-banner"]').exists()).toBe(false);
  });

  it("links the breadcrumb back to the service in AutoObserve", () => {
    wrapper = mountPage();
    const link = wrapper
      .findAllComponents(RouterLinkStub)
      .find((l) => l.attributes("data-test") === "synthetics-prefill-breadcrumb-service");
    expect(link?.props("to")).toEqual(drawerRoute);
  });

  it("saves only on Save & Exit and then returns to the service in AutoObserve", async () => {
    wrapper = mountPage();
    await flushPromises();
    expect(mocks.save).not.toHaveBeenCalled();
    await wrapper.find('[data-test="synthetics-create-save-btn"]').trigger("click");
    await flushPromises();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith(drawerRoute);
  });

  it("returns to the service on Cancel without saving", async () => {
    wrapper = mountPage();
    await flushPromises();
    await wrapper.find('[data-test="synthetics-create-cancel-btn"]').trigger("click");
    expect(mocks.push).toHaveBeenCalledWith(drawerRoute);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns to the checks list after saving a plain check", async () => {
    sessionStorage.clear();
    routeState.query = { type: "http" };
    wrapper = mountPage();
    await flushPromises();
    await wrapper.find('[data-test="synthetics-create-save-btn"]').trigger("click");
    await flushPromises();
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ name: "synthetics" }));
  });

  it("scrolls the banner and the After you save panel with the form on a narrow screen", () => {
    breakpoint.lgUp = false;
    wrapper = mountPage();
    const panel = wrapper.find(
      '[data-test="synthetics-check-configure"] [data-test="synthetics-prefill-after-save"]',
    );
    expect(panel.exists()).toBe(true);
    expect(wrapper.findAll('[data-test="synthetics-prefill-after-save"]')).toHaveLength(1);
    const banner = wrapper.find(
      '[data-test="synthetics-check-configure"] [data-test="synthetics-prefill-banner"]',
    );
    expect(banner.exists()).toBe(true);
    expect(wrapper.findAll('[data-test="synthetics-prefill-banner"]')).toHaveLength(1);
  });
});

describe("CreateProtocolCheck reconciling an AutoObserve prefill with the org", () => {
  let wrapper: VueWrapper;

  const ConfigureProbe = defineComponent({
    name: "CheckConfigure",
    props: ["check", "checkType", "locations", "destinations", "folders"],
    emits: ["update:check", "refresh-locations", "refresh:destinations"],
    setup(props, { slots }) {
      const view = useSyntheticPrefillView();
      return () =>
        h("div", { "data-test": "synthetics-check-configure" }, [
          h(
            "p",
            { "data-test": "probe-unconfirmed-locations" },
            view?.value?.unconfirmed?.locations,
          ),
          h(
            "p",
            { "data-test": "probe-unconfirmed-destinations" },
            view?.value?.unconfirmed?.destinations,
          ),
          h("p", { "data-test": "probe-note-destinations" }, view?.value?.notes.destinations),
          slots["after-sections"]?.(),
        ]);
    },
  });

  function mountProbed() {
    return mount(CreateProtocolCheck, {
      props: { checkType: "http" },
      global: { plugins: [store], stubs: { ...stubs, CheckConfigure: ConfigureProbe } },
    });
  }

  const probe = (w: VueWrapper) => w.findComponent(ConfigureProbe);
  const checkOf = (w: VueWrapper) => probe(w).props("check") as ProtocolCheck;
  const text = (w: VueWrapper, test: string) => w.find(`[data-test="${test}"]`).text();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    sessionStorage.clear();
    store.state.selectedOrganization.identifier = "default";
    routeState.query = { type: "http", prefill: "autoobserve" };
    configState.isEnterprise = "true";
    breakpoint.lgUp = true;
    sessionStorage.setItem(SYNTHETIC_PREFILL_KEY, JSON.stringify(internalPrefill));
    mocks.getLocations.mockResolvedValue({ data: { locations: prefillLocations } });
    mocks.destinations.mockResolvedValue({ data: [{ name: "ops-webhook" }] });
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    sessionStorage.clear();
  });

  it("drops a suggested destination the org no longer has, so nobody is promised a notification", async () => {
    mocks.destinations.mockResolvedValue({ data: [] });
    wrapper = mountProbed();
    await flushPromises();
    expect(checkOf(wrapper).notifications.destinations).toEqual([]);
    expect(text(wrapper, "synthetics-prefill-after-save")).not.toContain("ops-webhook");
    expect(text(wrapper, "probe-unconfirmed-destinations")).toBe("");
  });

  it("drops the suggested locations when the org has none", async () => {
    mocks.getLocations.mockResolvedValue({ data: { locations: [] } });
    wrapper = mountProbed();
    await flushPromises();
    expect(checkOf(wrapper).locations).toEqual([]);
    expect(text(wrapper, "probe-unconfirmed-locations")).toBe("");
  });

  it("keeps the suggestions as unconfirmed while the lists fail, then checks them on refresh", async () => {
    mocks.getLocations.mockRejectedValueOnce({ response: { status: 500 } });
    mocks.destinations.mockRejectedValueOnce(new Error("down"));
    wrapper = mountProbed();
    await flushPromises();
    expect(checkOf(wrapper).locations).toEqual(["cluster-k-agents", "us-east"]);
    expect(checkOf(wrapper).notifications.destinations).toEqual(["ops-webhook"]);
    expect(text(wrapper, "probe-unconfirmed-locations")).toBe(
      "Locations didn't load, so the suggested ones aren't confirmed. Refresh the list before you save.",
    );
    expect(text(wrapper, "probe-unconfirmed-destinations")).toBe(
      "Destinations didn't load, so the suggested ones aren't confirmed. Refresh the list before you save.",
    );
    expect(text(wrapper, "probe-note-destinations")).toBe("");
    expect(text(wrapper, "synthetics-prefill-after-save")).toContain(
      "ops-webhook will be notified if you keep the suggestion.",
    );
    expect(text(wrapper, "synthetics-prefill-after-save")).toContain(
      "The check will run every 5 minutes from 2 locations if you keep the suggestion.",
    );

    mocks.destinations.mockResolvedValue({ data: [] });
    probe(wrapper).vm.$emit("refresh-locations");
    probe(wrapper).vm.$emit("refresh:destinations");
    await flushPromises();
    expect(checkOf(wrapper).locations).toEqual(["cluster-k-agents"]);
    expect(checkOf(wrapper).notifications.destinations).toEqual([]);
    expect(text(wrapper, "probe-unconfirmed-locations")).toBe("");
    expect(text(wrapper, "probe-unconfirmed-destinations")).toBe("");
    expect(text(wrapper, "synthetics-prefill-after-save")).not.toContain("if you keep");
  });

  it("keeps locations chosen before the list lands instead of narrowing them to the suggestion", async () => {
    let resolve!: (v: unknown) => void;
    let resolveDestinations!: (v: unknown) => void;
    mocks.getLocations.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    mocks.destinations.mockReturnValueOnce(new Promise((r) => (resolveDestinations = r)));
    wrapper = mountProbed();
    await flushPromises();
    probe(wrapper).vm.$emit("update:check", {
      ...checkOf(wrapper),
      locations: ["eu-west"],
      notifications: { destinations: ["ops-webhook", "pager"] },
    });
    await flushPromises();
    resolve({ data: { locations: prefillLocations } });
    resolveDestinations({ data: [{ name: "pager" }] });
    await flushPromises();
    expect(checkOf(wrapper).locations).toEqual(["eu-west"]);
    expect(checkOf(wrapper).notifications.destinations).toEqual(["ops-webhook", "pager"]);
  });

  it("lists a private location no agent has joined yet, unticked, only on the prefilled form", async () => {
    const ids = (w: VueWrapper) =>
      (probe(w).props("locations") as SyntheticsLocation[]).map((l) => l.id);
    wrapper = mountProbed();
    await flushPromises();
    expect(ids(wrapper)).toContain("dc-east");
    expect(checkOf(wrapper).locations).not.toContain("dc-east");
    wrapper.unmount();

    sessionStorage.clear();
    routeState.query = { type: "http" };
    wrapper = mountProbed();
    await flushPromises();
    expect(ids(wrapper)).not.toContain("dc-east");
  });
});
