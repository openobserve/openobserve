import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import OToastProvider from "./OToastProvider.vue";
import { toastRecords, toast } from "./useToast";

beforeEach(() => {
  toastRecords.splice(0, toastRecords.length);
});

describe("OToastProvider", () => {
  it("renders nothing (no OToast elements) when toastRecords is empty", () => {
    const wrapper = mount(OToastProvider, { attachTo: document.body });
    // No ToastRoot elements should be rendered
    expect(wrapper.findAll('[role="status"], [role="alert"]')).toHaveLength(0);
  });

  it("renders one OToast per record in toastRecords", async () => {
    toast({ variant: "success", message: "First", timeout: 0 });
    toast({ variant: "error", message: "Second", timeout: 0 });

    const wrapper = mount(OToastProvider, { attachTo: document.body });
    await nextTick();

    const toastElements = wrapper.findAll('[role="status"], [role="alert"]');
    expect(toastElements).toHaveLength(2);
  });

  it("removes a record after openChange(false) fires", async () => {
    toast({ variant: "info", message: "Temp", timeout: 0 });

    const wrapper = mount(OToastProvider, { attachTo: document.body });
    await nextTick();

    expect(toastRecords).toHaveLength(1);

    // Simulate Reka firing openChange(false) by directly calling the handler
    // Manually trigger handleOpenChange by emitting on the OToast child
    const oToast = wrapper.findComponent({ name: "OToast" });
    oToast.vm.$emit("openChange", false);
    await nextTick();

    expect(toastRecords).toHaveLength(0);
  });

  it("renders a bottom-right toast in its own viewport", async () => {
    toast({ variant: "error", message: "Denied", position: "bottom-right", timeout: 0 });

    const wrapper = mount(OToastProvider, { attachTo: document.body });
    await nextTick();

    expect(wrapper.findAllComponents({ name: "OToast" })).toHaveLength(1);
    const viewport = document.body.querySelector("ol.end-4");
    expect(viewport?.textContent).toContain("Denied");
  });

  it("dismisses an open grouped toast on Escape", async () => {
    toast({
      variant: "error",
      message: "Denied",
      position: "bottom-right",
      timeout: 0,
      details: [{ label: "Logs", url: "/api/logs" }],
    });
    mount(OToastProvider, { attachTo: document.body });
    await nextTick();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();

    expect(toastRecords.every((r) => !r.open)).toBe(true);
  });

  it("leaves plain toasts alone on Escape", async () => {
    toast({ variant: "error", message: "Boom", timeout: 0 });
    mount(OToastProvider, { attachTo: document.body });
    await nextTick();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();

    expect(toastRecords.every((r) => r.open)).toBe(true);
  });
});
