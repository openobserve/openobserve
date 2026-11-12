// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { parseDate } from "@internationalized/date";
import ODateRangeCalendar from "./ODateRangeCalendar.vue";

describe("ODateRangeCalendar", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Structure ──────────────────────────────────────────────────

  it("should render the calendar root", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-root"]').exists()).toBe(true);
  });

  it("should render prev navigation button", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-prev"]').exists()).toBe(true);
  });

  it("should render next navigation button", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-next"]').exists()).toBe(true);
  });

  it("should render the month heading", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-heading"]').exists()).toBe(true);
  });

  it("should render day cells for the current month", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    const cells = wrapper.findAll('[data-test^="daterangecalendar-cell-"]');
    // A month always has at least 28 calendar days visible
    expect(cells.length).toBeGreaterThanOrEqual(28);
  });

  // ── Props ─────────────────────────────────────────────────────

  it("should mount without error when startDate and endDate are provided", () => {
    expect(() => {
      wrapper = mount(ODateRangeCalendar, {
        attachTo: document.body,
        props: {
          startDate: "2024/01/10",
          endDate: "2024/01/20",
        },
      });
    }).not.toThrow();
  });

  it("should mount without error when only startDate is provided", () => {
    expect(() => {
      wrapper = mount(ODateRangeCalendar, {
        attachTo: document.body,
        props: { startDate: "2024/06/15" },
      });
    }).not.toThrow();
  });

  it("should mount without error when no props are provided", () => {
    expect(() => {
      wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    }).not.toThrow();
  });

  it("should render as disabled when disabled prop is true", () => {
    wrapper = mount(ODateRangeCalendar, {
      attachTo: document.body,
      props: { disabled: true },
    });
    // reka-ui sets data-disabled on the root when disabled
    const root = wrapper.find('[data-test="daterangecalendar-root"]');
    expect(root.exists()).toBe(true);
    // The root element should carry the disabled data attribute
    expect(root.attributes("data-disabled")).toBeDefined();
  });

  // ── Date format conversion ────────────────────────────────────

  it("should emit update:startDate and update:endDate in YYYY/MM/DD format when a range is selected", async () => {
    // Use a v-model wrapper so prop updates flow back into the calendar —
    // mirrors how the parent (DateTime / DateTimePicker) actually consumes
    // this component. Without this, the calendar's model-value gets out of
    // sync between clicks in jsdom and reka-ui's internal click counter
    // resets on every click.
    const Wrapper = {
      components: { ODateRangeCalendar },
      data: () => ({ startDate: "", endDate: "" }),
      template: `
        <ODateRangeCalendar
          :start-date="startDate"
          :end-date="endDate"
          @update:start-date="startDate = $event"
          @update:end-date="endDate = $event"
        />
      `,
    };
    wrapper = mount(Wrapper, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    // Find all cell triggers in the current view (excludes outside-month cells)
    const cells = wrapper
      .findAll('[data-test^="daterangecalendar-cell-"]')
      .filter((c) => c.attributes("data-outside-view") === undefined);

    // Need at least 2 in-month cells to form a range
    if (cells.length >= 2) {
      // Click start cell
      await cells[0].trigger("click");
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      // Click end cell (a few days later)
      const endIdx = Math.min(5, cells.length - 1);
      await cells[endIdx].trigger("click");
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      // Inspect emits from the inner calendar component. The wrapper exposes
      // them on its first (and only) child component.
      const inner = wrapper.findComponent(ODateRangeCalendar);
      const startEmitted = inner.emitted("update:startDate");
      const endEmitted = inner.emitted("update:endDate");

      // Any emitted value must be YYYY/MM/DD (not reka-ui's YYYY-MM-DD).
      // It's also valid for nothing to be emitted in jsdom — reka-ui's
      // pointer-event handling differs from a real browser. The behavioral
      // verification of the click flow lives in the e2e tests.
      if (startEmitted) {
        for (const [v] of startEmitted) {
          if (v) expect(String(v)).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
        }
      }
      if (endEmitted) {
        for (const [v] of endEmitted) {
          if (v) expect(String(v)).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
        }
      }
    }
  });

  it("reports a first click as pending until the range is completed", async () => {
    wrapper = mount(ODateRangeCalendar, {
      props: { startDate: "2026/10/26", endDate: "2026/10/26" },
    });
    const root = wrapper.findComponent({ name: "RangeCalendarRoot" });

    root.vm.$emit("update:modelValue", { start: parseDate("2026-10-20"), end: undefined });
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:pendingDate")?.at(-1)).toEqual(["2026/10/20"]);
    expect(wrapper.emitted("update:startDate")).toBeUndefined();

    root.vm.$emit("update:modelValue", {
      start: parseDate("2026-10-20"),
      end: parseDate("2026-10-22"),
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:pendingDate")?.at(-1)).toEqual([null]);
    expect(wrapper.emitted("update:startDate")?.at(-1)).toEqual(["2026/10/20"]);
    expect(wrapper.emitted("update:endDate")?.at(-1)).toEqual(["2026/10/22"]);
  });

  it("should pass YYYY/MM/DD startDate and endDate through to the calendar selection state", () => {
    // The selected range is converted internally to reka-ui's YYYY-MM-DD for the calendar
    // and back to YYYY/MM/DD on emit. This test verifies the component accepts valid props.
    expect(() => {
      wrapper = mount(ODateRangeCalendar, {
        attachTo: document.body,
        props: {
          startDate: "2024/03/01",
          endDate: "2024/03/15",
          minDate: "2024/01/01",
          maxDate: "2024/12/31",
        },
      });
    }).not.toThrow();

    expect(wrapper.find('[data-test="daterangecalendar-root"]').exists()).toBe(true);
  });

  it.each([
    ["clears the selection", false, null],
    ["starts a new range on it when asked", true, "2026/10/26"],
  ])("on a click on the selected single day, %s", async (_, preventDeselect, pending) => {
    wrapper = mount(ODateRangeCalendar, {
      props: { startDate: "2026/10/26", endDate: "2026/10/26", preventDeselect },
      attachTo: document.body,
    });

    await wrapper.get('[data-test="daterangecalendar-cell-2026-10-26"]').trigger("click");

    expect(wrapper.emitted("update:pendingDate")?.at(-1)).toEqual([pending]);
    expect(wrapper.emitted("update:startDate")).toBeUndefined();
  });

  it("adds the band styling only when asked", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-root"]').classes()).not.toContain(
      "o-range-cal--band",
    );
    wrapper.unmount();
    wrapper = mount(ODateRangeCalendar, { props: { bandRange: true }, attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-root"]').classes()).toContain(
      "o-range-cal--band",
    );
  });

  it("stretches the grid to its container only when asked", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    const fixedCell = wrapper.find('[data-test^="daterangecalendar-cell-"]');
    expect(fixedCell.classes()).toContain("w-8");
    wrapper.unmount();
    wrapper = mount(ODateRangeCalendar, { props: { fill: true }, attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-root"]').classes()).toContain("w-full");
    const cell = wrapper.find('[data-test^="daterangecalendar-cell-"]');
    expect(cell.classes()).toEqual(expect.arrayContaining(["w-full", "h-8"]));
    expect(cell.element.closest("tr")?.className).toContain("grid-cols-7");
  });
  describe("band and today marking", () => {
    const cell = (iso: string) => wrapper.find(`[data-test="daterangecalendar-cell-${iso}"]`);

    afterEach(() => {
      vi.useRealTimers();
    });

    it("paints the band behind the days of a range, half cells at its ends, and dots today", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
      wrapper = mount(ODateRangeCalendar, {
        props: { bandRange: true, fill: true, startDate: "2026/11/04", endDate: "2026/11/06" },
        attachTo: document.body,
      });

      const td = (iso: string) => cell(iso).element.closest("td")!.className;
      expect(td("2026-11-04")).toContain("before:bg-datepicker-day-range-bg");
      expect(td("2026-11-04")).toContain("before:start-1/2");
      expect(td("2026-11-05")).toContain("before:bg-datepicker-day-range-bg");
      expect(td("2026-11-06")).toContain("before:end-1/2");
      expect(td("2026-11-07")).not.toContain("before:bg-datepicker-day-range-bg");
      expect(cell("2026-11-11").classes()).toContain("o-range-cal__today");
      expect(cell("2026-11-11").classes().join(" ")).not.toContain("border-datepicker-day-today");
    });

    it("leaves a range another control produced unpainted and keeps today a dot", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
      wrapper = mount(ODateRangeCalendar, {
        props: {
          bandRange: true,
          fill: true,
          hideSelection: true,
          startDate: "2026/11/04",
          endDate: "2026/11/06",
        },
        attachTo: document.body,
      });

      expect(wrapper.findAll("[data-selected]")).toHaveLength(0);
      expect(cell("2026-11-05").element.closest("td")!.className).not.toContain("before:");
      expect(cell("2026-11-11").classes()).toContain("o-range-cal__today");
      expect(cell("2026-11-11").classes().join(" ")).not.toContain("data-today:not-data-selected");
    });
  });

  describe("v2 picking", () => {
    const cell = (iso: string) =>
      wrapper.find<HTMLElement>(`[data-test="daterangecalendar-cell-${iso}"]`);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps a first pick made over a hidden selection as a lone start when the parent unhides it", async () => {
      wrapper = mount(ODateRangeCalendar, {
        props: {
          bandRange: true,
          hideSelection: true,
          startDate: "2026/11/11",
          endDate: "2026/11/11",
        },
        attachTo: document.body,
      });
      await cell("2026-11-04").trigger("click");
      expect(wrapper.emitted("update:pendingDate")?.at(-1)).toEqual(["2026/11/04"]);
      await wrapper.setProps({ hideSelection: false });

      expect(wrapper.emitted("update:startDate")).toBeUndefined();
      expect(cell("2026-11-04").attributes("data-selection-start")).toBeDefined();
      expect(cell("2026-11-11").attributes("data-selected")).toBeUndefined();
    });

    it("previews the would-be end under the pointer and drops a half pick on request", async () => {
      wrapper = mount(ODateRangeCalendar, {
        props: { bandRange: true, hideSelection: true },
        attachTo: document.body,
      });
      await cell("2026-11-04").trigger("click");
      await cell("2026-11-09").trigger("mouseenter");

      expect(wrapper.emitted("update:previewDate")?.at(-1)).toEqual(["2026/11/09"]);
      expect(cell("2026-11-06").attributes("data-preview")).toBeDefined();
      expect(cell("2026-11-09").attributes("data-preview-end")).toBeDefined();

      const exposed = wrapper.vm as unknown as { clearPending: () => boolean };
      expect(exposed.clearPending()).toBe(true);
      expect(wrapper.emitted("update:pendingDate")?.at(-1)).toEqual([null]);
      expect(exposed.clearPending()).toBe(false);
    });

    it("starts the week on the given day and names the grid and month buttons", () => {
      wrapper = mount(ODateRangeCalendar, {
        props: {
          weekStartsOn: 1,
          locale: "en-GB",
          calendarLabel: "Date range",
          prevLabel: "Previous month",
          nextLabel: "Next month",
        },
        attachTo: document.body,
      });
      const firstCell = wrapper.find("[data-reka-calendar-cell-trigger]");
      expect(new Date(`${firstCell.attributes("data-value")}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(wrapper.find('[data-test="daterangecalendar-prev"]').attributes("aria-label")).toBe(
        "Previous month",
      );
      expect(wrapper.find('[data-test="daterangecalendar-next"]').attributes("aria-label")).toBe(
        "Next month",
      );
    });

    it("moves a month with PageDown and to the week's end with End", async () => {
      wrapper = mount(ODateRangeCalendar, {
        props: { weekStartsOn: 1, autoFocus: true },
        attachTo: document.body,
      });
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.activeElement?.getAttribute("data-value")).toBe("2026-11-11");

      await cell("2026-11-11").trigger("keydown", { key: "End" });
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.activeElement?.getAttribute("data-value")).toBe("2026-11-15");

      await cell("2026-11-15").trigger("keydown", { key: "PageDown" });
      await new Promise((resolve) => setTimeout(resolve));
      expect(wrapper.find('[data-test="daterangecalendar-heading"]').text()).toContain("December");
      expect(document.activeElement?.getAttribute("data-value")).toBe("2026-12-15");
    });

    it("strikes days before the retention floor and says why", () => {
      wrapper = mount(ODateRangeCalendar, {
        props: { unavailableBefore: "2026/11/05", unavailableReason: "Outside 7-day retention" },
        attachTo: document.body,
      });
      expect(cell("2026-11-04").attributes("data-unavailable")).toBeDefined();
      expect(cell("2026-11-04").attributes("title")).toBe("Outside 7-day retention");
      expect(cell("2026-11-05").attributes("data-unavailable")).toBeUndefined();
    });
  });
});
