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
import store from "@/test/unit/helpers/store";

const fake = vi.hoisted(() => ({
  ready: {} as Record<string, boolean>,
  failing: "",
  metrics: ["kube_pod_status_phase", "system_cpu_time"],
  matchPack: vi.fn(),
  installs: {} as Record<string, Array<{ status: string }>>,
  alerts: {} as Record<string, Array<Record<string, unknown>>>,
  push: vi.fn(() => Promise.resolve()),
}));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));
vi.mock("@/composables/alerts/useAlertLibrary", () => ({
  useAlertLibrary: () => ({ loadManifest: vi.fn(), loadAlertFile: vi.fn() }),
}));
vi.mock("@/composables/starterPacks/packMatchData", () => ({
  readOrgStreams: async () => ({ metrics: new Map(fake.metrics.map((name) => [name, 1])) }),
  matchPack: (...args: unknown[]) => fake.matchPack(...args),
}));
vi.mock("@/composables/starterPacks/useInstallRecords", () => ({
  useInstallRecords: () => ({
    list: async (id: string) => {
      if (fake.failing === id) throw new Error("down");
      return fake.installs[id] ?? [];
    },
  }),
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", async () => {
  const { fakeFlow } = await import("./starterPackTestFlow");
  const flow = fakeFlow();
  return { useStarterPackFlow: () => flow };
});
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: async (options: { queryKey: unknown[] }) => {
    const tag = JSON.stringify(options.queryKey).match(/pack:([a-z]+)/)?.[1] ?? "";
    return fake.alerts[tag] ?? [];
  },
}));

import StarterPackCoverageLine from "./StarterPackCoverageLine.vue";

const mountLine = async (refreshKey = "a") => {
  const wrapper = mount(StarterPackCoverageLine, {
    props: { org: "org", refreshKey },
    global: { plugins: [i18n, store], stubs: { StarterPackDrawer: true } },
  });
  await flushPromises();
  return wrapper;
};

describe("StarterPackCoverageLine", () => {
  beforeEach(() => {
    fake.ready = {};
    fake.installs = {};
    fake.alerts = {};
    fake.failing = "";
    fake.metrics = ["kube_pod_status_phase", "system_cpu_time"];
    fake.matchPack.mockReset();
    fake.matchPack.mockImplementation(async (_org: string, pack: { id: string }) => ({
      ready: !!fake.ready[pack.id],
      alerts: new Map([
        ["a", true],
        ["b", true],
        ["c", false],
      ]),
    }));
    fake.push.mockClear();
  });

  it("stays hidden when no pack matches", async () => {
    const wrapper = await mountLine();
    expect(wrapper.find('[data-test="starter-pack-coverage-line"]').exists()).toBe(false);
  });

  it("offers a matched pack that is not installed with its fit count", async () => {
    fake.ready = { kubernetes: true };
    const wrapper = await mountLine();
    expect(wrapper.find('[data-test="starter-pack-coverage-fit-kubernetes"]').text()).toBe(
      "2 fit your data",
    );
    expect(wrapper.find('[data-test="starter-pack-coverage-install-kubernetes"]').text()).toBe(
      "Install 2 alerts",
    );
    expect(wrapper.find('[data-test="starter-pack-coverage-see-kubernetes"]').exists()).toBe(true);
  });

  it("links an installed pack with every alert off to its page", async () => {
    fake.ready = { kubernetes: true, hosts: true };
    fake.installs = { kubernetes: [{ status: "complete" }], hosts: [{ status: "complete" }] };
    fake.alerts = { kubernetes: [{ enabled: false }], hosts: [{ enabled: true }] };
    const wrapper = await mountLine();
    const link = wrapper.find('[data-test="starter-pack-coverage-link-kubernetes"]');
    expect(link.text()).toContain("Turn on");
    expect(wrapper.find('[data-test="starter-pack-coverage-row-hosts"]').exists()).toBe(false);
    await link.trigger("click");
    expect(fake.push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "starterPack", params: { pack: "kubernetes" } }),
    );
  });

  it("shows no row for an installed pack whose install made no alerts", async () => {
    fake.ready = { kubernetes: true };
    fake.installs = { kubernetes: [{ status: "complete" }] };
    fake.alerts = { kubernetes: [] };
    const wrapper = await mountLine();
    expect(wrapper.find('[data-test="starter-pack-coverage-row-kubernetes"]').exists()).toBe(false);
  });

  it("warns when pack alerts fired this week with no destination", async () => {
    fake.ready = { kubernetes: true };
    fake.installs = { kubernetes: [{ status: "complete" }] };
    const now = Date.now() * 1000;
    fake.alerts = {
      kubernetes: [
        { enabled: true, last_triggered_at: now },
        { enabled: true, last_triggered_at: now, destinations: ["chat"] },
        { enabled: true, last_triggered_at: now - 8 * 24 * 3_600_000_000 },
      ],
    };
    const wrapper = await mountLine();
    expect(wrapper.find('[data-test="starter-pack-coverage-silent"]').text()).toContain(
      "1 alert fired this week and notified nobody.",
    );
    await wrapper.find('[data-test="starter-pack-coverage-route-btn"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith(expect.objectContaining({ name: "alertDestinations" }));
  });

  it("skips the full match for a pack without a signal stream", async () => {
    fake.metrics = [];
    await mountLine();
    expect(fake.matchPack).not.toHaveBeenCalled();
  });

  it("still reports the other packs when one pack's read fails", async () => {
    fake.ready = { kubernetes: true, hosts: true };
    fake.failing = "kubernetes";
    const wrapper = await mountLine();
    expect(wrapper.find('[data-test="starter-pack-coverage-row-kubernetes"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="starter-pack-coverage-row-hosts"]').exists()).toBe(true);
  });

  it("recounts when the list reports a toggle, without matching again", async () => {
    fake.ready = { kubernetes: true };
    fake.installs = { kubernetes: [{ status: "complete" }] };
    fake.alerts = { kubernetes: [{ enabled: false }] };
    const wrapper = await mountLine("a1:false");
    fake.alerts = { kubernetes: [{ enabled: true }] };
    await wrapper.setProps({ refreshKey: "a1:true" });
    await flushPromises();
    expect(wrapper.find('[data-test="starter-pack-coverage-line"]').exists()).toBe(false);
    expect(fake.matchPack).toHaveBeenCalledTimes(2);
  });
});
