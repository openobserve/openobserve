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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const START = Date.parse("2026-11-04T00:00:00Z") * 1000;
const END = Date.parse("2026-11-05T00:00:00Z") * 1000;
const ABSOLUTE = {
  disableRelative: true,
  autoApply: true,
  defaultAbsoluteTime: { startTime: START, endTime: END },
};

describe("DateTime pickerTimezone and hideClipboard", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: { ...ABSOLUTE, ...props },
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };
  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as { startTime: number; endTime: number };
  };
  const inMenu = (dataTest: string) =>
    document.body.querySelector(`#date-time-menu [data-test="${dataTest}"]`);

  beforeEach(() => {
    store.state.timezone = "UTC";
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("starts on the given zone and shows its wall clock", async () => {
    createWrapper({ pickerTimezone: "Asia/Calcutta" });
    await flushPromises();
    expect(wrapper!.vm.selectedTime.startTime).toBe("05:30:00");
    expect(wrapper!.vm.timezone).toBe("Asia/Calcutta");
    expect(lastEmit().startTime).toBe(START);
  });

  /// A zone picked here changes this range only, never the timezone every other page reads.
  it("re-reads the shown times in a newly picked zone without touching the app's", async () => {
    const dispatch = store.dispatch;
    const calls: unknown[][] = [];
    store.dispatch = ((...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve();
    }) as typeof store.dispatch;
    try {
      createWrapper({ pickerTimezone: "Asia/Calcutta" });
      await flushPromises();
      wrapper!.vm.timezone = "UTC";
      await wrapper!.vm.onTimezoneChange();
      await flushPromises();

      expect(lastEmit().startTime).toBe(START + 5.5 * 3_600_000_000);
      expect(wrapper!.emitted("on:timezone-change")!.at(-1)).toEqual(["UTC"]);
      expect(store.state.timezone).toBe("UTC");
      expect(calls.some((call) => call[0] === "setTimezone")).toBe(false);
    } finally {
      store.dispatch = dispatch;
    }
  });

  it("drops the copy and paste row but keeps the zone select and the hint", async () => {
    createWrapper({ pickerTimezone: "Asia/Calcutta", hideClipboard: true, defaultOpen: true });
    await flushPromises();
    expect(inMenu("date-time-copy-btn")).toBeNull();
    expect(inMenu("date-time-paste-btn")).toBeNull();
    expect(inMenu("datetime-timezone-select")).not.toBeNull();
    expect(document.body.textContent).toContain("You can choose multiple dates");
  });

  it("keeps copy and paste and reads the app's zone by default", async () => {
    store.state.timezone = "Asia/Calcutta";
    createWrapper({ defaultOpen: true });
    await flushPromises();
    expect(wrapper!.vm.selectedTime.startTime).toBe("05:30:00");
    expect(inMenu("date-time-copy-btn")).not.toBeNull();
    expect(inMenu("date-time-paste-btn")).not.toBeNull();
  });
});
