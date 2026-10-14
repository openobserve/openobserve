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

// The real banner + the real checklist dialog together; only the transports are faked.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import i18n from "@/locales";

vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  // Render the dialog inline so the spec can reach it.
  return { ...actual, DialogPortal: actual.DialogContent };
});
vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/common", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
const { getStreams, toastMock } = vi.hoisted(() => ({ getStreams: vi.fn(), toastMock: vi.fn() }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/readyMade/kubernetesDashboards", async () => ({
  buildKubernetesDashboards: (
    await import("@/composables/readyMade/__fixtures__/kubernetesDashboardsStub")
  ).stubKubernetesDashboards,
}));
vi.mock("@/utils/commons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/commons")>()),
  getFoldersList: vi.fn().mockResolvedValue([]),
  getFoldersListByType: vi.fn().mockResolvedValue([]),
}));

import dashboards from "@/services/dashboards";
import settings from "@/services/settings";
import common from "@/services/common";
import { queryClient } from "@/composables/query/queryClient";
import { resetReadyMadeSessionMemory } from "@/composables/readyMade/readyMadeSettings";
import ReadyMadeOffers from "./ReadyMadeOffers.vue";

const ORG = "org1";
const USER = "me@x.io";
const svc = dashboards as unknown as Record<string, ReturnType<typeof vi.fn>>;
const settingsSvc = settings as unknown as Record<string, ReturnType<typeof vi.fn>>;
const commonSvc = common as unknown as Record<string, ReturnType<typeof vi.fn>>;

const STREAMS: Record<string, string[]> = {
  kubernetes: ["kube_pod_status_phase", "k8s_node_cpu_usage"],
  postgresql: ["postgresql_backends", "postgresql_commits"],
  mysql: ["mysql_threads", "mysql_operations"],
  redis: ["redis_clients", "redis_commands"],
  otelcol: ["otelcol_process_uptime", "otelcol_exporter_sent"],
};

let rows: any[];
let folders: Map<string, { folderId: string; name: string }>;
let nextId: number;
let failCreateFor: Set<string>;
let forbidCreate: boolean;
let storedSetting: any;

const t = (key: string, named: Record<string, unknown> = {}, plural?: number) =>
  plural === undefined
    ? (i18n.global as any).t(key, named)
    : (i18n.global as any).t(key, named, plural);

const fakeBackend = (detected: string[]) => {
  rows = [];
  folders = new Map();
  nextId = 1;
  failCreateFor = new Set();
  forbidCreate = false;
  storedSetting = null;
  const metrics = detected.flatMap((id) => STREAMS[id]);
  getStreams.mockImplementation(async (type: string) => ({
    list: (type === "metrics" ? metrics : []).map((name) => ({ name })),
  }));
  settingsSvc.getSetting.mockImplementation(async () => {
    if (!storedSetting) throw Object.assign(new Error("404"), { response: { status: 404 } });
    return { data: { setting_value: storedSetting } };
  });
  settingsSvc.setUserSetting.mockImplementation(async (...args: any[]) => {
    storedSetting = args[3];
    return {};
  });
  svc.list.mockImplementation(async (...args: any[]) => {
    const title = String(args[7] ?? "").toLowerCase();
    return { data: { dashboards: rows.filter((r) => r.title.toLowerCase().includes(title)) } };
  });
  svc.get_Folder_By_Name.mockImplementation(async (_org: string, name: string) => {
    const folder = folders.get(name);
    if (!folder) throw Object.assign(new Error("404"), { response: { status: 404 } });
    return { data: folder };
  });
  svc.new_Folder.mockImplementation(async (_org: string, data: any) => {
    const folder = { folderId: `f-${data.name}`, name: data.name };
    folders.set(data.name, folder);
    return { data: folder };
  });
  svc.create.mockImplementation(async (_org: string, doc: any, folderId: string) => {
    if (forbidCreate) throw Object.assign(new Error("403"), { response: { status: 403 } });
    if ([...failCreateFor].some((name) => doc.title.startsWith(name))) throw new Error("boom");
    const id = `d${nextId++}`;
    rows.push({
      dashboard_id: id,
      folder_id: folderId,
      folder_name: [...folders.values()].find((f) => f.folderId === folderId)?.name,
      title: doc.title,
      role: doc.role,
      created: new Date(Date.UTC(2026, 9, 12, 10, 0, nextId)).toISOString(),
    });
    return { data: { version: 8, v8: { dashboardId: id } } };
  });
  commonSvc.list_Folders.mockImplementation(async () => ({
    data: { list: [...folders.values()] },
  }));
};

