import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import ODropdown from "./ODropdown.vue";
import ODropdownSub from "./ODropdownSub.vue";
import ODropdownItem from "./ODropdownItem.vue";

let wrapper: ReturnType<typeof mount> | undefined;
afterEach(() => wrapper?.unmount());

describe("ODropdownSub", () => {
  it.each([
    ["ArrowRight", "ArrowLeft"],
    ["Enter", "Escape"],
  ])("supports %s/%s parent navigation and activates a nested action once", async (open, close) => {
    const select = vi.fn();
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () => [
          h(
            ODropdownSub,
            { "data-test": "sub", textValue: raw("Export") },
            {
              trigger: () => "Export",
              default: () =>
                h(ODropdownItem, { "data-test": "csv", onSelect: select }, () => "CSV"),
            },
          ),
          h(ODropdownItem, { "data-test": "next" }, () => "Next"),
        ],
      },
    });
    await flushPromises();
    const item = (id: string) => document.querySelector<HTMLElement>(`[data-test="${id}"]`)!;
    const key = (key: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    const sub = item("sub");
    sub.focus();
    key("ArrowDown");
    await vi.waitFor(() => expect(document.activeElement).toBe(item("next")));
    expect(item("csv")).toBeNull();
    sub.focus();
    key(open);
    await vi.waitFor(() => expect(document.activeElement).toBe(item("csv")));
    key(close);
    await vi.waitFor(() => expect(document.activeElement).toBe(sub));
    await vi.waitFor(() => expect(item("csv")).toBeNull());
    expect(sub.getAttribute("aria-expanded")).toBe("false");
    key("ArrowDown");
    await vi.waitFor(() => expect(document.activeElement).toBe(item("next")));
    expect(select).not.toHaveBeenCalled();
    sub.focus();
    key(open);
    await vi.waitFor(() => expect(document.activeElement).toBe(item("csv")));
    item("csv").click();
    await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(item("sub")).toBeNull());
  });

  it("stays open when the pointer comes back onto its own trigger", async () => {
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () => [
          h(
            ODropdownSub,
            { "data-test": "sub", textValue: raw("Open as") },
            {
              trigger: () => h("span", { "data-test": "sub-label" }, "Open as"),
              default: () => h(ODropdownItem, { "data-test": "full" }, () => "Full page"),
            },
          ),
        ],
      },
    });
    await flushPromises();
    const item = (id: string) => document.querySelector<HTMLElement>(`[data-test="${id}"]`);
    const pointer = (target: Element, type: string) => {
      const event = new MouseEvent(type, { bubbles: type === "pointermove", cancelable: true });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      target.dispatchEvent(event);
    };
    const sub = item("sub")!;
    pointer(sub, "pointermove");
    await vi.waitFor(() => expect(item("full")).not.toBeNull());
    pointer(sub, "pointerleave");
    await flushPromises();
    pointer(item("sub-label")!, "pointermove");
    await flushPromises();
    expect(item("full")).not.toBeNull();
    expect(sub.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps a flipped submenu open on a slow diagonal across a sibling item", async () => {
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () => [
          h(
            ODropdownSub,
            { "data-test": "sub", textValue: raw("Open as") },
            {
              trigger: () => "Open as",
              default: () => h(ODropdownItem, { "data-test": "full" }, () => "Full page"),
            },
          ),
          h(ODropdownItem, { "data-test": "delete" }, () => "Delete"),
        ],
      },
    });
    await flushPromises();
    const item = (id: string) => document.querySelector<HTMLElement>(`[data-test="${id}"]`);
    const pointer = (target: Element, type: string, x = 0, y = 0) => {
      const event = new MouseEvent(type, {
        bubbles: type === "pointermove",
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      target.dispatchEvent(event);
      return event;
    };
    const sub = item("sub")!;
    pointer(sub, "pointermove", 760, 390);
    await vi.waitFor(() => expect(item("full")).not.toBeNull());
    const panel = item("full")!.closest<HTMLElement>("[role=menu]")!;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 518, y: 373, width: 160, height: 106 }),
    );
    pointer(sub, "pointerleave", 707, 405);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(pointer(item("delete")!, "pointermove", 697, 419).defaultPrevented).toBe(true);
    await flushPromises();
    expect(item("full")).not.toBeNull();
    expect(pointer(item("delete")!, "pointermove", 720, 425).defaultPrevented).toBe(false);
    await vi.waitFor(() => expect(item("full")).toBeNull());
  });
});
