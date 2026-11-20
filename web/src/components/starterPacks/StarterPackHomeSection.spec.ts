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
import { nextTick, ref, shallowRef } from "vue";

import i18n from "@/locales";

import type { HomePacks } from "@/composables/starterPacks/useHomePacks";
import { packById } from "@/composables/starterPacks/usePackCatalog";
import {
  resetStarterPackPopups,
  useStarterPackPopup,
} from "@/composables/starterPacks/useStarterPackPopup";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

import StarterPackHomeSection from "./StarterPackHomeSection.vue";
import { fakeFlow } from "./starterPackTestFlow";

loadCatalogFixture();

const HOSTS_PACK = packById("hosts")!;
const KUBERNETES_PACK = packById("kubernetes")!;

const fake = vi.hoisted(() => ({
  flows: {} as Record<string, any>,
  matchers: {} as Record<string, any>,
  hasUserData: null as any,
  noResources: null as any,
  browser: {
    saveBuiltIn: vi.fn(),
  },
  gate: true,
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: (_org: string, pack: { id: string }) => fake.flows[pack.id],
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: (_org: string, { pack }: { pack: { id: string } }) =>
    fake.matchers[pack.id],
}));
vi.mock("@/composables/useOrgHasUserData", () => ({
  useOrgHasUserData: () => ({ hasUserData: fake.hasUserData }),
}));
vi.mock("@/composables/useOrgResources", () => ({
  useOrgHasNoResources: () => ({ noResources: fake.noResources }),
}));
vi.mock("@/composables/starterPacks/useBrowserMatches", () => ({
  useBrowserMatches: () => fake.browser,
}));
vi.mock("@/composables/starterPacks/usePackGate", async () => {
  const { computed } = await import("vue");
  return { usePackGate: () => ({ visible: computed(() => fake.gate) }) };
});

const matcherDouble = (state = "matched", streams = ["k8s_events"]) => {
  const check = vi.fn();
  return {
    state: ref(state),
    clusters: ref<string[]>([]),
    streams: ref(streams),
    streamTypes: ref<Record<string, string>>({}),
    waitedLong: ref(false),
    check,
    checkShared: check,
    retry: vi.fn(async () => undefined),
  };
};

const previewOf = (kinds: string[]) => ({
  items: kinds.map((kind, n) => ({ kind, itemId: `${kind}-${n}`, status: "new" })),
  panels: { kept: 0 },
  severities: {},
});

