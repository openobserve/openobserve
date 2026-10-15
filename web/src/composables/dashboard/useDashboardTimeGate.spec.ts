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

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { effectScope, nextTick, ref, type EffectScope, type Ref } from "vue";
import { ABSOLUTE_APPLY_DEBOUNCE_MS, useDashboardTimeGate } from "./useDashboardTimeGate";

const relative = (period: string) => ({
  valueType: "relative",
  relativeTimePeriod: period,
  startTime: 1,
  endTime: 2,
});

const absolute = (startTime: number, endTime: number) => ({
  valueType: "absolute",
  relativeTimePeriod: null,
  startTime,
  endTime,
});

const START = relative("15m");

describe("useDashboardTimeGate", () => {
  let scope: EffectScope;
  let autoRun: Ref<boolean | undefined>;
  let onAutoApply: Mock<(value: unknown) => void>;

  const createGate = (applied = ref<any>(null)) => {
    const gate = scope.run(() =>
      useDashboardTimeGate({ applied, isAutoRunOn: () => autoRun.value === true, onAutoApply }),
    )!;
    gate.onPick(START);
    return gate;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    scope = effectScope();
    autoRun = ref<boolean | undefined>(true);
    onAutoApply = vi.fn();
  });

  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
  });

  describe("starting range", () => {
    it("takes the first range a picker reports as the applied one, with Auto Run off too", () => {
      autoRun.value = false;
      const gate = createGate();

      expect(gate.applied.value).toEqual(START);
      expect(gate.picked.value).toEqual(START);
      expect(gate.isWaiting.value).toBe(false);
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("writes the starting range into the applied ref it was given", () => {
      const applied = ref<any>({ valueType: "relative", relativeTimePeriod: "15m" });
      createGate(applied);

      expect(applied.value).toEqual(START);
    });
  });

  describe("Auto Run on", () => {
    it("applies a relative preset at once", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(relative("1h"));

      expect(gate.applied.value).toEqual(relative("1h"));
      expect(gate.isWaiting.value).toBe(false);
      expect(onAutoApply).toHaveBeenCalledTimes(1);
      expect(onAutoApply).toHaveBeenCalledWith(relative("1h"));
    });

    it("holds an absolute edit made in the open picker for the Logs pause", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS - 1);

      expect(gate.applied.value).toEqual(START);
      expect(gate.isWaiting.value).toBe(true);

      vi.advanceTimersByTime(1);

      expect(gate.applied.value).toEqual(absolute(100, 200));
      expect(onAutoApply).toHaveBeenCalledTimes(1);
    });

    it("restarts the pause on every further edit and applies only the last one", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      vi.advanceTimersByTime(2000);
      gate.onPick(absolute(100, 300));
      vi.advanceTimersByTime(2000);

      expect(gate.applied.value).toEqual(START);

      vi.advanceTimersByTime(500);

      expect(gate.applied.value).toEqual(absolute(100, 300));
      expect(onAutoApply).toHaveBeenCalledTimes(1);
    });

    it("applies a held absolute edit at once when the picker closes", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      gate.onHide();

      expect(gate.applied.value).toEqual(absolute(100, 200));

      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);
      expect(onAutoApply).toHaveBeenCalledTimes(1);
    });

    it("applies an absolute range at once while the picker is closed, as the arrows produce", () => {
      const gate = createGate();

      gate.onPick(absolute(100, 200));

      expect(gate.applied.value).toEqual(absolute(100, 200));
    });

    it("applies a held range at once on flush, as a time zone change asks", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      gate.flush();

      expect(gate.applied.value).toEqual(absolute(100, 200));
    });

    it("does nothing on close or flush when no edit is held", () => {
      const gate = createGate();

      gate.onShow();
      gate.onHide();
      gate.flush();

      expect(gate.applied.value).toEqual(START);
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("drops the held edit when a preset is picked before the pause ends", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      gate.onPick(relative("1h"));
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

      expect(gate.applied.value).toEqual(relative("1h"));
      expect(onAutoApply).toHaveBeenCalledTimes(1);
    });
  });

  describe.each([
    ["off", false],
    ["unavailable", undefined],
  ])("Auto Run %s", (_label, state) => {
    beforeEach(() => {
      autoRun.value = state;
    });

    it("keeps a preset picked and waiting until it is applied", () => {
      const gate = createGate();

      gate.onPick(relative("1h"));
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS * 2);

      expect(gate.applied.value).toEqual(START);
      expect(gate.picked.value).toEqual(relative("1h"));
      expect(gate.isWaiting.value).toBe(true);
      expect(gate.needsRefresh.value).toBe(true);
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("keeps an absolute edit waiting through the pause and through closing the picker", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);
      gate.onHide();
      gate.flush();

      expect(gate.applied.value).toEqual(START);
      expect(gate.needsRefresh.value).toBe(true);
    });

    it("applies the waiting range on apply and tells the caller it changed", () => {
      const gate = createGate();
      gate.onPick(relative("1h"));

      expect(gate.apply()).toBe(true);

      expect(gate.applied.value).toEqual(relative("1h"));
      expect(gate.isWaiting.value).toBe(false);
      expect(gate.apply()).toBe(false);
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("applies the waiting range on refresh", () => {
      const gate = createGate();
      gate.onPick(relative("1h"));

      gate.refresh();

      expect(gate.applied.value).toEqual(relative("1h"));
    });
  });

  describe("refresh", () => {
    it("re-issues the applied range as a new object when nothing waits", () => {
      const gate = createGate();
      const before = gate.applied.value;

      gate.refresh();

      expect(gate.applied.value).toEqual(before);
      expect(gate.applied.value).not.toBe(before);
    });
  });

  describe("a broken range", () => {
    it.each([
      ["an empty start", { valueType: "absolute", startTime: NaN, endTime: 200 }],
      ["an empty end", { valueType: "absolute", startTime: 100, endTime: NaN }],
      ["a start after its end", absolute(300, 200)],
      ["a start equal to its end", absolute(200, 200)],
      ["a relative range without a period", { valueType: "relative", relativeTimePeriod: "m" }],
    ])("never applies and never waits: %s", (_label, broken) => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(broken);
      gate.onHide();
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

      expect(gate.isWaiting.value).toBe(false);
      expect(gate.needsRefresh.value).toBe(false);
      expect(gate.apply()).toBe(false);
      expect(gate.applied.value).toEqual(START);
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("cancels a held edit when the next edit breaks the range", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      gate.onPick(absolute(300, 200));
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

      expect(gate.applied.value).toEqual(START);
    });

    it("does not wait while Auto Run is off", () => {
      autoRun.value = false;
      const gate = createGate();

      gate.onPick(absolute(300, 200));

      expect(gate.needsRefresh.value).toBe(false);
    });
  });

  describe("picking the applied range again", () => {
    it("clears waiting without applying anything, when Auto Run is off", () => {
      autoRun.value = false;
      const gate = createGate();
      const before = gate.applied.value;

      gate.onPick(relative("1h"));
      gate.onPick(relative("15m"));

      expect(gate.isWaiting.value).toBe(false);
      expect(gate.apply()).toBe(false);
      expect(gate.applied.value).toBe(before);
    });

    it("treats a relative range as its period, whatever window it resolved to", () => {
      autoRun.value = false;
      const gate = createGate();

      gate.onPick({ ...relative("15m"), startTime: 900, endTime: 1800 });

      expect(gate.isWaiting.value).toBe(false);
    });

    it("cancels a held edit when the fields are edited back to the applied range", () => {
      const gate = createGate();
      gate.onPick(absolute(100, 200));
      onAutoApply.mockClear();

      gate.onShow();
      gate.onPick(absolute(100, 300));
      gate.onPick(absolute(100, 200));
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

      expect(gate.applied.value).toEqual(absolute(100, 200));
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("compares an applied range read from the URL as numbers", () => {
      autoRun.value = false;
      const applied = ref<any>(null);
      const gate = createGate(applied);
      gate.onPick(absolute(100, 200));
      gate.apply();

      applied.value = { valueType: "absolute", startTime: "100", endTime: "200" };

      expect(gate.isWaiting.value).toBe(false);
    });
  });

  describe("turning Auto Run on or off", () => {
    it("applies a waiting range when Auto Run is turned on", async () => {
      autoRun.value = false;
      const gate = createGate();
      gate.onPick(relative("1h"));

      autoRun.value = true;
      await nextTick();

      expect(gate.applied.value).toEqual(relative("1h"));
      expect(gate.isWaiting.value).toBe(false);
      expect(onAutoApply).toHaveBeenCalledTimes(1);
    });

    it("applies nothing when Auto Run is turned on with no range waiting", async () => {
      autoRun.value = false;
      const gate = createGate();
      const before = gate.applied.value;

      autoRun.value = true;
      await nextTick();

      expect(gate.applied.value).toBe(before);
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("keeps a held edit waiting when Auto Run is turned off before the pause ends", async () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      autoRun.value = false;
      await nextTick();
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

      expect(gate.applied.value).toEqual(START);
      expect(gate.needsRefresh.value).toBe(true);
    });

    it("shows no refresh signal for a range Auto Run is still holding", () => {
      const gate = createGate();

      gate.onShow();
      gate.onPick(absolute(100, 200));

      expect(gate.isWaiting.value).toBe(true);
      expect(gate.needsRefresh.value).toBe(false);
    });
  });

  it("keeps its own applied range when the caller passes none", () => {
    autoRun.value = false;
    const gate = scope.run(() => useDashboardTimeGate({ isAutoRunOn: () => false }))!;

    gate.onPick(START);
    gate.onPick(relative("1h"));

    expect(gate.applied.value).toEqual(START);
    expect(gate.apply()).toBe(true);
    expect(gate.applied.value).toEqual(relative("1h"));
  });

  describe("closing the picker on a broken range", () => {
    let showInPicker: ReturnType<typeof vi.fn>;

    const createGateShowingRanges = () => {
      showInPicker = vi.fn();
      const gate = scope.run(() =>
        useDashboardTimeGate({
          isAutoRunOn: () => autoRun.value === true,
          onAutoApply,
          showInPicker,
        }),
      )!;
      gate.onPick(START);
      return gate;
    };

    it.each([
      ["on", true],
      ["off", false],
    ])("puts the picker back on the applied range with Auto Run %s", (_label, isOn) => {
      autoRun.value = isOn;
      const gate = createGateShowingRanges();

      gate.onShow();
      gate.onPick(absolute(300 * 60, 200 * 60));
      gate.onHide();
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

      expect(showInPicker).toHaveBeenCalledTimes(1);
      expect(showInPicker).toHaveBeenCalledWith(START);
      expect(gate.picked.value).toEqual(START);
      expect(gate.applied.value).toEqual(START);
      expect(gate.isWaiting.value).toBe(false);
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("also resets an emptied field", () => {
      const gate = createGateShowingRanges();

      gate.onShow();
      gate.onPick({ valueType: "absolute", startTime: NaN, endTime: 200 });
      gate.onHide();

      expect(showInPicker).toHaveBeenCalledWith(START);
      expect(gate.picked.value).toEqual(START);
    });

    it("keeps an invalid range while the picker stays open", () => {
      const gate = createGateShowingRanges();

      gate.onShow();
      gate.onPick(absolute(300, 200));

      expect(showInPicker).not.toHaveBeenCalled();
      expect(gate.picked.value).toEqual(absolute(300, 200));
    });

    it("drops a held edit that was broken before the picker closed", () => {
      const gate = createGateShowingRanges();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      gate.onPick(absolute(300, 200));
      gate.onHide();
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

      expect(gate.applied.value).toEqual(START);
      expect(onAutoApply).not.toHaveBeenCalled();
    });

    it("leaves the picker alone when it closes on a valid range", () => {
      autoRun.value = false;
      const gate = createGateShowingRanges();

      gate.onShow();
      gate.onPick(absolute(100, 200));
      gate.onHide();

      expect(showInPicker).not.toHaveBeenCalled();
      expect(gate.needsRefresh.value).toBe(true);
    });
  });

  describe("an applied range set from outside the picker", () => {
    it("replaces a waiting range on adopt, so nothing waits and Refresh applies nothing old", () => {
      autoRun.value = false;
      const applied = ref<any>(null);
      const gate = createGate(applied);
      gate.onPick(relative("1h"));

      applied.value = relative("6h");
      gate.adopt();

      expect(gate.picked.value).toEqual(relative("6h"));
      expect(gate.isWaiting.value).toBe(false);
      expect(gate.apply()).toBe(false);
      expect(applied.value).toEqual(relative("6h"));
    });

    it("drops a held absolute edit on adopt", () => {
      const applied = ref<any>(null);
      const gate = createGate(applied);
      gate.onShow();
      gate.onPick(absolute(100, 200));

      applied.value = relative("6h");
      gate.adopt();
      vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

      expect(applied.value).toEqual(relative("6h"));
      expect(onAutoApply).not.toHaveBeenCalled();
    });
  });

  it("drops a held edit when its scope is disposed", () => {
    const gate = createGate();

    gate.onShow();
    gate.onPick(absolute(100, 200));
    scope.stop();
    vi.advanceTimersByTime(ABSOLUTE_APPLY_DEBOUNCE_MS);

    expect(gate.applied.value).toEqual(START);
    expect(onAutoApply).not.toHaveBeenCalled();
  });
});
