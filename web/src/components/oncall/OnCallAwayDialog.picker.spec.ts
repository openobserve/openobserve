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
import OnCallAwayDialog from "@/components/oncall/OnCallAwayDialog.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import { nextWeekRange, zonedMidnight } from "@/utils/oncall";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

const IST = "Asia/Kolkata";
const NOW = new Date("2026-11-09T03:33:00Z");
const NOW_US = NOW.getTime() * 1000;

// The real OFormDateTimeRange and DateTime, so the window the form holds is the one the picker emitted.
const stubs = {
  ODialog: { name: "ODialog", props: ["open"], template: "<div v-if='open'><slot /></div>" },
  OFormInput: true,
  OAvatar: true,
  OnCallZoneInfo: true,
  OnCallPersonName: true,
};

describe("OnCallAwayDialog with the real time range picker", () => {
  let wrapper: VueWrapper | null = null;

  const render = () => {
    wrapper = mount(OnCallAwayDialog, {
      props: { open: true, email: "ana@o2.ai", timezone: IST },
      attachTo: document.body,
      global: { plugins: [i18n, store], stubs },
    });
    return wrapper;
  };

  const lastPickerEmit = () => {
    const events = wrapper!.findComponent(DateTime).emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    toastMock.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("keeps the default window that runs a day ahead", async () => {
    render();
    await flushPromises();

    expect(lastPickerEmit()).toMatchObject({
      valueType: "absolute",
      startTime: NOW_US,
      endTime: NOW_US + MICROS_PER_DAY,
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "tomorrow",
      () => ({ from: zonedMidnight(NOW_US, IST, 1), to: zonedMidnight(NOW_US, IST, 2) }),
    ],
    ["next-week", () => nextWeekRange(NOW_US, IST)],
  ])("keeps the %s preset instead of falling back", async (key, range) => {
    render();
    await flushPromises();

    await wrapper!.find(`[data-test="oncall-members-away-preset-${key}"]`).trigger("click");
    await flushPromises();

    const { from, to } = range();
    expect(lastPickerEmit()).toMatchObject({ valueType: "absolute", startTime: from, endTime: to });
    expect(toastMock).not.toHaveBeenCalled();
  });
});
