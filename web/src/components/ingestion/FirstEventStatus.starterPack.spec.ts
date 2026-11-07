import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { createStore } from "vuex";

import i18n from "@/locales";

import FirstEventStatus from "./FirstEventStatus.vue";

vi.mock("@/constants/starterPacks", () => ({ STARTER_PACKS_ENABLED: true }));
vi.mock("@/composables/firstEvent/useFirstEventWatch", () => ({
  useFirstEventWatch: () => ({
    state: ref("received"),
    result: ref({
      count: 1,
      streamName: "default",
      streamType: "logs",
      rangeStart: 1,
      rangeEnd: 2,
    }),
    diagnosis: ref(),
    startedAtMs: ref(),
    scope: ref("new-data"),
    troubleshooting: ref(false),
    sinceUs: ref(),
    targetExists: ref(true),
    deciding: ref(false),
    start: vi.fn(),
    probeNow: vi.fn(),
    troubleshoot: vi.fn(),
  }),
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/components/starterPacks/StarterPackBannerSlot.vue", () => ({
  default: defineComponent({
    name: "StarterPackBannerSlot",
    props: ["org", "clusterName"],
    emits: ["offered"],
    setup: (_props, { emit }) => {
      emit("offered", true);
      return () => h("div", { "data-test": "pack-slot" });
    },
  }),
}));

const render = async (props: Record<string, unknown>) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  const store = createStore({
    state: { zoConfig: {}, selectedOrganization: { identifier: "org" }, organizationData: {} },
  });
  const wrapper = mount(FirstEventStatus, {
    props: { org: "org", ...props },
    global: { plugins: [i18n, store, router] },
  });
  await nextTick();
  await flushPromises();
  return wrapper;
};

describe("FirstEventStatus with the flag on", () => {
  it("mounts the pack on an offering guide and drops Open to outline", async () => {
    const wrapper = await render({ offersPack: true, clusterName: "typed" });
    const slot = wrapper.findComponent({ name: "StarterPackBannerSlot" });
    expect(slot.props("clusterName")).toBe("typed");
    expect(wrapper.find("#first-event-pack-actions").exists()).toBe(true);
    expect(wrapper.findComponent({ name: "OButton" }).exists()).toBe(true);
    const open = wrapper
      .findAllComponents({ name: "OButton" })
      .find((b) => b.attributes("data-test") === "first-event-status-open-btn");
    expect(open?.props("variant")).toBe("outline");
  });

  it("leaves other guides alone", async () => {
    const wrapper = await render({});
    expect(wrapper.find('[data-test="pack-slot"]').exists()).toBe(false);
  });
});
