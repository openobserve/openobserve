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
import { defineComponent, ref } from "vue";
import DataSourceSetupCard from "./DataSourceSetupCard.vue";
import i18n from "@/locales";
import settings from "@/services/settings";
import { settingKeys } from "@/services/settings.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import {
  READY_MADE_SETTING_KEY,
  resetReadyMadeSessionMemory,
  saveReadyMadeStates,
} from "@/composables/readyMade/readyMadeSettings";

const {
  importHostMetricsDashboard,
  importSetupDashboard,
  toastMock,
  installReadyMade,
  detectReadyMade,
} = vi.hoisted(() => ({
  importHostMetricsDashboard: vi.fn(),
  importSetupDashboard: vi.fn(),
  toastMock: vi.fn(),
  installReadyMade: vi.fn(),
  detectReadyMade: vi.fn(),
}));

vi.mock("@/composables/readyMade/installReadyMade", () => ({ installReadyMade }));
vi.mock("@/composables/readyMade/useReadyMadeDetection", () => ({
  useReadyMadeDetection: () => ({ detect: detectReadyMade }),
}));
// The memory read stays real; only its transport is faked.
vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getSetting: vi.fn(), setUserSetting: vi.fn() },
  });
});

vi.mock("@/composables/useSetupDashboardImport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/useSetupDashboardImport")>()),
  importSetupDashboard,
}));

