import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref, shallowRef } from "vue";

import i18n from "@/locales";

import StarterPackLandingRow from "./StarterPackLandingRow.vue";
import { fakeFlow } from "./starterPackTestFlow";

const fake = vi.hoisted(() => ({
  flow: null as any,
  matcher: null as any,
  dismissal: null as any,
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
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));

const render = async () => {
  const wrapper = mount(StarterPackLandingRow, {
    props: { org: "org" },
    global: {
      plugins: [i18n],
      stubs: { StarterPackDrawer: true, StarterPackUndoDialog: true, TurnOnAlertsDrawer: true },
    },
  });
  fake.flow.record.value = { status: "complete" };
  await flushPromises();
  return wrapper;
};
const has = (wrapper: Awaited<ReturnType<typeof render>>, id: string) =>
  wrapper.find(`[data-test="${id}"]`).exists();

describe("StarterPackLandingRow", () => {
  beforeEach(() => {
    fake.flow = fakeFlow({ record: shallowRef(null) });
    fake.matcher = { clusters: ref(["c1"]), check: vi.fn() };
    fake.dismissal = {
      dismissed: ref(false),
      dismiss: vi.fn(() => (fake.dismissal.dismissed.value = true)),
    };
  });

  it("shows nothing and spends nothing without an install", async () => {
    const wrapper = mount(StarterPackLandingRow, {
      props: { org: "org" },
      global: {
        plugins: [i18n],
        stubs: { StarterPackDrawer: true, StarterPackUndoDialog: true, TurnOnAlertsDrawer: true },
      },
    });
    await flushPromises();
    expect(has(wrapper, "kubernetes-pack-undo-row")).toBe(false);
    expect(fake.matcher.check).not.toHaveBeenCalled();
  });

  it("shows the success bar with item count, Undo, time left and the alerts link", async () => {
    fake.flow.made.value = [
      { kind: "dashboard", itemId: "d" },
      { kind: "alert", itemId: "a" },
    ];
    const wrapper = await render();
    expect(fake.matcher.check).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-test="kubernetes-pack-installed-message"]').text()).toBe(
      "Kubernetes pack installed · 2 items",
    );
    expect(wrapper.get('[data-test="kubernetes-pack-undo-btn"]').text()).toBe("Undo setup");
    expect(wrapper.get('[data-test="kubernetes-pack-undo-left"]').text()).toBe("available for 5 h");
    expect(has(wrapper, "kubernetes-pack-view-btn")).toBe(true);
    expect(wrapper.get('[data-test="kubernetes-pack-scope"]').text()).toContain("c1");
    await wrapper.get('[data-test="kubernetes-pack-view-btn"]').trigger("click");
    expect(fake.push).toHaveBeenCalledWith(expect.objectContaining({ name: "starterPack" }));
    expect(has(wrapper, "kubernetes-pack-turn-on-btn")).toBe(true);
  });

  it("names the items that need attention with See which", async () => {
    fake.flow.failed.value = [{ kind: "alert", itemId: "a" }];
    const wrapper = await render();
    expect(wrapper.get('[data-test="kubernetes-pack-attention"]').text()).toContain(
      "1 item needs your attention",
    );
    expect(has(wrapper, "kubernetes-pack-see-which-btn")).toBe(true);
  });

  it("goes away on Not now", async () => {
    const wrapper = await render();
    await wrapper.get('[data-test="kubernetes-pack-not-now-btn"]').trigger("click");
    expect(has(wrapper, "kubernetes-pack-undo-row")).toBe(false);
  });

  it("is read-only for someone who cannot manage it", async () => {
    fake.flow.canManage.value = false;
    fake.flow.canUndo.value = false;
    const wrapper = await render();
    expect(has(wrapper, "kubernetes-pack-undo-row-readonly")).toBe(true);
    expect(has(wrapper, "kubernetes-pack-undo-btn")).toBe(false);
    expect(has(wrapper, "kubernetes-pack-turn-on-btn")).toBe(false);
    await wrapper.get('[data-test="kubernetes-pack-not-now-btn"]').trigger("click");
    expect(has(wrapper, "kubernetes-pack-undo-row-readonly")).toBe(false);
  });

  it("disappears after the window once every alert is on", async () => {
    fake.flow.undoLeftUs.value = 0;
    fake.flow.alertsOff.value = 0;
    fake.flow.canUndo.value = false;
    const wrapper = await render();
    expect(has(wrapper, "kubernetes-pack-undo-row")).toBe(false);
  });

  it("reports what Undo did, and retries a failed one", async () => {
    const wrapper = await render();
    fake.flow.removal.value = {
      removed: [{ kind: "alert" }, { kind: "savedView" }, { kind: "folder" }],
      kept: [{}],
    };
    await nextTick();
    expect(wrapper.get('[data-test="kubernetes-pack-undo-result"]').text()).toContain(
      "Removed 2 items. 1 you changed stayed.",
    );
    fake.flow.removalFailed.value = true;
    await nextTick();
    await wrapper.get('[data-test="kubernetes-pack-undo-result"] button').trigger("click");
    expect(fake.flow.undo).toHaveBeenCalled();
  });
});
