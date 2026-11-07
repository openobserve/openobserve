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

  const menuEl = (id: string) => document.querySelector(`#date-time-menu [data-test="${id}"]`);
  const emitCount = () => (wrapper!.emitted("on:date-change") ?? []).length;

  it("fills the draft from a keyboard paste and applies it only on Apply", async () => {
    createWrapper();
    await openMenu();

    const emitsBefore = emitCount();
    const event = firePaste(document.querySelector("#date-time-menu")!, PAYLOAD);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(emitCount()).toBe(emitsBefore);
    expect(wrapper!.vm.panelDraft?.kind).toBe("absolute");
    expect(wrapper!.vm.draft.start).toMatchObject({ date: "2026-10-27", time: "11:20:00" });
    expect(menuEl("date-time-range-note")?.getAttribute("data-kind")).toBe("info");
    expect(menuEl("date-time-range-draft")).not.toBeNull();

    (menuEl("date-time-apply-btn") as HTMLButtonElement).click();
    await flushPromises();

    expect(emitCount()).toBe(emitsBefore + 1);
    expect(lastEmit()).toMatchObject({
      startTime: START_US,
      endTime: END_US,
      valueType: "absolute",
      userChangedValue: true,
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("applies a pasted range on an outside close of an auto-apply picker, even after a pending day", async () => {
    createWrapper();
    await openMenu();
    wrapper!.vm.onCalendarPending("2026/10/03");
    await flushPromises();

    firePaste(document.querySelector("#date-time-menu")!, PAYLOAD);
    await flushPromises();
    wrapper!.vm.onMenuOpenChange(false);
    wrapper!.vm.menuOpen = false;
    await flushPromises();

    expect(wrapper!.vm.selectedDate).toMatchObject({ from: "2026/10/27", to: "2026/10/27" });
    expect(lastEmit()).toMatchObject({ startTime: START_US, endTime: END_US });
  });

  it("hands a paste inside a segment field to the panel instead of inserting it", async () => {
    createWrapper();
    await openMenu();
    const input = document.querySelector<HTMLInputElement>(
      '#date-time-menu [data-test="datetime-start-time"] input',
    )!;

    const event = firePaste(input, "2026-10-27 07:20:00 – 2026-10-27 08:20:00");
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(wrapper!.vm.draft.start).toMatchObject({ date: "2026-10-27", time: "07:20:00" });
    expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-10-27", time: "08:20:00" });
    expect(menuEl("date-time-range-note")?.textContent).toContain("Read in UTC");
    expect(menuEl("date-time-range-note")?.textContent).not.toContain("Read as");
  });

  it("leaves a paste into one of the picker's other fields alone", async () => {
    createWrapper();
    await openMenu();
    const emitsBefore = emitCount();
    const input = document.createElement("input");
    document.querySelector("#date-time-menu")!.appendChild(input);

    const event = firePaste(input, PAYLOAD);
    await flushPromises();

    expect(event.defaultPrevented).toBe(false);
    expect(emitCount()).toBe(emitsBefore);
    expect(wrapper!.vm.selectedType).toBe("relative");
  });

  it("points to the keyboard in the note when the browser blocks reading the clipboard", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    stubReadText(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    createWrapper();
    await openMenu();

    await wrapper!.vm.pasteRange();
    await flushPromises();

    const note = menuEl("date-time-range-note")!;
    expect(note.getAttribute("data-kind")).toBe("error");
    expect(note.getAttribute("data-reason")).toBe("blocked");
    expect(note.textContent).toContain(
      "This browser blocked reading the clipboard. Press Ctrl+V with the picker open to paste.",
    );
  });

  it("fills the draft from the clipboard read by the paste button", async () => {
    stubReadText(() => Promise.resolve(PAYLOAD));
    createWrapper();
    await openMenu();

    await wrapper!.vm.pasteRange();
    await flushPromises();
    wrapper!.vm.submitDraft();
    await flushPromises();

    expect(lastEmit()).toMatchObject({
      startTime: START_US,
      endTime: END_US,
      userChangedValue: true,
    });
  });

  it.each([
    ["an empty", ""],
    ["a whitespace-only", "  \n\t "],
  ])("says the clipboard is empty when the paste button reads %s clipboard", async (_, text) => {
    stubReadText(() => Promise.resolve(text));
    createWrapper();
    await openMenu();
    const emitsBefore = emitCount();

    await wrapper!.vm.pasteRange();
    await flushPromises();

    const note = menuEl("date-time-range-note")!;
    expect(note.getAttribute("data-reason")).toBe("empty");
    expect(note.textContent).toContain("Clipboard is empty. Copy a date range first.");
    expect(emitCount()).toBe(emitsBefore);
  });

  it("says why a paste could not be read and leaves the draft alone", async () => {
    createWrapper();
    await openMenu();
    const before = { ...wrapper!.vm.draft.start };

    wrapper!.vm.onFieldPaste("hello there");
    await flushPromises();

    const note = menuEl("date-time-range-note")!;
    expect(note.getAttribute("data-reason")).toBe("no-date");
    expect(note.textContent).toContain("“hello there”");
    expect(wrapper!.vm.panelDraft).toBeNull();
    expect(wrapper!.vm.draft.start.date).toBe(before.date);
  });

  it("puts the previous draft back on Undo", async () => {
    createWrapper();
    await openMenu();
    const before = JSON.parse(JSON.stringify(wrapper!.vm.draft));

    wrapper!.vm.onFieldPaste(PAYLOAD);
    await flushPromises();
    (menuEl("date-time-range-note-undo") as HTMLButtonElement).click();
    await flushPromises();

    expect(wrapper!.vm.draft).toEqual(before);
    expect(menuEl("date-time-range-note")).toBeNull();
  });

  it("opens on the range field with its text selected, so a paste replaces it", async () => {
    createWrapper({ calendarPresets: false });
    await openMenu();
    const autoFocus = new Event("focus", { cancelable: true });

    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);
    await flushPromises();

    const input = document.querySelector<HTMLInputElement>(
      '#date-time-menu [data-test="date-time-range-input"] input',
    )!;
    expect(autoFocus.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});