const seedInstalled = (sourceTitle: string, role: string, folderName = "Team") =>
  rows.push({
    dashboard_id: `seed-${rows.length}`,
    folder_id: `f-${folderName}`,
    folder_name: folderName,
    title: sourceTitle,
    role,
    created: "2026-01-01T00:00:00Z",
  });

/** Installs chain many awaits (lazy content imports included); let them all land. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("ReadyMadeOffers — banner + checklist dialog", () => {
  let wrapper: VueWrapper<any>;
  let router: any;

  beforeAll(async () => {
    // Warm the lazy content chunks so an install never outlives its test.
    await import("@/assets/dashboards/ready-made/postgresql.dashboard.json");
    await import("@/assets/dashboards/ready-made/mysql.dashboard.json");
    await import("@/assets/dashboards/ready-made/redis.dashboard.json");
    await import("@/assets/dashboards/ready-made/otel_collector.dashboard.json");
    await import("@/composables/readyMade/kubernetesDashboards");
  });

  const mountOffers = async () => {
    const store = createStore({
      state: {
        selectedOrganization: { identifier: ORG },
        userInfo: { email: USER },
        organizationData: { folders: [], foldersByType: {} },
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/dashboards", name: "dashboards", component: { template: "<div />" } },
        { path: "/dashboards/view", component: { template: "<div />" } },
        { path: "/ingest/redis", name: "redis", component: { template: "<div />" } },
        { path: "/ingest/mysql", name: "mysql", component: { template: "<div />" } },
        { path: "/ingest/otel", name: "otelCollector", component: { template: "<div />" } },
        { path: "/ingest/pg", name: "postgres", component: { template: "<div />" } },
        { path: "/ingest/k8s", name: "ingestFromKubernetes", component: { template: "<div />" } },
      ],
    });
    vi.spyOn(router, "push");
    const w = mount(ReadyMadeOffers, {
      global: { plugins: [store, router, i18n] },
      attachTo: document.body,
    });
    await settle();
    return w;
  };

  const banner = () => wrapper.find('[data-test="dashboards-ready-made-banner"]');
  const bannerText = () => wrapper.find('[data-test="dashboards-ready-made-banner-text"]').text();
  const click = async (dataTest: string) => {
    await wrapper.find(`[data-test="${dataTest}"]`).trigger("click");
    await settle();
  };
  const dialog = () => wrapper.find('[data-test="dashboards-ready-made-dialog"]');
  const row = (id: string) => wrapper.find(`[data-test="dashboards-ready-made-dialog-row-${id}"]`);
  // A pointer click lands on the cell; the box itself only takes keyboard activation.
  const toggleRow = async (id: string) => {
    await wrapper
      .find(`[data-test="dashboards-ready-made-dialog-check-cell-${id}"]`)
      .trigger("click");
    await flushPromises();
  };
  const checked = (id: string) =>
    wrapper
      .find(`[data-test="dashboards-ready-made-dialog-check-${id}"] button[role="checkbox"]`)
      .attributes("aria-checked");
  const primary = () => wrapper.find('[data-test="o-dialog-primary-btn"]');
  const destination = (id: string) =>
    wrapper.find(`[data-test="dashboards-ready-made-dialog-destination-${id}"]`).text();
  const declineNote = () =>
    wrapper.find('[data-test="dashboards-ready-made-dialog-decline-note"]').text();
  const savedStates = () =>
    Object.fromEntries(
      Object.entries(storedSetting?.sources ?? {}).map(([id, entry]: [string, any]) => [
        id,
        entry.state,
      ]),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    resetReadyMadeSessionMemory();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("banner states", () => {
    it("one source: names it, its folder, and offers Add / No thanks", async () => {
      fakeBackend(["postgresql"]);
      wrapper = await mountOffers();
      expect(bannerText()).toContain(t("dashboard.readyMade.foundOne", { name: "PostgreSQL" }));
      expect(bannerText()).toContain(t("dashboard.readyMade.askOne", { name: "PostgreSQL" }));
      expect(bannerText()).toContain(
        t("dashboard.readyMade.folderSentenceOne", { folder: "PostgreSQL" }),
      );
      expect(wrapper.find('[data-test="dashboards-ready-made-banner-add"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboards-ready-made-banner-choose"]').exists()).toBe(
        false,
      );
    });

    it("Kubernetes alone uses its four-dashboard copy", async () => {
      fakeBackend(["kubernetes"]);
      wrapper = await mountOffers();
      expect(bannerText()).toContain(t("dashboard.readyMade.askKubernetes"));
      expect(bannerText()).toContain(t("dashboard.readyMade.folderSentenceKubernetes"));
    });

    it("two or more sources: one banner with Add all N, Choose… and No thanks", async () => {
      fakeBackend(["kubernetes", "postgresql", "redis"]);
      wrapper = await mountOffers();
      expect(wrapper.findAll('[data-test="dashboards-ready-made-banner"]')).toHaveLength(1);
      expect(bannerText()).toContain("Kubernetes, PostgreSQL");
      expect(bannerText()).toContain("Redis");
      expect(wrapper.find('[data-test="dashboards-ready-made-banner-add-all"]').text()).toBe(
        t("dashboard.readyMade.addAll", { count: 3 }),
      );
      expect(wrapper.find('[data-test="dashboards-ready-made-banner-choose"]').exists()).toBe(true);
    });

    it("leaves out a source the user already answered", async () => {
      fakeBackend(["postgresql", "redis"]);
      storedSetting = { version: 1, sources: { redis: { state: "dismissed", at: "x" } } };
      wrapper = await mountOffers();
      expect(bannerText()).toContain(t("dashboard.readyMade.foundOne", { name: "PostgreSQL" }));
    });

    it("leaves out a source with a marked copy anywhere in the org", async () => {
      fakeBackend(["postgresql", "redis"]);
      seedInstalled("PostgreSQL / Overview", "ready-made:postgresql/overview:1", "DB");
      wrapper = await mountOffers();
      expect(bannerText()).toContain(t("dashboard.readyMade.foundOne", { name: "Redis" }));
    });

    it("shows nothing when the user's memory cannot be read", async () => {
      fakeBackend(["postgresql"]);
      settingsSvc.getSetting.mockRejectedValue(
        Object.assign(new Error("down"), { response: { status: 500 } }),
      );
      wrapper = await mountOffers();
      expect(banner().exists()).toBe(false);
    });

    it("shows nothing when nothing is detected", async () => {
      fakeBackend([]);
      wrapper = await mountOffers();
      expect(banner().exists()).toBe(false);
    });

    it("an ignored banner saves nothing", async () => {
      fakeBackend(["postgresql", "redis"]);
      wrapper = await mountOffers();
      expect(banner().exists()).toBe(true);
      expect(settingsSvc.setUserSetting).not.toHaveBeenCalled();
    });
  });

  describe("banner actions", () => {
    it("Add installs, remembers 'added', and opens the dashboard", async () => {
      fakeBackend(["postgresql"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-add");
      expect(svc.create).toHaveBeenCalledTimes(1);
      expect(savedStates()).toEqual({ postgresql: "added" });
      expect(router.push).toHaveBeenCalledWith({
        path: "/dashboards/view",
        query: { org_identifier: ORG, dashboard: "d1", folder: "f-PostgreSQL" },
      });
      expect(toastMock.mock.calls[0][0].message).toBe(
        t(
          "dashboard.readyMade.addedOne",
          { name: "PostgreSQL", folder: "PostgreSQL", count: 1 },
          1,
        ),
      );
      expect(wrapper.emitted("installed")).toHaveLength(1);
      expect(banner().exists()).toBe(false);
    });

    it("Add on Kubernetes opens Kubernetes / Cluster", async () => {
      fakeBackend(["kubernetes"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-add");
      expect(svc.create.mock.calls.map((call) => call[1].title)).toEqual([
        "Kubernetes / Cluster",
        "Kubernetes / Node",
        "Kubernetes / Pod",
        "Kubernetes / Workload",
      ]);
      expect(router.push.mock.calls[0][0].query.dashboard).toBe("d1");
    });

    it("Add all installs every source, stays on the list and toasts the folders", async () => {
      fakeBackend(["kubernetes", "postgresql", "redis"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-add-all");
      expect(router.push).not.toHaveBeenCalled();
      expect(savedStates()).toEqual({ kubernetes: "added", postgresql: "added", redis: "added" });
      const toast = toastMock.mock.calls.at(-1)![0];
      expect(toast.message).toContain("6");
      expect(toast.message).toContain("3");
      expect(toast.action.label).toBe(
        t("dashboard.readyMade.openFolder", { folder: "Kubernetes" }),
      );
      toast.action.handler();
      expect(router.push).toHaveBeenCalledWith({
        path: "/dashboards",
        query: { org_identifier: ORG, folder: "f-Kubernetes" },
      });
    });

    it("No thanks remembers every listed source as dismissed and says where to find them", async () => {
      fakeBackend(["postgresql", "redis"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-no-thanks");
      expect(savedStates()).toEqual({ postgresql: "dismissed", redis: "dismissed" });
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: t("dashboard.readyMade.dismissedToast") }),
      );
      expect(banner().exists()).toBe(false);
      expect(svc.create).not.toHaveBeenCalled();
    });

    it("a 403 turns the banner into one permission message and dismisses those sources", async () => {
      fakeBackend(["postgresql", "redis"]);
      forbidCreate = true;
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-add-all");
      expect(wrapper.find('[data-test="dashboards-ready-made-banner-forbidden"]').text()).toContain(
        t("dashboard.readyMade.forbidden"),
      );
      expect(savedStates()).toEqual({ postgresql: "dismissed", redis: "dismissed" });
      // One message only: no error toast on top of the banner.
      expect(toastMock).not.toHaveBeenCalled();
      expect(svc.create).toHaveBeenCalledTimes(1);
    });

    it("a partial failure still installs the others and offers Retry for the failed one", async () => {
      fakeBackend(["postgresql", "redis"]);
      failCreateFor.add("Redis");
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-add-all");
      expect(savedStates()).toEqual({ postgresql: "added" });
      const error = toastMock.mock.calls.find((call) => call[0].variant === "error")![0];
      expect(error.message).toBe(t("dashboard.readyMade.failed", { list: "Redis" }));
      failCreateFor.clear();
      error.action.handler();
      await settle();
      expect(savedStates()).toEqual({ postgresql: "added", redis: "added" });
    });
  });

  describe("Choose… checklist", () => {
    it("lists the offered sources ticked, with contents and destination", async () => {
      fakeBackend(["kubernetes", "redis"]);
      folders.set("Redis", { folderId: "f-Redis", name: "Redis" });
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      expect(dialog().exists()).toBe(true);
      expect(row("kubernetes").text()).toContain(t("dashboard.readyMade.contentsKubernetes"));
      expect(row("kubernetes").text()).toContain(t("dashboard.readyMade.dataFound"));
      expect(destination("kubernetes")).toBe(
        t("dashboard.readyMade.destinationNew", { folder: "Kubernetes" }),
      );
      expect(destination("redis")).toBe(
        t("dashboard.readyMade.destinationExisting", { folder: "Redis" }),
      );
      expect(primary().text()).toBe(t("dashboard.readyMade.addSelected", { count: 2 }));
    });

    it("reads the folders afresh, so a folder made since the list was cached reads as existing", async () => {
      fakeBackend(["mysql", "redis"]);
      wrapper = await mountOffers();
      // The org's folder list is cached before the user makes their own MySQL folder elsewhere.
      await click("dashboards-ready-made-banner-choose");
      expect(destination("mysql")).toBe(
        t("dashboard.readyMade.destinationNew", { folder: "MySQL" }),
      );
      await wrapper.find('[data-test="o-dialog-secondary-btn"]').trigger("click");
      await settle();
      folders.set("MySQL", { folderId: "mine", name: "MySQL" });
      const reads = commonSvc.list_Folders.mock.calls.length;

      await click("dashboards-ready-made-banner-choose");

      expect(commonSvc.list_Folders.mock.calls.length).toBe(reads + 1);
      expect(destination("mysql")).toBe(
        t("dashboard.readyMade.destinationExisting", { folder: "MySQL" }),
      );
      expect(destination("redis")).toBe(
        t("dashboard.readyMade.destinationNew", { folder: "Redis" }),
      );
    });

    it("never claims new or existing when the folder list cannot be read", async () => {
      fakeBackend(["mysql", "redis"]);
      commonSvc.list_Folders.mockRejectedValue(new Error("down"));
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      expect(destination("mysql")).toBe(
        t("dashboard.readyMade.destinationUnknown", { folder: "MySQL" }),
      );
    });

    it("says beside the button that unticked items won't be offered again, naming them", async () => {
      fakeBackend(["postgresql", "redis"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      expect(declineNote()).toBe(t("dashboard.readyMade.declineRule"));
      await toggleRow("redis");
      expect(declineNote()).toBe(
        (i18n.global as any).t("dashboard.readyMade.declineNamed", { list: "Redis" }, 1),
      );
      await toggleRow("postgresql");
      expect(declineNote()).toBe(
        (i18n.global as any).t(
          "dashboard.readyMade.declineNamed",
          { list: "PostgreSQL and Redis" },
          2,
        ),
      );
    });

    it("after Add selected, says which were not added and where to find them", async () => {
      fakeBackend(["postgresql", "redis"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      await toggleRow("redis");
      await primary().trigger("click");
      await settle();
      const info = toastMock.mock.calls.map((call) => call[0]).filter((x) => x.variant === "info");
      expect(info.map((x) => x.message)).toEqual([
        (i18n.global as any).t("dashboard.readyMade.notAddedToast", { list: "Redis" }, 1),
      ]);
      expect(info[0].message).toContain("Import → Ready-made dashboards");
    });

    it("ticked are added, unticked are dismissed, one left ticked is opened", async () => {
      fakeBackend(["kubernetes", "postgresql"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      await toggleRow("kubernetes");
      expect(primary().text()).toBe(t("dashboard.readyMade.addSelected", { count: 1 }));
      await primary().trigger("click");
      await settle();
      expect(savedStates()).toEqual({ kubernetes: "dismissed", postgresql: "added" });
      expect(svc.create.mock.calls.map((call) => call[1].title)).toEqual(["PostgreSQL / Overview"]);
      expect(router.push.mock.calls[0][0].path).toBe("/dashboards/view");
    });

    it("several ticked stay on the list with a toast", async () => {
      fakeBackend(["postgresql", "redis", "mysql"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      await toggleRow("mysql");
      await primary().trigger("click");
      // Two installs queue behind the dismissal's write, so a fixed tick count runs out under a loaded run.
      await vi.waitFor(
        () =>
          expect(savedStates()).toEqual({
            postgresql: "added",
            redis: "added",
            mysql: "dismissed",
          }),
        { timeout: 4000 },
      );
      await settle();
      expect(router.push).not.toHaveBeenCalled();
      // The added ones first, then the one left out.
      expect(toastMock.mock.calls.map((call) => call[0].variant)).toEqual(["success", "info"]);
      expect(toastMock.mock.calls[0][0].message).toBe(
        t("dashboard.readyMade.addedMany", {
          count: 2,
          folderCount: 2,
          list: "PostgreSQL, Redis",
        }),
      );
    });

    it("ticks and unticks from the cell and from the keyboard, once per activation", async () => {
      fakeBackend(["postgresql", "redis"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      await toggleRow("redis");
      expect(checked("redis")).toBe("false");
      await toggleRow("redis");
      expect(checked("redis")).toBe("true");
      // Space on the focused box dispatches a click on the button itself.
      await wrapper
        .find('[data-test="dashboards-ready-made-dialog-check-redis"] button[role="checkbox"]')
        .trigger("click");
      await flushPromises();
      expect(checked("redis")).toBe("false");
      expect(primary().text()).toBe(t("dashboard.readyMade.addSelected", { count: 1 }));
    });

    it("Add selected is disabled at zero", async () => {
      fakeBackend(["postgresql", "redis"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      await toggleRow("postgresql");
      await toggleRow("redis");
      expect(primary().attributes("disabled")).toBeDefined();
    });

    it("Cancel saves nothing", async () => {
      fakeBackend(["postgresql", "redis"]);
      wrapper = await mountOffers();
      await click("dashboards-ready-made-banner-choose");
      await toggleRow("redis");
      await wrapper.find('[data-test="o-dialog-secondary-btn"]').trigger("click");
      await flushPromises();
      expect(settingsSvc.setUserSetting).not.toHaveBeenCalled();
      expect(svc.create).not.toHaveBeenCalled();
      expect(banner().exists()).toBe(true);
    });
  });

  describe("Import → Ready-made dashboards", () => {
    const openImport = async () => {
      await wrapper.vm.openImport();
      await settle();
    };

    it("lists all five sources, ignoring dismissals", async () => {
      fakeBackend(["redis", "postgresql"]);
      storedSetting = { version: 1, sources: { redis: { state: "dismissed", at: "x" } } };
      seedInstalled("PostgreSQL / Overview", "ready-made:postgresql/overview:1", "DB team");
      wrapper = await mountOffers();
      await openImport();

      // Detected and not installed → ticked "Data found", even though dismissed.
      expect(row("redis").text()).toContain(t("dashboard.readyMade.dataFound"));
      expect(row("redis").find('button[role="checkbox"]').attributes("aria-checked")).toBe("true");
      // Installed → "Added · in <folder>" + Open, no checkbox.
      expect(row("postgresql").text()).toContain(
        t("dashboard.readyMade.addedIn", { folder: "DB team" }),
      );
      expect(row("postgresql").find('button[role="checkbox"]').exists()).toBe(false);
      expect(
        wrapper.find('[data-test="dashboards-ready-made-dialog-open-postgresql"]').exists(),
      ).toBe(true);
      // Not detected → unticked "No data yet" + Set up.
      expect(row("kubernetes").text()).toContain(t("dashboard.readyMade.noData"));
      expect(row("kubernetes").find('button[role="checkbox"]').attributes("aria-checked")).toBe(
        "false",
      );
      expect(
        wrapper.find('[data-test="dashboards-ready-made-dialog-set-up-kubernetes"]').exists(),
      ).toBe(true);
      expect(wrapper.findAll('[data-test^="dashboards-ready-made-dialog-row-"]')).toHaveLength(5);
    });

    it("unticking saves nothing; adding saves 'added'", async () => {
      fakeBackend(["redis", "postgresql"]);
      wrapper = await mountOffers();
      await openImport();
      await toggleRow("redis");
      await primary().trigger("click");
      await settle();
      expect(savedStates()).toEqual({ postgresql: "added" });
    });

    it("Open on an installed row opens its first dashboard", async () => {
      fakeBackend([]);
      for (const key of ["node", "cluster", "pod", "workload"]) {
        seedInstalled(`Kubernetes / ${key}`, `ready-made:kubernetes/${key}:1`, "Kubernetes");
      }
      wrapper = await mountOffers();
      await openImport();
      await click("dashboards-ready-made-dialog-open-kubernetes");
      expect(router.push).toHaveBeenCalledWith({
        path: "/dashboards/view",
        query: { org_identifier: ORG, dashboard: "seed-1", folder: "f-Kubernetes" },
      });
    });

    it("keeps a partial set tickable, and adding it creates only the missing dashboards", async () => {
      fakeBackend(["kubernetes"]);
      seedInstalled("Kubernetes / Cluster", "ready-made:kubernetes/cluster:1", "Kubernetes");
      folders.set("Kubernetes", { folderId: "f-Kubernetes", name: "Kubernetes" });
      wrapper = await mountOffers();
      await openImport();
      expect(checked("kubernetes")).toBe("true");
      expect(destination("kubernetes")).toBe(
        t("dashboard.readyMade.destinationExisting", { folder: "Kubernetes" }),
      );
      await primary().trigger("click");
      await settle();
      expect(svc.create.mock.calls.map((call) => call[1].title)).toEqual([
        "Kubernetes / Node",
        "Kubernetes / Pod",
        "Kubernetes / Workload",
      ]);
      // A gap fill names what came back instead of claiming all four were added, and opens the first of them.
      expect(toastMock.mock.calls.at(-1)![0].message).toBe(
        (i18n.global as any).t(
          "dashboard.readyMade.missingAdded",
          {
            list: "Kubernetes / Node, Kubernetes / Pod, and Kubernetes / Workload",
            folder: "Kubernetes",
          },
          3,
        ),
      );
      expect(router.push.mock.calls.at(-1)[0].query.dashboard).toBe("d1");
    });

    it("shows where an installed dashboard lives now, after it was moved", async () => {
      fakeBackend(["postgresql"]);
      seedInstalled("PostgreSQL / Overview", "ready-made:postgresql/overview:1", "PostgreSQL");
      wrapper = await mountOffers();
      await openImport();
      expect(row("postgresql").text()).toContain(
        t("dashboard.readyMade.addedIn", { folder: "PostgreSQL" }),
      );
      await wrapper.find('[data-test="o-dialog-secondary-btn"]').trigger("click");
      await settle();
      // Moved through the Dashboards list, which writes outside the ready-made lookups' cache.
      Object.assign(rows[0], { folder_id: "f-Team", folder_name: "Team" });

      await openImport();

      expect(row("postgresql").text()).toContain(
        t("dashboard.readyMade.addedIn", { folder: "Team" }),
      );
    });

    it("never warns about unticking: in this list it remembers nothing", async () => {
      fakeBackend(["redis", "postgresql"]);
      wrapper = await mountOffers();
      await openImport();
      expect(wrapper.find('[data-test="dashboards-ready-made-dialog-decline-note"]').exists()).toBe(
        false,
      );
    });

    it("Set up opens the source's data-source page", async () => {
      fakeBackend([]);
      wrapper = await mountOffers();
      await openImport();
      await click("dashboards-ready-made-dialog-set-up-redis");
      expect(router.push).toHaveBeenCalledWith({ name: "redis", query: { org_identifier: ORG } });
    });

    it("marks an existing same-name folder as the destination", async () => {
      fakeBackend(["mysql"]);
      folders.set("MySQL", { folderId: "mine", name: "MySQL" });
      wrapper = await mountOffers();
      await openImport();
      expect(
        wrapper.find('[data-test="dashboards-ready-made-dialog-destination-mysql"]').text(),
      ).toBe(t("dashboard.readyMade.destinationExisting", { folder: "MySQL" }));
    });
  });
});