vi.mock("@/composables/useHostMetricsDashboard", () => ({
  importHostMetricsDashboard,
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
import analytics from "@/services/product_analytics";

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

  it("does not track dashboard_created for the automatic detect-time import", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 4);
    await flushPromises();
    expect(importHostMetricsDashboard).toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("tracks dashboard_created when the step button creates the dashboard", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("step-action", "view-host-dashboard");
    await flushPromises();
    expect(analytics.track).toHaveBeenCalledWith("dashboard_created");
  });

  it("does not track dashboard_created when the step button finds it already exists", async () => {
    importHostMetricsDashboard.mockResolvedValue({
      status: "exists",
      dashboardId: "dash-old",
      folderId: "default",
    });
    wrapper = mountCard("linux");
    renderer().vm.$emit("step-action", "view-host-dashboard");
    await flushPromises();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("re-resolves the host dashboard after an org switch instead of opening the old org's id", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 4);
    await flushPromises();
    store.state.selectedOrganization = { identifier: "org-b" };
    importHostMetricsDashboard.mockResolvedValue({
      status: "exists",
      dashboardId: "dash-b",
      folderId: "default",
    });
    renderer().vm.$emit("step-action", "view-host-dashboard");
    await flushPromises();
    expect(importHostMetricsDashboard).toHaveBeenLastCalledWith("org-b");
    expect(router.push).toHaveBeenLastCalledWith({
      path: "/dashboards/view",
      query: { org_identifier: "org-b", dashboard: "dash-b", folder: "default" },
    });
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

describe("DataSourceSetupCard — companion dashboard (NVIDIA GPU) wiring", () => {
  let wrapper: VueWrapper<any>;
  let router: any;

  const mountCard = (slug: string) => {
    const store = createStore({
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
        { path: "/dashboards/view", name: "viewDashboard", component: { template: "<div />" } },
      ],
    });
    vi.spyOn(router, "push");
    return mount(DataSourceSetupCard, {
      props: { slug },
      global: { plugins: [store, router, i18n], stubs: { SetupCardRenderer: rendererStub } },
    });
  };
  const renderer = () => wrapper.findComponent({ name: "SetupCardRenderer" });
  const GPU_TITLE = "GPU Monitoring - NVIDIA";

  beforeEach(() => {
    vi.clearAllMocks();
    importSetupDashboard.mockResolvedValue({
      status: "created",
      dashboardId: "gpu-1",
      folderId: "default",
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("imports the GPU dashboard on detect and toasts with an Open dashboard action", async () => {
    wrapper = mountCard("nvidiaDcgm");
    renderer().vm.$emit("detected", 3);
    await flushPromises();
    expect(importSetupDashboard).toHaveBeenCalledWith(
      "test-org",
      expect.objectContaining({ title: GPU_TITLE }),
    );
    expect(importHostMetricsDashboard).not.toHaveBeenCalled();
    const arg = toastMock.mock.calls[0][0];
    expect(arg.variant).toBe("success");
    expect(arg.message).toContain(GPU_TITLE);
    arg.action.handler();
    expect(router.push).toHaveBeenCalledWith({
      path: "/dashboards/view",
      query: { org_identifier: "test-org", dashboard: "gpu-1", folder: "default" },
    });
  });

  it("stays silent when the detect-time import fails", async () => {
    importSetupDashboard.mockResolvedValue({ status: "error", kind: "generic", message: "x" });
    wrapper = mountCard("nvidiaDcgm");
    renderer().vm.$emit("detected", 3);
    await flushPromises();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("imports then opens the dashboard from the step button, reusing the id afterwards", async () => {
    wrapper = mountCard("nvidiaDcgm");
    renderer().vm.$emit("step-action", "open-setup-dashboard");
    await flushPromises();
    renderer().vm.$emit("step-action", "open-setup-dashboard");
    await flushPromises();
    expect(importSetupDashboard).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenLastCalledWith({
      path: "/dashboards/view",
      query: { org_identifier: "test-org", dashboard: "gpu-1", folder: "default" },
    });
  });

  it("re-resolves the dashboard after an org switch instead of opening the old org's id", async () => {
    wrapper = mountCard("nvidiaDcgm");
    renderer().vm.$emit("step-action", "open-setup-dashboard");
    await flushPromises();
    (wrapper.vm.$store as any).state.selectedOrganization = { identifier: "org-b" };
    importSetupDashboard.mockResolvedValue({
      status: "exists",
      dashboardId: "gpu-b",
      folderId: "default",
    });
    renderer().vm.$emit("step-action", "open-setup-dashboard");
    await flushPromises();
    expect(importSetupDashboard).toHaveBeenLastCalledWith("org-b", expect.anything());
    expect(router.push).toHaveBeenLastCalledWith({
      path: "/dashboards/view",
      query: { org_identifier: "org-b", dashboard: "gpu-b", folder: "default" },
    });
  });

  it("names the RBAC cause when the step button hits a 403", async () => {
    importSetupDashboard.mockResolvedValue({ status: "error", kind: "forbidden", message: "" });
    wrapper = mountCard("nvidiaDcgm");
    renderer().vm.$emit("step-action", "open-setup-dashboard");
    await flushPromises();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: i18n.global.t("ingestion.setupCard.setupDashboardImportForbidden", {
          name: GPU_TITLE,
        }),
      }),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("ignores the dashboard action on a card without a companion dashboard", async () => {
    wrapper = mountCard("linux");
    renderer().vm.$emit("step-action", "open-setup-dashboard");
    await flushPromises();
    expect(importSetupDashboard).not.toHaveBeenCalled();
  });
});

describe("DataSourceSetupCard — ready-made dashboards wiring", () => {
  let wrapper: VueWrapper<any>;
  let router: any;

  const mountCard = (slug: string, userInfo: Record<string, unknown> = { email: "t@e.com" }) => {
    const store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        userInfo,
        organizationData: { organizationPasscode: "pc" },
        theme: "light",
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/dashboards/view", name: "viewDashboard", component: { template: "<div />" } },
      ],
    });
    vi.spyOn(router, "push");
    return mount(DataSourceSetupCard, {
      props: { slug },
      global: { plugins: [store, router, i18n], stubs: { SetupCardRenderer: rendererStub } },
    });
  };
  const renderer = () => wrapper.findComponent({ name: "SetupCardRenderer" });
  const tp = (key: string, named: Record<string, unknown>, count: number) =>
    (i18n.global as any).t(key, named, count);

  const getSetting = settings.getSetting as unknown as ReturnType<typeof vi.fn>;
  const setUserSetting = settings.setUserSetting as unknown as ReturnType<typeof vi.fn>;
  const httpError = (status: number) =>
    Object.assign(new Error(String(status)), { response: { status } });
  const stored = (sources: Record<string, "added" | "dismissed">) => ({
    data: {
      setting_value: {
        version: 1,
        sources: Object.fromEntries(
          Object.entries(sources).map(([id, state]) => [id, { state, at: "2026-10-01T00:00:00Z" }]),
        ),
      },
    },
  });
  /** What the server holds as this user's memory; nothing stored is a 404. */
  const answered = (sources: Record<string, "added" | "dismissed">) =>
    getSetting.mockResolvedValue(stored(sources));

  const installed = (sourceId: string, count = 1, status = "created", createdKeys?: string[]) => {
    const folderName = sourceId === "kubernetes" ? "Kubernetes" : "PostgreSQL";
    return {
      status,
      sourceId,
      folderId: "f-1",
      folderName,
      dashboards: Array.from({ length: count }, (_, i) => ({
        key: `k${i}`,
        title: `t${i}`,
        dashboardId: `dash-${i}`,
        folderId: "f-1",
        folderName,
        created: createdKeys ? createdKeys.includes(`k${i}`) : status === "created",
      })),
    };
  };
  const notice = () => wrapper.find('[data-test="data-source-setup-card-ready-made-added"]');

  beforeEach(() => {
    vi.clearAllMocks();
    resetReadyMadeSessionMemory();
    queryClient.clear();
    installReadyMade.mockResolvedValue(installed("postgresql"));
    detectReadyMade.mockResolvedValue(["kubernetes"]);
    getSetting.mockRejectedValue(httpError(404));
    setUserSetting.mockResolvedValue({});
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it.each([
    ["postgres", "postgresql"],
    ["mySQL", "mysql"],
    ["mariaDB", "mysql"],
    ["redis", "redis"],
  ])(
    "detection on the %s card with no earlier answer installs %s silently and toasts the folder",
    async (slug, sourceId) => {
      wrapper = mountCard(slug);
      renderer().vm.$emit("detected", 2);
      await flushPromises();
      expect(getSetting).toHaveBeenCalledWith("test-org", READY_MADE_SETTING_KEY, "t@e.com");
      expect(installReadyMade).toHaveBeenCalledWith("test-org", sourceId, { userId: "t@e.com" });
      expect(detectReadyMade).not.toHaveBeenCalled();
      const arg = toastMock.mock.calls[0][0];
      expect(arg.variant).toBe("success");
      arg.action.handler();
      expect(router.push).toHaveBeenCalledWith({
        path: "/dashboards/view",
        query: { org_identifier: "test-org", dashboard: "dash-0", folder: "f-1" },
      });
    },
  );

  it.each(["dismissed", "added"] as const)(
    "detection does nothing when this user's answer for the source is %s",
    async (state) => {
      answered({ postgresql: state });
      wrapper = mountCard("postgres");
      renderer().vm.$emit("detected", 2);
      await flushPromises();
      expect(getSetting).toHaveBeenCalledWith("test-org", READY_MADE_SETTING_KEY, "t@e.com");
      expect(installReadyMade).not.toHaveBeenCalled();
      expect(setUserSetting).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
      // The embedding page still hears about the data.
      expect(wrapper.emitted("detected")).toEqual([[2]]);
    },
  );

  it("another source's answer does not silence this one", async () => {
    answered({ redis: "dismissed", mysql: "added" });
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(installReadyMade).toHaveBeenCalledWith("test-org", "postgresql", { userId: "t@e.com" });
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it.each([500, 403])("detection does nothing when the memory read fails (%s)", async (status) => {
    getSetting.mockRejectedValue(httpError(status));
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(getSetting).toHaveBeenCalledTimes(1);
    expect(installReadyMade).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("the MariaDB card honours the mysql answer", async () => {
    answered({ mysql: "dismissed" });
    wrapper = mountCard("mariaDB");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(installReadyMade).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("reads the server's copy, so an answer given in another tab wins over this tab's cache", async () => {
    queryClient.setQueryData(settingKeys.one("test-org", READY_MADE_SETTING_KEY, "t@e.com"), {
      version: 1,
      sources: {},
    });
    answered({ postgresql: "dismissed" });
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(getSetting).toHaveBeenCalledTimes(1);
    expect(installReadyMade).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("honours an answer whose save failed earlier in this session", async () => {
    setUserSetting.mockRejectedValue(new Error("down"));
    const { saved } = await saveReadyMadeStates("test-org", "t@e.com", { postgresql: "dismissed" });
    expect(saved).toBe(false);
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(installReadyMade).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("stays silent without a signed-in user id, whose answer could be neither read nor saved", async () => {
    wrapper = mountCard("postgres", {});
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(getSetting).not.toHaveBeenCalled();
    expect(installReadyMade).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("names the dashboard and folder in the toast", async () => {
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(toastMock.mock.calls[0][0].message).toBe(
      tp("dashboard.readyMade.addedOne", { name: "PostgreSQL", folder: "PostgreSQL", count: 1 }, 1),
    );
  });

  it("stays silent when the Test-time install fails", async () => {
    installReadyMade.mockResolvedValue({ status: "error", kind: "forbidden", message: "" });
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(toastMock).not.toHaveBeenCalled();
    expect(notice().exists()).toBe(false);
  });

  it("after an automatic add, keeps a notice on the page naming what was added and where, with Open", async () => {
    wrapper = mountCard("postgres");
    expect(notice().exists()).toBe(false);
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(notice().text()).toContain(
      (i18n.global as any).t("ingestion.setupCard.readyMadeAutoAdded", {
        name: "PostgreSQL",
        list: "t0",
        folder: "PostgreSQL",
      }),
    );
    await notice()
      .find('[data-test="data-source-setup-card-ready-made-added-open"]')
      .trigger("click");
    expect(router.push).toHaveBeenCalledWith({
      path: "/dashboards/view",
      query: { org_identifier: "test-org", dashboard: "dash-0", folder: "f-1" },
    });
    await notice()
      .find('[data-test="data-source-setup-card-ready-made-added-close"]')
      .trigger("click");
    expect(notice().exists()).toBe(false);
  });

  it("keeps the notice when a layout switch remounts the card, and drops it on the next visit", async () => {
    // The page stays mounted while the card is swapped, as the data-sources page does when a phone rotation crosses md.
    const host = defineComponent({
      components: { DataSourceSetupCard },
      setup: () => ({ shown: ref(true) }),
      template: '<DataSourceSetupCard v-if="shown" slug="postgres" />',
    });
    const store = createStore({
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
        { path: "/setup", component: { template: "<div />" } },
      ],
    });
    await router.push("/setup");
    wrapper = mount(host, {
      global: { plugins: [store, router, i18n], stubs: { SetupCardRenderer: rendererStub } },
    });
    const remount = async () => {
      wrapper.vm.shown = false;
      await flushPromises();
      wrapper.vm.shown = true;
      await flushPromises();
    };
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(notice().exists()).toBe(true);

    await remount();
    expect(notice().exists()).toBe(true);
    expect(installReadyMade).toHaveBeenCalledTimes(1);

    await router.push("/");
    await router.push("/setup");
    await remount();
    expect(notice().exists()).toBe(false);
  });

  it("shows no notice when the automatic path found the dashboards already there", async () => {
    installReadyMade.mockResolvedValue(installed("postgresql", 1, "exists"));
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(notice().exists()).toBe(false);
  });

  it("shows no notice after an earlier answer silenced the automatic path", async () => {
    answered({ postgresql: "dismissed" });
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(notice().exists()).toBe(false);
  });

  it("the step button names a dashboard it had to put back into an existing set", async () => {
    installReadyMade.mockResolvedValue(installed("kubernetes", 4, "created", ["k1"]));
    wrapper = mountCard("kubernetes");
    renderer().vm.$emit("step-action", "open-ready-made-dashboard");
    await flushPromises();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      variant: "success",
      message: tp("dashboard.readyMade.missingAdded", { list: "t1", folder: "Kubernetes" }, 1),
    });
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("the step button opens a fresh install without a toast: the dashboard it opens is the news", async () => {
    installReadyMade.mockResolvedValue(installed("kubernetes", 4));
    wrapper = mountCard("kubernetes");
    renderer().vm.$emit("step-action", "open-ready-made-dashboard");
    await flushPromises();
    expect(toastMock).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("Kubernetes with no earlier answer installs only when its metrics rule passes", async () => {
    detectReadyMade.mockResolvedValue([]);
    wrapper = mountCard("kubernetes");
    renderer().vm.$emit("detected", 1);
    await flushPromises();
    expect(getSetting).toHaveBeenCalledWith("test-org", READY_MADE_SETTING_KEY, "t@e.com");
    expect(detectReadyMade).toHaveBeenCalledWith({ force: true });
    expect(installReadyMade).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();

    detectReadyMade.mockResolvedValue(["kubernetes"]);
    installReadyMade.mockResolvedValue(installed("kubernetes", 4));
    renderer().vm.$emit("detected", 1);
    await flushPromises();
    expect(installReadyMade).toHaveBeenCalledWith("test-org", "kubernetes", { userId: "t@e.com" });
    expect(toastMock.mock.calls[0][0].message).toBe(
      tp("dashboard.readyMade.addedOne", { name: "Kubernetes", folder: "Kubernetes", count: 4 }, 4),
    );
  });

  it.each(["dismissed", "added"] as const)(
    "Kubernetes with a %s answer skips the metrics re-check and the install",
    async (state) => {
      answered({ kubernetes: state });
      wrapper = mountCard("kubernetes");
      renderer().vm.$emit("detected", 1);
      await flushPromises();
      expect(detectReadyMade).not.toHaveBeenCalled();
      expect(installReadyMade).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
    },
  );

  it("the Kubernetes step button always installs and opens Cluster, rule or not", async () => {
    detectReadyMade.mockResolvedValue([]);
    installReadyMade.mockResolvedValue(installed("kubernetes", 4));
    wrapper = mountCard("kubernetes");
    renderer().vm.$emit("step-action", "open-ready-made-dashboard");
    await flushPromises();
    expect(detectReadyMade).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({
      path: "/dashboards/view",
      query: { org_identifier: "test-org", dashboard: "dash-0", folder: "f-1" },
    });
  });

  it("the step button still installs and opens after No thanks, without consulting the memory", async () => {
    answered({ postgresql: "dismissed" });
    wrapper = mountCard("postgres");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(installReadyMade).not.toHaveBeenCalled();
    getSetting.mockClear();

    renderer().vm.$emit("step-action", "open-ready-made-dashboard");
    await flushPromises();
    expect(getSetting).not.toHaveBeenCalled();
    // The shared install is what records "added"; the click hands it this user.
    expect(installReadyMade).toHaveBeenCalledTimes(1);
    expect(installReadyMade).toHaveBeenCalledWith("test-org", "postgresql", { userId: "t@e.com" });
    expect(analytics.track).toHaveBeenCalledWith("dashboard_created");
    expect(router.push).toHaveBeenCalledWith({
      path: "/dashboards/view",
      query: { org_identifier: "test-org", dashboard: "dash-0", folder: "f-1" },
    });
  });

  it("the step button installs and opens even when the memory cannot be read", async () => {
    getSetting.mockRejectedValue(httpError(500));
    wrapper = mountCard("postgres");
    renderer().vm.$emit("step-action", "open-ready-made-dashboard");
    await flushPromises();
    expect(installReadyMade).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("the step button reuses the Test-time install", async () => {
    wrapper = mountCard("redis");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    renderer().vm.$emit("step-action", "open-ready-made-dashboard");
    await flushPromises();
    expect(installReadyMade).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["forbidden", "dashboard.readyMade.forbidden"],
    ["generic", "ingestion.setupCard.readyMadeFailed"],
  ])("the step button names a %s failure", async (kind, key) => {
    installReadyMade.mockResolvedValue({ status: "error", kind, message: "" });
    wrapper = mountCard("postgres");
    renderer().vm.$emit("step-action", "open-ready-made-dashboard");
    await flushPromises();
    const expected =
      kind === "forbidden" ? (i18n.global as any).t(key) : tp(key, { name: "PostgreSQL" }, 1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: expected }),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("leaves Host Metrics and NVIDIA flows alone", async () => {
    const imported = { status: "created", dashboardId: "dash-1", folderId: "default" };
    importHostMetricsDashboard.mockResolvedValue(imported);
    importSetupDashboard.mockResolvedValue(imported);
    wrapper = mountCard("linux");
    renderer().vm.$emit("detected", 2);
    renderer().vm.$emit("step-action", "open-ready-made-dashboard");
    await flushPromises();
    expect(installReadyMade).not.toHaveBeenCalled();
    wrapper.unmount();
    wrapper = mountCard("nvidiaDcgm");
    renderer().vm.$emit("detected", 2);
    await flushPromises();
    expect(installReadyMade).not.toHaveBeenCalled();
    // Host and NVIDIA imports never consult the ready-made memory.
    expect(getSetting).not.toHaveBeenCalled();
    expect(importHostMetricsDashboard).toHaveBeenCalledTimes(1);
    expect(importSetupDashboard).toHaveBeenCalledTimes(1);
  });
});
