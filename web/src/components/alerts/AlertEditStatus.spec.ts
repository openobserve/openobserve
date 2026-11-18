// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { computed, defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import i18n from "@/locales";
import AlertEditStatus from "./AlertEditStatus.vue";
import AlertEditActions from "./AlertEditActions.vue";
import type { AlertEditHeader, AlertEditState } from "@/composables/alerts/useAlertEditHeader";

const t = (key: string) => i18n.global.t(key);
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const fakeHeader = (opts: {
  muteEnabled?: boolean;
  muted?: boolean;
  state?: AlertEditState;
  enabled?: { value: boolean };
  pending?: { value: boolean };
}): AlertEditHeader => ({
  muteEnabled: computed(() => opts.muteEnabled ?? true),
  muted: computed(() => (opts.muted ? { id: "dt1", ends_at: 1, version: 1 } : null)),
  mutedUntilText: computed(() => raw(opts.muted ? "Muted until 14:00" : "")),
  enabled: computed(() => opts.enabled?.value ?? true),
  state: computed(() => opts.state ?? { kind: "notRun" }),
  pending: computed(() => opts.pending?.value ?? false),
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

const mountStatus = (header: AlertEditHeader, part: "state" | "actions" = "state") =>
  mount(AlertEditStatus, {
    props: { header, alertId: "a1", folderId: "f1", orgId: "default", part },
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
  it.each([
    [
      "state",
      ["state-chip", "enabled-switch", "muted-until"],
      ["mute", "unmute-btn", "history-link"],
    ],
    ["actions", ["unmute-btn", "history-link"], ["state-chip", "enabled-switch", "muted-until"]],
  ] as const)("the %s part holds only its own controls", (part, shown, absent) => {
    const wrapper = mountStatus(fakeHeader({ muted: true }), part);
    for (const id of shown)
      expect(wrapper.find(`[data-test="add-alert-${id}"]`).exists()).toBe(true);
    for (const id of absent)
      expect(wrapper.find(`[data-test="add-alert-${id}"]`).exists()).toBe(false);
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
    const wrapper = mountStatus(header, "actions");
    expect(wrapper.find('[data-test="add-alert-mute-duration"]').text()).toContain("1 h");
    await wrapper.find('[data-test="add-alert-mute-btn"]').trigger("click");
    expect(header.muteFor).toHaveBeenCalledWith(3600);
  });

  it("shows Muted until and an Unmute that ends the mute", async () => {
    const header = fakeHeader({ muted: true });
    expect(mountStatus(header).find('[data-test="add-alert-muted-until"]').text()).toContain(
      "Muted until 14:00",
    );
    const wrapper = mountStatus(header, "actions");
    expect(wrapper.find('[data-test="add-alert-mute-btn"]').exists()).toBe(false);
    await wrapper.find('[data-test="add-alert-unmute-btn"]').trigger("click");
    expect(header.unmute).toHaveBeenCalled();
  });

  it("hides mute entirely when downtimes are off", () => {
    const header = fakeHeader({ muteEnabled: false, muted: true });
    expect(mountStatus(header).find('[data-test="add-alert-muted-until"]').exists()).toBe(false);
    const actions = mountStatus(header, "actions");
    expect(actions.find('[data-test="add-alert-mute"]').exists()).toBe(false);
    expect(actions.find('[data-test="add-alert-unmute-btn"]').exists()).toBe(false);
  });

  it("chips the last run outcome or no run yet", () => {
    const outcome = mountStatus(fakeHeader({ state: { kind: "outcome", value: "firing" } }));
    expect(outcome.find('[data-test="add-alert-state-chip"]').text()).toContain("Firing");
    const fresh = mountStatus(fakeHeader({ state: { kind: "notRun" } }));
    expect(fresh.find('[data-test="add-alert-state-chip"]').text()).toContain("Not run yet");
  });

  it.each([
    ["on", true, "common.switchOn"],
    ["off", false, "common.switchOff"],
  ])("says %s once, beside the switch", (_, on, key) => {
    const wrapper = mountStatus(
      fakeHeader({ enabled: { value: on }, state: on ? { kind: "notRun" } : { kind: "disabled" } }),
    );
    expect(wrapper.find('[data-test="add-alert-enabled-switch-state"]').text()).toBe(t(key));
    expect(wrapper.find('[data-test="add-alert-state-chip"]').exists()).toBe(on);
  });

  it("links Alert History to the alert's detail page", async () => {
    const wrapper = mountStatus(fakeHeader({}), "actions");
    await wrapper.find('[data-test="add-alert-history-link"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "alertDetail",
      params: { alert_id: "a1" },
      query: { folder: "f1", org_identifier: "default" },
    });
  });
});

describe("the Enabled switch", () => {
  it("reflects the saved state, toggles it, and waits for the server before it moves", async () => {
    const enabled = ref(true);
    const pending = ref(false);
    const header = fakeHeader({ enabled, pending });
    const wrapper = mountStatus(header);
    const control = () => wrapper.find('[data-test="add-alert-enabled-switch"] [role="switch"]');
    await control().trigger("click");
    expect(header.toggleEnabled).toHaveBeenCalledTimes(1);
    expect(control().attributes("aria-checked")).toBe("true");
    pending.value = true;
    await wrapper.vm.$nextTick();
    expect(control().attributes("disabled")).toBeDefined();
    expect(control().attributes("aria-busy")).toBe("true");
    enabled.value = false;
    pending.value = false;
    await wrapper.vm.$nextTick();
    expect(control().attributes("aria-checked")).toBe("false");
  });

  it("is not repeated as an Enable item in More", () => {
    const wrapper = mount(AlertEditActions, {
      props: { header: fakeHeader({}), name: "errors", part: "more" },
      global: {
        stubs: {
          ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
          ODropdownItem: ItemStub,
          ODialog: true,
          ExportResourceDialog: true,
        },
      },
    });
    expect(wrapper.find('[data-test="add-alert-more-clone"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="add-alert-more-toggle-enabled"]').exists()).toBe(false);
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
