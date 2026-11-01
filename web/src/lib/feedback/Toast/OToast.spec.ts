import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { h, nextTick as vueNextTick } from "vue";
import { ToastProvider, ToastViewport } from "reka-ui";
import OToast from "./OToast.vue";
import type { ToastProps } from "./OToast.types";

// ToastViewport uses Teleport to portal its <ol> into document.body.
// We include a ToastViewport in the wrapper, mount with attachTo: document.body,
// and query document.body for rendered content.
function mountToast(props: ToastProps) {
  return mount(
    {
      render() {
        return h(ToastProvider, { duration: 0 }, () => [h(OToast, props), h(ToastViewport)]);
      },
    },
    { attachTo: document.body },
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OToast", () => {
  it("renders message text", async () => {
    mountToast({ id: "1", open: true, message: "Hello world" });
    await vueNextTick();
    expect(document.body.textContent).toContain("Hello world");
  });

  it("keeps each line of a multi-line message on its own line", async () => {
    mountToast({ id: "1", open: true, message: "First: a; b\nSecond: c" });
    await vueNextTick();
    const body = document.body.querySelector('[data-test="o-toast-message"]');
    expect(body?.textContent).toContain("First: a; b\nSecond: c");
    expect(body?.className).toContain("whitespace-pre-line");
    expect(body?.className).toContain("break-words");
  });

  it("renders title when provided", async () => {
    mountToast({ id: "1", open: true, message: "Body text", title: "My Title" });
    await vueNextTick();
    expect(document.body.textContent).toContain("My Title");
    expect(document.body.textContent).toContain("Body text");
  });

  it("renders success icon for success variant", async () => {
    mountToast({ id: "1", open: true, message: "Done", variant: "success" });
    await vueNextTick();
    expect(document.body.querySelector("svg")).not.toBeNull();
  });

  it("renders error icon for error variant", async () => {
    mountToast({ id: "1", open: true, message: "Error", variant: "error" });
    await vueNextTick();
    expect(document.body.querySelector("svg")).not.toBeNull();
  });

  it("renders warning icon for warning variant", async () => {
    mountToast({ id: "1", open: true, message: "Warn", variant: "warning" });
    await vueNextTick();
    expect(document.body.querySelector("svg")).not.toBeNull();
  });

  it("renders info icon for info variant", async () => {
    mountToast({ id: "1", open: true, message: "FYI", variant: "info" });
    await vueNextTick();
    expect(document.body.querySelector("svg")).not.toBeNull();
  });

  it("does not render an icon for default variant", async () => {
    mountToast({ id: "1", open: true, message: "Plain", variant: "default" });
    await vueNextTick();
    // default variant has no variant-icon div — only the dismiss button X renders
    const toastEl = document.body.querySelector('[role="status"]');
    expect(toastEl).not.toBeNull();
    // The variant icon is wrapped in a <div aria-hidden="true">; close button X is not
    expect(toastEl!.querySelector('div[aria-hidden="true"]')).toBeNull();
  });

  it("renders a spinning icon for loading variant", async () => {
    mountToast({ id: "1", open: true, message: "Loading…", variant: "loading" });
    await vueNextTick();
    // OIcon renders <span class="...animate-spin"><component(svg) class="size-full" /></span>
    // The animate-spin class is on the span (via attribute fallthrough on OIcon), not the svg
    const spinEl = document.body.querySelector('[class*="animate-spin"]');
    expect(spinEl).not.toBeNull();
  });

  it("renders action button when action prop is provided", async () => {
    const handler = vi.fn();
    mountToast({
      id: "1",
      open: true,
      message: "Reload needed",
      action: { label: "Refresh", handler },
    });
    await vueNextTick();
    const btn = document.body.querySelector('button[type="button"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("Refresh");
  });

  it("calls action.handler when action button is clicked", async () => {
    const handler = vi.fn();
    mountToast({
      id: "1",
      open: true,
      message: "Reload needed",
      action: { label: "Refresh", handler },
    });
    await vueNextTick();
    const btn = document.body.querySelector<HTMLButtonElement>('button[type="button"]');
    btn!.click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("emits openChange(false) when close button is clicked", async () => {
    const wrapper = mountToast({ id: "1", open: true, message: "Hello" });
    await vueNextTick();
    const closeBtn = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss notification"]',
    );
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();
    await vueNextTick();
    const emitted = wrapper.findComponent(OToast).emitted("openChange");
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual([false]);
  });

  it("has role=alert for error variant", async () => {
    mountToast({ id: "1", open: true, message: "Bad", variant: "error" });
    await vueNextTick();
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("has role=alert for warning variant", async () => {
    mountToast({ id: "1", open: true, message: "Careful", variant: "warning" });
    await vueNextTick();
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("has role=status for success variant", async () => {
    mountToast({ id: "1", open: true, message: "Great", variant: "success" });
    await vueNextTick();
    expect(document.body.querySelector('[role="status"]')).not.toBeNull();
  });

  it("has role=status for info variant", async () => {
    mountToast({ id: "1", open: true, message: "Note", variant: "info" });
    await vueNextTick();
    expect(document.body.querySelector('[role="status"]')).not.toBeNull();
  });

  it("masks the toast root for session replay only when asked", async () => {
    mountToast({ id: "1", open: true, message: "Answer ready", mask: true });
    await vueNextTick();
    expect(
      document.body.querySelector('[data-test="o-toast-1"]')?.getAttribute("data-dd-privacy"),
    ).toBe("mask");
    document.body.innerHTML = "";
    mountToast({ id: "2", open: true, message: "Saved" });
    await vueNextTick();
    expect(
      document.body.querySelector('[data-test="o-toast-2"]')?.hasAttribute("data-dd-privacy"),
    ).toBe(false);
  });

  it("sets aria-live from live and leaves it unset by default", async () => {
    mountToast({ id: "1", open: true, message: "Answer ready", live: "off" });
    await vueNextTick();
    const silent = document.body.querySelector('[data-test="o-toast-1"]');
    expect(silent?.getAttribute("aria-live")).toBe("off");
    expect(silent?.querySelector(".shadow-toast[data-reka-toast-announce-exclude]")).not.toBeNull();
    document.body.innerHTML = "";
    mountToast({ id: "2", open: true, message: "Saved", variant: "success" });
    await vueNextTick();
    const spoken = document.body.querySelector('[data-test="o-toast-2"]');
    expect(spoken?.hasAttribute("aria-live")).toBe(false);
    expect(spoken?.querySelector(".shadow-toast[data-reka-toast-announce-exclude]")).toBeNull();
  });
});
