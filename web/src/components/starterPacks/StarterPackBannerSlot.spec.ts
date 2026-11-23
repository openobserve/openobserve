import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import i18n from "@/locales";

import { packById } from "@/composables/starterPacks/usePackCatalog";
import {
  resetStarterPackPopups,
  useStarterPackPopup,
} from "@/composables/starterPacks/useStarterPackPopup";
import StarterPackBannerSlot from "./StarterPackBannerSlot.vue";
import { fakeFlow } from "./starterPackTestFlow";
import { loadCatalogFixture } from "@/test/unit/helpers/starterPacksCatalog";

loadCatalogFixture();
const KUBERNETES = packById("kubernetes")!;

const fake = vi.hoisted(() => ({
  flow: null as any,
  matcher: null as any,
  shared: null as any,
  gate: true,
}));
vi.mock("@/composables/starterPacks/usePackGate", async () => {
  const { computed } = await import("vue");
  return { usePackGate: () => ({ visible: computed(() => fake.gate) }) };
});
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: () => fake.flow,
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: (_org: string, options?: { pack?: unknown }) =>
    (options?.pack && fake.shared) || fake.matcher,
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(async () => undefined) }) }));

let target: HTMLElement;
const render = async (clusterName?: string) => {
  const wrapper = mount(StarterPackBannerSlot, {
    props: { org: "org", clusterName },
    global: { plugins: [i18n] },
  });
  await nextTick();
  await flushPromises();
  return wrapper;
};
const has = (wrapper: Awaited<ReturnType<typeof render>>, id: string) =>
  wrapper.find(`[data-test="${id}"]`).exists();
const action = (id: string) => target.querySelector(`[data-test="${id}"]`);

