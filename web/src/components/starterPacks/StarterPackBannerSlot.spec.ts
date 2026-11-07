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
      waitedLong: ref(false),
      check: vi.fn(),
      retry: vi.fn(),
    };
  });
  afterEach(() => target.remove());

  it("holds the button at final width and disabled while checking", async () => {
    fake.matcher.state.value = "checking";
    const wrapper = await render();
    const button = action("first-event-status-pack-checking") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.className).toContain("w-68");
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([true]);
  });

  it("keeps checking while logs arrive, then offers the partial setup after the wait", async () => {
    fake.matcher.state.value = "waiting";
    await render();
    expect(action("first-event-status-pack-checking")).not.toBeNull();
    fake.matcher.waitedLong.value = true;
    await nextTick();
    expect(action("first-event-status-pack-partial-btn")?.className).toContain("w-68");
  });

  it("offers setup and names the guide cluster first", async () => {
    const wrapper = await render("typed");
    expect(action("first-event-status-pack-setup-btn")?.className).toContain("w-68");
    expect(wrapper.get('[data-test="first-event-status-pack-scope"]').text()).toContain(
      "2 seen so far: typed, seen-1",
    );
  });

  it("starts setup and lands on the typed cluster", async () => {
    await render("typed");
    (action("first-event-status-pack-setup-btn") as HTMLElement).click();
    await flushPromises();
    expect(fake.flow.land).toHaveBeenCalledWith("typed");
  });

  it("falls back to today's banner with a Library link when nothing matches", async () => {
    fake.matcher.state.value = "none";
    const wrapper = await render();
    expect(action("first-event-status-pack-library-link")).not.toBeNull();
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([false]);
  });

  it("offers a check retry on error", async () => {
    fake.matcher.state.value = "error";
    await render();
    (action("first-event-status-pack-retry-btn") as HTMLElement).click();
    expect(fake.matcher.retry).toHaveBeenCalled();
  });

  it("shows the admin link when setup was refused and the unlicensed copy on a lower plan", async () => {
    fake.flow.forbidden.value = true;
    fake.flow.licensed.value = false;
    const wrapper = await render();
    expect(action("first-event-status-pack-copy-link-btn")).not.toBeNull();
    expect(wrapper.get('[data-test="first-event-status-pack-unlicensed"]').text()).toContain(
      "a Kubernetes dashboard",
    );
  });

  it("offers nothing once the pack is installed", async () => {
    fake.flow.installed.value = true;
    const wrapper = await render();
    expect(action("first-event-status-pack-setup-btn")).toBeNull();
    expect(wrapper.emitted("offered")?.at(-1)).toEqual([false]);
  });
});
