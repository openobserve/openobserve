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

  const lastToast = () => toastMock.mock.calls[toastMock.mock.calls.length - 1][0];

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

  it("keeps the default focus inside the panel when the rail has nothing to focus", async () => {
    localStorage.clear();
    createWrapper({ calendarPresets: false });
    await openMenu();
    const autoFocus = new Event("focus", { cancelable: true });

    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);

    expect(autoFocus.defaultPrevented).toBe(false);
  });

  it("moves focus to the first rail item when there is one", async () => {
    createWrapper();
    await openMenu();
    const autoFocus = new Event("focus", { cancelable: true });

    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);

    expect(autoFocus.defaultPrevented).toBe(true);
    expect(document.activeElement?.hasAttribute("data-date-time-rail-item")).toBe(true);
  });
});
