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

  it("keeps the message on one line, cut with its full text on hover", async () => {
    mountToast({ id: "1", open: true, message: "Pipeline payments-ingest saved" });
    await vueNextTick();
    const body = document.body.querySelector('[data-test="o-toast-message"]');
    expect(body?.querySelector(".truncate")?.textContent).toContain(
      "Pipeline payments-ingest saved",
    );
  });

  it("is one inverse line, 40 high, at most 420 wide, with the menu radius", async () => {
    mountToast({ id: "1", open: true, message: "Dashboard saved" });
    await vueNextTick();
    const root = document.body.querySelector('[data-test="o-toast-1"]');
    for (const c of [
      "bg-toast-inverse-bg",
      "text-toast-inverse-text",
      "rounded-menu",
      "min-h-10",
      "text-compact",
      "max-w-[min(26.25rem,calc(100vw-2rem))]",
    ])
      expect(root?.className).toContain(c);
  });

  it.each([
    ["success", "ok", "text-toast-inverse-icon-ok"],
    ["error", "error", "text-toast-inverse-icon-err"],
    ["warning", "neutral", "text-toast-inverse-icon"],
    ["info", "neutral", "text-toast-inverse-icon"],
    ["default", "neutral", "text-toast-inverse-icon"],
  ] as const)("renders the %s variant as the %s kind", async (variant, kind, iconClass) => {
    mountToast({ id: "1", open: true, message: "m", variant });
    await vueNextTick();
    const root = document.body.querySelector('[data-test="o-toast-1"]');
    expect(root?.getAttribute("data-test-kind")).toBe(kind);
    const icon = root?.querySelector('span[aria-hidden="true"]');
    expect(icon?.className.split(" ")).toContain(iconClass);
    expect(icon?.querySelector("svg")).not.toBeNull();
  });

  it("shows how many identical results it collapsed", async () => {
    mountToast({ id: "1", open: true, message: "Forbidden", count: 3 });
    await vueNextTick();
    expect(document.body.querySelector('[data-test="o-toast-count-3"]')?.textContent).toBe("×3");
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
});
