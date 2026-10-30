// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { computed, defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import AlertEditStatus from "./AlertEditStatus.vue";
import type { AlertEditHeader, AlertEditState } from "@/composables/alerts/useAlertEditHeader";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const fakeHeader = (opts: {
  muteEnabled?: boolean;
  muted?: boolean;
  state?: AlertEditState;
}): AlertEditHeader => ({
  muteEnabled: computed(() => opts.muteEnabled ?? true),
  muted: computed(() => (opts.muted ? { id: "dt1", ends_at: 1, version: 1 } : null)),
  mutedUntilText: computed(() => raw(opts.muted ? "Muted until 14:00" : "")),
  enabled: computed(() => true),
  state: computed(() => opts.state ?? { kind: "notRun" }),
  pending: computed(() => false),
  fireOpen: computed(() => false),
  setFireOpen: vi.fn(),
  muteFor: vi.fn().mockResolvedValue(true),
  unmute: vi.fn().mockResolvedValue(true),
  fireNow: vi.fn(),
  toggleEnabled: vi.fn(),
  exportDefinition: vi.fn(),
  clone: vi.fn(),
  refresh: vi.fn(),
});

const mountStatus = (header: AlertEditHeader) =>
  mount(AlertEditStatus, {
    props: { header, alertId: "a1", folderId: "f1", orgId: "default" },
  });

// The menu part renders inside the More menu; a plain stand-in for its items keeps it testable alone.
const ItemStub = defineComponent({
  emits: ["select"],
  setup(_, { slots, emit, attrs }) {
    return () => h("button", { ...attrs, onClick: () => emit("select") }, slots.default?.());
  },
});
const mountMenu = (header: AlertEditHeader) =>
  mount(AlertEditStatus, {
    props: { header, alertId: "a1", folderId: "f1", orgId: "default", part: "menu" },
    global: { stubs: { ODropdownItem: ItemStub } },
  });

describe("AlertEditStatus", () => {
  it("hides mute and history below lg, where the More menu carries them", () => {
    const wrapper = mountStatus(fakeHeader({}));
    expect(wrapper.find('[data-test="add-alert-mute"]').classes()).toContain("max-lg:hidden");
    expect(wrapper.find('[data-test="add-alert-history-link"]').classes()).toContain(
      "max-lg:hidden",
    );
    expect(wrapper.find('[data-test="add-alert-state-chip"]').classes()).not.toContain(
      "max-lg:hidden",
    );
  });

  it("gives the More menu Mute for 1 h and Alert History below lg", async () => {
    const header = fakeHeader({});
    const wrapper = mountMenu(header);
    expect(wrapper.find('[data-test="add-alert-state-chip"]').exists()).toBe(false);
    const muteItem = wrapper.find('[data-test="add-alert-menu-mute"]');
    expect(muteItem.text()).toBe("Mute for 1 h");
    await muteItem.trigger("click");
    expect(header.muteFor).toHaveBeenCalledWith(3600);
    await wrapper.find('[data-test="add-alert-menu-history"]').trigger("click");
    expect(push).toHaveBeenCalled();
  });

  it("offers Unmute in the More menu while muted", async () => {
    const header = fakeHeader({ muted: true });
    const wrapper = mountMenu(header);
    await wrapper.find('[data-test="add-alert-menu-unmute"]').trigger("click");
    expect(header.unmute).toHaveBeenCalled();
  });

  it("offers Mute for 1 h and mutes for an hour", async () => {
    const header = fakeHeader({});
    const wrapper = mountStatus(header);
    expect(wrapper.find('[data-test="add-alert-mute-duration"]').text()).toContain("1 h");
    await wrapper.find('[data-test="add-alert-mute-btn"]').trigger("click");
    expect(header.muteFor).toHaveBeenCalledWith(3600);
    expect(wrapper.find('[data-test="add-alert-muted"]').exists()).toBe(false);
  });

  it("shows Muted until and an Unmute that ends the mute", async () => {
    const header = fakeHeader({ muted: true });
    const wrapper = mountStatus(header);
    expect(wrapper.find('[data-test="add-alert-muted-until"]').text()).toContain(
      "Muted until 14:00",
    );
    expect(wrapper.find('[data-test="add-alert-mute-btn"]').exists()).toBe(false);
    await wrapper.find('[data-test="add-alert-unmute-btn"]').trigger("click");
    expect(header.unmute).toHaveBeenCalled();
  });

  it("hides mute entirely when downtimes are off", () => {
    const wrapper = mountStatus(fakeHeader({ muteEnabled: false, muted: true }));
    expect(wrapper.find('[data-test="add-alert-mute"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="add-alert-muted"]').exists()).toBe(false);
  });

  it("chips the last run outcome, a disabled alert, or no run yet", () => {
    const outcome = mountStatus(fakeHeader({ state: { kind: "outcome", value: "firing" } }));
    expect(outcome.find('[data-test="add-alert-state-chip"]').text()).toContain("Firing");
    const disabled = mountStatus(fakeHeader({ state: { kind: "disabled" } }));
    expect(disabled.find('[data-test="add-alert-state-chip"]').text()).toContain("Disabled");
    const fresh = mountStatus(fakeHeader({ state: { kind: "notRun" } }));
    expect(fresh.find('[data-test="add-alert-state-chip"]').text()).toContain("Not run yet");
  });

  it("links Alert History to the alert's detail page", async () => {
    const wrapper = mountStatus(fakeHeader({}));
    await wrapper.find('[data-test="add-alert-history-link"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "alertDetail",
      params: { alert_id: "a1" },
      query: { folder: "f1", org_identifier: "default" },
    });
  });
});

describe("AlertEditStatus with a real ref", () => {
  it("switches to Muted until once the mute lands", async () => {
    const muted = ref(false);
    const header = {
      ...fakeHeader({}),
      muted: computed(() => (muted.value ? { id: "d", ends_at: 1 } : null)),
      mutedUntilText: computed(() => raw("Muted until 15:30")),
    };
    const wrapper = mountStatus(header);
    muted.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="add-alert-muted-until"]').text()).toContain("15:30");
  });
});
