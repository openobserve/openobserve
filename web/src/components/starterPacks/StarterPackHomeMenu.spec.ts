import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { computed, ref, shallowRef } from "vue";

import i18n from "@/locales";

import { HOSTS_PACK } from "@/composables/starterPacks/hostsPack";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import type { HomePack, HomePacks } from "@/composables/starterPacks/useHomePacks";

import StarterPackHomeMenu from "./StarterPackHomeMenu.vue";
import StarterPackSilentAlerts from "./StarterPackSilentAlerts.vue";
import { fakeFlow } from "./starterPackTestFlow";

const itemDouble = (pack: typeof KUBERNETES_PACK, view: string, flow = fakeFlow()) =>
  ({
    pack,
    title: pack.id === "hosts" ? "Hosts" : "Kubernetes",
    testId: (id: string) =>
      pack.id === "kubernetes" ? id : id.replace("home-pack", `home-pack-${pack.id}`),
    flow,
    matcher: { streams: ref(["syslog", "node_metrics"]), clusters: ref([]) },
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

const render = (home: HomePacks) =>
  mount(StarterPackHomeMenu, {
    props: { home },
    global: {
      plugins: [i18n],
      stubs: {
        OIcon: true,
        OPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
      },
    },
  });

const NOW_US = Date.now() * 1000;

describe("StarterPackHomeMenu", () => {
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
