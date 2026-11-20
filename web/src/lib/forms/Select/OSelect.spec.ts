// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OSelect from "./OSelect.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { TOOLTIP_DELAY_MS } from "@/lib/styles/motion";

describe("OSelect", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OSelect);
    expect(wrapper.exists()).toBe(true);
  });

  it.each([
    ["sm", "h-control-sm"],
    ["md", "h-control-md"],
    ["lg", "h-control-lg"],
  ] as const)("sizes the trigger for %s", (size, expected) => {
    wrapper = mount(OSelect, { props: { size } });
    expect(wrapper.find("button").classes()).toContain(expected);
  });

  it("renders a label when prop is provided", () => {
    wrapper = mount(OSelect, { props: { label: "Country" } });
    expect(wrapper.find("label").text()).toBe("Country");
  });

  it("renders a trigger button", () => {
    wrapper = mount(OSelect);
    expect(wrapper.find("button").exists()).toBe(true);
  });

  it("shows placeholder text when no value is selected", () => {
    // searchable: false forces the native SelectRoot branch where reka-ui's
    // SelectValue renders the placeholder prop correctly in JSDOM. The listbox
    // (PopoverRoot) branch renders "false" as text in JSDOM due to a reka-ui
    // JSDOM limitation — test the non-listbox path to verify the placeholder prop.
    wrapper = mount(OSelect, {
      props: { placeholder: "Pick one", searchable: false },
    });
    expect(wrapper.text()).toContain("Pick one");
  });

  it("shows clear button when clearable and a value is set", () => {
    wrapper = mount(OSelect, {
      props: {
        clearable: true,
        modelValue: "a",
        options: [{ label: "Option A", value: "a" }],
      },
    });
    expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(true);
  });

  it("does not show clear button when value is undefined", () => {
    wrapper = mount(OSelect, {
      props: { clearable: true, modelValue: undefined },
    });
    expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(false);
  });

  it("emits clear event when clear button is clicked", async () => {
    wrapper = mount(OSelect, {
      props: {
        clearable: true,
        modelValue: "a",
        options: [{ label: "Option A", value: "a" }],
      },
    });
    await wrapper.find('button[aria-label="Clear selection"]').trigger("click");
    expect(wrapper.emitted("clear")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0][0]).toBeUndefined();
  });

  it("shows error message when provided", () => {
    // The component requires both `error: true` AND `errorMessage` to render
    // the error span. `error` is the gating flag; `errorMessage` is the text.
    wrapper = mount(OSelect, {
      props: { error: true, errorMessage: "Selection required" },
    });
    expect(wrapper.find('[role="alert"]').text()).toContain("Selection required");
  });

  it("renders mapped option labels for object options", () => {
    wrapper = mount(OSelect, {
      props: {
        modelValue: 2,
        options: [
          { id: 1, title: "One" },
          { id: 2, title: "Two" },
        ] as any,
        valueKey: "id",
        labelKey: "title",
      },
    });
    expect(wrapper.text()).toContain("Two");
  });

  it("emits empty array when clear is clicked in multiple mode", async () => {
    wrapper = mount(OSelect, {
      props: {
        clearable: true,
        multiple: true,
        modelValue: ["a", "b"],
        options: [
          { label: "Option A", value: "a" },
          { label: "Option B", value: "b" },
        ],
      },
    });
    await wrapper.find('button[aria-label="Clear selection"]').trigger("click");
    expect(wrapper.emitted("clear")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0][0]).toEqual([]);
  });

  it("lets pointerdown inside the open popover propagate to document", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: {
        multiple: true,
        searchable: true,
        options: [
          { label: "Option A", value: "a" },
          { label: "Option B", value: "b" },
        ],
      },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();

    const input = document.body.querySelector(
      'input[placeholder="Search..."]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const docSpy = vi.fn();
    document.addEventListener("pointerdown", docSpy);
    input!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.removeEventListener("pointerdown", docSpy);

    // With @pointerdown.stop present this would be 0 (stopped at the content).
    expect(docSpy).toHaveBeenCalled();
  });

  it("emits close once when Escape closes the dropdown", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: {
        multiple: true,
        searchable: true,
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
      },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("open")).toHaveLength(1);

    const input = document.body.querySelector('input[placeholder="Search..."]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();

    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits close when the dropdown is closed programmatically", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: { multiple: true, options: [{ label: "A", value: "a" }] },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();

    (wrapper.vm as any).close();
    await flushPromises();

    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits open when typing on the closed trigger opens the dropdown", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: { multiple: true, searchable: true, options: [{ label: "A", value: "a" }] },
    });

    await wrapper.find("button").trigger("keydown", { key: "a" });
    await flushPromises();

    expect(wrapper.find("button").attributes("aria-expanded")).toBe("true");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("emits open when focus() opens the dropdown", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: { multiple: true, options: [{ label: "A", value: "a" }] },
    });

    (wrapper.vm as any).focus();
    await flushPromises();

    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("does not emit create on Enter when creatable is false", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: {
        searchable: true,
        creatable: false,
        options: [{ label: "Existing", value: "ex" }],
      },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    const input = document.body.querySelector(
      'input[placeholder="Search..."]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input!.value = "brand-new-term";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("create")).toBeFalsy();
  });

  describe("Enter on a typed term when creatable", () => {
    async function typeAndEnter(props: Record<string, unknown>, term: string) {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: { searchable: true, creatable: true, ...props },
      });
      await wrapper.find("button").trigger("click");
      await flushPromises();
      const input = document.body.querySelector(
        'input[placeholder="Search..."]',
      ) as HTMLInputElement;
      input.value = term;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();
    }

    const options = [
      { label: "Existing", value: "ex" },
      { label: "Locked", value: "locked", disabled: true },
    ];

    it("selects an exact label match instead of creating it", async () => {
      await typeAndEnter({ options }, "Existing");
      expect(wrapper.emitted("create")).toBeFalsy();
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["ex"]);
    });

    it("matches case-sensitively, so a differently cased term is created", async () => {
      await typeAndEnter({ options }, "existing");
      expect(wrapper.emitted("create")?.at(-1)).toEqual(["existing"]);
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("emits create once for a term with no match", async () => {
      await typeAndEnter({ options }, "brand-new");
      expect(wrapper.emitted("create")).toEqual([["brand-new"]]);
    });

    it("neither selects nor creates an exact match on a disabled option", async () => {
      await typeAndEnter({ options }, "Locked");
      expect(wrapper.emitted("create")).toBeFalsy();
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("adds an exact match to a multi-select without removing the selection", async () => {
      await typeAndEnter(
        {
          options: [...options, { label: "Other", value: "o" }],
          multiple: true,
          modelValue: ["o"],
        },
        "Existing",
      );
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["o", "ex"]]);
    });

    it("leaves a multi-select unchanged when the match is already selected", async () => {
      await typeAndEnter({ options, multiple: true, modelValue: ["ex"] }, "Existing");
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
      expect(wrapper.emitted("create")).toBeFalsy();
    });
  });

  describe("close on scroll", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let frameSpies: { mockRestore: () => void }[] = [];

    // The trigger check runs in a frame callback, so the tests drive frames by hand.
    function stubFrames() {
      frameSpies = [
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
          frames.set(++nextFrame, cb);
          return nextFrame;
        }),
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
          frames.delete(id);
        }),
      ];
    }

    function runFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((cb) => cb(0));
    }

    afterEach(() => {
      frames.clear();
      frameSpies.forEach((spy) => spy.mockRestore());
      frameSpies = [];
    });

    async function openSelect() {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: { multiple: true, options: [{ label: "A", value: "a" }] },
      });
      await wrapper.find("button").trigger("click");
      await flushPromises();
      expect(wrapper.emitted("open")).toHaveLength(1);
      stubFrames();
    }

    // Scroll events are dispatched a frame late, so one queued before the open arrives after it.
    it("stays open on a scroll that did not move the trigger", async () => {
      await openSelect();
      document.dispatchEvent(new Event("scroll"));
      runFrames();
      await flushPromises();
      expect(wrapper.emitted("close")).toBeUndefined();
    });

    it("closes on a scroll that moved the trigger", async () => {
      await openSelect();
      const rect = vi
        .spyOn(Element.prototype, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, 40, 10, 10));
      try {
        document.dispatchEvent(new Event("scroll"));
        runFrames();
      } finally {
        rect.mockRestore();
      }
      await flushPromises();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("measures the trigger at most once per frame", async () => {
      await openSelect();
      const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
      try {
        for (let i = 0; i < 3; i++) document.dispatchEvent(new Event("scroll"));
        expect(rect).not.toHaveBeenCalled();
        runFrames();
        expect(rect).toHaveBeenCalledTimes(1);
      } finally {
        rect.mockRestore();
      }
    });
  });

  describe("opening a large single-select scrolls to the current value", () => {
    // Regression for a virtualised 48-option time-of-day picker always opening
    // scrolled to its first entry: single-select now seeds highlightedIndex
    // with the selected option and scrolls the virtualizer to it on open.
    const MANY_OPTIONS = Array.from({ length: 48 }, (_, i) => ({
      label: `Option ${i}`,
      value: i,
    }));

    it("does not throw when the selected value is deep in the list", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: { modelValue: 24, options: MANY_OPTIONS },
      });
      await wrapper.find("button").trigger("click");
      await flushPromises();

      // Popover opened successfully (search input mounted) and nothing threw
      // while resolving/scrolling to the selected index.
      const input = document.body.querySelector('input[placeholder="Search..."]');
      expect(input).not.toBeNull();
    });

    it("does not throw when the current value has no matching option", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: { modelValue: "not-an-option", options: MANY_OPTIONS },
      });
      await wrapper.find("button").trigger("click");
      await flushPromises();

      const input = document.body.querySelector('input[placeholder="Search..."]');
      expect(input).not.toBeNull();
    });

    it("still resets the multi-select highlight on open instead of scrolling to a single value", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: { modelValue: [24], multiple: true, options: MANY_OPTIONS },
      });
      await wrapper.find("button").trigger("click");
      await flushPromises();

      const input = document.body.querySelector('input[placeholder="Search..."]');
      expect(input).not.toBeNull();
    });

    it("starts a new search from the top of the list, not the offset it opened at", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          modelValue: 150,
          options: Array.from({ length: 200 }, (_, i) => ({ label: `Option ${i}`, value: i })),
        },
      });
      await wrapper.find("button").trigger("click");
      await flushPromises();
      const scroller = document.body.querySelector<HTMLElement>('[data-test="o-select-list"]')!;
      scroller.scrollTop = 600;

      const input = document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search..."]',
      )!;
      input.value = "Option 1";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();

      expect(scroller.scrollTop).toBe(0);
    });
  });

  describe("trigger keyboard focus behavior", () => {
    // The listbox-mode trigger must expose role="combobox" so the global
    // shortcut manager's isInputFocused() guard treats a focused select as a
    // text-entry widget — otherwise single-letter page shortcuts (logs "s",
    // "r", "h") fire while the select has focus inside a dialog.
    it("should expose role=combobox on the listbox trigger", () => {
      wrapper = mount(OSelect, {
        props: {
          searchable: true,
          options: [{ label: "Option A", value: "a" }],
        },
      });
      const trigger = wrapper.find("button");
      expect(trigger.attributes("role")).toBe("combobox");
      expect(trigger.attributes("aria-expanded")).toBe("false");
    });

    it("should open the dropdown and seed the filter when a printable key is pressed on the closed trigger", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          options: [
            { label: "sample", value: "s1" },
            { label: "other", value: "o1" },
          ],
        },
      });
      await wrapper.find("button").trigger("keydown", { key: "s" });
      await flushPromises();

      const input = document.body.querySelector(
        'input[placeholder="Search..."]',
      ) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.value).toBe("s");
    });

    it("leaves the seeded character unselected so the next keystroke appends to it", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          options: [
            { label: "sample", value: "s1" },
            { label: "other", value: "o1" },
          ],
        },
      });
      await wrapper.find("button").trigger("keydown", { key: "s" });
      await flushPromises();
      // ListboxFilter's own autoFocus fires on a 1 ms timer.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const input = document.body.querySelector(
        'input[placeholder="Search..."]',
      ) as HTMLInputElement;
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([1, 1]);
    });

    it("should not open the dropdown when a modifier combo is pressed on the trigger", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          options: [{ label: "sample", value: "s1" }],
        },
      });
      await wrapper.find("button").trigger("keydown", { key: "s", ctrlKey: true });
      await flushPromises();
      expect(document.body.querySelector('input[placeholder="Search..."]')).toBeNull();
    });

    // A caller driving the trigger programmatically (an empty state's "add"
    // action landing the cursor in the field) wants more than a focus ring —
    // it wants the picker actually open, the same as a click would.
    it("opens the dropdown when focus() is called programmatically", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          options: [{ label: "sample", value: "s1" }],
        },
      });
      (wrapper.vm as unknown as { focus: () => void }).focus();
      await flushPromises();
      expect(document.body.querySelector('input[placeholder="Search..."]')).not.toBeNull();
    });

    it("does not open a disabled select", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          disabled: true,
          options: [{ label: "sample", value: "s1" }],
        },
      });
      (wrapper.vm as unknown as { focus: () => void }).focus();
      await flushPromises();
      expect(document.body.querySelector('input[placeholder="Search..."]')).toBeNull();
    });

    it("should stop propagation of printable keys so page-level shortcuts never fire", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: {
          searchable: true,
          options: [{ label: "sample", value: "s1" }],
        },
      });
      const docSpy = vi.fn();
      document.addEventListener("keydown", docSpy);
      (wrapper.find("button").element as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
      );
      document.removeEventListener("keydown", docSpy);
      expect(docSpy).not.toHaveBeenCalled();
    });
  });

  describe("accessible name", () => {
    const options = [{ label: "Option A", value: "a" }];

    it("points the popover trigger at the outside label", () => {
      wrapper = mount(OSelect, { props: { label: "Country", options } });
      const label = wrapper.find("label");
      const trigger = wrapper.find('button[role="combobox"]');
      expect(label.attributes("id")).toBeTruthy();
      expect(trigger.attributes("aria-labelledby")).toBe(label.attributes("id"));
    });

    it("lets an explicit aria-label stand instead of the label", () => {
      wrapper = mount(OSelect, {
        props: { label: "Country", options },
        attrs: { "aria-label": "Pick a country" },
      });
      const trigger = wrapper.find('button[role="combobox"]');
      expect(trigger.attributes("aria-label")).toBe("Pick a country");
      expect(trigger.attributes("aria-labelledby")).toBeUndefined();
    });

    it("puts the label's info icon in the Tab order so its tooltip opens on keyboard focus", async () => {
      wrapper = mount(OSelect, {
        props: { label: "Country", options },
        attrs: { "data-test": "country" },
        slots: { tooltip: () => h(OTooltip, { content: "Where the team works" }) },
        attachTo: document.body,
      });
      const info = wrapper.find('[data-test="country-info"]');
      expect(info.attributes("tabindex")).toBe("0");
      expect(info.attributes("aria-label")).toBeTruthy();
      info.element.dispatchEvent(new FocusEvent("focus"));
      await new Promise((r) => setTimeout(r, TOOLTIP_DELAY_MS + 50));
      await flushPromises();
      expect(document.body.textContent).toContain("Where the team works");
    });

    it("adds no labelledby without an outside label", () => {
      wrapper = mount(OSelect, { props: { options } });
      expect(wrapper.find('button[role="combobox"]').attributes("aria-labelledby")).toBeUndefined();
    });
  });

  describe("cut-off text", () => {
    const OPTIONS = [
      { label: "payment-service-production-eu-west-1", value: "a" },
      { label: "inventory-service", value: "b" },
    ];

    it("shows each selected chip as cut-only text with no always-on tooltip", () => {
      wrapper = mount(OSelect, {
        props: { modelValue: ["a", "b"], multiple: true, options: OPTIONS },
      });
      const chips = wrapper
        .findAllComponents(OTruncatedText)
        .filter((c) => c.classes().includes("max-w-40"));
      expect(chips.map((c) => c.text())).toEqual([
        "payment-service-production-eu-west-1",
        "inventory-service",
      ]);
      expect(chips[0].classes()).toContain("inline-block");
      expect(wrapper.findAllComponents(OTooltip).every((t) => t.props("overflowOnly"))).toBe(true);
    });

    it("gives the listbox trigger label a cut-only tooltip", () => {
      wrapper = mount(OSelect, { props: { modelValue: "a", searchable: true, options: OPTIONS } });
      const tip = wrapper.findComponent(OTooltip);
      expect(tip.props("overflowOnly")).toBe(true);
      expect(tip.props("content")).toBeUndefined();
    });

    it("wraps the native trigger value so it cuts, with no tooltip over a custom trigger", () => {
      wrapper = mount(OSelect, { props: { modelValue: "a", searchable: false, options: OPTIONS } });
      const value = wrapper.findComponent(OTruncatedText);
      expect(value.classes()).toContain("flex-1");
      expect(value.props("tooltip")).toBeUndefined();

      wrapper.unmount();
      wrapper = mount(OSelect, {
        props: { modelValue: "a", searchable: false, options: OPTIONS },
        slots: { trigger: "<b>Custom</b>" },
      });
      expect(wrapper.findComponent(OTruncatedText).props("tooltip")).toBe(false);
    });
  });

  describe("filter variant", () => {
    const options = [
      { label: "Firing", value: "firing" },
      { label: "Paused", value: "paused" },
      { label: "Resolved", value: "resolved" },
    ];
    const mountFilter = (props: Record<string, unknown> = {}) =>
      mount(OSelect, {
        attachTo: document.body,
        props: { variant: "filter", label: "Status", options, ...props },
      });

    it("puts the label inside the trigger with Any while nothing is picked", () => {
      wrapper = mountFilter();
      const trigger = wrapper.find('button[role="combobox"]');
      expect(trigger.text()).toContain("Status:");
      expect(trigger.text()).toContain("Any");
      expect(trigger.attributes("aria-label")).toBe("Status");
      expect(wrapper.find("label").exists()).toBe(false);
    });

    it("shows the picked value, tints the trigger and offers clear once narrowed", () => {
      wrapper = mountFilter({ modelValue: "paused" });
      const trigger = wrapper.find('button[role="combobox"]');
      expect(wrapper.find('[data-test="o-select-filter-value"]').text()).toBe("Paused");
      expect(trigger.classes()).toContain("bg-select-item-selected-bg");
      expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(true);
    });

    it("counts the picks of a multi filter", () => {
      wrapper = mountFilter({ multiple: true, modelValue: ["firing", "paused"] });
      expect(wrapper.find('[data-test="o-select-filter-value"]').text()).toBe("2");
    });

    it("stays untinted and unclearable when the page makes it required", () => {
      wrapper = mountFilter({ modelValue: "paused", clearable: false });
      const trigger = wrapper.find('button[role="combobox"]');
      expect(trigger.classes()).not.toContain("bg-select-item-selected-bg");
      expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(false);
    });

    it.each([
      ["a searchable", { searchable: true }],
      ["a simple", { searchable: false }],
    ])(
      "as %s select with no label, shows the bare value with no colon, tint or clear",
      (_, extra) => {
        wrapper = mountFilter({ label: undefined, modelValue: "paused", ...extra });
        const trigger = wrapper.find('button[role="combobox"]');
        expect(wrapper.find('[data-test="o-select-filter-label"]').exists()).toBe(false);
        expect(trigger.text()).not.toContain(":");
        expect(trigger.classes()).not.toContain("bg-select-item-selected-bg");
        expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(false);
      },
    );

    it("reads as the bare picked value with no label", () => {
      wrapper = mountFilter({ label: undefined, modelValue: "paused", searchable: true });
      expect(wrapper.find('button[role="combobox"]').text()).toBe("Paused");
    });

    it("offers clear on a label-less filter only when the page makes it clearable", () => {
      wrapper = mountFilter({ label: undefined, modelValue: "paused", clearable: true });
      expect(wrapper.find('button[aria-label="Clear selection"]').exists()).toBe(true);
    });

    describe("reset value", () => {
      const withAll = [{ label: "All", value: "all" }, ...options];
      const isTinted = () =>
        wrapper.find('button[role="combobox"]').classes().includes("bg-select-item-selected-bg");
      const clearButton = () => wrapper.find('button[aria-label="Clear selection"]');

      it("reads untinted and unclearable at its All option", () => {
        wrapper = mountFilter({ options: withAll, modelValue: "all" });
        expect(wrapper.find('button[role="combobox"]').text()).toContain("Status:");
        expect(wrapper.find('[data-test="o-select-filter-value"]').text()).toBe("All");
        expect(isTinted()).toBe(false);
        expect(clearButton().exists()).toBe(false);
      });

      it("tints and offers clear once a real value is picked", () => {
        wrapper = mountFilter({ options: withAll, modelValue: "paused" });
        expect(isTinted()).toBe(true);
        expect(clearButton().exists()).toBe(true);
      });

      it("returns to the All option on clear", async () => {
        wrapper = mountFilter({ options: withAll, modelValue: "paused" });
        await clearButton().trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["all"]);
      });

      it("empties the model on clear when there is no reset value", async () => {
        wrapper = mountFilter({ modelValue: "paused" });
        await clearButton().trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([undefined]);
      });

      it.each([
        ["a sentinel valued All", { label: "All agents", value: "__all__" }],
        ["a null option", { label: "Auto", value: null }],
        ["a wildcard", { label: "Everything", value: "*" }],
        ["an Any label", { label: "Any status", value: "x" }],
      ])("infers the reset value from %s", (_, first) => {
        wrapper = mountFilter({ options: [first, ...options], modelValue: first.value });
        expect(isTinted()).toBe(false);
        expect(clearButton().exists()).toBe(false);
      });

      it("treats a first option that is a real value as a pick", () => {
        const unassigned = [{ label: "Unassigned", value: "none" }, ...options];
        wrapper = mountFilter({ options: unassigned, modelValue: "none" });
        expect(isTinted()).toBe(true);
      });

      it("takes an explicit reset value for a default that is not All", async () => {
        const withOff = [{ label: "Off", value: "off" }, ...options];
        wrapper = mountFilter({ options: withOff, modelValue: "off", resetValue: "off" });
        expect(isTinted()).toBe(false);
        await wrapper.setProps({ modelValue: "paused" });
        expect(isTinted()).toBe(true);
        await clearButton().trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["off"]);
      });
    });
  });

  describe("menu contents", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `Stream ${i}`, value: i }));

    it("hides the search box up to eight options and shows it past eight", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: { options: many.slice(0, 8) },
      });
      await wrapper.find("button").trigger("click");
      await flushPromises();
      expect(document.body.querySelector('input[placeholder="Search..."]')).toBeNull();
      wrapper.unmount();

      wrapper = mount(OSelect, { attachTo: document.body, props: { options: many } });
      await wrapper.find("button").trigger("click");
      await flushPromises();
      expect(document.body.querySelector('input[placeholder="Search..."]')).not.toBeNull();
    });

    it("shows two chips and +N for a multi-select", () => {
      wrapper = mount(OSelect, {
        props: { multiple: true, options: many, modelValue: [0, 1, 2, 3] },
      });
      expect(wrapper.find('[data-test="o-select-overflow-chip"]').text()).toBe("+2");
    });

    it("offers an Add row for a typed value that is not listed", async () => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: { options: many.slice(0, 3), creatable: true },
      });
      await wrapper.find("button").trigger("click");
      await flushPromises();
      const input = document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search..."]',
      )!;
      input.value = "billing";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
      const create = document.body.querySelector<HTMLButtonElement>(
        '[data-test="o-select-create"]',
      )!;
      expect(create.textContent).toContain('Add "billing"');
      create.click();
      expect(wrapper.emitted("create")?.[0]).toEqual(["billing"]);
    });
  });

  describe("simple (non-searchable) mode option icons", () => {
    const options = [
      { label: "Firing", value: "firing", icon: "warning" },
      { label: "Resolved", value: "resolved", icon: "check-circle" },
      { label: "All", value: "all" },
    ];

    const openSimple = async (props: Record<string, unknown>) => {
      wrapper = mount(OSelect, {
        attachTo: document.body,
        props: { searchable: false, options, "data-test": "status", ...props },
      });
      await wrapper.find('button[role="combobox"]').trigger("keydown", { key: "Enter" });
      await flushPromises();
      return Array.from(document.body.querySelectorAll<HTMLElement>('[data-test="status-option"]'));
    };

    it("shows each option's icon and a spacer for an iconless option when icon-key is set", async () => {
      const rows = await openSimple({ iconKey: "icon" });
      expect(rows).toHaveLength(3);
      const icons = wrapper.findAllComponents(OIcon).filter((c) => c.props("size") === "sm");
      expect(icons.map((c) => c.props("name"))).toEqual(
        expect.arrayContaining(["warning", "check-circle"]),
      );
      expect(rows[0].querySelector("[aria-hidden='true']")).not.toBeNull();
      expect(rows[2].querySelector(":scope > span.size-4")).not.toBeNull();
    });

    it("renders options without icons or spacers when icon-key is absent", async () => {
      const rows = await openSimple({});
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.querySelector(":scope > span.size-4")).toBeNull();
        expect(row.classList.contains("gap-2")).toBe(false);
      }
    });
  });
});
