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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { timeRangeHistoryKey } from "@/composables/useTimeRangeHistory";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

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

  const bar = () =>
    document.querySelector<HTMLInputElement>(
      '#date-time-menu [data-test="date-time-input-field"]',
    )!;
  const enterOnBar = async () => {
    bar().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
  };
  const previewNote = () =>
    document.querySelector('#date-time-menu [data-test="date-time-preview-note"]')?.textContent;

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

  it("fills the bar with a range pasted with the keyboard and applies it only on Enter", async () => {
    createWrapper();
    await openMenu();

    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;
    const event = firePaste(document.querySelector("#date-time-menu")!, PAYLOAD);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(bar().value).toBe(PAYLOAD);
    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    expect(
      document.querySelector('[data-test="date-time-resolved"]')?.getAttribute("data-preview"),
    ).toBe("true");

    await enterOnBar();

    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore + 1);
    expect(lastEmit()).toMatchObject({
      startTime: START_US,
      endTime: END_US,
      userChangedValue: true,
    });
    expect(wrapper!.vm.menuOpen).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("keeps the pasted range when a day was clicked before the paste", async () => {
    createWrapper();
    await openMenu();
    wrapper!.vm.selectedType = "absolute";
    wrapper!.vm.pendingDay = "2026/10/03";
    await flushPromises();

    firePaste(document.querySelector("#date-time-menu")!, PAYLOAD);
    await flushPromises();
    await enterOnBar();

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

  it("fills the bar from the clipboard with the paste button and applies it on Enter", async () => {
    stubReadText(() => Promise.resolve(PAYLOAD));
    createWrapper();
    await openMenu();
    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

    await wrapper!.vm.pasteRange();
    await flushPromises();
    expect(bar().value).toBe(PAYLOAD);
    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);

    await enterOnBar();
    expect(lastEmit()).toMatchObject({
      startTime: START_US,
      endTime: END_US,
      userChangedValue: true,
    });
    expect(toastMock).not.toHaveBeenCalled();
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

  it("keeps the default focus inside the panel when there is no box and the rail is empty", async () => {
    localStorage.clear();
    createWrapper({ calendarPresets: false, hideClipboard: true });
    await openMenu();
    const autoFocus = new Event("focus", { cancelable: true });

    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);

    expect(autoFocus.defaultPrevented).toBe(false);
  });

  it("focuses the paste box on open, so typing goes there and not to the list", async () => {
    createWrapper();
    await openMenu();
    const autoFocus = new Event("focus", { cancelable: true });

    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);

    const box = document.querySelector('[data-test="date-time-input-field"]')!;
    expect(autoFocus.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(box);
    const list = document.querySelector('[data-test="date-time-list"]')!;
    expect(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("closes the panel on the first Escape while the copy button's tooltip is open", async () => {
    createWrapper();
    await openMenu();
    const copy = document.querySelector<HTMLButtonElement>('[data-test="date-time-copy-btn"]')!;
    copy.focus();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushPromises();
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();

    copy.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();

    expect(wrapper!.vm.menuOpen).toBe(false);
    expect(wrapper!.emitted("hide")).toHaveLength(1);
  });

  it("leaves a half-typed Start alone when the clock ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T03:33:00Z"));
    try {
      createWrapper({ defaultRelativeTime: "1h" });
      await openMenu();
      wrapper!.vm.openCalendar();
      await flushPromises();
      const start = document.querySelector<HTMLInputElement>(
        '[data-test="datetime-start-time"] input',
      )!;

      // Vue drops an event stamped no later than its listener was attached, and a frozen clock stamps both alike.
      vi.setSystemTime(new Date("2026-11-09T03:33:01Z"));
      start.focus();
      start.value = "12:3";
      vi.setSystemTime(new Date("2026-11-09T03:34:00Z"));
      wrapper!.vm.refreshTooltipNow();
      await flushPromises();
      expect(start.value).toBe("12:3");

      start.blur();
      vi.setSystemTime(new Date("2026-11-09T03:35:00Z"));
      wrapper!.vm.refreshTooltipNow();
      await flushPromises();
      expect(start.value).toBe("02:35");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves reka's focus inside the panel on a touch screen, so no keyboard rises", async () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      createWrapper();
      await openMenu();
      const autoFocus = new Event("focus", { cancelable: true });

      wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);

      expect(autoFocus.defaultPrevented).toBe(false);
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it("leaves reka's focus inside the panel when the picker has no paste box", async () => {
    createWrapper({ hideClipboard: true });
    await openMenu();
    const autoFocus = new Event("focus", { cancelable: true });

    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);

    expect(autoFocus.defaultPrevented).toBe(false);
  });

  it("refuses a pasted range over the query-range limit with the restriction toast only", async () => {
    createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24 hours" });
    await openMenu();
    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

    firePaste(document.querySelector("#date-time-menu")!, "2024/01/01 - 2024/01/31");
    await flushPromises();
    expect(previewNote()).toBe("Max 24 hours");
    await enterOnBar();

    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    expect(wrapper!.vm.menuOpen).toBe(true);
    expect(document.querySelector('[data-test="date-time-input-error"]')).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("says why a pasted range over the limit is refused when the page gives no message", async () => {
    createWrapper({ queryRangeRestrictionInHour: 24 });
    await openMenu();
    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

    firePaste(document.querySelector("#date-time-menu")!, "2024/01/01 - 2024/01/31");
    await flushPromises();
    await enterOnBar();

    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    expect(previewNote()).toBe("This range is longer than the 24-hour limit");
  });

  it("refuses a pasted range whose end is not after its start", async () => {
    createWrapper();
    await openMenu();
    const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

    firePaste(
      document.querySelector("#date-time-menu")!,
      "2024/01/02 10:00:00 - 2024/01/01 10:00:00",
    );
    await flushPromises();
    expect(document.querySelector('[data-test="date-time-input-error"]')).toBeNull();
    expect(previewNote()).toBe("End must be after start.");
    await enterOnBar();

    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    expect(document.querySelector('[data-test="date-time-input-error"]')?.textContent).toContain(
      "End must be after start.",
    );
  });

  describe("text input", () => {
    const NOW = new Date("2026-11-09T03:33:00Z");
    const micros = (iso: string) => Date.parse(iso) * 1000;
    const inMenu = (dataTest: string) =>
      document.querySelector<HTMLElement>(`#date-time-menu [data-test="${dataTest}"]`);
    const field = () => inMenu("date-time-input-field") as HTMLInputElement;

    // Vue drops an event stamped no later than its handler attached, which a frozen Date clock always is.
    const tick = () => vi.setSystemTime(Date.now() + 1000);
    // Typed text is read after a short pause, so each helper waits it out before the next step.
    const typeInto = async (text: string) => {
      tick();
      field().value = text;
      field().dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      await flushPromises();
    };
    const pressEnter = async () => {
      tick();
      field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();
    };
    const emitCount = () => (wrapper!.emitted("on:date-change") ?? []).length;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders the input above the resolved line, which shows the pending selection while empty", async () => {
      createWrapper();
      await openMenu();

      expect(field().getAttribute("placeholder")).toBe("Try 2h, yesterday, Q3, Nov 4 – 6");
      expect(field().value).toBe("");
      expect(inMenu("date-time-resolved-name")?.textContent).toBe("Last 15 minutes");
      expect(inMenu("date-time-resolved")?.textContent).toContain("Nov 9, 03:18 – 03:33");
      expect(inMenu("date-time-resolved")?.textContent).not.toContain("·");
      expect(inMenu("date-time-resolved-duration")).toBeNull();
    });

    it("previews relative text while typing and applies it on Enter, closing the panel", async () => {
      createWrapper();
      await openMenu();
      const before = emitCount();

      await typeInto("last 2 hours");
      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-resolved")?.getAttribute("data-preview")).toBe("true");
      expect(inMenu("date-time-resolved-name")?.textContent).toBe("Last 2 hours");
      expect(inMenu("date-time-preview-live")?.textContent?.trim()).toBe("live");
      expect(inMenu("date-time-resolved")?.textContent).toContain("Nov 9, 01:33 – 03:33");
      expect(inMenu("date-time-input-enter-hint")).not.toBeNull();
      expect(inMenu("date-time-paste-btn")).toBeNull();

      await pressEnter();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "2h", userChangedValue: true });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("waits for a pause in typing before it reads the text", async () => {
      createWrapper();
      await openMenu();

      tick();
      field().value = "2h";
      field().dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
      expect(inMenu("date-time-resolved")?.getAttribute("data-preview")).toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 150));
      await flushPromises();
      expect(inMenu("date-time-resolved")?.getAttribute("data-preview")).toBe("true");
    });

    it("lights nothing below the bar and keeps the applied range while the bar previews another", async () => {
      createWrapper();
      await openMenu();
      wrapper!.vm.pickChip("4h");
      await flushPromises();
      await openMenu();

      await typeInto("2h");

      expect(inMenu("date-time-chips")).toBeNull();
      expect(document.querySelectorAll("#date-time-menu [aria-selected='true']")).toHaveLength(0);
      expect(wrapper!.vm.selectedType).toBe("relative");
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("4h");
    });

    it("keeps the applied range in force while the bar previews another", async () => {
      createWrapper();
      await openMenu();

      await typeInto("2h");

      expect(wrapper!.vm.selectedType).toBe("relative");
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("15m");
    });

    it("applies a typed range in Apply mode on Enter, as the Apply button would", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();
      const before = emitCount();

      await typeInto("2026-11-06 14:02:11 to 15:10:43");
      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-resolved-name")?.textContent).toBe("Nov 6, 14:02:11 – 15:10:43");

      await pressEnter();
      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-06T14:02:11Z"),
        endTime: micros("2026-11-06T15:10:43Z"),
      });
    });

    it("never applies text on blur and keeps it in the bar to finish later", async () => {
      createWrapper();
      await openMenu();
      const before = emitCount();

      await typeInto("1762437600");
      tick();
      field().dispatchEvent(new FocusEvent("blur"));
      await flushPromises();

      expect(emitCount()).toBe(before);
      expect(field().value).toBe("1762437600");
      expect(inMenu("date-time-input-error")).toBeNull();
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("15m");
    });

    it("marks unreadable text and keeps the previous selection", async () => {
      createWrapper();
      await openMenu();
      const before = emitCount();

      await typeInto("last tuesday-ish");
      expect(inMenu("date-time-input-error")).toBeNull();
      expect(field().getAttribute("aria-invalid")).not.toBe("true");
      expect(inMenu("date-time-resolved")?.getAttribute("data-preview")).toBeNull();
      await pressEnter();

      expect(inMenu("date-time-input-error")?.textContent).toContain("Didn’t catch that");
      expect(inMenu("date-time-input-examples")?.textContent).toBe(
        "Try 7d, last quarter, Nov 4 – 6",
      );
      expect(inMenu("date-time-resolved")).toBeNull();
      expect(field().getAttribute("aria-invalid")).toBe("true");
      expect(emitCount()).toBe(before);
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("15m");

      await typeInto("last tuesday");
      expect(inMenu("date-time-input-error")).toBeNull();
    });

    describe("across a daylight-saving change", () => {
      beforeEach(() => {
        store.state.timezone = "America/New_York";
      });

      it.each([
        [
          "the autumn repeated hour",
          "2026-11-01 00:30:00 to 2026-11-01 02:30:00",
          "04:30",
          "07:30",
        ],
        ["the spring skipped hour", "2026-03-08 01:30:00 to 2026-03-08 03:30:00", "06:30", "07:30"],
      ])("reads a zoneless range over %s in real hours", async (_case, text, start, end) => {
        createWrapper();
        await openMenu();

        await typeInto(text);
        await pressEnter();

        const day = text.slice(0, 10);
        expect(lastEmit()).toMatchObject({
          valueType: "absolute",
          startTime: micros(`${day}T${start}:00Z`),
          endTime: micros(`${day}T${end}:00Z`),
        });
      });

      it.each([
        ["just before the spring skipped hour", "2026-03-08 01:58:00", "2026-03-08T06:58:00Z"],
        ["just after the autumn repeated hour", "2026-11-01 02:01:00", "2026-11-01T07:01:00Z"],
      ])("widens a single time %s by five real minutes each way", async (_case, text, centre) => {
        createWrapper();
        await openMenu();

        await typeInto(text);
        await pressEnter();

        expect(lastEmit()).toMatchObject({
          startTime: micros(centre) - 5 * 60_000_000,
          endTime: micros(centre) + 5 * 60_000_000,
        });
      });

      it("toggles a single time on a daylight-saving day between UTC and the zone", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2026-03-08 01:58:00");

        tick();
        inMenu("date-time-as-utc-toggle")!.click();
        await flushPromises();
        await pressEnter();

        expect(lastEmit()).toMatchObject({
          startTime: micros("2026-03-08T01:53:00Z"),
          endTime: micros("2026-03-08T02:03:00Z"),
        });
      });

      it("applies the zone reading when the toggle is pressed back before Enter", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2026-03-08 01:58:00");

        tick();
        inMenu("date-time-as-utc-toggle")!.click();
        await flushPromises();
        tick();
        inMenu("date-time-as-utc-toggle")!.click();
        await flushPromises();
        await pressEnter();

        expect(lastEmit()).toMatchObject({
          startTime: micros("2026-03-08T06:53:00Z"),
          endTime: micros("2026-03-08T07:03:00Z"),
        });
      });
    });

    it("ties the error message to the input for screen readers", async () => {
      createWrapper();
      await openMenu();

      await typeInto("last tuesday-ish");
      await pressEnter();

      const error = inMenu("date-time-input-error")!;
      expect(error.id).not.toBe("");
      expect(field().getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
    });

    it.each([
      [{ disableRelative: true }, "15m", "Enter dates, not a period"],
      [{ hideSeconds: true }, "30s", "Use minutes or longer"],
    ])("says why readable text is not allowed on %o", async (props, text, message) => {
      createWrapper(props);
      await openMenu();
      const before = emitCount();

      await typeInto(text);
      await pressEnter();

      expect(inMenu("date-time-input-error")?.textContent).toBe(message);
      expect(emitCount()).toBe(before);
    });

    it("rejects an end before its start and says so", async () => {
      createWrapper();
      await openMenu();

      await typeInto("2026/11/06 15:00:00 - 2026/11/06 14:00:00");
      await pressEnter();

      expect(inMenu("date-time-input-error")?.textContent).toBe("End must be after start.");
    });

    it("clears the typed text and its as-UTC chip when a calendar day is clicked", async () => {
      store.state.timezone = "Asia/Calcutta";
      createWrapper();
      await openMenu();
      await typeInto("2026-11-06 14:02:11 to 15:10:43");
      expect(inMenu("date-time-as-utc-toggle")).not.toBeNull();
      wrapper!.vm.openCalendar();
      await flushPromises();

      wrapper!
        .findComponent({ name: "ODateRangeCalendar" })
        .vm.$emit("update:pendingDate", "2026/11/04");
      await flushPromises();

      expect(field().value).toBe("");
      expect(inMenu("date-time-as-utc-toggle")).toBeNull();
      expect(wrapper!.vm.pendingDay).toBe("2026/11/04");
    });

    it("offers no as-UTC reading that would start in the future", async () => {
      store.state.timezone = "Asia/Calcutta";
      createWrapper();
      await openMenu();

      await typeInto("2026-11-09 08:40 to 08:55");
      await pressEnter();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-09T03:10:00Z"),
        endTime: micros("2026-11-09T03:25:00Z"),
      });
      expect(inMenu("date-time-as-utc-toggle")).toBeNull();
    });

    it("offers no as-UTC reading that would start after the picker's last day", async () => {
      store.state.timezone = "Asia/Calcutta";
      createWrapper({ maxDate: "2026/11/20" });
      await openMenu();

      await typeInto("2026-11-20 23:00 to 23:30");
      await pressEnter();

      expect(lastEmit()).toMatchObject({ startTime: micros("2026-11-20T17:30:00Z") });
      expect(inMenu("date-time-as-utc-toggle")).toBeNull();
    });

    it("rejects relative text on a date-only picker", async () => {
      createWrapper({ disableRelative: true });
      await openMenu();

      await typeInto("15m");
      await pressEnter();

      expect(inMenu("date-time-input-error")).not.toBeNull();
    });

    it("previews zoneless text in the picker zone, toggles the preview to UTC, and applies that", async () => {
      store.state.timezone = "Asia/Calcutta";
      createWrapper();
      await openMenu();

      const before = emitCount();
      await typeInto("2026-11-06 14:02:11 to 15:10:43");
      expect(inMenu("date-time-resolved-name")?.textContent).toBe("Nov 6, 14:02:11 – 15:10:43");
      const toggle = inMenu("date-time-as-utc-toggle")!;
      expect(toggle.textContent?.trim()).toBe("as UTC");
      expect(wrapper!.vm.asUtcLabel?.full).toBe("as UTC: 19:32 – 20:40");

      tick();
      toggle.click();
      await flushPromises();
      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-resolved")?.textContent).toContain("Nov 6, 19:32:11 – 20:40:43");
      expect(inMenu("date-time-as-utc-toggle")?.textContent?.trim()).toBe("as GMT+5:30");
      expect(wrapper!.vm.asUtcLabel?.full).toBe("as GMT+5:30: 14:02 – 15:10");
      expect(field().value).toBe("2026-11-06 14:02:11 to 15:10:43");

      await pressEnter();
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-06T14:02:11Z"),
        endTime: micros("2026-11-06T15:10:43Z"),
      });
    });

    it("offers no zone toggle when the text names its zone", async () => {
      store.state.timezone = "Asia/Calcutta";
      createWrapper();
      await openMenu();

      await typeInto("2026-11-08T03:30:00Z / 2026-11-08T05:30:00Z");
      await pressEnter();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-08T03:30:00Z"),
        endTime: micros("2026-11-08T05:30:00Z"),
      });
      expect(inMenu("date-time-as-utc-toggle")).toBeNull();
    });

    it("does not apply text left in the bar when the panel closes", async () => {
      createWrapper({ autoApply: true });
      await openMenu();
      const before = emitCount();
      await typeInto("2h");

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(emitCount()).toBe(before);
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("15m");
      expect(wrapper!.vm.inputText).toBe("");
    });

    it("caps a typed period on a restricted picker that opened on an absolute range", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-09T01:00:00Z"),
          endTime: micros("2026-11-09T02:00:00Z"),
        },
        queryRangeRestrictionInHour: 24,
      });
      await flushPromises();
      await openMenu();

      await typeInto("2h");
      await pressEnter();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "2h" });
      expect(wrapper!.vm.triggerLabel).toBe("Last 2 hours");

      await openMenu();
      await typeInto("3M");
      expect(inMenu("date-time-input-enter-hint")).toBeNull();
      await pressEnter();
      expect(inMenu("date-time-input-error")).toBeNull();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1d" });
    });

    it("refuses a typed range longer than the query-range limit and says why", async () => {
      createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24 hours" });
      await flushPromises();
      await openMenu();
      const before = emitCount();

      await typeInto("2024/01/01 - 2024/01/31");
      await pressEnter();

      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-input-error")).toBeNull();
      expect(inMenu("date-time-preview-note")?.textContent).toBe("Max 24 hours");
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("offers the longest allowed range for a typed count above the query-range limit", async () => {
      createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24 hours" });
      await flushPromises();
      await openMenu();
      const before = emitCount();

      await typeInto("48h");
      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-list-reading")?.getAttribute("aria-disabled")).toBe("true");
      expect(inMenu("date-time-list-reading")?.textContent).toContain("Max 1d");
      expect(inMenu("date-time-suggest-1")?.textContent).toContain("Longest allowed");
      expect(inMenu("date-time-preview-note")?.textContent).toBe("48h is over the 1-day limit");
      await pressEnter();

      expect(inMenu("date-time-input-error")).toBeNull();
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("1d");
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("accepts a typed period in minutes that fits the limit", async () => {
      createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24 hours" });
      await flushPromises();
      await openMenu();

      await typeInto("90m");
      await pressEnter();

      expect(inMenu("date-time-input-error")).toBeNull();
      expect(toastMock).not.toHaveBeenCalled();
      expect(lastEmit()).toMatchObject({
        valueType: "relative-custom",
        relativeTimePeriod: "90m",
        startTime: Date.now() * 1000 - 90 * 60_000_000,
      });
      expect(wrapper!.vm.triggerLabel).toBe("Last 90 minutes");
    });

    it("offers the longest allowed range for a typed period in days over the limit", async () => {
      createWrapper({ queryRangeRestrictionInHour: 36, queryRangeRestrictionMsg: "Max 36 hours" });
      await flushPromises();
      await openMenu();
      const before = emitCount();

      await typeInto("2d");
      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-preview-note")?.textContent).toBe("2d is over the 36-hour limit");
      await pressEnter();

      expect(inMenu("date-time-input-error")).toBeNull();
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("36h");
    });

    it("accepts a typed day that spans exactly the limit, as 24h does", async () => {
      createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24 hours" });
      await flushPromises();
      await openMenu();

      await typeInto("1d");
      await pressEnter();

      expect(inMenu("date-time-input-error")).toBeNull();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1d" });
    });

    it("says why a typed unit is over the limit and applies the longest allowed", async () => {
      createWrapper({ queryRangeRestrictionInHour: 12 });
      await flushPromises();
      await openMenu();
      const before = emitCount();

      await typeInto("1d");
      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-preview-note")?.textContent).toBe("1d is over the 12-hour limit");
      await pressEnter();

      expect(inMenu("date-time-input-error")).toBeNull();
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("12h");
    });

    it("refuses a typed day that runs 25 hours across a DST fall-back on a 24h page", async () => {
      const originalTz = process.env.TZ;
      process.env.TZ = "America/New_York";
      try {
        vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
        createWrapper({
          queryRangeRestrictionInHour: 24,
          queryRangeRestrictionMsg: "Max 24 hours",
        });
        await flushPromises();
        await openMenu();
        const before = emitCount();

        await typeInto("1d");
        await pressEnter();

        expect(emitCount()).toBe(before);
        expect(inMenu("date-time-input-error")).toBeNull();
        expect(inMenu("date-time-preview-note")?.textContent).toBe("1d is over the 1-day limit");
      } finally {
        process.env.TZ = originalTz;
      }
    });

    it("names an over-limit reading in the preview and applies the longest allowed, with no toast", async () => {
      createWrapper({ queryRangeRestrictionInHour: 12 });
      await flushPromises();
      await openMenu();

      await typeInto("3d");
      expect(inMenu("date-time-preview-note")?.textContent).toBe("3d is over the 12-hour limit");
      await pressEnter();

      expect(toastMock).not.toHaveBeenCalled();
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("12h");
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("reads refused text again on Enter once the limit has changed", async () => {
      createWrapper({ queryRangeRestrictionInHour: 12 });
      await flushPromises();
      await openMenu();
      await typeInto("3d");
      expect(inMenu("date-time-preview-note")?.textContent).toBe("3d is over the 12-hour limit");

      await wrapper!.setProps({ queryRangeRestrictionInHour: 96 });
      await flushPromises();
      await pressEnter();

      expect(inMenu("date-time-input-error")).toBeNull();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "3d" });
    });

    it("keeps an accepted 90m when the limit is recomputed and still allows it", async () => {
      createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24 hours" });
      await flushPromises();
      await openMenu();
      await typeInto("90m");
      await pressEnter();
      await openMenu();

      await wrapper!.setProps({ queryRangeRestrictionInHour: 12 });
      await flushPromises();

      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("90m");
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "90m" });
    });

    it("records only the reading Enter applies after the as-UTC toggle in Recent", async () => {
      localStorage.clear();
      store.state.timezone = "Asia/Calcutta";
      createWrapper();
      await openMenu();

      await typeInto("2026-11-06 14:02:11 to 15:10:43");
      tick();
      inMenu("date-time-as-utc-toggle")!.click();
      await flushPromises();
      await pressEnter();

      const stored = JSON.parse(
        localStorage.getItem(timeRangeHistoryKey("default", "example@gmail.com")) ?? "[]",
      );
      expect(stored).toEqual([
        { startUs: micros("2026-11-06T14:02:11Z"), endUs: micros("2026-11-06T15:10:43Z") },
      ]);
    });

    it("keeps the Recent entry when as-UTC reads the same instants in an offset-0 zone", async () => {
      localStorage.clear();
      store.state.timezone = "Europe/London";
      createWrapper();
      await openMenu();

      await typeInto("2026-11-06 14:02:11 to 15:10:43");
      tick();
      inMenu("date-time-as-utc-toggle")!.click();
      await flushPromises();
      await pressEnter();

      const stored = JSON.parse(
        localStorage.getItem(timeRangeHistoryKey("default", "example@gmail.com")) ?? "[]",
      );
      expect(stored).toEqual([
        { startUs: micros("2026-11-06T14:02:11Z"), endUs: micros("2026-11-06T15:10:43Z") },
      ]);
    });

    it("leaves Recent alone on a picker that does not record to it", async () => {
      const key = timeRangeHistoryKey("default", "example@gmail.com");
      const shared = [
        { startUs: micros("2026-11-06T08:32:11Z"), endUs: micros("2026-11-06T09:40:43Z") },
      ];
      localStorage.setItem(key, JSON.stringify(shared));
      store.state.timezone = "Asia/Calcutta";
      createWrapper({ disableRelative: true });
      await openMenu();

      await typeInto("2026-11-06 14:02:11 to 15:10:43");
      tick();
      inMenu("date-time-as-utc-toggle")!.click();
      await flushPromises();
      await pressEnter();

      expect(lastEmit()).toMatchObject({ startTime: micros("2026-11-06T14:02:11Z") });
      expect(JSON.parse(localStorage.getItem(key) ?? "[]")).toEqual(shared);
    });

    it("clears the bar when a button below picks another selection", async () => {
      createWrapper({ autoApply: false });
      await openMenu();
      await typeInto("2h");
      expect(field().value).toBe("2h");

      tick();
      inMenu("date-time-prev-btn-footer")!.click();
      await flushPromises();

      expect(wrapper!.vm.inputText).toBe("");
    });

    describe("suggestions", () => {
      const rows = () =>
        Array.from(document.querySelectorAll('#date-time-menu [data-test^="date-time-suggest-"]'));
      const suggestList = () => (rows().length > 0 ? inMenu("date-time-list") : null);
      const press = async (key: string) => {
        tick();
        field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        await flushPromises();
      };

      it("opens no list for unambiguous text or an empty bar", async () => {
        createWrapper();
        await openMenu();
        expect(suggestList()).toBeNull();

        await typeInto("2h");
        expect(suggestList()).toBeNull();
        expect(inMenu("date-time-list-reading")?.getAttribute("aria-selected")).toBe("false");
      });

      it("offers a bare number as minutes, hours, days, weeks and months with their shorthand", async () => {
        createWrapper();
        await openMenu();
        const before = emitCount();

        await typeInto("2");

        const list = suggestList()!;
        expect(list.getAttribute("role")).toBe("listbox");
        expect(rows().map((row) => row.textContent?.replace(/\s+/g, "").trim())).toEqual([
          expect.stringContaining("Last2minutes2m"),
          "Last2hours2h",
          "Last2days2d",
          "Last2weeks2w",
          "Last2months2mo",
        ]);
        expect(rows()[0].getAttribute("aria-selected")).toBe("true");
        expect(field().getAttribute("aria-expanded")).toBe("true");
        expect(field().getAttribute("aria-activedescendant")).toBe(rows()[0].id);
        expect(inMenu("date-time-resolved")?.getAttribute("data-preview")).toBe("true");
        expect(inMenu("date-time-resolved-name")?.textContent).toBe("Last 2 minutes");
        expect(emitCount()).toBe(before);
      });

      it("moves through the list with the arrows and applies the highlighted row on Enter", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2");

        await press("ArrowDown");
        expect(rows()[1].getAttribute("aria-selected")).toBe("true");
        await press("ArrowUp");
        await press("ArrowUp");
        expect(rows()[4].getAttribute("aria-selected")).toBe("true");
        await press("ArrowUp");
        await press("Enter");

        expect(lastEmit()).toMatchObject({ relativeTimePeriod: "2w", userChangedValue: true });
        expect(wrapper!.vm.menuOpen).toBe(false);
      });

      it("applies a row picked with the pointer", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2");

        tick();
        (rows()[3] as HTMLElement).click();
        await flushPromises();

        expect(lastEmit()).toMatchObject({ relativeTimePeriod: "2w" });
      });

      it("takes the highlighted row into the bar on Tab without applying it", async () => {
        createWrapper();
        await openMenu();
        const before = emitCount();
        await typeInto("2");

        await press("ArrowDown");
        await press("Tab");

        expect(field().value).toBe("2h");
        expect(suggestList()).toBeNull();
        expect(inMenu("date-time-resolved-name")?.textContent).toBe("Last 2 hours");
        expect(emitCount()).toBe(before);
      });

      it("offers both day orders for an ambiguous date", async () => {
        createWrapper();
        await openMenu();

        await typeInto("4/5");

        expect(rows()).toHaveLength(2);
        expect(rows()[0].textContent).toContain("Apr 5");
        expect(rows()[1].textContent).toContain("May 4");
      });

      it("names the offset each reading of a letter zone abbreviation stands for", async () => {
        createWrapper();
        await openMenu();

        await typeInto("2026-11-04 10:00 IST");

        expect(rows().map((row) => row.textContent?.match(/UTC[+-]\d{2}:\d{2}/)?.[0])).toEqual([
          "UTC+05:30",
          "UTC+01:00",
          "UTC+02:00",
        ]);
      });

      it("closes the list on Escape, then clears the bar, then closes the panel", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2");

        await press("Escape");
        expect(suggestList()).toBeNull();
        expect(field().value).toBe("2");
        expect(wrapper!.vm.menuOpen).toBe(true);

        await press("Escape");
        expect(field().value).toBe("");
        expect(wrapper!.vm.menuOpen).toBe(true);

        await press("Escape");
        expect(wrapper!.vm.menuOpen).toBe(false);
      });

      it("opens the list instead of an error when Enter comes before the pause", async () => {
        createWrapper();
        await openMenu();
        tick();
        field().value = "2";
        field().dispatchEvent(new Event("input", { bubbles: true }));

        await press("Enter");

        expect(inMenu("date-time-input-error")).toBeNull();
        expect(rows()).toHaveLength(5);
      });

      const retype = (text: string) => {
        tick();
        field().value = text;
        field().dispatchEvent(new Event("input", { bubbles: true }));
      };

      it("closes a list as soon as the text changes and applies the new text on a quick Enter", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2");
        expect(rows()).toHaveLength(5);

        retype("2h");
        await flushPromises();
        expect(suggestList()).toBeNull();
        await press("Enter");

        expect(lastEmit()).toMatchObject({ relativeTimePeriod: "2h", userChangedValue: true });
      });

      it("reads the new text on a quick Tab instead of taking a row of the old list", async () => {
        createWrapper();
        await openMenu();
        const before = emitCount();
        await typeInto("2");

        retype("2h");
        await press("Tab");

        expect(field().value).toBe("2h");
        expect(suggestList()).toBeNull();
        expect(inMenu("date-time-resolved-name")?.textContent).toBe("Last 2 hours");
        expect(emitCount()).toBe(before);
      });

      it("previews the highlighted zone of a letter abbreviation and applies that row", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2026-11-04 10:00 CST");

        expect(inMenu("date-time-resolved-name")?.textContent).toBe("Nov 4, 15:55 – 16:05");
        await press("ArrowDown");
        expect(inMenu("date-time-resolved-name")?.textContent).toBe("Nov 4, 01:55 – 02:05");
        await press("Enter");

        expect(lastEmit()).toMatchObject({
          startTime: micros("2026-11-04T01:55:00Z"),
          endTime: micros("2026-11-04T02:05:00Z"),
        });
      });

      it("applies the as-UTC reading of the highlighted row the preview shows", async () => {
        store.state.timezone = "Asia/Calcutta";
        createWrapper();
        await openMenu();
        await typeInto("04/05/2026 10:00");
        expect(rows().length).toBeGreaterThan(1);

        tick();
        inMenu("date-time-as-utc-toggle")!.click();
        await flushPromises();
        expect(inMenu("date-time-resolved-name")?.textContent).toBe("Apr 5, 15:25 – 15:35");
        await press("Enter");

        expect(lastEmit()).toMatchObject({
          startTime: micros("2026-04-05T09:55:00Z"),
          endTime: micros("2026-04-05T10:05:00Z"),
        });
      });

      it("reopens a dismissed list of a bare number on Enter", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2");
        await press("Escape");
        expect(suggestList()).toBeNull();

        await press("Enter");

        expect(rows()).toHaveLength(5);
        expect(wrapper!.vm.menuOpen).toBe(true);
      });

      it("closes the list when focus leaves the bar, and a press on a row keeps focus in it", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2");

        const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        rows()[1].dispatchEvent(press);
        expect(press.defaultPrevented).toBe(true);
        tick();
        (rows()[1] as HTMLElement).click();
        await flushPromises();
        expect(lastEmit()).toMatchObject({ relativeTimePeriod: "2h" });

        await openMenu();
        await typeInto("3");
        const outside = document.createElement("button");
        document.body.appendChild(outside);
        field().dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
        );
        await flushPromises();
        expect(suggestList()).toBeNull();
      });

      it("counts now-2h back in real time across a DST fall-back", async () => {
        store.state.timezone = "America/New_York";
        vi.setSystemTime(new Date("2026-11-01T06:30:00Z"));
        createWrapper();
        await openMenu();
        await typeInto("now-2h to now-1h");
        await press("Enter");

        const now = Date.now() * 1000;
        expect(lastEmit()).toMatchObject({
          startTime: now - 2 * 3_600_000_000,
          endTime: now - 3_600_000_000,
        });
      });
    });

    describe("paste reads like typing", () => {
      it("previews relative text from the paste button and applies it on Enter", async () => {
        stubReadText(() => Promise.resolve("last 3 hours"));
        createWrapper();
        await openMenu();
        const before = emitCount();

        tick();
        await wrapper!.vm.pasteRange();
        await flushPromises();

        expect(emitCount()).toBe(before);
        expect(field().value).toBe("last 3 hours");
        expect(inMenu("date-time-resolved-name")?.textContent).toBe("Last 3 hours");
        await pressEnter();
        expect(lastEmit()).toMatchObject({ relativeTimePeriod: "3h", userChangedValue: true });
        expect(toastMock).not.toHaveBeenCalled();
      });

      it("widens a single pasted timestamp to five minutes either side", async () => {
        createWrapper();
        await openMenu();

        tick();
        firePaste(document.querySelector("#date-time-menu")!, "2026-11-06 14:02:11");
        await flushPromises();
        await pressEnter();

        expect(lastEmit()).toMatchObject({
          valueType: "absolute",
          startTime: micros("2026-11-06T13:57:11Z"),
          endTime: micros("2026-11-06T14:07:11Z"),
        });
      });

      it("offers the as-UTC reading for pasted zoneless text", async () => {
        store.state.timezone = "Asia/Calcutta";
        stubReadText(() => Promise.resolve("2026-11-06 14:02:11 to 15:10:43"));
        createWrapper();
        await openMenu();

        const before = emitCount();
        tick();
        await wrapper!.vm.pasteRange();
        await flushPromises();

        expect(emitCount()).toBe(before);
        expect(inMenu("date-time-as-utc-toggle")?.textContent?.trim()).toBe("as UTC");
        expect(wrapper!.vm.asUtcLabel?.full).toBe("as UTC: 19:32 – 20:40");
        await pressEnter();
        expect(lastEmit()).toMatchObject({ startTime: micros("2026-11-06T08:32:11Z") });
      });

      it("previews text pasted into the empty box at once, without waiting for a pause", async () => {
        createWrapper();
        await openMenu();
        const before = emitCount();

        tick();
        const event = firePaste(field(), "2h");
        await flushPromises();

        expect(event.defaultPrevented).toBe(true);
        expect(field().value).toBe("2h");
        expect(inMenu("date-time-resolved-name")?.textContent).toBe("Last 2 hours");
        expect(emitCount()).toBe(before);
      });

      it("replaces readable text with a second paste into the box and applies that on Enter", async () => {
        createWrapper();
        await openMenu();
        tick();
        firePaste(field(), "last 3 hours");
        await flushPromises();
        field().setSelectionRange(field().value.length, field().value.length);

        tick();
        const event = firePaste(field(), "2026-11-08 10:00 - 2026-11-08 12:00");
        await flushPromises();

        expect(event.defaultPrevented).toBe(true);
        expect(field().value).toBe("2026-11-08 10:00 - 2026-11-08 12:00");
        await pressEnter();
        expect(lastEmit()).toMatchObject({
          valueType: "absolute",
          startTime: micros("2026-11-08T10:00:00Z"),
          endTime: micros("2026-11-08T12:00:00Z"),
        });
      });

      it("replaces typed text Enter refused with a paste into the box", async () => {
        createWrapper();
        await openMenu();
        await typeInto("whenever");
        await pressEnter();
        expect(inMenu("date-time-input-error")).not.toBeNull();

        tick();
        const event = firePaste(field(), "30m");
        await flushPromises();

        expect(event.defaultPrevented).toBe(true);
        expect(field().value).toBe("30m");
        expect(inMenu("date-time-input-error")).toBeNull();
        await pressEnter();
        expect(lastEmit()).toMatchObject({ relativeTimePeriod: "30m" });
      });

      it("leaves a paste into a box that already holds text to the browser", async () => {
        createWrapper();
        await openMenu();
        await typeInto("2026-11-06 14:00 to ");
        const before = emitCount();

        const event = firePaste(field(), "15:00");
        await flushPromises();

        expect(event.defaultPrevented).toBe(false);
        expect(emitCount()).toBe(before);
      });

      it("inserts a paste at the caret of text that was typed, not read", async () => {
        createWrapper();
        await openMenu();
        await typeInto("yesterday");
        field().setSelectionRange(field().value.length, field().value.length);

        const event = firePaste(field(), "15:00");
        await flushPromises();

        expect(event.defaultPrevented).toBe(false);
        expect(field().value).toBe("yesterday");
      });

      it("marks unreadable pasted text only after Enter, like typed text", async () => {
        createWrapper();
        await openMenu();
        const before = emitCount();

        tick();
        firePaste(document.querySelector("#date-time-menu")!, "not a date range at all");
        await flushPromises();
        expect(inMenu("date-time-input-error")).toBeNull();
        await pressEnter();

        expect(emitCount()).toBe(before);
        expect(inMenu("date-time-input-error")?.textContent).toContain("Didn’t catch that");
        expect(toastMock).not.toHaveBeenCalled();
      });
    });

    it("shows the restriction in the preview for a typed absolute range over the limit", async () => {
      createWrapper({ queryRangeRestrictionInHour: 2, queryRangeRestrictionMsg: "Max 2 hours" });
      await flushPromises();
      await openMenu();

      await typeInto("2026-11-06 10:00 to 2026-11-06 14:00");
      await pressEnter();

      expect(inMenu("date-time-input-error")).toBeNull();
      expect(inMenu("date-time-preview-note")?.textContent).toBe("Max 2 hours");
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("fixes a range read against now at the moment Enter is pressed", async () => {
      createWrapper({ defaultRelativeTime: "1h" });
      await openMenu();
      await typeInto("2026-11-09 03:00:00 to 2026-11-09 04:00:00");

      vi.setSystemTime(new Date("2026-11-09T03:40:00Z"));
      await pressEnter();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-09T03:00:00Z"),
        endTime: Date.now() * 1000,
      });
    });

    it.each([
      ["a year after now", "2099/01/01 - 2099/01/02", "That is in the future. Latest is now."],
      [
        "a start later today",
        "2026-11-09 04:00 to 2026-11-09 05:00",
        "That is in the future. Latest is now.",
      ],
      ["a year before the calendar's first day", "1970/01/01 - 1970/01/02", "Before Jan 1, 1999"],
      ["a start before the calendar's first day", "1998/12/31 - 1999/01/05", "Before Jan 1, 1999"],
    ])("refuses a typed range with %s and names the bound", async (_, text, message) => {
      createWrapper();
      await openMenu();
      const before = emitCount();

      await typeInto(text);
      await pressEnter();

      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-input-error")?.textContent).toBe(message);
    });

    it("names the bound in the preview, then as the error on Enter, for a pasted range out of bounds", async () => {
      createWrapper();
      await openMenu();

      tick();
      firePaste(document.querySelector("#date-time-menu")!, "2099/01/01 - 2099/01/02");
      await flushPromises();
      expect(inMenu("date-time-preview-note")?.textContent).toBe(
        "That is in the future. Latest is now.",
      );
      expect(inMenu("date-time-input-enter-hint")).toBeNull();
      await pressEnter();

      expect(inMenu("date-time-input-error")?.textContent).toContain(
        "That is in the future. Latest is now.",
      );
      expect(toastMock).not.toHaveBeenCalled();
    });

    it.each(["2099-01-01T10:00:00Z", "4070908800", "[01/Jan/2099:10:00:00 +0000]", "Jan 1 2099"])(
      "says a pasted %s is in the future rather than not a time, and Enter applies nothing",
      async (text) => {
        createWrapper();
        await openMenu();
        const before = emitCount();

        tick();
        firePaste(document.querySelector("#date-time-menu")!, text);
        await flushPromises();
        expect(inMenu("date-time-preview-note")?.textContent).toBe(
          "That is in the future. Latest is now.",
        );
        await pressEnter();

        expect(emitCount()).toBe(before);
        expect(inMenu("date-time-input-error")?.textContent).not.toContain("Didn’t catch that");
      },
    );

    it("names the zone a pasted stamp wrote its time in", async () => {
      createWrapper();
      await openMenu();

      tick();
      firePaste(document.querySelector("#date-time-menu")!, "2026-11-08T03:30:00+05:30");
      await flushPromises();

      expect(inMenu("date-time-preview-note")?.textContent).toBe("typed in UTC+05:30");
    });

    it("offers the as-UTC reading only for zoneless text that gives a year", async () => {
      store.state.timezone = "Asia/Calcutta";
      createWrapper();
      await openMenu();

      await typeInto("Nov 6 14:02");
      expect(inMenu("date-time-resolved-name")?.textContent).toBe(
        "± 5 min around Nov 6, 14:02:00.000",
      );
      expect(inMenu("date-time-as-utc-toggle")).toBeNull();

      await typeInto("Nov 6 2026 14:02");
      expect(inMenu("date-time-as-utc-toggle")).not.toBeNull();
    });

    it("refuses a typed range before a date-only picker's minDate", async () => {
      createWrapper({ disableRelative: true, minDate: "2026/11/01" });
      await openMenu();
      const before = emitCount();

      await typeInto("2026/10/01 - 2026/10/02");
      await pressEnter();

      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-input-error")?.textContent).toBe("Before Nov 1");
    });

    it("refuses a typed range after a scheduling picker's last day", async () => {
      createWrapper({ maxDate: "2026/11/20" });
      await openMenu();
      const before = emitCount();

      await typeInto("2026/11/21 10:00 - 2026/11/21 11:00");
      await pressEnter();

      expect(emitCount()).toBe(before);
      expect(inMenu("date-time-input-error")?.textContent).toBe("After Nov 20");
    });

    it("stops a typed range that ends in the future at now", async () => {
      createWrapper();
      await openMenu();

      await typeInto("2026-11-09 03:00:00 to 2026-11-09 04:00:00");
      await pressEnter();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-09T03:00:00Z"),
        endTime: Date.now() * 1000,
      });
    });

    it("applies a typed future window on an absolute-only picker that books ahead", async () => {
      createWrapper({ disableRelative: true, minDate: "2026/11/09" });
      await openMenu();

      await typeInto("2026-11-12 09:00:00 to 2026-11-12 17:00:00");
      await pressEnter();

      expect(inMenu("date-time-input-error")).toBeNull();
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-12T09:00:00Z"),
        endTime: micros("2026-11-12T17:00:00Z"),
      });
    });

    describe("day-only pickers", () => {
      const dayOnly = {
        disableRelative: true,
        hideRelativeTime: true,
        hideRelativeTimezone: true,
      };

      it("shows days with no clock times, zone or minutes, as the trigger does", async () => {
        store.state.timezone = "Asia/Calcutta";
        createWrapper(dayOnly);
        await flushPromises();
        await openMenu();

        const line = inMenu("date-time-resolved")!.textContent!;
        expect(line).toContain("Nov 9");
        expect(line).toContain("1d");
        expect(line).not.toMatch(/\d{2}:\d{2}/);
        expect(line).not.toContain("GMT");
        expect(wrapper!.vm.triggerLabel).toBe("2026/11/09 - 2026/11/09");
      });

      it("shows a typed range as its days, with no as-UTC chip", async () => {
        store.state.timezone = "Asia/Calcutta";
        createWrapper(dayOnly);
        await openMenu();

        await typeInto("2026/11/05 to 2026/11/07");

        const line = inMenu("date-time-resolved")!.textContent!;
        expect(line).toContain("Nov 5 – 7");
        expect(line).toContain("3d");
        expect(line).not.toMatch(/\d{2}:\d{2}/);
        expect(inMenu("date-time-as-utc-toggle")).toBeNull();
      });

      it("drops the zone and the as-UTC chip when the picker hides its zone", async () => {
        store.state.timezone = "Asia/Calcutta";
        createWrapper({ hideRelativeTimezone: true });
        await openMenu();

        await typeInto("2026-11-06 14:02:11 to 15:10:43");

        expect(inMenu("date-time-resolved")?.textContent).toContain("Nov 6, 14:02:11 – 15:10:43");
        expect(inMenu("date-time-resolved")?.textContent).not.toContain("GMT");
        expect(inMenu("date-time-as-utc-toggle")).toBeNull();
      });
    });
  });

  describe("zoom out and Live", () => {
    const NOW = new Date("2026-11-09T12:00:00Z");
    const micros = (iso: string) => Date.parse(iso) * 1000;
    const button = (dataTest: string) =>
      document.querySelector<HTMLButtonElement>(`[data-test="${dataTest}"]`)!;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("doubles a relative period", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();

      button("date-time-zoom-out-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "relative",
        relativeTimePeriod: "30m",
        userChangedValue: true,
      });
      expect(wrapper!.vm.triggerLabel).toBe("Last 30 minutes");
    });

    it.each([
      ["30m", "1h", "Last 1 hour", ["h", 1]],
      ["2h", "4h", "Last 4 hours", ["h", 4]],
      ["12h", "1d", "Last 1 day", ["d", 1]],
      ["45m", "90m", "Last 90 minutes", null],
      ["30s", "1m", "Last 1 minute", null],
      ["1w", "2w", "Last 2 weeks", null],
    ])("zooms %s out to %s in the largest exact unit", async (from, to, label, chip) => {
      createWrapper({ autoApply: false, defaultRelativeTime: from });
      await flushPromises();

      button("date-time-zoom-out-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: to });
      expect(wrapper!.vm.triggerLabel).toBe(label);
      if (chip) {
        expect([wrapper!.vm.relativePeriod, wrapper!.vm.relativeValue]).toEqual(chip);
      }
    });

    it("doubles the whole count a mid-edit custom value stands for", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "15m" });
      await flushPromises();
      wrapper!.vm.relativeValue = 2.5 as unknown as number;
      await flushPromises();

      button("date-time-zoom-out-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "4m" });
    });

    it("doubles an absolute range around its centre", async () => {
      createWrapper({
        autoApply: false,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-08T10:00:00Z"),
          endTime: micros("2026-11-08T12:00:00Z"),
        },
      });
      await flushPromises();

      button("date-time-zoom-out-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-08T09:00:00Z"),
        endTime: micros("2026-11-08T13:00:00Z"),
        userChangedValue: true,
      });
    });

    it("stops the end of a widened absolute range at now", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-09T11:00:00Z"),
          endTime: micros("2026-11-09T11:40:00Z"),
        },
      });
      await flushPromises();

      button("date-time-zoom-out-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-09T10:40:00Z"),
        endTime: micros("2026-11-09T12:00:00Z"),
      });
    });

    it("clamps to the query-range limit and says why", async () => {
      createWrapper({
        defaultRelativeTime: "45m",
        queryRangeRestrictionInHour: 1,
        queryRangeRestrictionMsg: "Max 1 hour",
      });
      await flushPromises();

      button("date-time-zoom-out-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1h" });
      expect(lastToast()).toMatchObject({ variant: "warning", message: "Max 1 hour" });
    });

    it("explains a clamp with the default message when the page gives none", async () => {
      createWrapper({ defaultRelativeTime: "45m", queryRangeRestrictionInHour: 1 });
      await flushPromises();

      button("date-time-zoom-out-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1h" });
      expect(lastToast()).toMatchObject({
        variant: "warning",
        message: "This range is longer than the 1-hour limit",
      });
    });

    it("clamps a widened absolute range to the limit", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-08T10:00:00Z"),
          endTime: micros("2026-11-08T11:30:00Z"),
        },
        queryRangeRestrictionInHour: 2,
        queryRangeRestrictionMsg: "Max 2 hours",
      });
      await flushPromises();

      button("date-time-zoom-out-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-08T09:45:00Z"),
        endTime: micros("2026-11-08T11:45:00Z"),
      });
      expect(lastToast()).toMatchObject({ message: "Max 2 hours" });
    });

    describe("on absolute-only pickers", () => {
      // logstream/schema.vue's picker: whole days only.
      const schemaPicker = {
        disableRelative: true,
        hideRelativeTime: true,
        hideRelativeTimezone: true,
      };

      it("offers no zoom-out on a day-only form picker", async () => {
        createWrapper({ ...schemaPicker, minDate: "2026/10/01" });
        await flushPromises();

        expect(document.querySelector('[data-test="date-time-zoom-out-btn"]')).toBeNull();
      });

      it.each([
        ["a normal picker", {}],
        [
          "UsageTrends' picker",
          { disableRelative: true, disablePrevShift: true, minDate: "2026/10/01" },
        ],
      ])("offers zoom-out on %s", async (_case, props) => {
        createWrapper(props);
        await flushPromises();

        expect(document.querySelector('[data-test="date-time-zoom-out-btn"]')).not.toBeNull();
      });

      it("never widens a timed range before minDate", async () => {
        createWrapper({
          disableRelative: true,
          minDate: "2026/11/08",
          defaultType: "absolute",
          defaultAbsoluteTime: {
            startTime: micros("2026-11-08T01:00:00Z"),
            endTime: micros("2026-11-08T05:00:00Z"),
          },
        });
        await flushPromises();

        button("date-time-zoom-out-btn").click();
        await flushPromises();

        expect(lastEmit()).toMatchObject({
          startTime: micros("2026-11-08T00:00:00Z"),
          endTime: micros("2026-11-08T08:00:00Z"),
        });
      });

      // enterprise UsageTrends.vue's picker: ‹ turns off once the range reaches the oldest data.
      it("keeps the start where it is while the previous shift is off", async () => {
        createWrapper({
          autoApply: true,
          disableRelative: true,
          disablePrevShift: true,
          minDate: "2026/10/01",
          defaultType: "absolute",
          defaultAbsoluteTime: {
            startTime: micros("2026-11-08T00:00:00Z"),
            endTime: micros("2026-11-08T06:00:00Z"),
          },
          queryRangeRestrictionInHour: 720,
          queryRangeRestrictionMsg: "Max 30 days",
        });
        await flushPromises();

        button("date-time-zoom-out-btn").click();
        await flushPromises();

        expect(lastEmit()).toMatchObject({
          startTime: micros("2026-11-08T00:00:00Z"),
          endTime: micros("2026-11-08T12:00:00Z"),
        });
      });
    });

    it("is hidden with the shift buttons", async () => {
      createWrapper({ hideRangeShift: true });
      await flushPromises();

      expect(document.querySelector('[data-test="date-time-zoom-out-btn"]')).toBeNull();
    });

    it("hides Live while the range is relative", async () => {
      createWrapper();
      await openMenu();

      expect(document.querySelector('#date-time-menu [data-test="date-time-live-btn"]')).toBeNull();
    });

    it.each([
      ["2026-11-09T10:00:00Z", "2026-11-09T12:00:00Z", "2h"],
      ["2026-11-09T10:30:00Z", "2026-11-09T12:00:00Z", "90m"],
      ["2026-11-07T00:00:00Z", "2026-11-09T00:00:00Z", "2d"],
    ])("turns %s – %s into a rolling %s ending now", async (start, end, period) => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: { startTime: micros(start), endTime: micros(end) },
      });
      await flushPromises();
      await openMenu();

      button("date-time-live-btn").click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: period });
      expect(document.querySelector('#date-time-menu [data-test="date-time-live-btn"]')).toBeNull();
    });

    it("applies Live at once in Apply mode, as the list has no Apply to stage it for", async () => {
      createWrapper({
        autoApply: false,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-09T10:00:00Z"),
          endTime: micros("2026-11-09T12:00:00Z"),
        },
      });
      await flushPromises();
      await openMenu();
      const before = (wrapper!.emitted("on:date-change") ?? []).length;

      button("date-time-live-btn").click();
      await flushPromises();

      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(before + 1);
      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "2h" });
    });
  });

  describe("values from outside the picker", () => {
    const NOW = new Date("2026-11-09T03:33:00Z");
    const micros = (iso: string) => Date.parse(iso) * 1000;
    const nowUs = micros("2026-11-09T03:33:00Z");
    const emits = () =>
      (wrapper!.emitted("on:date-change") ?? []).map(([payload]) => payload) as Record<
        string,
        unknown
      >[];
    const fallback = { valueType: "relative", relativeTimePeriod: "15m", userChangedValue: false };
    const warned = () =>
      toastMock.mock.calls.some(([arg]) => (arg as { variant: string }).variant === "warning");

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      ["999999M", "120M", "Last 10 years"],
      ["1200M", "120M", "Last 10 years"],
      ["9999999m", "3650d", "Last 3650 days"],
    ])(
      "caps a URL period of %s to %s, as Custom does, and says so",
      async (period, capped, label) => {
        createWrapper({ defaultRelativeTime: period });
        await flushPromises();

        expect(emits()).toHaveLength(1);
        expect(lastEmit()).toMatchObject({ relativeTimePeriod: capped, userChangedValue: false });
        expect(lastEmit().startTime as number).toBeGreaterThanOrEqual(
          micros("1999-01-01T00:00:00Z"),
        );
        expect(lastToast()).toMatchObject({
          variant: "warning",
          message: `This time range was shortened to ${label}`,
        });
      },
    );

    it("shows no toast for a valid URL period", async () => {
      createWrapper({ defaultRelativeTime: "60m" });
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "60m" });
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("refuses a URL period with a fractional count instead of reading 1.5h as 5h", async () => {
      createWrapper({ defaultRelativeTime: "1.5h" });
      await flushPromises();

      expect(lastEmit()).toMatchObject(fallback);
      expect(warned()).toBe(true);
    });

    it.each([
      ["1.5h", "15m"],
      ["999999M", "120M"],
    ])("emits a corrected period when a parent sets %s", async (period, corrected) => {
      createWrapper({ defaultRelativeTime: "1h" });
      await flushPromises();
      const before = emits().length;

      wrapper!.vm.setRelativeTime(period);
      await flushPromises();

      expect(emits()).toHaveLength(before + 1);
      expect(lastEmit()).toMatchObject({
        valueType: "relative",
        relativeTimePeriod: corrected,
        userChangedValue: false,
      });
    });

    it("emits nothing extra for a valid period a parent sets", async () => {
      createWrapper({ defaultRelativeTime: "1h" });
      await flushPromises();
      const before = emits().length;

      wrapper!.vm.setRelativeTime("2h");
      await flushPromises();

      expect(emits()).toHaveLength(before);
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("2h");
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("falls back to the last 15 minutes for a reversed URL range", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-08T12:00:00Z"),
          endTime: micros("2026-11-08T10:00:00Z"),
        },
      });
      await flushPromises();

      expect(emits()).toHaveLength(1);
      expect(lastEmit()).toMatchObject({
        ...fallback,
        startTime: nowUs - 15 * 60_000_000,
        endTime: nowUs,
      });
      expect(warned()).toBe(true);
    });

    it.each([
      ["before 1999", "1990-01-01T00:00:00Z", "1990-01-02T00:00:00Z"],
      ["after now", "3000-01-01T00:00:00Z", "3000-01-02T00:00:00Z"],
      ["ending past now", "2026-11-08T00:00:00Z", "3000-01-01T00:00:00Z"],
    ])("keeps a URL range %s as the parent asked", async (_case, from, to) => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: { startTime: micros(from), endTime: micros(to) },
      });
      await flushPromises();

      // Mount saves once and the auto-apply watcher once more, as on main; both carry the range as asked.
      for (const payload of emits()) {
        expect(payload).toMatchObject({
          valueType: "absolute",
          startTime: micros(from),
          endTime: micros(to),
          userChangedValue: false,
        });
      }
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("emits a jump to data ahead of the browser clock unchanged, once", async () => {
      createWrapper({ defaultType: "absolute" });
      await flushPromises();
      const before = emits().length;

      wrapper!.vm.setAbsoluteTime(micros("2026-11-09T03:40:00Z"), micros("2026-11-09T03:50:00Z"));
      await flushPromises();

      expect(emits()).toHaveLength(before + 1);
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-09T03:40:00Z"),
        endTime: micros("2026-11-09T03:50:00Z"),
      });
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("still bounds a parent's range by an explicit maxDate", async () => {
      createWrapper({ defaultType: "absolute", maxDate: "2026/11/10" });
      await flushPromises();

      wrapper!.vm.setAbsoluteTime(micros("2026-11-10T20:00:00Z"), micros("2026-11-12T00:00:00Z"));
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-10T20:00:00Z"),
        endTime: micros("2026-11-11T00:00:00Z"),
      });
    });

    it("emits the fallback once when a parent sets a reversed range and then its type", async () => {
      createWrapper();
      await flushPromises();
      const before = emits().length;

      wrapper!.vm.setAbsoluteTime(micros("2026-11-08T12:00:00Z"), micros("2026-11-08T10:00:00Z"));
      wrapper!.vm.setDateType("absolute");
      await flushPromises();

      expect(emits()).toHaveLength(before + 1);
      expect(warned()).toBe(true);
    });

    it("emits the fallback when a parent sets a reversed range and stops there", async () => {
      createWrapper();
      await flushPromises();
      const before = emits().length;

      wrapper!.vm.setAbsoluteTime(micros("2026-11-08T12:00:00Z"), micros("2026-11-08T10:00:00Z"));
      await flushPromises();

      expect(emits()).toHaveLength(before + 1);
      expect(lastEmit()).toMatchObject(fallback);
    });

    it("emits a corrected period once when the parent refreshes right after", async () => {
      createWrapper({ defaultRelativeTime: "1h" });
      await flushPromises();
      const before = emits().length;

      wrapper!.vm.setRelativeTime("999999M");
      wrapper!.vm.refresh();
      await flushPromises();

      expect(emits()).toHaveLength(before + 1);
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "120M", userChangedValue: false });
    });

    it("keeps a zoomed range a parent sets, even ahead of now", async () => {
      createWrapper();
      await flushPromises();

      wrapper!.vm.setCustomDate("absolute", {
        start: Date.parse("2026-11-09T03:00:00Z"),
        end: Date.parse("2026-11-09T04:00:00Z"),
      });
      await flushPromises();

      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: micros("2026-11-09T03:00:00Z"),
        endTime: micros("2026-11-09T04:00:00Z"),
      });
    });

    it("keeps a parent's range set while the Apply-mode panel is open when it closes", async () => {
      createWrapper({ autoApply: false, defaultType: "absolute" });
      await flushPromises();
      await openMenu();

      wrapper!.vm.setAbsoluteTime(micros("2026-11-08T10:00:00Z"), micros("2026-11-08T11:00:00Z"));
      await flushPromises();
      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: micros("2026-11-08T10:00:00Z"),
        endTime: micros("2026-11-08T11:00:00Z"),
      });
    });

    it("ignores a parent's zoom to a reversed range and keeps the current one", async () => {
      createWrapper({ defaultRelativeTime: "1h" });
      await flushPromises();
      const before = emits().length;

      wrapper!.vm.setCustomDate("absolute", {
        start: Date.parse("2026-11-09T04:00:00Z"),
        end: Date.parse("2026-11-09T03:00:00Z"),
      });
      await flushPromises();

      expect(emits()).toHaveLength(before);
      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({ relativeTimePeriod: "1h" });
    });
  });

  describe("typed calendar words", () => {
    const NOW = new Date("2026-11-09T03:33:00Z");
    const micros = (iso: string) => Date.parse(iso) * 1000;
    const typeAndEnter = async (text: string) => {
      vi.setSystemTime(Date.now() + 1000);
      const field = document.querySelector<HTMLInputElement>(
        "#date-time-menu [data-test='date-time-input-field']",
      )!;
      field.value = text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
      vi.setSystemTime(Date.now() + 1000);
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      ["today", "calendar:day:0"],
      ["yesterday", "calendar:day:-1"],
      ["this week", "calendar:week:0"],
      ["last month", "calendar:month:-1"],
      ["last quarter", "calendar:quarter:-1"],
    ])("selects the rail's token for %s when calendar presets are on", async (text, token) => {
      createWrapper();
      await openMenu();

      await typeAndEnter(text);

      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: token });
      expect(wrapper!.vm.calendarToken).toBe(token);
    });

    it("keeps last 2 months rolling", async () => {
      createWrapper();
      await openMenu();

      await typeAndEnter("last 2 months");

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "2M" });
    });

    it("applies the token's range as absolute dates when calendar presets are off", async () => {
      createWrapper({ calendarPresets: false });
      await openMenu();

      await typeAndEnter("last month");

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        relativeTimePeriod: null,
        startTime: micros("2026-10-01T00:00:00Z"),
        endTime: micros("2026-11-01T00:00:00Z"),
      });
      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/10/01", to: "2026/10/31" });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });
    });

    it("ends today at now when calendar presets are off", async () => {
      createWrapper({ calendarPresets: false });
      await openMenu();

      await typeAndEnter("today");

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-09T00:00:00Z"),
      });
      expect(lastEmit().endTime as number).toBeGreaterThanOrEqual(micros("2026-11-09T03:33:00Z"));
    });
  });
});
