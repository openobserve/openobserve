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
});
