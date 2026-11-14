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

import { HOSTS_PACK } from "@/composables/starterPacks/hostsPack";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import type { HomePacks } from "@/composables/starterPacks/useHomePacks";

import StarterPackHomeSection from "./StarterPackHomeSection.vue";
import { fakeFlow } from "./starterPackTestFlow";

const fake = vi.hoisted(() => ({
  flows: {} as Record<string, any>,
  matchers: {} as Record<string, any>,
  dismissal: null as any,
  org: null as any,
  hasUserData: null as any,
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
  usePackDismissal: () => fake.dismissal,
  usePackHiddenForOrg: () => fake.org,
}));
vi.mock("@/composables/useOrgHasUserData", () => ({
  useOrgHasUserData: () => ({ hasUserData: fake.hasUserData }),
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
        StarterPackFindMore: true,
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
    fake.hasUserData = ref(true);
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
    expect(has(wrapper, "home-pack-offer-header")).toBe(true);
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

  it("shows the strip title, counts with a plain bell and the matched stream", async () => {
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    const header = wrapper.get('[data-test="home-pack-offer-header"]').text();
    expect(header).toContain("Ready-made content for your data");
    expect(header).toContain("2 starter packs fit streams you already send");
    expect(wrapper.get('[data-test="home-pack-card-row-dashboard"]').text()).toBe("1 dashboard");
    expect(wrapper.get('[data-test="home-pack-card-row-alert"]').text()).toBe("2 alerts");
    expect(wrapper.text()).not.toContain("Silent until you turn them on");
    expect(wrapper.get('[data-test="home-pack-card-icon-alert"]').attributes("name")).toBe(
      "notifications",
    );
    expect(wrapper.get('[data-test="home-pack-card-row-savedView"]').text()).toBe("1 saved view");
    expect(wrapper.get('[data-test="home-pack-card-streams"]').text()).toContain("Fits k8s_events");
  });

  it("opens the setup popup from Set up and never installs from the card", async () => {
    const wrapper = await render();
    const setUp = wrapper.get('[data-test="home-pack-card-setup-btn"]');
    expect(setUp.text()).toBe("Set up");
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
    expect(sources[0].items.map((item: { kind: string }) => item.kind)).toContain("alert");
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

  it("shows one stream and folds the rest into a +N badge with a hover list", async () => {
    fake.matchers.kubernetes.streams.value = ["a", "b", "c", "d"];
    fake.matchers.kubernetes.clusters.value = ["staging-eu-1"];
    const wrapper = await render();
    expect(wrapper.get('[data-test="home-pack-card-from"]').text()).toBe("from staging-eu-1");
    expect(wrapper.get('[data-test="home-pack-streams-more"]').text()).toContain("+3 streams");
    expect(wrapper.get('[data-test="home-pack-streams-more-list"]').text()).toContain("d");
  });

  it("offers a Browse starter packs card beside the packs", async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-test="home-pack-find-other"]').text()).toContain(
      "Find packs for other data",
    );
    expect(wrapper.get('[data-test="home-pack-find-other"]').text()).toContain(
      "Nginx, PostgreSQL, AWS and more in the Starter Packs library.",
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

  it("says no pack matches once, and offers Retry on error", async () => {
    fake.matchers.kubernetes.state.value = "none";
    fake.matchers.hosts.state.value = "none";
    const none = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(none.findAll('[data-test="home-pack-empty"]')).toHaveLength(1);
    expect(has(none, "home-pack-empty-library-link")).toBe(true);
    fake.matchers.hosts.state.value = "matched";
    await nextTick();
    expect(has(none, "home-pack-empty")).toBe(false);
    expect(has(none, "home-pack-hosts-card")).toBe(true);

    fake.matchers.kubernetes.state.value = "error";
    fake.matchers.hosts.state.value = "none";
    const wrapper = await render();
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

  it("says nothing about no match while the org has no data of its own", async () => {
    fake.hasUserData = ref(false);
    fake.matchers.kubernetes.state.value = "none";
    const wrapper = await render();
    expect(homeOf(wrapper).empty.value).toBe(false);
    expect(has(wrapper, "home-pack-empty")).toBe(false);
    expect(wrapper.findComponent({ name: "StarterPackFindMore" }).exists()).toBe(false);
  });

  it("swaps Set up for Ask an admin and Copy link when the user may not create the pack", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card-setup-btn")).toBe(false);
    expect(wrapper.get('[data-test="home-pack-card-ask-admin-btn"]').text()).toBe("Ask an admin");
    expect(wrapper.get('[data-test="home-pack-card-copy-link-btn"]').text()).toBe("Copy link");
  });

  it("copies the pack page link from the Copy link button of a pack the user may not create", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render();
    await wrapper.get('[data-test="home-pack-card-copy-link-btn"]').trigger("click");
    expect(fake.copy).toHaveBeenCalledTimes(1);
    expect(fake.copy.mock.calls[0][0]).toBe(fake.flows.kubernetes.packLink());
    expect(fake.copy.mock.calls[0][0]).toContain("/starter-packs/kubernetes");
  });
});
