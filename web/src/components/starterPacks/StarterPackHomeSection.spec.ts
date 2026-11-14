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
  menu: null as any,
  org: null as any,
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
  usePackDismissal: (_surface: string, _org: string, id: string) =>
    id === "menu" ? fake.menu : fake.dismissal,
  usePackHiddenForOrg: () => fake.org,
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
        OPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
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
    fake.menu = dismissalDouble();
    fake.copy.mockClear();
    fake.org = {
      hidden: ref(false),
      sharedOrg: ref(false),
      loaded: ref(true),
      load: vi.fn(),
      show: vi.fn(),
      loadUserCount: vi.fn(),
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
    expect(has(wrapper, "home-pack-hosts-card-best")).toBe(true);
    expect(has(wrapper, "home-pack-card-best")).toBe(false);
  });

  it("keeps the row, not the menu, while an install is still running", async () => {
    const wrapper = await render();
    fake.flows.kubernetes.running.value = true;
    fake.flows.kubernetes.record.value = { status: "incomplete" };
    await nextTick();
    const home = homeOf(wrapper);
    expect(wrapper.get('[data-test="home-pack-card"]').attributes("data-status")).toBe("running");
    expect(has(wrapper, "home-pack-offer")).toBe(true);
    expect(home.showMenu.value).toBe(false);
    expect(home.setUp.value).toEqual([]);
    fake.flows.kubernetes.record.value = { status: "complete" };
    fake.flows.kubernetes.running.value = false;
    await nextTick();
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    expect(home.showMenu.value).toBe(true);
  });

  it("shows the tiles, the matched streams and Set up <pack>, then lands on the dashboard", async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-test="home-pack-card-row-dashboard"]').text()).toContain(
      "1 dashboard",
    );
    const alerts = wrapper.get('[data-test="home-pack-card-row-alert"]').text();
    expect(alerts).toContain("2 alerts");
    expect(alerts).toContain("Silent until you turn them on");
    expect(has(wrapper, "home-pack-card-row-savedView")).toBe(true);
    expect(wrapper.get('[data-test="home-pack-card-streams"]').text()).toContain("k8s_events");
    expect(wrapper.get('[data-test="home-pack-card-setup-btn"]').text()).toBe("Set up Kubernetes");
    await wrapper.get('[data-test="home-pack-card-setup-btn"]').trigger("click");
    await flushPromises();
    expect(fake.flows.kubernetes.install).toHaveBeenCalled();
    expect(fake.flows.kubernetes.land).toHaveBeenCalledWith();
  });

  it("shows two streams and folds the rest behind a +N chip", async () => {
    fake.matchers.kubernetes.streams.value = ["a", "b", "c", "d"];
    fake.matchers.kubernetes.clusters.value = ["staging-eu-1"];
    const wrapper = await render();
    expect(wrapper.get('[data-test="home-pack-card-from"]').text()).toBe("from staging-eu-1");
    expect(wrapper.get('[data-test="home-pack-streams-more"]').text()).toContain("+2 streams");
    expect(wrapper.get('[data-test="home-pack-streams-more-list"]').text()).toContain("d");
  });

  it("marks only the first offered pack as the place to start", async () => {
    const wrapper = await render([KUBERNETES_PACK, HOSTS_PACK]);
    expect(has(wrapper, "home-pack-card-best")).toBe(true);
    expect(has(wrapper, "home-pack-hosts-card-best")).toBe(false);
    expect(wrapper.get('[data-test="home-pack-hosts-card-setup-btn"]').text()).toBe("Set up Hosts");
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

  it("offers Hide for everyone to admins of orgs with two or more users only", async () => {
    fake.flows.kubernetes.isAdmin.value = true;
    const solo = await render();
    expect(fake.org.loadUserCount).toHaveBeenCalled();
    expect(has(solo, "home-pack-card-hide-all-btn")).toBe(false);
    fake.org.sharedOrg.value = true;
    await nextTick();
    expect(has(solo, "home-pack-card-hide-all-btn")).toBe(true);
    fake.flows.kubernetes.isAdmin.value = false;
    await nextTick();
    expect(has(solo, "home-pack-card-hide-all-btn")).toBe(false);
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

  it("drops the section once a pack is set up and hands Overview the menu and silent alerts", async () => {
    fake.org.hidden.value = true;
    fake.flows.kubernetes.record = shallowRef({ status: "complete" });
    const wrapper = await render();
    expect(has(wrapper, "home-pack-offer")).toBe(false);
    const home = homeOf(wrapper);
    expect(home.showMenu.value).toBe(true);
    expect(home.silent.value.map((item) => item.pack.id)).toEqual(["kubernetes"]);
    fake.flows.kubernetes.remindAlerts.value = false;
    expect(home.silent.value).toEqual([]);
    fake.menu.dismiss();
    expect(home.showMenu.value).toBe(false);
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

  it("swaps Set up for Copy link when the user may not create the pack", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card-setup-btn")).toBe(false);
    expect(has(wrapper, "home-pack-card-copy-link-btn")).toBe(true);
  });

  it("copies the pack page link from the Copy link button of a pack the user may not create", async () => {
    fake.flows.kubernetes.forbidden.value = true;
    const wrapper = await render();
    await wrapper.get('[data-test="home-pack-card-copy-link-btn"]').trigger("click");
    expect(fake.copy).toHaveBeenCalledTimes(1);
    expect(fake.copy.mock.calls[0][0]).toBe(fake.flows.kubernetes.packLink());
    expect(fake.copy.mock.calls[0][0]).toContain("/alert-library/packs/kubernetes");
  });
});