describe("StarterPackBannerSlot", () => {
  beforeEach(() => {
    target = document.createElement("div");
    target.id = "first-event-pack-actions";
    document.body.append(target);
    resetStarterPackPopups();
    fake.gate = true;
    fake.shared = null;
    fake.flow = fakeFlow();
    fake.matcher = {
      state: ref("matched"),
      clusters: ref(["seen-1"]),
      streams: ref(["k8s_events", "k8s_node_cpu"]),
      waitedLong: ref(false),
      check: vi.fn(),
      checkShared: vi.fn(),
      retry: vi.fn(),
    };
  });
  afterEach(() => target.remove());

  it("shows the Home pack row, disabled with skeleton counts, while checking", async () => {
    fake.matcher.state.value = "checking";
    const wrapper = await render();
    const card = wrapper.get('[data-test="first-event-status-pack-card"]');
    expect(card.attributes("data-status")).toBe("loading");
    const button = wrapper.get('[data-test="first-event-status-pack-card-setup-btn"]')
      .element as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([true]);
  });

  it("keeps checking while logs arrive, then offers the setup and loads its counts", async () => {
    fake.matcher.state.value = "waiting";
    const wrapper = await render();
    const card = () => wrapper.get('[data-test="first-event-status-pack-card"]');
    expect(card().attributes("data-status")).toBe("loading");
    expect(fake.flow.loadPreview).not.toHaveBeenCalled();
    fake.matcher.waitedLong.value = true;
    await nextTick();
    expect(card().attributes("data-status")).toBe("offer");
    expect(fake.flow.loadPreview).toHaveBeenCalled();
  });

  it("says nothing fits yet when the long wait's preview has no items", async () => {
    fake.flow = fakeFlow({ alertCount: ref(0), dashboardCount: ref(0), viewCount: ref(0) });
    fake.matcher.state.value = "waiting";
    fake.matcher.waitedLong.value = true;
    const wrapper = await render();
    expect(wrapper.get('[data-test="first-event-status-pack-resource-empty"]').text()).toBe(
      "Nothing in this pack fits your data yet. Its items show here once their data arrives.",
    );
  });

  it("reloads the counts when the data arrives after a long wait", async () => {
    fake.matcher.state.value = "waiting";
    await render();
    fake.matcher.waitedLong.value = true;
    await nextTick();
    expect(fake.flow.loadPreview).toHaveBeenCalledTimes(1);
    fake.matcher.waitedLong.value = false;
    fake.matcher.state.value = "matched";
    await nextTick();
    expect(fake.flow.loadPreview).toHaveBeenCalledTimes(2);
  });

  it("offers the same pack row as Home with matched streams and resource cards", async () => {
    const wrapper = await render("typed");
    expect(has(wrapper, "first-event-status-pack-row-highlight")).toBe(true);
    expect(wrapper.get('[data-test="first-event-status-pack-card-setup-btn"]').text()).toBe(
      "Review pack",
    );
    expect(wrapper.get('[data-test="first-event-status-pack-row-streams"]').text()).toContain(
      "k8s_events, k8s_node_cpu",
    );
    expect(wrapper.get('[data-test="first-event-status-pack-card-row-dashboard"]').text()).toBe(
      "1 dashboard",
    );
  });

  it("shows skeleton counts until the preview has loaded", async () => {
    fake.flow = fakeFlow({
      alertCount: ref(null),
      dashboardCount: ref(null),
      viewCount: ref(null),
      previewState: ref("loading"),
    });
    const wrapper = await render("typed");
    expect(has(wrapper, "first-event-status-pack-resource-skeleton")).toBe(true);
  });

  it("opens the popup on the pack's review, naming the typed cluster, without installing", async () => {
    const wrapper = await render("typed");
    const popup = useStarterPackPopup("org");
    expect(popup.open.value).toBe(false);
    await wrapper.get('[data-test="first-event-status-pack-card-setup-btn"]').trigger("click");
    await flushPromises();
    expect([popup.open.value, popup.screen.value, popup.packId.value]).toEqual([
      true,
      "pack",
      "kubernetes",
    ]);
    expect(popup.entryOf(KUBERNETES).flow).toBe(fake.flow);
    expect(popup.clustersOf("kubernetes", ["seen-1"])).toEqual(["typed", "seen-1"]);
    expect(fake.flow.install).not.toHaveBeenCalled();
    expect(fake.flow.land).not.toHaveBeenCalled();
  });

  it("re-runs the shared match on Set up when it settled before the data arrived", async () => {
    fake.shared = { ...fake.matcher, state: ref("none"), clusters: ref([]), checkShared: vi.fn() };
    const wrapper = await render();
    await wrapper.get('[data-test="first-event-status-pack-card-setup-btn"]').trigger("click");
    expect(fake.shared.checkShared).toHaveBeenCalledTimes(1);
    expect(fake.matcher.checkShared).not.toHaveBeenCalled();
  });

  it("shows nothing and offers nothing for an org past onboarding (D10)", async () => {
    fake.gate = false;
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-card")).toBe(false);
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([false]);
    fake.flow.interrupted.value = true;
    await nextTick();
    expect(has(wrapper, "first-event-status-pack-interrupted")).toBe(false);
  });

  it("holds the row busy while the setup runs", async () => {
    fake.flow.running.value = true;
    const wrapper = await render();
    expect(
      wrapper.get('[data-test="first-event-status-pack-card"]').attributes("data-status"),
    ).toBe("running");
    const button = wrapper.get('[data-test="first-event-status-pack-card-setup-btn"]')
      .element as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("says a stopped setup in the Home banner and finishes it in the popup", async () => {
    fake.flow.interrupted.value = true;
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-card")).toBe(false);
    await wrapper.get('[data-test="first-event-status-pack-interrupted-btn"]').trigger("click");
    await flushPromises();
    expect(useStarterPackPopup("org").screen.value).toBe("pack");
    expect(useStarterPackPopup("org").open.value).toBe(true);
  });

  it("names who started a stopped setup in the Home banner and offers them no Finish", async () => {
    fake.flow.interrupted.value = true;
    fake.flow.interruptedBy = ref("other@example.com");
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-interrupted-btn")).toBe(false);
    const banner = () => wrapper.get('[data-test="first-event-status-pack-interrupted"]').text();
    expect(banner()).toBe("other@example.com started setting up Kubernetes.");
    fake.flow.interruptedBy.value = "";
    await nextTick();
    expect(banner()).toBe("Someone else started setting up Kubernetes.");
  });

  it("offers nothing when no pack matches", async () => {
    fake.matcher.state.value = "none";
    const wrapper = await render();
    expect(target.children.length).toBe(0);
    expect(has(wrapper, "first-event-status-pack-card")).toBe(false);
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([false]);
  });

  it("offers a check retry on error", async () => {
    fake.matcher.state.value = "error";
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-card")).toBe(false);
    (action("first-event-status-pack-retry-btn") as HTMLElement).click();
    expect(fake.matcher.retry).toHaveBeenCalled();
  });

  it("asks an admin, with no badge, when setup was refused", async () => {
    fake.flow.forbidden.value = true;
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-card-ask-admin")).toBe(true);
    expect(has(wrapper, "first-event-status-pack-card-setup-btn")).toBe(false);
    expect(has(wrapper, "first-event-status-pack-best-start")).toBe(false);
    expect(target.children.length).toBe(0);
  });

  it("offers nothing once the pack is installed", async () => {
    fake.flow.installed.value = true;
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-card")).toBe(false);
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([false]);
  });
});
