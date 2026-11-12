import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import i18n from "@/locales";

import StarterPackBannerSlot from "./StarterPackBannerSlot.vue";
import { fakeFlow } from "./starterPackTestFlow";

const fake = vi.hoisted(() => ({ flow: null as any, matcher: null as any }));
vi.mock("@/composables/starterPacks/useStarterPackFlow", () => ({
  useStarterPackFlow: () => fake.flow,
}));
vi.mock("@/composables/starterPacks/useStarterPackMatcher", () => ({
  useStarterPackMatcher: () => fake.matcher,
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(async () => undefined) }) }));

let target: HTMLElement;
const render = async (clusterName?: string) => {
  const wrapper = mount(StarterPackBannerSlot, {
    props: { org: "org", clusterName },
    global: { plugins: [i18n], stubs: { StarterPackDrawer: true } },
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
    fake.flow = fakeFlow();
    fake.matcher = {
      state: ref("matched"),
      clusters: ref(["seen-1"]),
      streams: ref(["k8s_events", "k8s_node_cpu"]),
      waitedLong: ref(false),
      check: vi.fn(),
      retry: vi.fn(),
    };
  });
  afterEach(() => target.remove());

  it("holds the button at final width and disabled while checking", async () => {
    fake.matcher.state.value = "checking";
    const wrapper = await render();
    const button = wrapper.get('[data-test="first-event-status-pack-checking"]')
      .element as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.className).toContain("w-68");
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([true]);
  });

  it("keeps checking while logs arrive, then offers the partial setup after the wait", async () => {
    fake.matcher.state.value = "waiting";
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-checking")).toBe(true);
    fake.matcher.waitedLong.value = true;
    await nextTick();
    expect(wrapper.get('[data-test="first-event-status-pack-partial-btn"]').text()).toBe(
      "Set up for logs now, add metrics later",
    );
  });

  it("offers the same install card as Home with counts and matched streams", async () => {
    const wrapper = await render("typed");
    expect(wrapper.get('[data-test="first-event-status-pack-setup-btn"]').text()).toBe(
      "Install 4 items",
    );
    expect(wrapper.get('[data-test="first-event-status-pack-card-counts"]').text()).toContain(
      "1 dashboard",
    );
    expect(wrapper.get('[data-test="first-event-status-pack-card-sub"]').text()).toContain(
      "Matched to 2 streams you are already sending.",
    );
  });

  it("starts setup and lands on the pack dashboard", async () => {
    const wrapper = await render("typed");
    await wrapper.get('[data-test="first-event-status-pack-setup-btn"]').trigger("click");
    await flushPromises();
    expect(fake.flow.land).toHaveBeenCalledWith();
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
    await render();
    (action("first-event-status-pack-retry-btn") as HTMLElement).click();
    expect(fake.matcher.retry).toHaveBeenCalled();
  });

  it("shows the admin link in the card instead of the counts when setup was refused", async () => {
    fake.flow.forbidden.value = true;
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-copy-link-btn")).toBe(true);
    expect(has(wrapper, "first-event-status-pack-card-counts")).toBe(false);
    expect(target.children.length).toBe(0);
  });

  it("offers nothing once the pack is installed", async () => {
    fake.flow.installed.value = true;
    const wrapper = await render();
    expect(has(wrapper, "first-event-status-pack-setup-btn")).toBe(false);
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([false]);
  });
});
