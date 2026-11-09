import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref, shallowRef } from "vue";

import i18n from "@/locales";

import { HOSTS_PACK } from "@/composables/starterPacks/hostsPack";

import StarterPackHomeCard from "./StarterPackHomeCard.vue";
import { fakeFlow } from "./starterPackTestFlow";

const fake = vi.hoisted(() => ({
  flow: null as any,
  matcher: null as any,
  dismissal: null as any,
  org: null as any,
  push: vi.fn(async () => undefined),
}));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: () => fake.flow,
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: () => fake.matcher,
}));
vi.mock("@/composables/starterPacks/packDismissal", () => ({
  usePackDismissal: () => fake.dismissal,
  usePackHiddenForOrg: () => fake.org,
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));

const render = async (props: Record<string, unknown> = {}) => {
  fake.flow.loaded.value = false;
  const wrapper = mount(StarterPackHomeCard, {
    props: { org: "org", ...props },
    global: {
      plugins: [i18n],
      stubs: {
        StarterPackDrawer: true,
        StarterPackHealthLine: true,
        TurnOnAlertsDrawer: true,
        OIcon: true,
      },
    },
  });
  fake.flow.loaded.value = true;
  await flushPromises();
  return wrapper;
};
const has = (wrapper: Awaited<ReturnType<typeof render>>, id: string) =>
  wrapper.find(`[data-test="${id}"]`).exists();

describe("StarterPackHomeCard", () => {
  beforeEach(() => {
    fake.flow = fakeFlow();
    fake.matcher = {
      state: ref("matched"),
      clusters: ref([]),
      streams: ref(["k8s_events"]),
      waitedLong: ref(false),
      check: vi.fn(),
      retry: vi.fn(async () => undefined),
    };
    fake.dismissal = {
      dismissed: ref(false),
      dismiss: vi.fn(() => (fake.dismissal.dismissed.value = true)),
      restore: vi.fn(() => (fake.dismissal.dismissed.value = false)),
    };
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

  it("reminds until alerts are on, and Keep off asks the flow to stop", async () => {
    fake.flow.record.value = { items: [] };
    const wrapper = await render();
    expect(has(wrapper, "home-pack-reminder")).toBe(true);
    await wrapper.get('[data-test="home-pack-reminder-keep-off-btn"]').trigger("click");
    expect(fake.flow.keepOff).toHaveBeenCalled();
    fake.flow.remindAlerts.value = false;
    await nextTick();
    expect(has(wrapper, "home-pack-reminder")).toBe(false);
  });

  it("copies a link to the pack page, not the page the asker is on", async () => {
    expect(fake.flow.packLink()).toContain("/alert-library/packs/kubernetes");
  });

  it("keeps a skeleton while checking, and offers the pack once matched", async () => {
    fake.matcher.state.value = "checking";
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card-skeleton")).toBe(true);
    fake.matcher.state.value = "matched";
    await nextTick();
    expect(has(wrapper, "home-pack-card")).toBe(true);
    expect(fake.flow.loadPreview).toHaveBeenCalled();
  });

  it("dismisses per user and comes back with Show again", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="home-pack-card-dismiss-btn"]').trigger("click");
    expect(has(wrapper, "home-pack-card")).toBe(false);
    await wrapper.get('[data-test="home-pack-card-show-again-btn"]').trigger("click");
    expect(has(wrapper, "home-pack-card")).toBe(true);
  });

  it("offers Hide for everyone to admins of orgs with two or more users only", async () => {
    fake.flow.isAdmin.value = true;
    const solo = await render();
    expect(fake.org.loadUserCount).toHaveBeenCalled();
    expect(has(solo, "home-pack-card-hide-all-btn")).toBe(false);
    fake.org.sharedOrg.value = true;
    await nextTick();
    expect(has(solo, "home-pack-card-hide-all-btn")).toBe(true);
    fake.flow.isAdmin.value = false;
    await nextTick();
    expect(has(solo, "home-pack-card-hide-all-btn")).toBe(false);
  });

  it("renders nothing when hidden for everyone", async () => {
    fake.org.hidden.value = true;
    expect(has(await render(), "home-pack-section")).toBe(false);
    expect(fake.matcher.check).not.toHaveBeenCalled();
  });

  it("lets an admin undo Hide for everyone", async () => {
    fake.org.hidden.value = true;
    fake.flow.isAdmin.value = true;
    const wrapper = await render();
    await wrapper.get('[data-test="home-pack-card-show-all-btn"]').trigger("click");
    expect(fake.org.show).toHaveBeenCalled();
  });

  it("keeps the install states visible when hidden for everyone", async () => {
    fake.org.hidden.value = true;
    fake.flow.record = shallowRef({ status: "complete" });
    expect(has(await render(), "home-pack-reminder")).toBe(true);
  });

  it("spends nothing on the matcher for an installed or dismissed pack", async () => {
    fake.flow.record = shallowRef({ status: "complete" });
    await render();
    fake.flow.record = shallowRef(null);
    fake.dismissal.dismissed.value = true;
    await render();
    expect(fake.matcher.check).not.toHaveBeenCalled();
  });

  it("shows the Library path when nothing matches and Retry on error", async () => {
    fake.matcher.state.value = "none";
    expect(has(await render(), "home-pack-empty-library-link")).toBe(true);
    fake.matcher.state.value = "error";
    const wrapper = await render();
    await wrapper.get('[data-test="home-pack-card-retry-btn"]').trigger("click");
    expect(fake.matcher.retry).toHaveBeenCalled();
  });

  it("offers the Hosts pack under its own title and stays silent when nothing matches", async () => {
    const hosts = { pack: HOSTS_PACK, showEmpty: false };
    fake.flow = fakeFlow({ viewCount: ref(0), licensed: ref(false) });
    const offer = await render(hosts);
    const card = offer.get('[data-test="home-pack-hosts-card"]');
    expect(card.text()).toContain("Your Hosts data is ready to monitor");
    expect(offer.get('[data-test="home-pack-hosts-card-counts"]').text()).toContain("2 alerts");
    expect(has(offer, "home-pack-card")).toBe(false);
    expect(has(offer, "home-pack-hosts-card-setup-btn")).toBe(true);
    expect(offer.emitted("offered")?.at(-1)).toEqual([true]);
    fake.matcher.state.value = "none";
    const silent = await render(hosts);
    expect(silent.find('[data-test="home-pack-hosts-section"]').exists()).toBe(false);
    expect(silent.emitted("offered")?.at(-1)).toEqual([false]);
  });

  it("shows the counts, the matched streams and Install N items without a Library link", async () => {
    const wrapper = await render();
    expect(wrapper.get('[data-test="home-pack-card-counts"]').text()).toContain(
      "1 dashboard2 alerts1 saved search",
    );
    expect(wrapper.get('[data-test="home-pack-card-sub"]').text()).toContain(
      "Matched to 1 stream you are already sending.",
    );
    expect(wrapper.get('[data-test="home-pack-card-setup-btn"]').text()).toBe("Install 4 items");
    expect(has(wrapper, "home-pack-card-library-link")).toBe(false);
    await wrapper.get('[data-test="home-pack-card-setup-btn"]').trigger("click");
    await flushPromises();
    expect(fake.flow.land).toHaveBeenCalledWith();
  });

  it("swaps to the reminder after setup and links the pack page", async () => {
    fake.flow.record = shallowRef({ status: "complete" });
    const wrapper = await render();
    expect(has(wrapper, "home-pack-card")).toBe(false);
    expect(has(wrapper, "home-pack-alerts-on-tile")).toBe(true);
    await wrapper.get('[data-test="home-pack-view-btn"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith(expect.objectContaining({ name: "starterPack" }));
    expect(has(wrapper, "home-pack-reminder-turn-on-btn")).toBe(true);
  });

  it("surfaces an interrupted install before anything else", async () => {
    fake.flow.interrupted.value = true;
    fake.flow.record = shallowRef({ status: "incomplete" });
    expect(has(await render(), "home-pack-interrupted-btn")).toBe(true);
  });
});
