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

// T1.2 wiring (design 4.2/§6): auto-import on `detected` + the view-host-dashboard action.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";
import DataSourceSetupCard from "./DataSourceSetupCard.vue";
import i18n from "@/locales";

const { importHostMetricsDashboard, toastMock } = vi.hoisted(() => ({
  importHostMetricsDashboard: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/composables/useHostMetricsDashboard", () => ({
  importHostMetricsDashboard,
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/composables/useIngestion", () => ({
  default: () => ({
    endpoint: ref({
      url: "https://test.openobserve.ai",
      host: "test.openobserve.ai",
      port: 443,
      protocol: "https",
      tls: true,
    }),
  }),
}));

// The renderer is presentational — stub it and drive its emits directly.
const rendererStub = {
  name: "SetupCardRenderer",
  props: ["content", "subs"],
  emits: ["detected", "step-action"],
  template: '<div data-test="renderer-stub" />',
};

// Comparing against the same translation the component uses catches a wrong key either side of the locale landing.
const t = (key: string) => i18n.global.t(key);

describe("DataSourceSetupCard — host metrics auto-import wiring", () => {
  let wrapper: VueWrapper<any>;
  let store: any;
  let router: any;

  const mountCard = (slug: string) => {
    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        userInfo: { email: "t@e.com" },
        organizationData: { organizationPasscode: "pc" },
        theme: "light",
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/infra/hosts", name: "infraHosts", component: { template: "<div />" } },
        { path: "/dashboards/view", name: "viewDashboard", component: { template: "<div />" } },
      ],
    });
    vi.spyOn(router, "push");
    return mount(DataSourceSetupCard, {
      props: { slug },
      global: {
        plugins: [store, router, i18n],
        stubs: { SetupCardRenderer: rendererStub },
      },
    });
  };

  const renderer = () => wrapper.findComponent({ name: "SetupCardRenderer" });

  beforeEach(() => {
    vi.clearAllMocks();
    importHostMetricsDashboard.mockResolvedValue({
      status: "created",
      dashboardId: "dash-1",
      folderId: "default",
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it.each(["linux", "windows", "macos"])(
    "imports the host dashboard when detection connects on the %s card",
    async (slug) => {
      wrapper = mountCard(slug);
      renderer().vm.$emit("detected", 4);
      await flushPromises();
      expect(importHostMetricsDashboard).toHaveBeenCalledWith("test-org");
    },
  );

  it("is a no-op for every non-host slug (the AWS EC2 embed guarantee)", async () => {
    wrapper = mountCard("sqlServer");
    renderer().vm.$emit("detected", 4);
    renderer().vm.$emit("step-action", "view-host-dashboard");
    await flushPromises();
    expect(importHostMetricsDashboard).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it.each(["linux", "sqlServer"])(
    "forwards the renderer's detected emit for the %s slug (embedding pages react to it)",
    async (slug) => {
      wrapper = mountCard(slug);
      renderer().vm.$emit("detected", 4);
      await flushPromises();
      // The Hosts empty state flips live off this emit — the card's state never reaches it otherwise.
      expect(wrapper.emitted("detected")).toEqual([[4]]);
    },
  );

  it("toasts hostDashboardImported with the View Hosts action on created", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 4);
    await flushPromises();
    expect(toastMock).toHaveBeenCalledTimes(1);
    const opts = toastMock.mock.calls[0][0];
    expect(opts.variant).toBe("success");
    // Copy leads with the destination the button opens (pass-4 finding 1).
    expect(opts.message).toBe(t("ingestion.setupCard.hostDashboardImported"));
    expect(opts.action.label).toBe(t("ingestion.setupCard.viewHosts"));
  });

  it("the toast action opens Infra → Hosts with the captured org", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 4);
    await flushPromises();
    // Org switches between detect and toast click — the captured org must win.
    store.state.selectedOrganization.identifier = "other-org";
    toastMock.mock.calls[0][0].action.handler();
    await flushPromises();
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/infra/hosts",
        query: expect.objectContaining({ org_identifier: "test-org" }),
      }),
    );
  });

  it("toasts the hostDashboardExists variant, still carrying View Hosts, on exists", async () => {
    importHostMetricsDashboard.mockResolvedValue({
      status: "exists",
      dashboardId: "dash-old",
      folderId: "default",
    });
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 4);
    await flushPromises();
    const opts = toastMock.mock.calls[0][0];
    expect(opts.message).toBe(t("ingestion.setupCard.hostDashboardExists"));
    expect(opts.action.label).toBe(t("ingestion.setupCard.viewHosts"));
  });

  it("stays silent when the auto-path import errors (user didn't invoke it)", async () => {
    importHostMetricsDashboard.mockResolvedValue({
      status: "error",
      kind: "forbidden",
      message: "403",
    });
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 4);
    await flushPromises();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("navigates the view-host-dashboard step button to the known dashboard id", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 4);
    await flushPromises();
    renderer().vm.$emit("step-action", "view-host-dashboard");
    await flushPromises();
    // The detect-time import already yielded the id — no second import.
    expect(importHostMetricsDashboard).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/dashboards/view",
        query: expect.objectContaining({
          org_identifier: "test-org",
          dashboard: "dash-1",
          folder: "default",
        }),
      }),
    );
  });

  it("keeps the silent detect-time import — the setup flow's own framing is the user's consent", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 4);
    await flushPromises();
    expect(importHostMetricsDashboard).toHaveBeenCalledWith("test-org");
    expect(wrapper.find('[data-test="host-drawer-import-confirm"]').exists()).toBe(false);
  });

  it("imports first, then navigates, when the step button is clicked before any import", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("step-action", "view-host-dashboard");
    await flushPromises();
    expect(importHostMetricsDashboard).toHaveBeenCalledWith("test-org");
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/dashboards/view",
        query: expect.objectContaining({ dashboard: "dash-1", folder: "default" }),
      }),
    );
  });

  it("names the RBAC cause when the user-invoked step button hits a 403", async () => {
    importHostMetricsDashboard.mockResolvedValue({
      status: "error",
      kind: "forbidden",
      message: "403",
    });
    wrapper = mountCard("linux");
    renderer().vm.$emit("step-action", "view-host-dashboard");
    await flushPromises();
    const opts = toastMock.mock.calls[0][0];
    expect(opts.message).toBe(t("ingestion.setupCard.hostDashboardImportForbidden"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows the actionable generic copy when the step button import fails otherwise", async () => {
    importHostMetricsDashboard.mockResolvedValue({
      status: "error",
      kind: "generic",
      message: "boom",
    });
    wrapper = mountCard("linux");
    renderer().vm.$emit("step-action", "view-host-dashboard");
    await flushPromises();
    const opts = toastMock.mock.calls[0][0];
    expect(opts.message).toBe(t("ingestion.setupCard.hostDashboardImportFailed"));
    expect(router.push).not.toHaveBeenCalled();
  });
});
