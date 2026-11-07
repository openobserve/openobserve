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
  push: vi.fn(async () => {}),
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
    return {};
  },
  matchPack: async () => ({
    ready: fake.ready,
    dashboards: new Map([["overview", fake.dashboard]]),
  }),
}));
vi.mock("@/composables/starterPacks/useInstallRecords", () => ({
  useInstallRecords: () => ({ list: async () => fake.records }),
}));

import StarterPackLibraryTab from "./StarterPackLibraryTab.vue";

const render = async (view: "packs" | "dashboards" = "packs") => {
  const wrapper = mount(StarterPackLibraryTab, {
    props: { org: "org", view },
    global: { plugins: [i18n] },
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

  it("uses the existing filter words", async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-test="library-tab-state-kubernetes"]').text()).toBe("Ready to use");
    expect(wrapper.get('[data-test="library-tab-stat-ready"]').text()).toContain("Ready to use");
    expect(wrapper.get('[data-test="library-tab-stat-missing"]').text()).toContain("Not ingested");
  });

  it("shows Not ingested and filters to it", async () => {
    fake.ready = false;
    const wrapper = await render();
    expect(wrapper.get('[data-test="library-tab-state-kubernetes"]').text()).toBe("Not ingested");
    await wrapper.get('[data-test="library-tab-stat-ready"]').trigger("click");
    expect(wrapper.find('[data-test="library-tab-empty"]').exists()).toBe(true);
  });

  it("lists every install with its installer and date under Installed", async () => {
    fake.records = [
      record({ installId: "one" }),
      record({ installId: "two", installedBy: "b@example.com", status: "incomplete" }),
      record({ installId: "gone", status: "removed" }),
    ];
    const wrapper = await render();
    await wrapper.get('[data-test="library-tab-stat-installed"]').trigger("click");
    const one = wrapper.get('[data-test="library-tab-installed-one"]').text();
    expect(one).toContain("a@example.com");
    expect(one).toContain(new Date(1_700_000_000_000).toLocaleString());
    expect(wrapper.get('[data-test="library-tab-installed-two"]').text()).toContain("Incomplete");
    expect(wrapper.find('[data-test="library-tab-installed-gone"]').exists()).toBe(false);
  });

  it("explains an empty Installed filter", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="library-tab-stat-installed"]').trigger("click");
    expect(wrapper.get('[data-test="library-tab-empty"]').text()).toContain(
      "No pack has been installed",
    );
  });

  it("lists pack dashboards with their own verdict", async () => {
    fake.dashboard = false;
    fake.records = [record({})];
    const wrapper = await render("dashboards");
    const id = "kubernetes/overview/one";
    expect(wrapper.get(`[data-test="library-tab-state-${id}"]`).text()).toBe("Not ingested");
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

  it("opens the pack page", async () => {
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
    expect(wrapper.find('[data-test="library-tab-state-kubernetes"]').exists()).toBe(true);
  });
});
