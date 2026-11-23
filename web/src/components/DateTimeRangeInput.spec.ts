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

import DateTimeRangeInput from "@/components/DateTimeRangeInput.vue";
import i18n from "@/locales";
import {
  loadTimeRangeLocale,
  type TimeRangeLocale,
  type TimeRangeReading,
} from "@/utils/timeRangeInput";
import { MAX_RANGE_TEXT_UNITS } from "@/utils/date";
import { addMonths } from "@/utils/timeRangeInput/civil";
import { offsetAtInstant, offsetLabel, resolveCivil, wallAt } from "@/utils/timeRangeInput/zone";
import { barInput, el, press, typeInBar } from "@/test/unit/helpers/dateTimePicker";

const NOW = new Date("2026-10-08T03:00:00Z");
const NOW_US = NOW.getTime() * 1000;
const NY = "America/New_York";

type Bar = VueWrapper<InstanceType<typeof DateTimeRangeInput>>;

describe("DateTimeRangeInput", () => {
  let wrapper: Bar | null = null;

  const create = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTimeRangeInput, {
      props: {
        zone: "UTC",
        locale: "en-us",
        intlLocale: "en-US",
        applied: { startUs: NOW_US - 900_000_000, endUs: NOW_US },
        limits: { allowFuture: false, maxSpanUs: 72 * 3_600_000_000 },
        kinds: { relative: true, calendar: true, absolute: true },
        units: ["s", "m", "h", "d", "w", "M"],
        canCopy: true,
        spanLimit: "3 days",
        ...props,
      },
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    return wrapper;
  };

  const applied = () =>
    (wrapper!.emitted("apply") ?? []).map((args) => args[0] as TimeRangeReading);
  const copyBtn = () => el<HTMLButtonElement>("date-time-copy-btn")!;
  const pasteBtn = () => el<HTMLButtonElement>("date-time-paste-btn")!;
  const state = () => el("date-time-range-status")!.getAttribute("data-state");

  beforeEach(() => {
    // A frozen clock makes Vue drop every listener after the first for one event, so it creeps instead.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("focuses its input on mount and shows the applied range", async () => {
    create();
    await flushPromises();

    expect(document.activeElement).toBe(barInput());
    expect(state()).toBe("empty");
    expect(el("date-time-range-status")!.textContent).toContain("Applied");
    expect(el("date-time-range-resolved")!.querySelector("bdi")!.textContent).toContain("→");
    expect(el("date-time-range-duration")!.textContent).toContain("15 min");
  });

  it("previews a valid reading and applies it on Enter", async () => {
    create();
    await typeInBar("2h");

    expect(state()).toBe("valid");
    expect(el("date-time-range-name")!.textContent).toBe("Last 2 hours");
    expect(el("date-time-range-enter-hint")).not.toBeNull();
    const event = await press(barInput(), "Enter");

    expect(event.defaultPrevented).toBe(true);
    expect(applied()).toHaveLength(1);
    expect(applied()[0].rolling).toEqual({ value: 2, unit: "h" });
  });

  it("ignores Enter while an IME composition is open", async () => {
    create();
    await typeInBar("2h");
    await press(barInput(), "Enter", { isComposing: true });
    await press(barInput(), "Enter", { keyCode: 229 });

    expect(applied()).toHaveLength(0);
  });

  it("applies nothing on Enter for an ambiguous text until a row is picked", async () => {
    create();
    await typeInBar("15M");

    expect(state()).toBe("ambiguous");
    expect(el("date-time-range-reading-0")!.getAttribute("aria-selected")).toBe("false");
    await press(barInput(), "Enter");
    expect(applied()).toHaveLength(0);

    await press(barInput(), "ArrowDown");
    expect(el("date-time-range-reading-0")!.getAttribute("aria-selected")).toBe("true");
    expect(barInput()!.getAttribute("aria-activedescendant")).toBe(
      el("date-time-range-reading-0")!.id,
    );
    await press(barInput(), "Enter");

    expect(applied()).toHaveLength(1);
    expect(applied()[0].rolling).toEqual({ value: 15, unit: "m" });
  });

  it("names Enter's affordance for screen readers and on hover", async () => {
    create();
    await typeInBar("2h");

    expect(el("date-time-range-enter-hint")!.getAttribute("aria-label")).toBe(
      "Press Enter to apply",
    );
  });

  it("refreshes the selected row when clicked after two minutes", async () => {
    create();
    await typeInBar("15M");
    const commitTime = NOW.getTime() + 120_000;
    vi.setSystemTime(commitTime);
    el("date-time-range-reading-0")!.click();
    expect(applied()[0].rolling).toEqual({ value: 15, unit: "m" });
    expect(applied()[0].endUs).toBeGreaterThanOrEqual(commitTime * 1000);
    expect(applied()[0].endUs).toBeLessThanOrEqual(Date.now() * 1000);
  });

  it("links invalid and blocked input to the visible message", async () => {
    create();
    for (const text of ["unreadable", "200h"]) {
      await typeInBar(text);
      const field = barInput()!;
      expect(field.getAttribute("aria-invalid")).toBe("true");
      const description = document.getElementById(field.getAttribute("aria-describedby") ?? "");
      expect(description?.textContent).toContain(el("date-time-range-message")!.textContent);
    }
    await typeInBar("2h");
    expect(barInput()!.hasAttribute("aria-invalid")).toBe(false);
    expect(barInput()!.hasAttribute("aria-describedby")).toBe(false);
  });

  it.each([
    ["en-us", "en-US", "Month first, as in your language", "Day first", Date.UTC(2026, 2, 4)],
    ["vi", "vi-VN", "Day first, as in your language", "Month first", Date.UTC(2026, 3, 3)],
    ["ar", "ar-SA", "Day first, as in your language", "Month first", Date.UTC(2026, 3, 3)],
  ])(
    "labels the day-month readings in %s with its own order first",
    async (locale, intlLocale, first, second, firstStartMs) => {
      await loadTimeRangeLocale(locale as TimeRangeLocale);
      create({ locale, intlLocale });
      await flushPromises();
      await typeInBar("03/04/2026");

      expect(state()).toBe("ambiguous");
      expect(el("date-time-range-reading-0")!.textContent).toContain(first);
      expect(el("date-time-range-reading-1")!.textContent).toContain(second);
      await press(barInput(), "ArrowDown");
      await press(barInput(), "Enter");
      expect(applied()[0].startUs).toBe(firstStartMs * 1000);
    },
  );

  it("labels the day-month rows by the pack that read them, not the display locale", async () => {
    create({ locale: "en-us", intlLocale: "vi-VN" });
    await flushPromises();
    await typeInBar("03/04/2026");

    expect(el("date-time-range-reading-0")!.textContent).toContain(
      "Month first, as in your language",
    );
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(applied()[0].startUs).toBe(Date.UTC(2026, 2, 4) * 1000);
  });

  it("offers the longest allowed range for a text over the limit", async () => {
    create();
    await typeInBar("200h");

    expect(state()).toBe("blocked");
    expect(el("date-time-range-message")!.textContent).toBe(
      "Longer than this stream's query limit of 3 days.",
    );
    expect(el("date-time-range-reading-0")!.textContent).toContain("Longest allowed");
    await press(barInput(), "Enter");
    expect(applied()).toHaveLength(0);
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(applied()[0].endUs - applied()[0].startUs).toBe(72 * 3_600_000_000);
  });

  it("clears the text on the first Escape and lets the second close the picker", async () => {
    create();
    await typeInBar("2h");
    const first = await press(barInput(), "Escape");

    expect(first.defaultPrevented).toBe(true);
    expect(barInput()!.value).toBe("");

    const second = await press(barInput(), "Escape");
    expect(second.defaultPrevented).toBe(false);
  });

  it("tells the host when its text blocks Apply", async () => {
    create();
    await typeInBar("garbage text");
    await typeInBar("2h");
    await typeInBar("");

    expect(wrapper!.emitted("dirty")).toEqual([[true], [false]]);
  });

  it.each([
    ["valid", "2h"],
    ["ambiguous", "15M"],
    ["blocked", "200h"],
    ["invalid", "garbage text"],
    ["incomplete", "last"],
  ])("turns Copy off and keeps Paste on in the %s state", async (expected, text) => {
    create();
    await typeInBar(text);

    expect(state()).toBe(expected);
    expect(copyBtn().disabled).toBe(true);
    expect(pasteBtn().disabled).toBe(false);
  });

  it("turns Copy off when the selection fails the picker's gate", async () => {
    create({ canCopy: false });
    await flushPromises();

    expect(state()).toBe("empty");
    expect(copyBtn().disabled).toBe(true);
    expect(pasteBtn().disabled).toBe(false);
  });

  it("puts Copy and Paste after the status, in tab order after the input", async () => {
    create();
    await flushPromises();
    const actions = el("date-time-range-actions")!;
    const status = el("date-time-range-status")!;

    expect(actions.contains(copyBtn())).toBe(true);
    expect(actions.contains(pasteBtn())).toBe(true);
    expect(status.contains(copyBtn())).toBe(false);
    const order = [barInput()!, copyBtn(), pasteBtn()];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("emits copy and paste once per click", async () => {
    create();
    await flushPromises();
    copyBtn().click();
    pasteBtn().click();

    expect(wrapper!.emitted("copy")).toHaveLength(1);
    expect(wrapper!.emitted("paste")).toHaveLength(1);
  });

  it("previews pasted text set by the host and focuses it", async () => {
    create();
    await flushPromises();
    (document.activeElement as HTMLElement).blur();
    wrapper!.vm.setText("2026-10-08T01:00:00Z", "paste");
    await flushPromises();

    expect(barInput()!.value).toBe("2026-10-08T01:00:00Z");
    expect(document.activeElement).toBe(barInput());
    expect(el("date-time-range-note")!.textContent).toContain("either side of");
  });
});

describe("DateTimeRangeInput review fixes", () => {
  let wrapper: Bar | null = null;

  const create = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTimeRangeInput, {
      props: {
        zone: "UTC",
        locale: "en-us",
        intlLocale: "en-US",
        applied: null,
        limits: { allowFuture: false },
        kinds: { relative: true, calendar: true, absolute: true },
        units: ["s", "m", "h", "d", "w", "M"],
        canCopy: true,
        spanLimit: "",
        ...props,
      },
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    return wrapper;
  };

  const applied = () =>
    (wrapper!.emitted("apply") ?? []).map((args) => args[0] as TimeRangeReading);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("selects the last row on the first Arrow Up", async () => {
    create();
    await typeInBar("15M");
    await press(barInput(), "ArrowUp");

    expect(el("date-time-range-reading-1")!.getAttribute("aria-selected")).toBe("true");
  });

  it("names each repeated-hour row by the offset at the typed instant", async () => {
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    create({ zone: "America/New_York" });
    await typeInBar("2026-11-01 01:02");

    expect(el("date-time-range-reading-0")!.textContent).toContain("UTC-04:00");
    expect(el("date-time-range-reading-1")!.textContent).toContain("UTC-05:00");
    expect(el("date-time-range-message")!.textContent).toContain("01:02");
  });

  it("waits for the locale's own pack before Enter applies", async () => {
    vi.setSystemTime(new Date("2026-10-08T17:00:00Z"));
    create({ locale: "fr", intlLocale: "fr-FR" });
    (wrapper!.vm as unknown as { setText: (t: string, s: string) => void }).setText("15h", "typed");
    await press(barInput(), "Enter");
    await vi.waitFor(() =>
      expect(el("date-time-range-status")!.getAttribute("data-state")).toBe("ambiguous"),
    );

    expect(applied()).toHaveLength(0);
  });
  const pasteIntoBar = (text: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    barInput()!.dispatchEvent(event);
    return event;
  };

  it("caps typing at the parser's limit and masks the bar in session replay", async () => {
    create();
    await flushPromises();

    expect(barInput()!.maxLength).toBe(MAX_RANGE_TEXT_UNITS);
    expect(el("date-time-range-bar")!.getAttribute("data-o2-privacy")).toBe("mask");
  });

  it("refuses an oversize native paste whole and shows the too-long state", async () => {
    create();
    await typeInBar("15m");
    barInput()!.setSelectionRange(3, 3);
    const event = pasteIntoBar("9".repeat(MAX_RANGE_TEXT_UNITS - 2));
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(barInput()!.value).toBe("15m");
    expect(el("date-time-range-status")!.getAttribute("data-state")).toBe("invalid");
    expect(el("date-time-range-message")!.textContent).toContain(
      "Too long to read as a time range",
    );
  });

  it("lets a paste that fits the cap through to the field", async () => {
    create();
    await flushPromises();
    const event = pasteIntoBar("2h");

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("DateTimeRangeInput polish fixes", () => {
  let wrapper: Bar | null = null;

  const capped = (reading: TimeRangeReading, startUs: number, startOffset: string) => ({
    ...reading,
    rolling: { unit: "M" as const, value: 120 },
    startUs,
    startOffset,
    name: undefined,
    notes: [],
    blocked: undefined,
  });
  // A cap whose start falls in a repeated hour yields both readings, as DateTime's does.
  const capRolling = (reading: TimeRangeReading): TimeRangeReading[] | null => {
    if (reading.rolling?.unit === "h" && reading.rolling.value > 87_600)
      return [
        {
          ...capped(reading, reading.endUs - 87_600 * 3_600_000_000, "+00:00"),
          rolling: { unit: "h", value: 87_600 },
        },
      ];
    if (!reading.rolling || reading.rolling.unit !== "M" || reading.rolling.value <= 120)
      return null;
    if (reading.startOffset === "+00:00")
      return [capped(reading, reading.endUs - 3653 * 86_400_000_000, "+00:00")];
    // The same wall time ten years back, as DateTime resolves it, in the New York zone the tests use.
    const at = resolveCivil(addMonths(wallAt(NY, reading.endUs), -120), NY)!;
    const offset = (us: number) => offsetLabel(offsetAtInstant(NY, us));
    if (at.kind !== "fold") return [capped(reading, at.us, offset(at.us))];
    return [
      capped(reading, at.earlier, offset(at.earlier)),
      capped(reading, at.later, offset(at.later)),
    ];
  };

  const create = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTimeRangeInput, {
      props: {
        zone: "UTC",
        locale: "en-us",
        intlLocale: "en-US",
        applied: null,
        limits: { allowFuture: false },
        kinds: { relative: true, calendar: true, absolute: true },
        units: ["s", "m", "h", "d", "w", "M"],
        canCopy: true,
        spanLimit: "",
        capRolling,
        ...props,
      },
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    return wrapper;
  };

  const applied = () =>
    (wrapper!.emitted("apply") ?? []).map((args) => args[0] as TimeRangeReading);
  const state = () => el("date-time-range-status")!.getAttribute("data-state");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("blocks a rolling range over the picker's cap and offers the capped one", async () => {
    create();
    await typeInBar("last 200 months");

    expect(state()).toBe("blocked");
    expect(el("date-time-range-message")!.textContent).toBe(
      "Longer than the picker's 10-year limit.",
    );
    const row = el("date-time-range-reading-0")!.textContent;
    expect(row).toContain("Last 120 months");
    expect(row).toContain("Longest allowed");
    await press(barInput(), "Enter");
    expect(applied()).toHaveLength(0);
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(applied()[0].rolling).toEqual({ unit: "M", value: 120 });
  });

  it("names each zone-abbreviation row by its offset without counting the readings", async () => {
    create();
    await typeInBar("2026-10-07 10:00 IST");

    expect(state()).toBe("ambiguous");
    expect(el("date-time-range-message")!.textContent).toBe(
      "This zone abbreviation names more than one zone. Pick one",
    );
    expect(el("date-time-range-reading-0")!.textContent).toContain("UTC+05:30");
    expect(el("date-time-range-reading-1")!.textContent).toContain("UTC+02:00");
  });

  it("does not call a range cut at now the longest allowed", async () => {
    create();
    await typeInBar("2026-10-08 02:00 to 2026-10-08 05:00");

    expect(state()).toBe("blocked");
    expect(el("date-time-range-reading-0")!.textContent).not.toContain("Longest allowed");
  });

  it("describes a stamp's window as it is when now cuts it short", async () => {
    create();
    await typeInBar("2026-10-08 02:59");
    expect(el("date-time-range-note")!.textContent).toBe("5 min before and 1 min after");

    vi.setSystemTime(new Date(NOW.getTime() + 20));
    await typeInBar("2026-10-08 03:00:00");
    expect(el("date-time-range-note")!.textContent).toBe("5 min before Thu, Oct 8, 03:00");

    await typeInBar("2026-10-08 01:00");
    expect(el("date-time-range-note")!.textContent).toBe("5 min either side of Thu, Oct 8, 01:00");
  });

  it("offers the capped range when a stream limit is over the picker's cap", async () => {
    create({ limits: { allowFuture: false, maxSpanUs: 100_000 * 3_600_000_000 } });
    await typeInBar("last 200 months");

    expect(state()).toBe("blocked");
    const row = el("date-time-range-reading-0")!;
    expect(row.getAttribute("aria-disabled")).toBeNull();
    expect(row.textContent).toContain("Last 120 months");
    expect(row.textContent).toContain("Longest allowed");
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(applied()[0].rolling).toEqual({ unit: "M", value: 120 });
  });

  it("names the capped row in the unit the user typed", async () => {
    create();
    await typeInBar("last 11 years");

    expect(state()).toBe("blocked");
    expect(el("date-time-range-reading-0")!.textContent).toContain("Last 10 years");
  });

  it("offers a capped fix for an over-cap range read in a repeated hour", async () => {
    // 01:30 on Nov 6, 2026 lands ten years back in the repeated hour of Nov 6, 2016.
    vi.setSystemTime(new Date("2026-11-06T06:30:00Z"));
    create({ zone: "America/New_York" });
    await typeInBar("last 11 years");

    expect(state()).toBe("blocked");
    expect(el("date-time-range-message")!.textContent).toBe(
      "Longer than the picker's 10-year limit.",
    );
    const first = el("date-time-range-reading-0")!;
    const second = el("date-time-range-reading-1")!;
    expect(first.getAttribute("aria-disabled")).toBeNull();
    expect(first.textContent).toContain("First time, UTC-04:00");
    expect(second.textContent).toContain("Second time, UTC-05:00");
    expect(second.textContent).toContain("Longest allowed");
    await press(barInput(), "ArrowDown");
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(applied()[0].startOffset).toBe("-05:00");
  });

  it("labels each zone row by the offset that differs between them", async () => {
    create();
    await typeInBar("2026-10-07 00:00Z to 2026-10-07 12:00 IST");

    expect(state()).toBe("ambiguous");
    expect(el("date-time-range-reading-0")!.textContent).toContain("UTC+05:30");
    expect(el("date-time-range-reading-1")!.textContent).toContain("UTC+02:00");
    expect(el("date-time-range-reading-2")!.textContent).toContain("UTC+01:00");
  });

  it("says a future stamp's window ends at now, before the stamp", async () => {
    create();
    await typeInBar("2026-10-08T03:04:59Z");

    expect(el("date-time-range-note")!.textContent).toBe(
      "Ends now, 4 min 59 sec before Thu, Oct 8, 03:04:59",
    );
  });

  it("names the typed stamp, not the window end, when it is in the future", async () => {
    create();
    await typeInBar("2026-10-08 12:00");

    expect(state()).toBe("blocked");
    expect(el("date-time-range-message")!.textContent).toBe("Thu, Oct 8, 12:00 is in the future.");
  });

  it("names a repeated hour once, without milliseconds, and the date alone", async () => {
    vi.setSystemTime(new Date("2026-11-02T06:30:00.020Z"));
    create({ zone: "America/New_York" });
    await typeInBar("last 1 day");

    expect(state()).toBe("ambiguous");
    expect(el("date-time-range-message")!.textContent).toBe(
      "01:30 happens twice on Sun, Nov 1. Pick one",
    );
  });

  it("offers the capped rolling range when the stream limit alone would allow over ten years", async () => {
    create({ limits: { allowFuture: false, maxSpanUs: 90_000 * 3_600_000_000 } });
    await typeInBar("last 11 years");

    expect(state()).toBe("blocked");
    expect(el("date-time-range-reading-0")!.textContent).toContain("Last 10 years");
    expect(el("date-time-range-reading-1")).toBeNull();
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(applied()[0]).toMatchObject({ kind: "rolling", rolling: { unit: "M", value: 120 } });
  });

  it("offers the capped range for an over-cap reading of an ambiguous unit", async () => {
    create();
    await typeInBar("200M");

    expect(state()).toBe("ambiguous");
    expect(el("date-time-range-reading-0")!.textContent).toContain("Last 200 minutes");
    const capped = el("date-time-range-reading-1")!;
    expect(capped.textContent).toContain("Last 120 months");
    expect(capped.getAttribute("aria-disabled")).toBeNull();
    await press(barInput(), "ArrowDown");
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(applied()[0].rolling).toEqual({ unit: "M", value: 120 });
  });

  it("names the end of a stamp's window cut by the latest allowed date, not now", async () => {
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    create({ limits: { allowFuture: false, maxEndUs: Date.UTC(2026, 9, 8) * 1000 } });
    await typeInBar("2026-10-08T00:02Z");

    expect(el("date-time-range-note")!.textContent).toBe("3 min before Thu, Oct 8, 00:00");
  });

  it("keeps the typed microseconds in the future message", async () => {
    create();
    await typeInBar("2026-10-08T12:06:00.000021Z");

    expect(el("date-time-range-message")!.textContent).toBe(
      "Thu, Oct 8, 12:06:00.000021 is in the future.",
    );
  });

  it("wraps a fix row whose label is its range on a narrow screen", async () => {
    create({ limits: { allowFuture: false, maxSpanUs: 3_600_000_000 } });
    await typeInBar("2026-10-07 00:00 to 2026-10-07 05:00");

    const label = el("date-time-range-reading-0")!.querySelector("span")!;
    expect(label.className).toContain("max-sm:whitespace-normal");
    expect(label.className).toContain("max-sm:basis-full");
  });

  it("shows no duration for an empty applied range", async () => {
    create({ applied: { startUs: NOW_US, endUs: NOW_US } });
    await flushPromises();

    expect(el("date-time-range-resolved")).not.toBeNull();
    expect(el("date-time-range-duration")).toBeNull();
  });
});
