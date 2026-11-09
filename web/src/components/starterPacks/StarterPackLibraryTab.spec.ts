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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";

const fake = vi.hoisted(() => ({
  ready: true,
  dashboard: true,
  fail: false,
  records: [] as Array<Record<string, unknown>>,
  rawLogs: [] as Array<{ stream: string; column: string }>,
  rawLogsFor: [] as string[][],
  push: vi.fn(async () => {}),
  state: { zoConfig: {}, userInfo: { role: "member", email: "a@example.com" } } as Record<
    string,
    any
  >,
  repairs: [] as Array<Record<string, any>>,
  undo: vi.fn(async () => {}),
}));

vi.mock("vuex", () => ({ useStore: () => ({ state: fake.state }) }));
vi.mock("@/composables/starterPacks/useNginxParse", () => ({
  useNginxParse: () => ({
    active: async () => fake.repairs,
    preview: async () => ({ format: "combined", rows: [] }),
    readers: async () => [],
    confirm: vi.fn(),
    undo: fake.undo,
  }),
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: fake.push }),
}));
vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({ loadManifest: vi.fn(), loadAlertFile: vi.fn() }),
}));
vi.mock("@/composables/starterPacks/kubernetesPack", () => ({
  STARTER_PACKS: [
    {
      id: "kubernetes",
      titleKey: "starterPacks.kubernetes.title",
      descriptionKey: "starterPacks.kubernetes.description",
      dashboards: [{ id: "overview", title: "Kubernetes Overview" }],
    },
  ],
}));
vi.mock("@/composables/starterPacks/packMatchData", () => ({
  readOrgStreams: async () => {
    if (fake.fail) throw new Error("down");
    return { logs: new Map([["edge", 1]]) };
  },
  matchPack: async () => ({
    ready: fake.ready,
    dashboards: new Map([["overview", fake.dashboard]]),
  }),
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", async (importOriginal) => {
  const { fakeFlow } = await import("./starterPackTestFlow");
  const flow = fakeFlow();
  return {
    ...(await importOriginal<typeof import("@/composables/starterPacks/useStarterPackFlow")>()),
    useStarterPackFlow: () => flow,
  };
});
vi.mock("@/composables/starterPacks/rawLogs", () => ({
  findRawNginxLogs: async (_org: string, streams: Map<string, number>) => {
    fake.rawLogsFor.push([...streams.keys()]);
    return fake.rawLogs;
  },
}));
vi.mock("@/composables/starterPacks/useStreamValues", () => ({
  useStreamValues: () => ({ readValues: vi.fn() }),
}));
vi.mock("@/composables/starterPacks/useInstallRecords", () => ({
  useInstallRecords: () => ({ list: async () => fake.records }),
}));

import StarterPackLibraryTab from "./StarterPackLibraryTab.vue";

const render = async (view: "packs" | "dashboards" = "packs") => {
  const wrapper = mount(StarterPackLibraryTab, {
    props: { org: "org", view },
    global: { plugins: [i18n], stubs: { StarterPackDrawer: true } },
  });
  await flushPromises();
  return wrapper;
};
const record = (over: Record<string, unknown>) => ({
  packId: "kubernetes",
  installId: "one",
  status: "complete",
  items: [{ kind: "dashboard", itemId: "overview", status: "created" }],
  installedBy: "a@example.com",
  installedAt: 1_700_000_000_000_000,
  ...over,
});

describe("StarterPackLibraryTab", () => {
  beforeEach(() => {
    fake.ready = true;
    fake.dashboard = true;
    fake.fail = false;
    fake.records = [];
    fake.push.mockClear();
  });

  it("puts a pack that fits under Fits your data with its counts in the chips", async () => {
    const wrapper = await render();
    expect(wrapper.find('[data-test="library-tab-section-fits"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="library-tab-chip-ready"]').text()).toBe("Fits your data · 1");
    expect(wrapper.get('[data-test="library-tab-chip-all"]').text()).toBe("All · 1");
    expect(wrapper.get('[data-test="library-tab-install-kubernetes"]').text()).toBe(
      "Install 4 items",
    );
    expect(wrapper.find('[data-test="library-tab-see-kubernetes"]').exists()).toBe(true);
  });

  it("loads the install preview so its count matches Home and the drawer", async () => {
    const { useStarterPackFlow } = await import("@/composables/starterPacks/useStarterPackFlow");
    const flow = useStarterPackFlow("org", {} as never);
    vi.mocked(flow.loadPreview).mockClear();
    await render();
    expect(flow.loadPreview).toHaveBeenCalledTimes(1);
  });

  it("puts a pack without data under Nothing matching yet and filters it out", async () => {
    fake.ready = false;
    const wrapper = await render();
    expect(wrapper.find('[data-test="library-tab-section-missing"]').exists()).toBe(true);
    await wrapper.get('[data-test="library-tab-chip-ready"]').trigger("click");
    expect(wrapper.find('[data-test="library-tab-empty"]').exists()).toBe(true);
  });

  it("searches by name", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="library-tab-search"] input').setValue("nothing-like-this");
    await flushPromises();
    expect(wrapper.find('[data-test="library-tab-empty"]').exists()).toBe(true);
  });

  it("shows how many items an installed pack has and offers Manage", async () => {
    fake.records = [
      record({
        items: [
          { kind: "dashboard", itemId: "overview", status: "created" },
          { kind: "alert", itemId: "a", status: "failed" },
        ],
      }),
    ];
    const wrapper = await render();
    const items = wrapper.get('[data-test="library-tab-items-one"]').text();
    expect(items).toContain("1 of 2 items installed");
    expect(items).toContain("1 item could not be created");
    expect(wrapper.get('[data-test="library-tab-state-one"]').text()).toBe("Installed");
    expect(wrapper.find('[data-test="library-tab-open-dashboard-one"]').exists()).toBe(true);
  });

  it("lists every install with its installer and date under Installed", async () => {
    fake.records = [
      record({ installId: "one" }),
      record({ installId: "two", installedBy: "b@example.com", status: "incomplete" }),
      record({ installId: "gone", status: "removed" }),
    ];
    const wrapper = await render();
    await wrapper.get('[data-test="library-tab-chip-installed"]').trigger("click");
    const one = wrapper.get('[data-test="library-tab-installed-one"]').text();
    expect(one).toContain("a@example.com");
    expect(one).toContain(new Date(1_700_000_000_000).toLocaleString());
    expect(wrapper.get('[data-test="library-tab-installed-two"]').text()).toContain("Incomplete");
    expect(wrapper.find('[data-test="library-tab-installed-gone"]').exists()).toBe(false);
  });

  it("explains an empty Installed filter", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="library-tab-chip-installed"]').trigger("click");
    expect(wrapper.get('[data-test="library-tab-empty"]').text()).toContain(
      "No pack has been installed",
    );
  });

  it("lists pack dashboards with their own verdict", async () => {
    fake.dashboard = false;
    fake.records = [record({})];
    const wrapper = await render("dashboards");
    const id = "kubernetes/overview/one";
    expect(wrapper.find('[data-test="library-tab-section-missing"]').exists()).toBe(true);
    expect(wrapper.get(`[data-test="library-tab-installed-${id}"]`).text()).toContain(
      "a@example.com",
    );
  });

  it("lists every install of a dashboard", async () => {
    fake.records = [record({}), record({ installId: "two", installedBy: "b@example.com" })];
    const wrapper = await render("dashboards");
    const line = '[data-test="library-tab-installed-kubernetes/overview/two"]';
    expect(wrapper.get(line).text()).toContain("b@example.com");
    expect(
      wrapper.find('[data-test="library-tab-installed-kubernetes/overview/one"]').exists(),
    ).toBe(true);
  });

  it("opens the pack page from Manage", async () => {
    fake.records = [record({ installId: "kubernetes" })];
    const wrapper = await render();
    await wrapper.get('[data-test="library-tab-open-kubernetes"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "starterPack", params: { pack: "kubernetes" } }),
    );
  });

  it("shows an error with retry", async () => {
    fake.fail = true;
    const wrapper = await render();
    const error = wrapper.get('[data-test="library-tab-error"]');
    fake.fail = false;
    await error.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="library-tab-row-kubernetes"]').exists()).toBe(true);
  });

  describe("raw logs", () => {
    beforeEach(() => {
      Object.assign(fake, { rawLogs: [], rawLogsFor: [], repairs: [] });
      fake.state.userInfo.role = "member";
      fake.undo.mockClear();
    });

    it("names plain-text Nginx logs without an action for a non-admin", async () => {
      fake.rawLogs = [{ stream: "edge", column: "message" }];
      const wrapper = await render();
      const notice = wrapper.find('[data-test="library-tab-raw-log-edge"]');
      expect(notice.text()).toBe("Looks like Nginx logs in edge, stored as plain text");
      expect(notice.find("button").exists()).toBe(false);
      expect(fake.rawLogsFor).toEqual([["edge"]]);
    });

    it("offers Parse these logs to an admin", async () => {
      fake.state.userInfo.role = "admin";
      fake.rawLogs = [{ stream: "edge", column: "message" }];
      const wrapper = await render();
      const button = wrapper.get('[data-test="library-tab-parse-edge"]');
      expect(button.text()).toBe("Parse these logs");
    });

    it("lists a stream being parsed instead of its notice, and Undo removes only that repair", async () => {
      fake.state.userInfo.role = "admin";
      fake.rawLogs = [{ stream: "edge", column: "message" }];
      const repair = {
        packId: "nginx_parse",
        installId: "starter_pack_nginx_edge",
        status: "complete",
        items: [{ kind: "function", itemId: "combined", status: "created", stream: "edge" }],
      };
      fake.repairs = [repair];
      const wrapper = await render();
      expect(wrapper.find('[data-test="library-tab-raw-log-edge"]').exists()).toBe(false);
      expect(wrapper.get('[data-test="library-tab-parsing-edge"]').text()).toContain(
        "Parsing new Nginx logs in edge",
      );
      await wrapper.get('[data-test="library-tab-parse-undo-edge"]').trigger("click");
      await flushPromises();
      const dialog = document.querySelector('[data-test="starter-pack-parse-undo-dialog"]');
      expect(dialog?.textContent).toContain("keep their added fields");
      (
        document.querySelector('[data-test="starter-pack-parse-undo-confirm-btn"]') as HTMLElement
      ).click();
      await flushPromises();
      expect(fake.undo).toHaveBeenCalledWith(repair);
    });

    it("hides Undo on a repair from a non-admin", async () => {
      fake.repairs = [
        {
          packId: "nginx_parse",
          installId: "x",
          status: "incomplete",
          items: [{ stream: "edge" }],
        },
      ];
      const wrapper = await render();
      const banner = wrapper.get('[data-test="library-tab-parsing-edge"]');
      expect(banner.text()).toContain("not fully set up");
      expect(banner.find("button").exists()).toBe(false);
    });

    it("shows nothing when no stream reads as raw Nginx, and never checks on Dashboards", async () => {
      const packs = await render();
      expect(packs.find('[data-test^="library-tab-raw-log-"]').exists()).toBe(false);
      await render("dashboards");
      expect(fake.rawLogsFor).toHaveLength(1);
    });
  });
});