const render = async (packs = [KUBERNETES_PACK]) => {
  for (const pack of packs) fake.flows[pack.id].loaded.value = false;
  const wrapper = mount(StarterPackHomeSection, {
    props: { org: "org", packs },
    global: {
      plugins: [i18n],
      stubs: {
        OIcon: true,
        OTooltip: { template: '<div><slot /><slot name="content" /></div>' },
      },
    },
  });
  for (const pack of packs) fake.flows[pack.id].loaded.value = true;
  await flushPromises();
  return wrapper;
};
type Wrapper = Awaited<ReturnType<typeof render>>;
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-test="${id}"]`).exists();
const homeOf = (wrapper: Wrapper) => wrapper.emitted("ready")![0][0] as HomePacks;

describe("StarterPackHomeSection", () => {
  beforeEach(() => {
    resetStarterPackPopups();
    fake.gate = true;
    fake.flows = { kubernetes: fakeFlow(), hosts: fakeFlow({ pack: HOSTS_PACK }) };
    fake.matchers = { kubernetes: matcherDouble(), hosts: matcherDouble() };
    fake.hasUserData = ref(true);
    fake.noResources = ref(true);
    fake.browser.saveBuiltIn.mockClear();
  });

  it("keeps a skeleton while checking, and offers the pack once matched", async () => {
    fake.matchers.kubernetes.state.value = "checking";
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(true);
    fake.matchers.kubernetes.state.value = "matched";
    await nextTick();
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(true);
    expect(has(wrapper, "home-pack-hero")).toBe(true);
    expect(fake.flows.kubernetes.loadPreview).toHaveBeenCalled();
  });

  it("holds the skeleton until every pack has answered, so no row or badge moves", async () => {
    fake.matchers.hosts.state.value = "checking";
    const wrapper = await render([HOSTS_PACK, KUBERNETES_PACK]);
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(true);
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(false);
    fake.matchers.hosts.state.value = "matched";
    await nextTick();
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(false);
    expect(has(wrapper, "home-pack-list-row-hosts")).toBe(true);
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(true);
  });

  it("keeps the offer while an install is still running", async () => {
    const wrapper = await render();
    fake.flows.kubernetes.running.value = true;
    fake.flows.kubernetes.record.value = { status: "incomplete" };
    await nextTick();
    const home = homeOf(wrapper);
    expect(
      wrapper.get('[data-test="home-pack-list-primary-btn"]').attributes("disabled"),
    ).toBeDefined();
    expect(has(wrapper, "home-pack-offer")).toBe(true);
    expect(home.setUp.value).toEqual([]);
    fake.flows.kubernetes.record.value = { status: "complete" };
    fake.flows.kubernetes.running.value = false;
    await nextTick();
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    expect(home.setUp.value.map((item) => item.pack.id)).toEqual(["kubernetes"]);
  });

  it("shows the hero, then the pack in the same rail and tiles as the header popup", async () => {
    fake.flows.kubernetes.preview.value = previewOf(["dashboard", "alert", "alert"]);
    fake.flows.hosts.preview.value = previewOf(["dashboard", "savedView"]);
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    const hero = wrapper.get('[data-test="home-pack-hero"]').text();
    expect(hero).toContain("Starter packs");
    expect(hero).toContain(
      "Data is live. Set up ready-made dashboards and alerts in about a minute",
    );
    expect(hero).toContain("from 2 packs that fit your data");
    const count = (kind: string) =>
      wrapper.get(`[data-test="home-pack-hero-count-${kind}"]`).text();
    expect([count("dashboard"), count("alert"), count("savedView")]).toEqual([
      "2 dashboards",
      "2 alerts",
      "1 saved view",
    ]);
    expect(has(wrapper, "home-pack-hero-icon")).toBe(true);
    expect(wrapper.get('[data-test="home-pack-list-hero"]').text()).toContain("Kubernetes");
    expect(has(wrapper, "home-pack-list-tile-dashboard")).toBe(true);
    expect(has(wrapper, "home-pack-list-tile-alert")).toBe(true);
    expect(has(wrapper, "home-pack-list-tile-savedView")).toBe(true);
    expect(wrapper.text()).not.toContain("Silent until you turn them on");
    expect(wrapper.get('[data-test="home-pack-list-streams"]').text()).toContain("k8s_events");
  });

  it("lists several packs once in a rail and swaps the pane on a rail click", async () => {
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(wrapper.findAll('[data-test="home-pack-offer"]')).toHaveLength(1);
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(true);
    expect(has(wrapper, "home-pack-list-row-hosts")).toBe(true);
    expect(wrapper.findAll('[data-test="home-pack-list-hero"]')).toHaveLength(1);
    expect(has(wrapper, "home-pack-list-best-start")).toBe(true);
    await wrapper.get('[data-test="home-pack-list-row-hosts"]').trigger("click");
    expect(wrapper.get('[data-test="home-pack-list-hero"]').text()).toContain("Hosts");
    expect(has(wrapper, "home-pack-list-best-start")).toBe(false);
    await wrapper.get('[data-test="home-pack-list-primary-btn"]').trigger("click");
    await flushPromises();
    expect(useStarterPackPopup("org").packId.value).toBe("hosts");
  });

  it("opens the setup popup from Review pack and never installs from the card", async () => {
    const wrapper = await render();
    const setUp = wrapper.get('[data-test="home-pack-list-primary-btn"]');
    expect(setUp.text()).toBe("Review pack");
    expect(setUp.attributes("aria-label")).toBe("Review the Kubernetes pack");
    expect(has(wrapper, "home-pack-card-details-btn")).toBe(false);
    await setUp.trigger("click");
    await flushPromises();
    const popup = useStarterPackPopup("org");
    expect([popup.open.value, popup.screen.value, popup.packId.value]).toEqual([
      true,
      "pack",
      "kubernetes",
    ]);
    expect(popup.entryOf(KUBERNETES_PACK).flow).toBe(fake.flows.kubernetes);
    expect(fake.flows.kubernetes.install).not.toHaveBeenCalled();
    expect(fake.flows.kubernetes.land).not.toHaveBeenCalled();
  });

  it("keeps the old browser copy when a pack's install records fail to load", async () => {
    fake.flows.hosts.loadFailed.value = true;
    await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(fake.browser.saveBuiltIn).not.toHaveBeenCalled();
  });

  it("keeps the old browser copy when a pack's match check fails", async () => {
    fake.matchers.hosts.state.value = "error";
    await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(fake.browser.saveBuiltIn).not.toHaveBeenCalled();
  });

  it("saves the built-in check to the browser copy once every pack has answered", async () => {
    fake.matchers.hosts.state.value = "checking";
    fake.matchers.kubernetes.streams.value = ["k8s_events", "k8s_logs"];
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(fake.browser.saveBuiltIn).not.toHaveBeenCalled();
    fake.matchers.hosts.state.value = "none";
    await nextTick();
    expect(fake.browser.saveBuiltIn).toHaveBeenCalledTimes(1);
    const [sources, installed, interrupted] = fake.browser.saveBuiltIn.mock.calls[0];
    expect(sources).toEqual([
      expect.objectContaining({
        id: "kubernetes",
        packId: "kubernetes",
        streams: ["k8s_events", "k8s_logs"],
      }),
    ]);
    const kinds = sources[0].items.map((item: { kind: string }) => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(["alert", "savedView"]));
    expect(installed).toEqual([]);
    expect(interrupted).toBeNull();
    wrapper.unmount();
  });

  it("lists installed packs and an interrupted install in the browser copy", async () => {
    fake.flows.kubernetes.record = shallowRef({ status: "complete" });
    fake.flows.hosts.interrupted.value = true;
    fake.flows.hosts.record = shallowRef({ status: "incomplete" });
    fake.flows.hosts.made.value = [{}];
    fake.flows.hosts.toCreate.value = [{}, {}, {}];
    await render([KUBERNETES_PACK, HOSTS_PACK]);
    const [sources, installed, interrupted] = fake.browser.saveBuiltIn.mock.calls.at(-1)!;
    expect(sources).toEqual([]);
    expect(installed).toEqual(["kubernetes"]);
    expect(interrupted).toEqual({ packId: "hosts", label: "Hosts", done: 1, total: 3 });
  });

  it("lists connected sources: two cluster names then +N clusters", async () => {
    fake.matchers.kubernetes.streams.value = ["a"];
    fake.matchers.kubernetes.clusters.value = ["prod", "stage", "dev", "qa"];
    const wrapper = await render();
    const row = wrapper.get('[data-test="home-pack-connected-kubernetes"]').text();
    expect(row).toContain("prod, stage");
    expect(row).toContain("+2 clusters");
  });

  it("shows a chip per cluster and the first 4 streams, then +N more", async () => {
    fake.matchers.kubernetes.streams.value = ["a", "b", "c", "d", "e"];
    fake.matchers.kubernetes.clusters.value = ["staging-eu-1"];
    const wrapper = await render();
    const chips = wrapper.findAll('[data-test="home-pack-list-source-chip"]');
    expect(chips.map((chip) => chip.findAll("span").map((part) => part.text()))).toEqual([
      ["staging-eu-1", "cluster"],
    ]);
    const streams = wrapper.get('[data-test="home-pack-list-streams"]').text();
    expect(streams).toContain("Streams this pack uses · 5");
    expect(wrapper.findAll('[data-test="home-pack-list-stream-chip"]')).toHaveLength(4);
    expect(streams).toContain("+1 more");
  });

  it("counts nothing to add until every startable pack's preview has loaded", async () => {
    fake.flows.kubernetes.previewState.value = "loading";
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(has(wrapper, "home-pack-hero-counts")).toBe(false);
    fake.flows.kubernetes.previewState.value = "ready";
    fake.flows.kubernetes.preview.value = previewOf(["dashboard"]);
    fake.flows.hosts.preview.value = previewOf(["alert"]);
    await nextTick();
    expect(wrapper.get('[data-test="home-pack-hero-counts"]').text()).toContain(
      "from 2 packs that fit your data",
    );
  });

  it("leaves a pack the user may not set up out of the Ready to add counts", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    fake.flows.kubernetes.preview.value = previewOf(["dashboard", "alert"]);
    fake.flows.hosts.preview.value = previewOf(["alert"]);
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    const counts = wrapper.get('[data-test="home-pack-hero-counts"]').text();
    expect(counts).toContain("1 alert");
    expect(counts).toContain("from 1 pack that fits your data");
    expect(has(wrapper, "home-pack-hero-count-dashboard")).toBe(false);
  });

  it("counts only packs that add something, and skips a pack whose preview failed", async () => {
    fake.flows.kubernetes.preview.value = previewOf(["alert"]);
    fake.flows.hosts.previewState.value = "error";
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    const counts = wrapper.get('[data-test="home-pack-hero-counts"]').text();
    expect(counts).toContain("1 alert");
    expect(counts).toContain("from 1 pack that fits your data");
  });

  it("hides Ready to add when every item of the pack already exists", async () => {
    fake.flows.kubernetes.preview.value = {
      ...previewOf(["dashboard"]),
      items: [{ kind: "dashboard", itemId: "d", status: "existing" }],
    };
    const wrapper = await render();
    expect(has(wrapper, "home-pack-hero-counts")).toBe(false);
  });

  it("names each stream's type and counts clusters and streams on the rail", async () => {
    fake.matchers.kubernetes.streams.value = ["k8s_events", "kube_pod_info"];
    fake.matchers.kubernetes.streamTypes.value = { k8s_events: "logs", kube_pod_info: "metrics" };
    fake.matchers.kubernetes.clusters.value = ["prod", "stage"];
    const wrapper = await render();
    const chips = wrapper.findAll('[data-test="home-pack-list-stream-chip"]');
    expect(chips.map((chip) => chip.findAll("span").map((part) => part.text()))).toEqual([
      ["k8s_events", "logs"],
      ["kube_pod_info", "metrics"],
    ]);
    expect(wrapper.get('[data-test="home-pack-list-row-kubernetes"]').text()).toContain(
      "2 clusters · 2 streams",
    );
  });

  it("shows an empty alerts tile with no summary for a pack with no alerts", async () => {
    fake.flows.hosts = fakeFlow({ pack: HOSTS_PACK, alertCount: ref(0), viewCount: ref(0) });
    fake.flows.hosts.preview.value = { items: [], panels: { kept: 0 }, severities: {} };
    const wrapper = await render([HOSTS_PACK]);
    expect(has(wrapper, "home-pack-list-tile-alert")).toBe(true);
    expect(has(wrapper, "home-pack-list-tile-summary-alert")).toBe(false);
  });

  it("has no Hide button on the strip", async () => {
    const wrapper = await render();
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(true);
    expect(has(wrapper, "home-pack-card-hide-all-btn")).toBe(false);
    expect(wrapper.text()).not.toContain("Hide");
  });

  it("drops the section once a pack is set up", async () => {
    fake.flows.kubernetes.record = shallowRef({ status: "complete" });
    const wrapper = await render();
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    const home = homeOf(wrapper);
    expect(home).not.toHaveProperty("showMenu");
  });

  it("spends nothing on the matcher for an installed pack", async () => {
    fake.flows.kubernetes.record = shallowRef({ status: "complete" });
    await render();
    expect(fake.matchers.kubernetes.check).not.toHaveBeenCalled();
  });

  it("shows nothing, not even the label, when no pack matches", async () => {
    fake.matchers.kubernetes.state.value = "none";
    fake.matchers.hosts.state.value = "none";
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(has(wrapper, "home-pack-label")).toBe(false);
    expect(has(wrapper, "home-pack-empty")).toBe(false);
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    expect(homeOf(wrapper).offerShown.value).toBe(false);
    fake.matchers.hosts.state.value = "matched";
    await nextTick();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    expect(has(wrapper, "home-pack-list-row-hosts")).toBe(true);
  });

  it("offers Retry under the label when a match check fails in an empty org", async () => {
    fake.matchers.kubernetes.state.value = "error";
    const wrapper = await render();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    await wrapper.get('[data-test="home-pack-card-retry-btn"]').trigger("click");
    expect(fake.matchers.kubernetes.retry).toHaveBeenCalled();
  });

  it("surfaces an interrupted install with Finish, which opens the popup on that pack", async () => {
    fake.flows.kubernetes.interrupted.value = true;
    fake.flows.kubernetes.record = shallowRef({ status: "incomplete" });
    const wrapper = await render();
    await wrapper.get('[data-test="home-pack-interrupted-btn"]').trigger("click");
    expect(useStarterPackPopup("org").screen.value).toBe("pack");
    expect(useStarterPackPopup("org").packId.value).toBe("kubernetes");
  });

  it("shows nothing and hands Home no pack state for an org past onboarding (D10)", async () => {
    fake.gate = false;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-section")).toBe(false);
    expect(wrapper.emitted("ready")!.at(-1)).toEqual([null]);
  });

  it("reads no pack record and runs no match for an org past onboarding", async () => {
    fake.gate = false;
    await render();
    expect(fake.flows.kubernetes.load).not.toHaveBeenCalled();
    expect(fake.matchers.kubernetes.checkShared).not.toHaveBeenCalled();
    expect(fake.flows.kubernetes.loadPreview).not.toHaveBeenCalled();
  });

  it("shows nothing while the org has no data of its own", async () => {
    fake.hasUserData = ref(false);
    const wrapper = await render();
    expect(has(wrapper, "home-pack-label")).toBe(false);
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(false);
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(false);
    expect(has(wrapper, "home-pack-empty")).toBe(false);
    expect(has(wrapper, "home-pack-find-other")).toBe(false);
    expect(homeOf(wrapper).offerShown.value).toBe(false);
  });

  it("shows no pack UI and no skeleton until the resources check says the org is empty", async () => {
    fake.noResources = ref(false);
    fake.matchers.kubernetes.state.value = "checking";
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(false);
    fake.matchers.kubernetes.state.value = "matched";
    await nextTick();
    expect(has(wrapper, "home-pack-label")).toBe(false);
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(false);
    expect(homeOf(wrapper).offerShown.value).toBe(false);
  });

  it("offers the packs once the resources check says the org is empty", async () => {
    fake.noResources = ref(false);
    const wrapper = await render();
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(false);
    fake.noResources.value = true;
    await nextTick();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(true);
    expect(homeOf(wrapper).offerShown.value).toBe(true);
  });

  it("puts the Starter packs label over the skeleton and over the offer strip", async () => {
    fake.matchers.kubernetes.state.value = "checking";
    const wrapper = await render();
    expect(wrapper.get('[data-test="home-pack-label"]').text()).toBe("Starter packs");
    expect(homeOf(wrapper).offerShown.value).toBe(true);
    fake.matchers.kubernetes.state.value = "matched";
    await nextTick();
    const section = wrapper.get('[data-test="home-pack-section"]').html();
    expect(section.indexOf("home-pack-label")).toBeLessThan(section.indexOf("home-pack-offer"));
    expect(wrapper.findAll('[data-test="home-pack-label"]')).toHaveLength(1);
  });

  it("still feeds the header chip in an org that already has resources", async () => {
    fake.noResources = ref(false);
    await render();
    const [sources] = fake.browser.saveBuiltIn.mock.calls.at(-1)!;
    expect(sources.map((source: { packId: string }) => source.packId)).toEqual(["kubernetes"]);
    expect(fake.matchers.kubernetes.check).toHaveBeenCalled();
  });

  it("shows the stopped setup under the label in an org that already has resources", async () => {
    fake.noResources = ref(false);
    fake.flows.kubernetes.interrupted.value = true;
    fake.flows.kubernetes.record = shallowRef({ status: "incomplete" });
    const wrapper = await render();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    expect(has(wrapper, "home-pack-interrupted")).toBe(true);
  });

  it("holds the skeleton, not the strip, while a pack's record loads beside a matched pack", async () => {
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(has(wrapper, "home-pack-offer")).toBe(true);
    fake.flows.hosts.loaded.value = false;
    await nextTick();
    expect(homeOf(wrapper).items[0].view.value).toBe("offer");
    expect(homeOf(wrapper).items[1].view.value).toBe("loading");
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(true);
    expect(homeOf(wrapper).offerShown.value).toBe(true);
    fake.flows.hosts.loaded.value = true;
    await nextTick();
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(false);
    expect(has(wrapper, "home-pack-offer")).toBe(true);
  });

  it("keeps Ask an admin on a pack the user may not create beside one they may", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(has(wrapper, "home-pack-ask-admin")).toBe(false);
    expect(has(wrapper, "home-pack-list-ask-admin")).toBe(false);
    await wrapper.get('[data-test="home-pack-list-row-kubernetes"]').trigger("click");
    expect(has(wrapper, "home-pack-list-primary-btn")).toBe(false);
    expect(wrapper.get('[data-test="home-pack-list-ask-admin"]').text()).toBe(
      "Ask an admin to set this up",
    );
  });

  it("says once to ask an admin when the user may create no offered pack", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(false);
    expect(wrapper.get('[data-test="home-pack-ask-admin"]').text()).toContain(
      "Starter packs fit your data. Ask an admin to add them.",
    );
    expect(homeOf(wrapper).offerShown.value).toBe(false);
  });

  it("puts the label inside the hero over the skeleton, and keeps it out of a banner-only view", async () => {
    fake.matchers.kubernetes.state.value = "checking";
    const wrapper = await render();
    expect(has(wrapper, "home-pack-hero")).toBe(true);
    expect(
      wrapper.get('[data-test="home-pack-hero"]').find('[data-test="home-pack-label"]').exists(),
    ).toBe(true);
    expect(wrapper.findAll('[data-test="home-pack-label"]')).toHaveLength(1);
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(true);
    fake.matchers.kubernetes.state.value = "error";
    await nextTick();
    expect(has(wrapper, "home-pack-hero")).toBe(false);
    expect(wrapper.findAll('[data-test="home-pack-label"]')).toHaveLength(1);
    expect(has(wrapper, "home-pack-error")).toBe(true);
  });

  it("shows no hero beside the ask-admin line", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-hero")).toBe(false);
    expect(wrapper.findAll('[data-test="home-pack-label"]')).toHaveLength(1);
  });

  it("borders each tile in its kind's colour with no fill", async () => {
    const wrapper = await render();
    const borders = {
      dashboard: "border-ingest-accent-blue/25",
      alert: "border-ingest-accent-orange/25",
      savedView: "border-ingest-accent-purple/25",
    };
    for (const [kind, border] of Object.entries(borders)) {
      const classes = wrapper.get(`[data-test="home-pack-list-tile-${kind}"]`).classes();
      expect(classes).toContain(border);
      expect(classes.some((name) => name.startsWith("bg-"))).toBe(false);
    }
  });

  it("shows no streams panel for a pack matched without a found stream", async () => {
    fake.matchers.kubernetes.streams.value = [];
    const wrapper = await render();
    expect(has(wrapper, "home-pack-list-row-kubernetes")).toBe(true);
    expect(has(wrapper, "home-pack-list-streams")).toBe(false);
  });

  it("opens on the first pack the user can set up, with the best-start badge", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(wrapper.get('[data-test="home-pack-list-hero"]').text()).toContain("Hosts");
    expect(wrapper.get('[data-test="home-pack-list-best-start"]').text()).toBe(
      "Best place to start",
    );
    expect(has(wrapper, "home-pack-list-primary-btn")).toBe(true);
  });
});
