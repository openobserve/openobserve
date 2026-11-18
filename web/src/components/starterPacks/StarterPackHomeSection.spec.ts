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
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

import StarterPackHomeSection from "./StarterPackHomeSection.vue";
import { fakeFlow } from "./starterPackTestFlow";

loadCatalogFixture();

const HOSTS_PACK = packById("hosts")!;
const KUBERNETES_PACK = packById("kubernetes")!;

const fake = vi.hoisted(() => ({
  flows: {} as Record<string, any>,
  matchers: {} as Record<string, any>,
  dismissal: null as any,
  dismissals: {} as Record<string, any>,
  org: null as any,
  hasUserData: null as any,
  noResources: null as any,
  browser: {
    saveBuiltIn: vi.fn(),
  },
  push: vi.fn(async () => undefined),
  copy: vi.fn(),
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: fake.copy }));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: (_org: string, pack: { id: string }) => fake.flows[pack.id],
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: (_org: string, { pack }: { pack: { id: string } }) =>
    fake.matchers[pack.id],
}));
vi.mock("@/composables/starterPacks/packDismissal", () => ({
  usePackDismissal: (_surface: string, _org: string, packId: string) =>
    fake.dismissals[packId] ?? fake.dismissal,
  usePackHiddenForOrg: () => fake.org,
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
vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));

const matcherDouble = (state = "matched", streams = ["k8s_events"]) => ({
  state: ref(state),
  clusters: ref<string[]>([]),
  streams: ref(streams),
  waitedLong: ref(false),
  check: vi.fn(),
  retry: vi.fn(async () => undefined),
});

const dismissalDouble = () => {
  const double = {
    dismissed: ref(false),
    dismiss: vi.fn(() => (double.dismissed.value = true)),
    restore: vi.fn(() => (double.dismissed.value = false)),
  };
  return double;
};

const render = async (packs = [KUBERNETES_PACK]) => {
  for (const pack of packs) fake.flows[pack.id].loaded.value = false;
  const wrapper = mount(StarterPackHomeSection, {
    props: { org: "org", packs },
    global: {
      plugins: [i18n],
      stubs: {
        StarterPackDrawer: true,
        StarterPackHealthLine: true,
        StarterPackUndoDialog: true,
        TurnOnAlertsDrawer: true,
        OIcon: true,
        OTooltip: { template: '<div><slot name="content" /></div>' },
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
    fake.flows = { kubernetes: fakeFlow(), hosts: fakeFlow({ pack: HOSTS_PACK }) };
    fake.matchers = { kubernetes: matcherDouble(), hosts: matcherDouble() };
    fake.dismissal = dismissalDouble();
    fake.dismissals = {};
    fake.hasUserData = ref(true);
    fake.noResources = ref(true);
    fake.browser.saveBuiltIn.mockClear();
    fake.copy.mockClear();
    fake.org = {
      hidden: ref(false),
      loaded: ref(true),
      load: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
    };
  });

  it("keeps a skeleton while checking, and offers the pack once matched", async () => {
    fake.matchers.kubernetes.state.value = "checking";
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(true);
    fake.matchers.kubernetes.state.value = "matched";
    await nextTick();
    expect(has(wrapper, "home-pack-card")).toBe(true);
    expect(has(wrapper, "home-pack-hero")).toBe(true);
    expect(fake.flows.kubernetes.loadPreview).toHaveBeenCalled();
  });

  it("holds the skeleton until every pack has answered, so no row or badge moves", async () => {
    fake.matchers.hosts.state.value = "checking";
    const wrapper = await render([HOSTS_PACK, KUBERNETES_PACK]);
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(true);
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    expect(has(wrapper, "home-pack-card")).toBe(false);
    fake.matchers.hosts.state.value = "matched";
    await nextTick();
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(false);
    expect(has(wrapper, "home-pack-hosts-card")).toBe(true);
    expect(has(wrapper, "home-pack-card")).toBe(true);
  });

  it("keeps the card while an install is still running", async () => {
    const wrapper = await render();
    fake.flows.kubernetes.running.value = true;
    fake.flows.kubernetes.record.value = { status: "incomplete" };
    await nextTick();
    const home = homeOf(wrapper);
    expect(wrapper.get('[data-test="home-pack-card"]').attributes("data-status")).toBe("running");
    expect(has(wrapper, "home-pack-offer")).toBe(true);
    expect(home.setUp.value).toEqual([]);
    fake.flows.kubernetes.record.value = { status: "complete" };
    fake.flows.kubernetes.running.value = false;
    await nextTick();
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    expect(home.setUp.value.map((item) => item.pack.id)).toEqual(["kubernetes"]);
  });

  it("shows the hero, counts with a plain bell and the matched stream", async () => {
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    const hero = wrapper.get('[data-test="home-pack-hero"]').text();
    expect(hero).toContain("Starter packs");
    expect(hero).toContain("Your data is arriving. Turn it into monitoring.");
    expect(hero).toContain(
      "Pick a starter pack below. It creates dashboards, alerts and saved views that fit your streams.",
    );
    expect(has(wrapper, "home-pack-hero-icon")).toBe(true);
    expect(wrapper.get('[data-test="home-pack-card-row-dashboard"]').text()).toBe("1 dashboard");
    expect(wrapper.get('[data-test="home-pack-card-row-alert"]').text()).toBe("2 alerts");
    expect(wrapper.text()).not.toContain("Silent until you turn them on");
    expect(wrapper.get('[data-test="home-pack-card-icon-alert"]').attributes("name")).toBe(
      "notifications",
    );
    expect(wrapper.get('[data-test="home-pack-card-row-savedView"]').text()).toBe("1 saved view");
    expect(wrapper.get('[data-test="home-pack-row-streams"]').text()).toContain("k8s_events");
  });

  it("shows no count rows until the preview has loaded", async () => {
    fake.flows.kubernetes = fakeFlow({
      alertCount: ref(null),
      dashboardCount: ref(null),
      viewCount: ref(null),
    });
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card")).toBe(true);
    expect(has(wrapper, "home-pack-card-row-dashboard")).toBe(false);
    expect(has(wrapper, "home-pack-card-row-alert")).toBe(false);
    expect(has(wrapper, "home-pack-card-row-savedView")).toBe(false);
  });

  it("opens the setup popup from Review and set up and never installs from the card", async () => {
    const wrapper = await render();
    const setUp = wrapper.get('[data-test="home-pack-card-setup-btn"]');
    expect(setUp.text()).toBe("Review and set up");
    expect(setUp.attributes("aria-label")).toBe("Review and set up Kubernetes");
    expect(has(wrapper, "home-pack-card-details-btn")).toBe(false);
    expect(wrapper.text()).not.toContain("What gets created");
    await setUp.trigger("click");
    await flushPromises();
    expect(homeOf(wrapper).items[0].drawerOpen.value).toBe(true);
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

  it("shows two streams and folds the rest into +N streams with a hover list", async () => {
    fake.matchers.kubernetes.streams.value = ["a", "b", "c", "d"];
    fake.matchers.kubernetes.clusters.value = ["staging-eu-1"];
    const wrapper = await render();
    expect(wrapper.get('[data-test="home-pack-card-from"]').text()).toBe("from staging-eu-1");
    const panel = wrapper.get('[data-test="home-pack-row-streams"]');
    expect(panel.text()).toContain("a");
    expect(panel.text()).toContain("b");
    expect(wrapper.get('[data-test="home-pack-streams-more"]').text()).toContain("+2 streams");
    const more = wrapper.get('[data-test="home-pack-streams-more-list"]').text();
    expect(more).toContain("c");
    expect(more).toContain("d");
  });

  it("offers a Find packs for other data link below the packs", async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-test="home-pack-find-other"]').text()).toBe(
      "Find packs for other data",
    );
    await wrapper.get('[data-test="home-pack-find-other-browse-btn"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith({
      name: "starterPacks",
      query: { org_identifier: "org" },
    });
  });

  it("shows no alerts tile and no placeholder for a pack with no alerts", async () => {
    fake.flows.hosts = fakeFlow({ pack: HOSTS_PACK, alertCount: ref(0), viewCount: ref(0) });
    const wrapper = await render([HOSTS_PACK]);
    expect(has(wrapper, "home-pack-hosts-card-row-alert")).toBe(false);
    expect(has(wrapper, "home-pack-hosts-card-no-alerts")).toBe(false);
  });

  it("has no Not now button and brings a dismissed pack back with Show again", async () => {
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card-dismiss-btn")).toBe(false);
    fake.dismissal.dismiss();
    await nextTick();
    expect(has(wrapper, "home-pack-card")).toBe(false);
    await wrapper.get('[data-test="home-pack-card-show-again-btn"]').trigger("click");
    expect(has(wrapper, "home-pack-card")).toBe(true);
  });

  it("has no Hide button on the strip, even for an admin", async () => {
    fake.flows.kubernetes.isAdmin.value = true;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card")).toBe(true);
    expect(has(wrapper, "home-pack-card-hide-all-btn")).toBe(false);
    expect(wrapper.text()).not.toContain("Hide");
  });

  it("shows nothing for a pack hidden for everyone, and spends nothing on its matcher", async () => {
    fake.org.hidden.value = true;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card")).toBe(false);
    expect(has(wrapper, "home-pack-empty")).toBe(false);
    expect(fake.matchers.kubernetes.check).not.toHaveBeenCalled();
  });

  it("lets an admin undo Hide for everyone", async () => {
    fake.org.hidden.value = true;
    fake.flows.kubernetes.isAdmin.value = true;
    const wrapper = await render();
    await wrapper.get('[data-test="home-pack-card-show-all-btn"]').trigger("click");
    expect(fake.org.show).toHaveBeenCalled();
  });

  it("drops the section once a pack is set up and hands Overview the silent alerts", async () => {
    fake.org.hidden.value = true;
    fake.flows.kubernetes.record = shallowRef({ status: "complete" });
    const wrapper = await render();
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    const home = homeOf(wrapper);
    expect(home).not.toHaveProperty("showMenu");
    expect(home.silent.value.map((item) => item.pack.id)).toEqual(["kubernetes"]);
    fake.flows.kubernetes.remindAlerts.value = false;
    expect(home.silent.value).toEqual([]);
  });

  it("spends nothing on the matcher for an installed or dismissed pack", async () => {
    fake.flows.kubernetes.record = shallowRef({ status: "complete" });
    await render();
    fake.flows.kubernetes = fakeFlow();
    fake.dismissal.dismissed.value = true;
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
    expect(has(wrapper, "home-pack-hosts-card")).toBe(true);
  });

  it("offers Retry under the label when a match check fails in an empty org", async () => {
    fake.matchers.kubernetes.state.value = "error";
    const wrapper = await render();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    await wrapper.get('[data-test="home-pack-card-retry-btn"]').trigger("click");
    expect(fake.matchers.kubernetes.retry).toHaveBeenCalled();
  });

  it("surfaces an interrupted install with Finish, which opens the drawer", async () => {
    fake.flows.kubernetes.interrupted.value = true;
    fake.flows.kubernetes.record = shallowRef({ status: "incomplete" });
    const wrapper = await render();
    await wrapper.get('[data-test="home-pack-interrupted-btn"]').trigger("click");
    expect(homeOf(wrapper).items[0].drawerOpen.value).toBe(true);
  });

  it("shows nothing while the org has no data of its own", async () => {
    fake.hasUserData = ref(false);
    const wrapper = await render();
    expect(has(wrapper, "home-pack-label")).toBe(false);
    expect(has(wrapper, "home-pack-card")).toBe(false);
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
    expect(has(wrapper, "home-pack-card")).toBe(false);
    expect(homeOf(wrapper).offerShown.value).toBe(false);
  });

  it("offers the packs once the resources check says the org is empty", async () => {
    fake.noResources = ref(false);
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card")).toBe(false);
    fake.noResources.value = true;
    await nextTick();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    expect(has(wrapper, "home-pack-card")).toBe(true);
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

  it("shows the hidden-for-you line under the label only in an empty org", async () => {
    fake.dismissal.dismissed.value = true;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    expect(has(wrapper, "home-pack-dismissed")).toBe(true);
    expect(homeOf(wrapper).offerShown.value).toBe(false);
    fake.noResources.value = false;
    await nextTick();
    expect(has(wrapper, "home-pack-label")).toBe(false);
    expect(has(wrapper, "home-pack-dismissed")).toBe(false);
  });

  it("holds no skeleton over Overview for a dismissed pack whose record is still loading", async () => {
    fake.dismissal.dismissed.value = true;
    const wrapper = await render();
    fake.flows.kubernetes.loaded.value = false;
    await nextTick();
    expect(homeOf(wrapper).items[0].view.value).toBe("loading");
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(false);
    expect(homeOf(wrapper).offerShown.value).toBe(false);
  });

  it("holds the skeleton, not the strip, while a dismissed pack's record loads beside a matched pack", async () => {
    fake.dismissals.hosts = dismissalDouble();
    fake.dismissals.hosts.dismissed.value = true;
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

  it("keeps Ask an admin on a row the user may not create beside one they may", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(has(wrapper, "home-pack-ask-admin")).toBe(false);
    expect(has(wrapper, "home-pack-card-setup-btn")).toBe(false);
    expect(wrapper.get('[data-test="home-pack-card-ask-admin-btn"]').text()).toBe("Ask an admin");
    expect(wrapper.get('[data-test="home-pack-card-copy-link-btn"]').text()).toBe("Copy link");
    expect(has(wrapper, "home-pack-hosts-card-setup-btn")).toBe(true);
  });

  it("says once to ask an admin, with Copy link, when the user may create no offered pack", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-label")).toBe(true);
    expect(has(wrapper, "home-pack-card")).toBe(false);
    expect(wrapper.get('[data-test="home-pack-ask-admin"]').text()).toContain(
      "Starter packs fit your data. Ask an admin to add them.",
    );
    expect(homeOf(wrapper).offerShown.value).toBe(false);
    await wrapper.get('[data-test="home-pack-ask-admin-copy-link-btn"]').trigger("click");
    expect(fake.copy).toHaveBeenCalledTimes(1);
    expect(fake.copy.mock.calls[0][0]).toBe(fake.flows.kubernetes.packLink());
    expect(fake.copy.mock.calls[0][0]).toContain("/starter-packs/kubernetes");
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

  it("highlights only the first row, with a filled button there and outline buttons below", async () => {
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(wrapper.get('[data-test="home-pack-best-start"]').text()).toBe("Best place to start");
    expect(has(wrapper, "home-pack-hosts-best-start")).toBe(false);
    const rows = wrapper.get('[data-test="home-pack-offer-rows"]');
    expect(rows.findAll('[data-test$="row-highlight"]')).toHaveLength(1);
    const highlight = wrapper.get('[data-test="home-pack-row-highlight"]');
    expect(highlight.get('[data-test="home-pack-card"]').classes()).toContain("border-accent");
    expect(wrapper.get('[data-test="home-pack-hosts-card"]').classes()).toContain(
      "border-border-default",
    );
    const buttons = rows.findAll('[data-test$="card-setup-btn"]');
    expect(buttons.map((btn) => btn.text())).toEqual(["Review and set up", "Review and set up"]);
    expect(buttons.map((btn) => btn.attributes("data-o2-variant"))).toEqual(["primary", "outline"]);
  });

  it("tints each resource card by its kind", async () => {
    const wrapper = await render();
    const tints = {
      dashboard: "bg-ingest-tint-blue",
      alert: "bg-ingest-tint-orange",
      savedView: "bg-ingest-tint-purple",
    };
    for (const [kind, tint] of Object.entries(tints)) {
      expect(wrapper.get(`[data-test="home-pack-resource-card-${kind}"]`).classes()).toContain(
        tint,
      );
    }
  });

  it("writes each resource card from the preview, in one column per kind", async () => {
    fake.matchers.kubernetes.clusters.value = ["staging-eu-1"];
    fake.flows.kubernetes.preview.value = {
      items: [
        { kind: "dashboard", itemId: "overview", status: "new" },
        { kind: "alert", itemId: "a1", status: "new" },
        { kind: "alert", itemId: "a2", status: "new" },
        { kind: "savedView", itemId: "v1", status: "new" },
      ],
      panels: { kept: 12, dropped: 0 },
    };
    const wrapper = await render();
    const grid = wrapper.get('[data-test="home-pack-resource-card-dashboard"]').element
      .parentElement!;
    expect(grid.className).toContain("grid-cols-3");
    expect(wrapper.get('[data-test="home-pack-resource-summary-dashboard"]').text()).toBe(
      "name-overview: 12 panels for staging-eu-1.",
    );
    const alerts = wrapper.get('[data-test="home-pack-resource-summary-alert"]');
    expect(alerts.text()).toBe(
      "name-a1, name-a2. Fire for every cluster (staging-eu-1). Off until you turn them on.",
    );
    expect(alerts.attributes("title")).toBe(alerts.text());
    expect(alerts.classes()).toContain("line-clamp-4");
    expect(wrapper.get('[data-test="home-pack-resource-summary-savedView"]').text()).toBe(
      "Kubernetes events: every event in k8s_events, one click from Logs.",
    );
  });

  it("sizes the resource grid to the kinds a pack has", async () => {
    fake.flows.hosts = fakeFlow({ pack: HOSTS_PACK, viewCount: ref(0) });
    const wrapper = await render([HOSTS_PACK]);
    const grid = wrapper.get('[data-test="home-pack-hosts-resource-card-dashboard"]').element
      .parentElement!;
    expect(grid.className).toContain("grid-cols-2");
    expect(wrapper.get('[data-test="home-pack-hosts-resource-summary-dashboard"]').text()).toBe(
      "Host Metrics: CPU, memory and disk for each host.",
    );
    expect(wrapper.get('[data-test="home-pack-hosts-resource-summary-alert"]').text()).toBe(
      "Fire for every host. Off until you turn them on.",
    );
  });

  it("holds resource placeholders in the row until the preview is ready", async () => {
    fake.flows.kubernetes = fakeFlow({
      alertCount: ref(null),
      dashboardCount: ref(null),
      viewCount: ref(null),
      previewState: ref("loading"),
    });
    const wrapper = await render();
    expect(has(wrapper, "home-pack-resource-skeleton")).toBe(true);
    expect(has(wrapper, "home-pack-resource-card-dashboard")).toBe(false);
  });

  it("says the preview failed in the row instead of leaving the grid blank", async () => {
    fake.flows.kubernetes = fakeFlow({
      alertCount: ref(null),
      dashboardCount: ref(null),
      viewCount: ref(null),
      previewState: ref("error"),
    });
    const wrapper = await render();
    expect(has(wrapper, "home-pack-resource-skeleton")).toBe(false);
    expect(wrapper.get('[data-test="home-pack-resource-error"]').text()).toBe(
      "Couldn't load what this pack sets up. Review it to try again.",
    );
  });

  it("shows no streams panel for a pack matched without a found stream", async () => {
    fake.matchers.kubernetes.streams.value = [];
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card")).toBe(true);
    expect(has(wrapper, "home-pack-row-streams")).toBe(false);
  });

  it("puts the best-start badge on the first row the user can set up", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(has(wrapper, "home-pack-best-start")).toBe(false);
    expect(has(wrapper, "home-pack-row-highlight")).toBe(false);
    expect(wrapper.get('[data-test="home-pack-hosts-best-start"]').text()).toBe(
      "Best place to start",
    );
    expect(has(wrapper, "home-pack-hosts-row-highlight")).toBe(true);
    expect(
      wrapper.get('[data-test="home-pack-hosts-card-setup-btn"]').attributes("data-o2-variant"),
    ).toBe("primary");
  });
});
