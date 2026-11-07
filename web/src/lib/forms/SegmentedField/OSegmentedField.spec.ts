// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import OSegmentedField from "./OSegmentedField.vue";
import type { SegmentedFieldProps } from "./OSegmentedField.types";

let wrapper: VueWrapper | null = null;

const mountField = (props: Partial<SegmentedFieldProps> & Pick<SegmentedFieldProps, "pattern">) => {
  wrapper = mount(OSegmentedField, { props, attachTo: document.body });
  return wrapper;
};

const input = () => wrapper!.find("input");
const inputEl = () => input().element as HTMLInputElement;

const press = async (key: string, init: KeyboardEventInit = {}) => {
  await input().trigger("keydown", { key, ...init });
  await nextTick();
};

const typeKeys = async (text: string) => {
  for (const key of text) await press(key);
};

const lastModel = () => {
  const events = wrapper!.emitted("update:modelValue") ?? [];
  return events.length ? events[events.length - 1][0] : undefined;
};

const focusField = async () => {
  inputEl().focus();
  await input().trigger("focus");
  await nextTick();
};

describe("OSegmentedField", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("renders the canonical value as its DOM value", () => {
    mountField({ pattern: "time", modelValue: "13:47:03" });
    expect(inputEl().value).toBe("13:47:03");
    expect(inputEl().type).toBe("text");
  });

  it("takes a whole-value write after focus has narrowed the selection to one segment", async () => {
    mountField({ pattern: "date", modelValue: "2026-11-04" });
    await focusField();
    await nextTick();
    expect([inputEl().selectionStart, inputEl().selectionEnd]).toEqual([0, 4]);

    // The insert replaces only the selected year, as a browser does; the event still carries the whole value.
    inputEl().value = "2026-11-05-11-04";
    inputEl().dispatchEvent(
      new InputEvent("input", { data: "2026-11-05", inputType: "insertText" }),
    );
    await nextTick();

    expect(wrapper!.emitted("update:modelValue")?.at(-1)).toEqual(["2026-11-05"]);
    expect(inputEl().value).toBe("2026-11-05");
  });

  it("keeps a pre-filled date outside min/max on blur and reports it out of range", async () => {
    mountField({ pattern: "date", modelValue: "2030-01-05", max: "2026-11-06" });
    await focusField();
    await input().trigger("blur");
    await nextTick();
    expect(wrapper!.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper!.emitted("update:status")?.at(-1)).toEqual(["out-of-range"]);
    expect(inputEl().value).toBe("2030-01-05");
  });

  it("emits a typed date outside min/max with an out-of-range status", async () => {
    mountField({ pattern: "date", max: "2026-11-06" });
    await focusField();
    await typeKeys("20301105");
    expect(lastModel()).toBe("2030-11-05");
    expect(wrapper!.emitted("update:status")?.at(-1)).toEqual(["out-of-range"]);
  });

  it("shows the 12h text while modelling 24h", () => {
    mountField({ pattern: "time12", modelValue: "13:47:03" });
    expect(inputEl().value).toBe("01:47:03 PM");
  });

  it("fills a whole date from typed digits and reports completion", async () => {
    mountField({ pattern: "date" });
    await focusField();
    await typeKeys("20261104");
    expect(lastModel()).toBe("2026-11-04");
    expect(wrapper!.emitted("complete")).toHaveLength(1);
  });

  it("pads a digit that cannot grow and advances, so 3 in the hour reads 03", async () => {
    mountField({ pattern: "time" });
    await focusField();
    await typeKeys("34703");
    expect(lastModel()).toBe("03:47:03");
  });

  it("treats a typed separator after an auto-advance as format, not a skip", async () => {
    mountField({ pattern: "time" });
    await focusField();
    await typeKeys("13:47:03");
    expect(lastModel()).toBe("13:47:03");
  });

  it("emits nothing while a segment is still being typed", async () => {
    mountField({ pattern: "date", modelValue: "2026-11-04" });
    await focusField();
    await press("2");
    expect(wrapper!.emitted("update:modelValue")).toBeUndefined();
  });

  it("steps by one with the arrows, wrapping inside the segment", async () => {
    mountField({ pattern: "time", modelValue: "23:47:03" });
    await focusField();
    await press("ArrowUp");
    expect(lastModel()).toBe("00:47:03");
    await press("ArrowDown");
    expect(lastModel()).toBe("23:47:03");
  });

  it("steps by ten with PgUp/PgDn and Shift+arrows", async () => {
    mountField({ pattern: "time", modelValue: "13:47:03" });
    await focusField();
    await press("ArrowRight");
    await press("PageUp");
    expect(lastModel()).toBe("13:57:03");
    await press("PageDown");
    await press("ArrowDown", { shiftKey: true });
    expect(lastModel()).toBe("13:37:03");
  });

  it("jumps to the segment minimum and maximum with Home and End", async () => {
    mountField({ pattern: "time", modelValue: "13:47:03" });
    await focusField();
    await press("End");
    expect(lastModel()).toBe("23:47:03");
    await press("Home");
    expect(lastModel()).toBe("00:47:03");
  });

  it("wraps the day to the month's length", async () => {
    mountField({ pattern: "date", modelValue: "2026-02-28" });
    await focusField();
    await press("ArrowRight");
    await press("ArrowRight");
    await press("ArrowUp");
    expect(lastModel()).toBe("2026-02-01");
  });

  it("clears a segment with Backspace and reports the field incomplete", async () => {
    mountField({ pattern: "time", modelValue: "13:47:03" });
    await focusField();
    await press("Backspace");
    expect(lastModel()).toBe("");
    expect(inputEl().value).toBe("HH:47:03");
    const statuses = wrapper!.emitted("update:status") ?? [];
    expect(statuses[statuses.length - 1][0]).toBe("incomplete");
  });

  it("reports a date that does not exist as invalid", async () => {
    mountField({ pattern: "date" });
    await input().setValue("2026-02-30");
    const statuses = wrapper!.emitted("update:status") ?? [];
    expect(statuses[statuses.length - 1][0]).toBe("invalid");
    expect(wrapper!.emitted("update:modelValue")).toBeUndefined();
  });

  it.each([
    ["time", "13:47:03", "13:47:03", "13:47:03"],
    ["time", "13:47", "13:47:00", "13:47:00"],
    ["time", "1:47:03 PM", "13:47:03", "13:47:03"],
    ["time12", "13:47:03", "13:47:03", "01:47:03 PM"],
    ["time12", "13:47", "13:47:00", "01:47:00 PM"],
    ["time12", "1:47:03 am", "01:47:03", "01:47:03 AM"],
  ] as const)(
    "accepts a whole-value write in %s mode: %s",
    async (pattern, written, model, shown) => {
      mountField({ pattern });
      await input().setValue(written);
      expect(lastModel()).toBe(model);
      expect(inputEl().value).toBe(shown);
    },
  );

  it("keeps its value when a whole-value write does not parse", async () => {
    mountField({ pattern: "time", modelValue: "13:47:03" });
    await input().setValue("not a time");
    expect(inputEl().value).toBe("13:47:03");
    expect(wrapper!.emitted("update:modelValue")).toBeUndefined();
  });

  it("re-renders the same clock when switched to 12h", async () => {
    mountField({ pattern: "time", modelValue: "00:05:09" });
    await wrapper!.setProps({ pattern: "time12" });
    expect(inputEl().value).toBe("12:05:09 AM");
  });

  it("sets AM and PM with a and p", async () => {
    mountField({ pattern: "time12", modelValue: "13:47:03" });
    await focusField();
    await press("Tab");
    await press("Tab");
    await press("Tab");
    await press("a");
    expect(lastModel()).toBe("01:47:03");
  });

  it("emits the clipboard text on paste and never inserts it", async () => {
    mountField({ pattern: "time", modelValue: "13:47:03" });
    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "Nov 4, 13:47 – 15:52" },
    });
    inputEl().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper!.emitted("paste-text")?.[0]).toEqual(["Nov 4, 13:47 – 15:52"]);
    expect(inputEl().value).toBe("13:47:03");
  });

  it("toggles the offset segment of a repeated hour", async () => {
    mountField({
      pattern: "time",
      modelValue: "01:30:00",
      offsets: ["UTC-04:00", "UTC-05:00"],
      offset: "UTC-04:00",
    });
    expect(inputEl().value).toBe("01:30:00 UTC-04:00");
    await focusField();
    await press("End");
    await press("ArrowRight");
    await press("ArrowRight");
    await press("ArrowRight");
    await press("ArrowUp");
    expect(wrapper!.emitted("update:offset")?.[0]).toEqual(["UTC-05:00"]);
  });

  it("announces the stepped segment for a live region", async () => {
    mountField({
      pattern: "time",
      modelValue: "13:47:44",
      segmentLabels: { second: "Seconds" } as SegmentedFieldProps["segmentLabels"],
    });
    await focusField();
    await press("ArrowRight");
    await press("ArrowRight");
    await press("ArrowUp");
    expect(wrapper!.emitted("step")?.[0]).toEqual([
      { kind: "second", label: "Seconds", value: "45" },
    ]);
  });

  it("emits submit on Enter and edge at the last segment", async () => {
    mountField({ pattern: "time", modelValue: "13:47:03" });
    await focusField();
    await press("ArrowLeft");
    expect(wrapper!.emitted("edge")?.[0]).toEqual(["prev"]);
    await press("Enter");
    expect(wrapper!.emitted("submit")).toHaveLength(1);
  });

  it("marks itself invalid and shows the error icon", () => {
    mountField({ pattern: "time", error: true, errorId: "x-error" });
    expect(input().attributes("aria-invalid")).toBe("true");
    expect(input().attributes("aria-errormessage")).toBe("x-error");
    expect(wrapper!.find('[data-test="o-input-error"]').exists()).toBe(true);
  });

  it("stays invalid for assistive tech without its icon when the caller rings a shared border", () => {
    mountField({ pattern: "time", error: true, errorId: "x-error", hideErrorIcon: true });
    expect(input().attributes("aria-invalid")).toBe("true");
    expect(input().attributes("aria-errormessage")).toBe("x-error");
    expect(wrapper!.find('[data-test="o-input-error"]').exists()).toBe(false);
  });

  it("adopts a new value from the parent but not its own echo", async () => {
    mountField({ pattern: "time", modelValue: "13:47:03" });
    await focusField();
    await press("Backspace");
    await wrapper!.setProps({ modelValue: "" });
    expect(inputEl().value).toBe("HH:47:03");
    await wrapper!.setProps({ modelValue: "09:00:00" });
    expect(inputEl().value).toBe("09:00:00");
  });
});
