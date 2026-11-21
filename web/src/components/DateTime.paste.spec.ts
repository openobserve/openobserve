// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { MAX_RANGE_TEXT_UNITS } from "@/utils/date";
import { barInput, el, typeInBar } from "@/test/unit/helpers/dateTimePicker";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
const copyMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copyMock }));

const START_US = 1_793_100_000_000_000;
const END_US = 1_793_103_600_000_000;
const PAYLOAD = JSON.stringify({ start_date: START_US, end_date: END_US });

describe("DateTime paste", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: { autoApply: true, calendarPresets: true, ...props },
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };

  const openMenu = async () => {
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
  };

  const firePaste = (target: Element, text: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    target.dispatchEvent(event);
    return event;
  };

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  // The test setup installs a non-configurable navigator.clipboard, so readText is set on that object.
  const stubReadText = (readText: () => Promise<string>) =>
    Object.assign(navigator.clipboard, { readText });

  const lastToast = () => toastMock.mock.calls[toastMock.mock.calls.length - 1][0];

  // The bar and the paste parser load lazily; warm them so a flush sees them mounted.
  beforeAll(async () => {
    await import("@/components/DateTimeRangeInput.vue");
    await import("@/composables/useTimeRangeInput");
  });

  beforeEach(() => {
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    toastMock.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    Reflect.deleteProperty(navigator.clipboard, "readText");
    Reflect.deleteProperty(navigator, "platform");
  });

  it("applies a range pasted with the keyboard while the picker is open", async () => {
    createWrapper();
    await openMenu();

    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;
    const event = firePaste(document.querySelector("#date-time-menu")!, PAYLOAD);
    await flushPromises();

    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore + 1);
    expect(event.defaultPrevented).toBe(true);
    expect(lastEmit()).toMatchObject({
      startTime: START_US,
      endTime: END_US,
      userChangedValue: true,
    });
    expect(lastToast()).toMatchObject({ variant: "success", message: "Date range pasted" });
  });

  it("keeps the pasted range when a day was clicked before the paste", async () => {
    createWrapper();
    await openMenu();
    wrapper!.vm.selectedType = "absolute";
    wrapper!.vm.pendingDay = "2026/10/03";
    await flushPromises();

    firePaste(document.querySelector("#date-time-menu")!, PAYLOAD);
    await flushPromises();
    wrapper!.vm.onMenuOpenChange(false);
    wrapper!.vm.menuOpen = false;
    await flushPromises();

    expect(wrapper!.vm.selectedDate).toMatchObject({ from: "2026/10/27", to: "2026/10/27" });
    expect(lastEmit()).toMatchObject({ startTime: START_US, endTime: END_US });
  });

  it("leaves a paste into one of the picker's own fields alone", async () => {
    createWrapper();
    await openMenu();
    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;
    const input = document.createElement("input");
    document.querySelector("#date-time-menu")!.appendChild(input);

    const event = firePaste(input, PAYLOAD);
    await flushPromises();

    expect(event.defaultPrevented).toBe(false);
    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("points to the keyboard when the browser blocks reading the clipboard", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    stubReadText(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    createWrapper();
    await openMenu();

    await wrapper!.vm.pasteRange();

    expect(lastToast()).toMatchObject({
      variant: "error",
      message:
        "This browser blocked reading the clipboard. Press Ctrl+V with the picker open to paste.",
    });
  });

  it("applies a range read from the clipboard by the paste button", async () => {
    stubReadText(() => Promise.resolve(PAYLOAD));
    createWrapper();
    await openMenu();

    await wrapper!.vm.pasteRange();

    expect(lastEmit()).toMatchObject({
      startTime: START_US,
      endTime: END_US,
      userChangedValue: true,
    });
    expect(lastToast()).toMatchObject({ variant: "success" });
  });

  it.each([
    ["paste button", "button"],
    ["keyboard", "keyboard"],
  ])("refuses an oversize %s paste as too long without keeping it", async (_, via) => {
    const text = " ".repeat(MAX_RANGE_TEXT_UNITS) + PAYLOAD;
    stubReadText(() => Promise.resolve(text));
    createWrapper();
    await openMenu();
    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

    if (via === "button") await wrapper!.vm.pasteRange();
    else firePaste(document.querySelector("#date-time-menu")!, text);
    await flushPromises();

    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    expect(barInput()!.value).toBe("");
    expect(el("date-time-range-status")!.getAttribute("data-state")).toBe("invalid");
    expect(el("date-time-range-message")!.textContent).toContain("Too long");
  });

  it.each([
    ["an empty", ""],
    ["a whitespace-only", "  \n\t "],
  ])("says the clipboard is empty when the paste button reads %s clipboard", async (_, text) => {
    stubReadText(() => Promise.resolve(text));
    createWrapper();
    await openMenu();
    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

    await wrapper!.vm.pasteRange();
    await flushPromises();

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(lastToast()).toMatchObject({
      variant: "info",
      message: "Clipboard is empty. Copy a date range first.",
    });
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Could not parse date range" }),
    );
    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
  });

  it("keeps the default focus inside the panel when the rail has nothing to focus", async () => {
    localStorage.clear();
    createWrapper({ calendarPresets: false, hideRangeInput: true });
    await openMenu();
    const autoFocus = new Event("focus", { cancelable: true });

    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);

    expect(autoFocus.defaultPrevented).toBe(false);
  });

  it("moves focus to the first rail item when there is one", async () => {
    createWrapper({ hideRangeInput: true });
    await openMenu();
    const autoFocus = new Event("focus", { cancelable: true });

    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);

    expect(autoFocus.defaultPrevented).toBe(true);
    expect(document.activeElement?.hasAttribute("data-date-time-rail-item")).toBe(true);
  });

  describe("copy", () => {
    const copied = () => {
      const calls = copyMock.mock.calls as unknown as [
        string,
        unknown,
        { successMessage: string },
      ][];
      const [text, , options] = calls[calls.length - 1];
      return { text, message: options.successMessage };
    };

    const pasteInto = async (text: string, zone: string, props: Record<string, unknown> = {}) => {
      wrapper?.unmount();
      store.state.timezone = zone;
      createWrapper(props);
      await openMenu();
      await wrapper!.vm.onPickerPaste(pasteEvent(text));
      await flushPromises();
      return lastEmit();
    };

    beforeEach(() => copyMock.mockClear());

    it("copies a rolling range as now-15m and pastes it back rolling in another zone", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await openMenu();
      wrapper!.vm.copyRange();

      expect(copied()).toEqual({ text: "now-15m", message: "Copied now-15m" });
      expect(await pasteInto("now-15m", "Asia/Calcutta")).toMatchObject({
        relativeTimePeriod: "15m",
        valueType: "relative",
      });
    });

    it("copies a calendar period as its token and pastes it back as that period", async () => {
      createWrapper({ defaultRelativeTime: "calendar:day:0" });
      await openMenu();
      wrapper!.vm.copyRange();

      expect(copied().text).toBe("calendar:day:0");
      expect(await pasteInto("calendar:day:0", "Asia/Calcutta")).toMatchObject({
        relativeTimePeriod: "calendar:day:0",
      });
    });

    it("copies the Absolute tab as an ISO pair in the picker zone that pastes back to the same µs", async () => {
      store.state.timezone = "Europe/Berlin";
      createWrapper({ autoApply: false });
      await openMenu();
      await wrapper!.vm.onPickerPaste(
        pasteEvent("2026-10-27T10:00:00.123456+01:00 - 2026-10-27T11:00:00+01:00"),
      );
      await flushPromises();
      wrapper!.vm.copyRange();

      expect(copied()).toEqual({
        text: "2026-10-27T10:00:00.123456+01:00 - 2026-10-27T11:00:00+01:00",
        message: "Copied with UTC+01:00",
      });
      expect(await pasteInto(copied().text, "America/New_York")).toMatchObject({
        startTime: Date.parse("2026-10-27T09:00:00Z") * 1000 + 123_456,
        endTime: Date.parse("2026-10-27T10:00:00Z") * 1000,
        relativeTimePeriod: null,
      });
    });

    it("writes no fraction for a range on whole seconds", async () => {
      createWrapper();
      await openMenu();
      await wrapper!.vm.onPickerPaste(pasteEvent(PAYLOAD));
      await flushPromises();
      wrapper!.vm.copyRange();

      expect(copied().text).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00 - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/,
      );
      expect(await pasteInto(copied().text, "Asia/Calcutta")).toMatchObject({
        startTime: START_US,
        endTime: END_US,
      });
    });
  });
});

