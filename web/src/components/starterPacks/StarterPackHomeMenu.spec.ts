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

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, ref, shallowRef } from "vue";
import { createStore } from "vuex";

import i18n from "@/locales";

import { HOSTS_PACK } from "@/composables/starterPacks/hostsPack";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import type { HomePack, HomePacks } from "@/composables/starterPacks/useHomePacks";

import StarterPackHomeMenu from "./StarterPackHomeMenu.vue";
import StarterPackSilentAlerts from "./StarterPackSilentAlerts.vue";
import { fakeFlow } from "./starterPackTestFlow";

const itemDouble = (
  pack: typeof KUBERNETES_PACK,
  view: string,
  flow = fakeFlow(),
  streams = ["syslog", "node_metrics"],
) =>
  ({
    pack,
    title: pack.id === "hosts" ? "Hosts" : "Kubernetes",
    testId: (id: string) =>
      pack.id === "kubernetes" ? id : id.replace("home-pack", `home-pack-${pack.id}`),
    flow,
    matcher: { streams: ref(streams), clusters: ref([]) },
    view: ref(view),
    startSetup: vi.fn(),
    openUndo: vi.fn(),
    openTurnOn: vi.fn(),
    keepOff: vi.fn(),
    copyLink: vi.fn(),
  }) as unknown as HomePack;

const homeDouble = (offered: HomePack[], setUp: HomePack[]) =>
  ({
    offered: computed(() => offered),
    setUp: computed(() => setUp),
    menu: { dismissed: ref(false), dismiss: vi.fn(), restore: vi.fn() },
    library: vi.fn(),
  }) as unknown as HomePacks;

const render = (home: HomePacks, timezone = "UTC") =>
  mount(StarterPackHomeMenu, {
    props: { home },
    global: {
      plugins: [i18n, createStore({ state: { timezone } })],
      stubs: {
        OIcon: true,
        OPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
      },
    },
  });

const NOW_US = Date.now() * 1000;

const usOf = (iso: string) => new Date(iso).getTime() * 1000;

