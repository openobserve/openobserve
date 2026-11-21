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

import { defineComponent, effectScope, h, KeepAlive, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { localeFileMap } from "@/locales";
import {
  formatDay,
  formatInstant,
  formatRangeText,
  formatSpan,
  readPickerText,
  timeRangeLocaleOf,
  useTimeRangeInput,
} from "@/composables/useTimeRangeInput";
import { MAX_RANGE_TEXT_UNITS } from "@/utils/date";
import { loadTimeRangeLocale, type RelativeUnit } from "@/utils/timeRangeInput";

const NOW_US = Date.parse("2026-11-18T13:32:00Z") * 1000;
const MIN_US = 60_000_000;

describe("useTimeRangeInput helpers", () => {
  it("maps every app locale to its own parser pack and anything else to English", () => {
    for (const key of Object.keys(localeFileMap)) expect(timeRangeLocaleOf(key)).toBe(key);
    expect(timeRangeLocaleOf("xx")).toBe("en-us");
    expect(timeRangeLocaleOf("constructor")).toBe("en-us");
    expect(timeRangeLocaleOf("toString")).toBe("en-us");
  });

  it("has a parser pack for every app locale, so none silently reads typed text as English", async () => {
    for (const key of Object.keys(localeFileMap)) {
      const pack = await loadTimeRangeLocale(timeRangeLocaleOf(key));
      expect(pack.locale).toBe(key);
    }
  });

  it.each([
    [15 * MIN_US, "15 min"],
    [90 * MIN_US, "1 hr 30 min"],
    [7 * 1440 * MIN_US, "7 days"],
    [30_000_000, "30 sec"],
    [250_000, "250 ms"],
    [1_500_000, "1.5 sec"],
    [1, "0.001 ms"],
    [59_999_600, "1 min"],
    [999_999, "999.999 ms"],
  ])("formats a span of %i µs as %s", (span, text) => {
    expect(formatSpan(span, "en-US")).toBe(text);
  });

  it("shows the milliseconds of an instant that has them", () => {
    const at = Date.parse("2026-11-18T13:20:05.250Z") * 1000;
    expect(formatInstant(at, "UTC", "en-US", NOW_US)).toBe("13:20:05.250");
    expect(formatInstant(at - 250_000, "UTC", "en-US", NOW_US)).toBe("13:20:05");
  });

  it("shows milliseconds in a range only between stamps under a minute apart", () => {
    const at = Date.parse("2026-11-18T13:20:05.250Z") * 1000;
    expect(formatRangeText(at, at + 500_000, "UTC", "en-US", NOW_US)).toBe(
      "13:20:05.250 → 13:20:05.750",
    );
    expect(formatRangeText(at - 15 * MIN_US, at, "UTC", "en-US", NOW_US)).toBe(
      "13:05:05 → 13:20:05",
    );
  });

  it("tells apart endpoints that share a millisecond", () => {
    const at = Date.parse("2026-11-18T09:20:05.250Z") * 1000;
    expect(formatRangeText(at + 1, at + 999, "UTC", "en-US", NOW_US)).toBe(
      "09:20:05.250001 → 09:20:05.250999",
    );
  });

  it("tells apart same-millisecond ends when only the start names its day", () => {
    const at = Date.parse("2026-11-17T09:20:05.250Z") * 1000;
    expect(formatRangeText(at + 1, at + 999, "UTC", "en-US", NOW_US)).toBe(
      "Tue, Nov 17, 09:20:05.250001 → 09:20:05.250999",
    );
  });

  it("tells apart same-millisecond ends when only one has a fraction", () => {
    const at = Date.parse("2026-11-18T09:20:05Z") * 1000;
    expect(formatRangeText(at, at + 1, "UTC", "en-US", NOW_US)).toBe(
      "09:20:05.000000 → 09:20:05.000001",
    );
  });

  it("tells apart the two passes of a repeated hour by their offsets", () => {
    const start = Date.parse("2026-11-01T05:30:00Z") * 1000;
    expect(formatRangeText(start, start + 60 * MIN_US, "America/New_York", "en-US", NOW_US)).toBe(
      "Sun, Nov 1, 01:30 -04:00 → 01:30 -05:00",
    );
  });

  it("writes the microsecond digits in the locale's own numerals", () => {
    const at = Date.parse("2026-11-18T09:20:05.250Z") * 1000;
    const text = formatRangeText(at + 1, at + 999, "UTC", "ar-SA", NOW_US);
    expect(text).not.toMatch(/[0-9]/);
    expect(text).toContain("٠٠١");
  });

  it("formats the day of an instant without its time", () => {
    const at = Date.parse("2026-11-01T05:30:00.020Z") * 1000;
    expect(formatDay(at, "America/New_York", "en-US", NOW_US)).toBe("Sun, Nov 1");
    expect(formatDay(at - 365 * 1440 * MIN_US, "UTC", "en-US", NOW_US)).toBe("Sat, Nov 1, 2025");
  });

  it("names the day only for a range off today and repeats it only when the end differs", () => {
    const today = formatRangeText(NOW_US - 15 * MIN_US, NOW_US, "Europe/Berlin", "en-US", NOW_US);
    expect(today).toBe("14:17 → 14:32");
    const earlier = formatRangeText(
      Date.parse("2026-11-03T13:00:00Z") * 1000,
      Date.parse("2026-11-05T08:30:00Z") * 1000,
      "Europe/Berlin",
      "en-US",
      NOW_US,
    );
    expect(earlier).toBe("Tue, Nov 3, 14:00 → Thu, Nov 5, 09:30");
  });

  it("reads pasted text with the picker's limits", async () => {
    const res = await readPickerText("200h", {
      locale: "en-us",
      zone: "UTC",
      units: ["s", "m", "h", "d", "w", "M"],
      kinds: { relative: true, calendar: true, absolute: true },
      limits: { allowFuture: false, maxSpanUs: 72 * 60 * MIN_US },
    });
    expect(res.state).toBe("blocked");
  });
});

describe("useTimeRangeInput review fixes", () => {
  const context = (locale: string) => () => ({
    locale,
    zone: "UTC",
    units: ["s", "m", "h", "d", "w", "M"] as RelativeUnit[],
    kinds: { relative: true, calendar: true, absolute: true },
    limits: { allowFuture: false },
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is ready only once the locale's own pack has loaded", async () => {
    const scope = effectScope();
    const fr = scope.run(() => useTimeRangeInput({ context: context("fr") }))!;
    const en = scope.run(() => useTimeRangeInput({ context: context("en-us") }))!;

    expect(en.ready.value).toBe(true);
    expect(fr.ready.value).toBe(false);
    await vi.waitFor(() => expect(fr.ready.value).toBe(true));
    expect(fr.pack.value.locale).toBe("fr");
    scope.stop();
  });

  it("lets a future verdict expire once the clock passes the end", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-08T03:00:00Z"));
    const scope = effectScope();
    const bar = scope.run(() => useTimeRangeInput({ context: context("en-us") }))!;
    bar.setText("2026-10-08T02:00:00+00:00 - 2026-10-08T03:00:20+00:00");
    expect(bar.result.value.state).toBe("blocked");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(bar.result.value.state).toBe("valid");
    scope.stop();
  });
  it("reuses its Intl formatters when the same rows are formatted again", () => {
    const format = () => {
      formatRangeText(NOW_US - 90 * MIN_US, NOW_US, "Asia/Tokyo", "de-DE", NOW_US);
      formatSpan(90 * MIN_US, "de-DE");
    };
    format();
    const dates = vi.spyOn(Intl, "DateTimeFormat");
    const numbers = vi.spyOn(Intl, "NumberFormat");
    format();

    expect(dates).not.toHaveBeenCalled();
    expect(numbers).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("refuses text over the parser's cap as too long without keeping it", () => {
    const scope = effectScope();
    const bar = scope.run(() => useTimeRangeInput({ context: context("en-us") }))!;
    bar.setText("15m");
    bar.setText("1".repeat(MAX_RANGE_TEXT_UNITS + 1), "paste");

    expect(bar.text.value).toBe("15m");
    expect(bar.result.value).toMatchObject({ state: "invalid", reason: "too-long" });
    bar.setText("2h");
    expect(bar.result.value.state).toBe("valid");
    scope.stop();
  });

  it("stops the future clock while its view is kept alive and resumes it on return", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-08T03:00:00Z"));
    let bar: ReturnType<typeof useTimeRangeInput> | null = null;
    const Child = defineComponent({
      setup() {
        bar = useTimeRangeInput({ context: context("en-us") });
        return () => h("div");
      },
    });
    const shown = ref(true);
    const host = mount(
      defineComponent({ setup: () => () => h(KeepAlive, null, shown.value ? h(Child) : null) }),
    );
    bar!.setText("2026-10-08T02:00:00+00:00 - 2026-10-08T03:05:00+00:00");
    await nextTick();
    expect(vi.getTimerCount()).toBe(1);

    shown.value = false;
    await nextTick();
    expect(vi.getTimerCount()).toBe(0);

    shown.value = true;
    await nextTick();
    expect(vi.getTimerCount()).toBe(1);
    host.unmount();
  });
});