function pasteEvent(text: string): ClipboardEvent {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  Object.defineProperty(event, "target", { value: document.body });
  return event;
}

describe("DateTime paste review fixes", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: { autoApply: true, calendarPresets: true, ...props },
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };

  const openMenu = async () => {
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
  };

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  beforeAll(async () => {
    await import("@/components/DateTimeRangeInput.vue");
    await import("@/composables/useTimeRangeInput");
  });

  beforeEach(() => {
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    toastMock.mockReset();
    copyMock.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("clears the bar after a staged paste, so Apply uses the pasted range", async () => {
    createWrapper({ autoApply: false });
    await openMenu();
    await typeInBar("2h");
    await wrapper!.vm.onPickerPaste(pasteEvent("now-30m"));
    await flushPromises();

    expect(wrapper!.vm.relativeValue).toBe(30);
    expect(barInput()!.value).toBe("");
    el<HTMLButtonElement>("date-time-apply-btn")!.click();
    await flushPromises();
    expect(lastEmit().relativeTimePeriod).toBe("30m");
  });

  it("sends a pasted rolling range over the cap to the bar instead of clamping it", async () => {
    createWrapper({ autoApply: true });
    await openMenu();
    const before = (wrapper!.emitted("on:date-change") ?? []).length;
    await wrapper!.vm.onPickerPaste(pasteEvent("now-200M"));
    await flushPromises();

    expect(barInput()!.value).toBe("now-200M");
    expect(el("date-time-range-status")!.getAttribute("data-state")).toBe("blocked");
    expect(el("date-time-range-reading-0")!.textContent).toContain("Last 120 months");
    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(before);
  });

  it("drops a paste that resolves after a newer pick", async () => {
    createWrapper({ autoApply: true });
    await openMenu();
    const pending = wrapper!.vm.onPickerPaste(pasteEvent("now-30m"));
    wrapper!.vm.pickRelativeChip("h", 1);
    await pending;
    await flushPromises();

    expect(lastEmit().relativeTimePeriod).toBe("1h");
    expect(wrapper!.vm.relativeValue).toBe(1);
  });

  it("copies the pending clicked day the trigger already shows", async () => {
    createWrapper({ autoApply: false });
    await openMenu();
    wrapper!.vm.selectTab("absolute");
    await flushPromises();
    wrapper!.vm.pendingDay = "2026/10/05";
    await flushPromises();
    wrapper!.vm.copyRange();

    expect(String((copyMock.mock.calls.at(-1) as unknown[])[0])).toMatch(/^2026-10-05T/);
  });
});
