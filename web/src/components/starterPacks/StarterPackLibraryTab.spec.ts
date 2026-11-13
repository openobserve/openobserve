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
  fail: false,
  records: [] as Array<Record<string, unknown>>,
  rawLogs: [] as Array<{ stream: string; column: string }>,
  rawLogsFor: [] as string[][],
  push: vi.fn(async () => {}),
  copy: vi.fn(),
  update: { available: { value: false }, check: vi.fn(async () => true) },
  state: { zoConfig: {}, userInfo: { role: "admin", email: "a@example.com" } } as Record<
    string,
    any
  >,
  repairs: [] as Array<Record<string, any>>,
  undo: vi.fn(async () => {}),
  pack: {
    id: "kubernetes",
    titleKey: "starterPacks.kubernetes.title",
    descriptionKey: "starterPacks.kubernetes.description",
    dashboards: [{ id: "overview", title: "Kubernetes Overview" }],
    collectorRoute: "ingestFromKubernetes",
  } as Record<string, unknown>,
}));

vi.mock("vuex", () => ({ useStore: () => ({ state: fake.state }) }));
vi.mock("./StarterPackDrawer.vue", () => ({
  default: { name: "StarterPackDrawer", template: "<div />" },
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: fake.copy }));
vi.mock("@/composables/starterPacks/useNginxParse", () => ({
  useNginxParse: () => ({
    active: async () => fake.repairs,
    preview: async () => ({ format: "combined", rows: [] }),
    readers: async () => [],
    confirm: vi.fn(),
    undo: fake.undo,
  }),
}));
vi.mock("@/composables/starterPacks/usePackUpdates", () => ({
  usePackUpdates: () => fake.update,
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: fake.push }),
}));
vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({ loadManifest: vi.fn(), loadAlertFile: vi.fn() }),
}));
vi.mock("@/composables/starterPacks/kubernetesPack", () => ({
  STARTER_PACKS: [fake.pack],
}));
vi.mock("@/composables/starterPacks/packMatchData", () => ({
  readOrgStreams: async () => {
    if (fake.fail) throw new Error("down");
    return { logs: new Map([["edge", 1]]) };
  },
  matchPack: async () => ({
    ready: fake.ready,
    alerts: new Map([
      ["a1", fake.ready],
      ["a2", false],
    ]),
    dashboards: new Map([["overview", fake.ready]]),
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

import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import StarterPackLibraryTab from "./StarterPackLibraryTab.vue";

const flow = useStarterPackFlow("org", {} as never);

const render = async () => {
  const wrapper = mount(StarterPackLibraryTab, {
    props: { org: "org" },
    global: { plugins: [i18n], stubs: { StarterPackDrawer: true, StarterPackUndoDialog: true } },
  });
  await flushPromises();
  return wrapper;
};
type Wrapper = Awaited<ReturnType<typeof render>>;
const text = (wrapper: Wrapper, id: string) => wrapper.get(`[data-test="${id}"]`).text();
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-test="${id}"]`).exists();
const pick = async (wrapper: Wrapper, tile: string) => {
  await wrapper.get(`[data-test="library-tab-stat-${tile}"]`).trigger("click");
  await flushPromises();
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
const shortDate = new Date(1_700_000_000_000).toLocaleDateString(undefined, {
  day: "numeric",
  month: "short",
});

describe("StarterPackLibraryTab", () => {
  beforeEach(() => {
    fake.ready = true;
    fake.fail = false;
    fake.records = [];
    fake.push.mockClear();
    fake.copy.mockClear();
    fake.update.available.value = false;
    fake.state.userInfo.role = "admin";
    flow.record.value = null;
    flow.running.value = false;
    flow.alertsOff.value = 0;
    flow.installed.value = false;
    flow.licensed.value = true;
    delete fake.pack.nativeView;
    vi.mocked(flow.install).mockClear();
    vi.mocked(flow.undo).mockClear();
  });

  it("counts packs in the stat strip and offers Set up on a pack that fits", async () => {
    const wrapper = await render();
    expect(text(wrapper, "library-tab-stat-ready")).toContain("1");
    expect(text(wrapper, "library-tab-stat-all")).toContain("1");
    expect(text(wrapper, "library-tab-state-kubernetes")).toBe("Ready to use");
    expect(text(wrapper, "library-tab-counts-kubernetes")).toBe(
      "1 dashboard · 2 alerts · 1 saved view",
    );
    expect(text(wrapper, "library-tab-meta-kubernetes")).toBe("2 of 3 items fit your data");
    expect(text(wrapper, "library-tab-install-kubernetes")).toBe("Set up Kubernetes monitoring");
    expect(has(wrapper, "library-tab-see-kubernetes")).toBe(true);
  });

  it("loads the install preview so its count matches Home and the drawer", async () => {
    vi.mocked(flow.loadPreview).mockClear();
    await render();
    expect(flow.loadPreview).toHaveBeenCalledTimes(1);
  });

  it("offers Open pack and Ingestion guide, never Set up, for a pack without data", async () => {
    fake.ready = false;
    const wrapper = await render();
    expect(text(wrapper, "library-tab-state-kubernetes")).toBe("Not ingested");
    expect(text(wrapper, "library-tab-meta-kubernetes")).toBe("Needs Kubernetes data");
    expect(has(wrapper, "library-tab-install-kubernetes")).toBe(false);
    await wrapper.get('[data-test="library-tab-guide-kubernetes"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith({
      name: "ingestFromKubernetes",
      query: { org_identifier: "org" },
    });
    await pick(wrapper, "ready");
    expect(has(wrapper, "library-tab-empty")).toBe(true);
    await pick(wrapper, "missing");
    expect(has(wrapper, "library-tab-row-kubernetes")).toBe(true);
  });

  it("hides the stat strip while loading", async () => {
    const wrapper = mount(StarterPackLibraryTab, {
      props: { org: "org" },
      global: { plugins: [i18n], stubs: { StarterPackDrawer: true } },
    });
    expect(has(wrapper, "library-tab-loading")).toBe(true);
    expect(has(wrapper, "library-tab-strip")).toBe(false);
    await flushPromises();
    expect(has(wrapper, "library-tab-strip")).toBe(true);
  });

  it("marks a pack with a failed item Incomplete and offers Retry", async () => {
    fake.records = [
      record({
        items: [
          { kind: "dashboard", itemId: "overview", status: "created" },
          { kind: "alert", itemId: "a", status: "failed" },
        ],
      }),
    ];
    const wrapper = await render();
    expect(text(wrapper, "library-tab-meta-one")).toBe(
      `Installed by a@example.com on ${shortDate} · Incomplete`,
    );
    const retry = wrapper.get('[data-test="library-tab-retry-one"]');
    expect(retry.text()).toBe("Retry 1 item");
    await retry.trigger("click");
    expect(flow.install).toHaveBeenCalledTimes(1);
  });

  it("counts what setup made on an installed card, not what the pack holds", async () => {
    fake.records = [
      record({
        items: [
          { kind: "folder", itemId: "f", status: "created" },
          { kind: "dashboard", itemId: "overview", status: "existing" },
          { kind: "alert", itemId: "a", status: "created" },
          { kind: "alert", itemId: "b", status: "failed" },
          { kind: "alert", itemId: "c", status: "skipped" },
        ],
      }),
    ];
    const wrapper = await render();
    expect(text(wrapper, "library-tab-counts-one")).toBe("1 dashboard · 1 alert");
  });

  it("lists every install with its installer and date under Installed", async () => {
    fake.records = [
      record({ installId: "one" }),
      record({ installId: "two", installedBy: "b@example.com", status: "incomplete" }),
      record({ installId: "gone", status: "removed" }),
    ];
    const wrapper = await render();
    await pick(wrapper, "installed");
    expect(text(wrapper, "library-tab-meta-one")).toBe(
      `Installed by a@example.com on ${shortDate}`,
    );
    expect(text(wrapper, "library-tab-meta-two")).toContain("Incomplete");
    expect(has(wrapper, "library-tab-row-gone")).toBe(false);
  });

  it("explains an empty Installed filter", async () => {
    const wrapper = await render();
    await pick(wrapper, "installed");
    expect(text(wrapper, "library-tab-empty")).toContain("No pack has been installed");
  });

  it("offers Turn on N alerts, which opens the pack page with the Turn on drawer", async () => {
    const installed = record({});
    fake.records = [installed];
    flow.record.value = installed as never;
    flow.alertsOff.value = 2;
    const wrapper = await render();
    expect(text(wrapper, "library-tab-meta-one")).toContain("2 alerts off");
    await wrapper.get('[data-test="library-tab-turn-on-one"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith({
      name: "starterPack",
      params: { pack: "kubernetes" },
      query: { org_identifier: "org", turnOn: "1" },
    });
  });

  it("offers Review update when the installed pack has an update", async () => {
    const installed = record({});
    fake.records = [installed];
    flow.record.value = installed as never;
    flow.installed.value = true;
    fake.update.available.value = true;
    const wrapper = await render();
    expect(fake.update.check).toHaveBeenCalled();
    expect(text(wrapper, "library-tab-meta-one")).toBe("An update to this pack is available");
    expect(has(wrapper, "library-tab-review-update-one")).toBe(true);
  });

  it("shows a pack being set up as busy, then an interrupted one with only Open pack", async () => {
    const installing = record({
      status: "installing",
      items: [
        { kind: "dashboard", itemId: "overview", status: "created" },
        { kind: "alert", itemId: "a", status: "pending" },
      ],
    });
    fake.records = [installing];
    flow.record.value = installing as never;
    flow.running.value = true;
    flow.alertsOff.value = 2;
    const wrapper = await render();
    expect(text(wrapper, "library-tab-meta-one")).toBe("Setting up · 1 of 2 created");
    expect(has(wrapper, "library-tab-open-one")).toBe(false);
    flow.running.value = false;
    await flushPromises();
    expect(text(wrapper, "library-tab-meta-one")).toContain("Incomplete");
    expect(has(wrapper, "library-tab-open-one")).toBe(true);
    expect(has(wrapper, "library-tab-turn-on-one")).toBe(false);
    expect(has(wrapper, "library-tab-undo-one")).toBe(false);
  });

  it("never offers Undo setup while the setup is still running", async () => {
    const installing = record({ status: "installing" });
    fake.records = [installing];
    flow.record.value = installing as never;
    flow.running.value = true;
    expect(has(await render(), "library-tab-undo-one")).toBe(false);
  });

  it("asks before Undo setup removes what the pack created", async () => {
    const installed = record({});
    fake.records = [installed];
    flow.record.value = installed as never;
    flow.alertsOff.value = 0;
    const wrapper = await render();
    await wrapper.get('[data-test="library-tab-undo-one"]').trigger("click");
    const dialog = wrapper.findComponent({ name: "StarterPackUndoDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("mode")).toBe("undo");
    expect(flow.undo).not.toHaveBeenCalled();
  });

  it("offers Open pack and What gets created, not Set up, when the pack's view needs a license", async () => {
    fake.pack.nativeView = { feature: "kubernetes_monitoring", route: "infraKubernetes" };
    flow.licensed.value = false;
    const wrapper = await render();
    expect(has(wrapper, "library-tab-install-kubernetes")).toBe(false);
    expect(has(wrapper, "library-tab-open-kubernetes")).toBe(true);
    expect(has(wrapper, "library-tab-see-kubernetes")).toBe(true);
  });

  it("refreshes in place, keeping the cards and the chosen filter", async () => {
    const wrapper = await render();
    await pick(wrapper, "ready");
    const done = (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh();
    await wrapper.vm.$nextTick();
    expect(has(wrapper, "library-tab-loading")).toBe(false);
    await done;
    await flushPromises();
    expect(has(wrapper, "library-tab-install-kubernetes")).toBe(true);
    expect(wrapper.findComponent({ name: "OStatStrip" }).props("selectedKey")).toBe("ready");
  });

  it("gives a non-admin Copy link for an admin instead of Set up", async () => {
    fake.state.userInfo.role = "member";
    const wrapper = await render();
    expect(text(wrapper, "library-tab-meta-kubernetes")).toContain("only admins can set up packs");
    expect(has(wrapper, "library-tab-install-kubernetes")).toBe(false);
    await wrapper.get('[data-test="library-tab-copy-link-kubernetes"]').trigger("click");
    expect(fake.copy).toHaveBeenCalledWith(flow.packLink(), expect.anything());
  });

  it("opens the pack page from Open pack", async () => {
    fake.records = [record({ installId: "kubernetes" })];
    const wrapper = await render();
    await wrapper.get('[data-test="library-tab-open-kubernetes"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "starterPack", params: { pack: "kubernetes" } }),
    );
  });

  it("shows an error with retry and no stat strip", async () => {
    fake.fail = true;
    const wrapper = await render();
    expect(has(wrapper, "library-tab-strip")).toBe(false);
    const error = wrapper.get('[data-test="library-tab-error"]');
    fake.fail = false;
    await error.get("button").trigger("click");
    await flushPromises();
    expect(has(wrapper, "library-tab-row-kubernetes")).toBe(true);
  });

  describe("raw logs", () => {
    beforeEach(() => {
      Object.assign(fake, { rawLogs: [], rawLogsFor: [], repairs: [] });
      fake.state.userInfo.role = "member";
      fake.undo.mockClear();
    });

    it("names plain-text Nginx logs on a card without an action for a non-admin", async () => {
      fake.rawLogs = [{ stream: "edge", column: "message" }];
      const wrapper = await render();
      const notice = wrapper.find('[data-test="library-tab-raw-log-edge"]');
      expect(notice.text()).toContain("Looks like Nginx logs in edge, stored as plain text");
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
      const card = wrapper.get('[data-test="library-tab-parsing-edge"]');
      expect(card.text()).toContain("not fully set up");
      expect(card.find("button").exists()).toBe(false);
    });

    it("shows nothing when no stream reads as raw Nginx", async () => {
      const wrapper = await render();
      expect(wrapper.find('[data-test^="library-tab-raw-log-"]').exists()).toBe(false);
    });
  });
});