describe("StarterPackHomeMenu", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the packs that fit, in the singular and plural", () => {
    const k8s = itemDouble(KUBERNETES_PACK, "installed");
    const hosts = itemDouble(HOSTS_PACK, "offer");
    expect(
      render(homeDouble([hosts], [k8s]))
        .get('[data-test="home-pack-menu-btn"]')
        .text(),
    ).toBe("1 starter pack fits your data");
    expect(
      render(homeDouble([hosts, hosts], [k8s]))
        .get('[data-test="home-pack-menu-btn"]')
        .text(),
    ).toBe("2 starter packs fit your data");
    expect(
      render(homeDouble([], [k8s]))
        .get('[data-test="home-pack-menu-btn"]')
        .text(),
    ).toBe("Starter packs");
  });

  it("offers Set up for a pack that fits and Undo setup for one set up today", async () => {
    const flow = fakeFlow({ record: shallowRef({ status: "complete", installedAt: NOW_US }) });
    const k8s = itemDouble(KUBERNETES_PACK, "installed", flow);
    const hosts = itemDouble(HOSTS_PACK, "offer");
    const home = homeDouble([hosts], [k8s]);
    const wrapper = render(home);

    const hostsRow = wrapper.get('[data-test="home-pack-menu-row-hosts"]').text();
    expect(hostsRow).toContain("1 dashboard · fits syslog, node_metrics");
    await wrapper.get('[data-test="home-pack-menu-setup-btn-hosts"]').trigger("click");
    expect(hosts.startSetup).toHaveBeenCalled();

    const k8sRow = wrapper.get('[data-test="home-pack-menu-row-kubernetes"]').text();
    expect(k8sRow).toMatch(/Set up today .+ · 2 alerts silent/);
    await wrapper.get('[data-test="home-pack-menu-undo-btn-kubernetes"]').trigger("click");
    expect(k8s.openUndo).toHaveBeenCalled();

    await wrapper.get('[data-test="home-pack-menu-library-link"]').trigger("click");
    expect(home.library).toHaveBeenCalled();
    await wrapper.get('[data-test="home-pack-menu-hide-btn"]').trigger("click");
    expect(home.menu.dismiss).toHaveBeenCalled();
  });

  it("names two matched streams and counts the rest", () => {
    const streams = ["syslog", "node_metrics", "auth", "kernel"];
    const hosts = itemDouble(HOSTS_PACK, "offer", fakeFlow(), streams);
    const row = render(homeDouble([hosts], []))
      .get('[data-test="home-pack-menu-row-hosts"]')
      .text();
    expect(row).toContain("1 dashboard · fits syslog, node_metrics +2 more");
    expect(row).not.toContain("auth");
  });

  it("leaves the dashboards out of the line for a pack that has none", () => {
    const flow = fakeFlow({ dashboardCount: ref(0) });
    const row = render(homeDouble([itemDouble(HOSTS_PACK, "offer", flow)], []))
      .get('[data-test="home-pack-menu-row-hosts"]')
      .text();
    expect(row).toContain("Fits syslog, node_metrics");
    expect(row).not.toContain("0 dashboard");
  });

  it("tells the set-up time and day in the app timezone", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T23:30:00Z"));
    const rowIn = (timezone: string, installedAt: number) => {
      const flow = fakeFlow({ record: shallowRef({ status: "complete", installedAt }) });
      const home = homeDouble([], [itemDouble(KUBERNETES_PACK, "installed", flow)]);
      return render(home, timezone).get('[data-test="home-pack-menu-row-kubernetes"]').text();
    };
    const lateEvening = usOf("2026-03-10T23:10:00Z");
    expect(rowIn("UTC", lateEvening)).toContain("Set up today 23:10");
    expect(rowIn("Asia/Kolkata", lateEvening)).toContain("Set up today 04:40");
    const afternoon = usOf("2026-03-10T17:00:00Z");
    expect(rowIn("UTC", afternoon)).toContain("Set up today 17:00");
    expect(rowIn("Asia/Kolkata", afternoon)).toContain("Set up 2026-03-10");
  });

  it("hides Undo setup once the undo window has passed", () => {
    const flow = fakeFlow({ canUndo: ref(false), record: shallowRef({ status: "complete" }) });
    const wrapper = render(homeDouble([], [itemDouble(KUBERNETES_PACK, "installed", flow)]));
    expect(wrapper.find('[data-test="home-pack-menu-undo-btn-kubernetes"]').exists()).toBe(false);
  });
});

describe("StarterPackSilentAlerts", () => {
  const mountSilent = (incidents: boolean, item = itemDouble(KUBERNETES_PACK, "installed")) =>
    mount(StarterPackSilentAlerts, {
      props: { items: [item], incidents },
      global: { plugins: [i18n], stubs: { OIcon: true } },
    });

  it("says how many alerts are silent and opens Turn on alerts", async () => {
    const item = itemDouble(KUBERNETES_PACK, "installed");
    const wrapper = mountSilent(true, item);
    expect(wrapper.get('[data-test="home-pack-reminder"]').text()).toContain(
      "No incidents · 2 Kubernetes alerts are silent",
    );
    await wrapper.get('[data-test="home-pack-reminder-turn-on-btn"]').trigger("click");
    expect(item.openTurnOn).toHaveBeenCalled();
    await wrapper.get('[data-test="home-pack-reminder-keep-off-btn"]').trigger("click");
    expect(item.keepOff).toHaveBeenCalled();
  });

  it("does not claim there are no incidents where incidents are not available", () => {
    const text = mountSilent(false).get('[data-test="home-pack-reminder"]').text();
    expect(text).toContain("2 Kubernetes alerts are silent");
    expect(text).not.toContain("No incidents");
  });
});
