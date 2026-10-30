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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import { invalidateChartTheme } from "@/utils/chartTheme";
import QueryAnnotationTooltip from "./QueryAnnotationTooltip.vue";

const dotEl = () =>
  document.body.querySelector<HTMLElement>('[data-test="dashboard-query-annotation-tooltip-dot"]');

// Teleported to <body>, so Vue Test Utils' own wrapper tree never contains these nodes.
const bodyEl = (dataTest: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);

const marker = (color: string) => ({
  start_time: 1_700_000_000_000_000,
  end_time: null,
  title: "deploy",
  text: "",
  source: { id: "s1", name: "Deploys", color },
});

describe("QueryAnnotationTooltip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    invalidateChartTheme();
  });

  it("lightens a near-black source colour the same way the chart mark itself is", () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) =>
      el === document.documentElement
        ? ({ getPropertyValue: () => "#0d1117" } as unknown as CSSStyleDeclaration)
        : real(el),
    );
    const wrapper = mount(QueryAnnotationTooltip, {
      props: { marker: marker("#111827"), timezone: "UTC", x: 10, y: 10 },
      global: { plugins: [i18n] },
    });
    expect(dotEl()!.style.backgroundColor).not.toBe("rgb(17, 24, 39)");
    wrapper.unmount();
  });

  it("leaves an already-legible source colour unchanged", () => {
    const wrapper = mount(QueryAnnotationTooltip, {
      props: { marker: marker("#34d399"), timezone: "UTC", x: 10, y: 10 },
      global: { plugins: [i18n] },
    });
    expect(dotEl()!.style.backgroundColor).toBe("rgb(52, 211, 153)");
    wrapper.unmount();
  });

  it("shows only the start time for a point-in-time marker", () => {
    const wrapper = mount(QueryAnnotationTooltip, {
      props: { marker: marker("#34d399"), timezone: "UTC", x: 10, y: 10 },
      global: { plugins: [i18n] },
    });
    expect(bodyEl("dashboard-query-annotation-tooltip-time")!.textContent).toBe("2023-11-14 22:13");
    wrapper.unmount();
  });

  it("shows a start–end range for a marker with an end time", () => {
    const wrapper = mount(QueryAnnotationTooltip, {
      props: {
        marker: { ...marker("#34d399"), end_time: 1_700_003_600_000_000 },
        timezone: "UTC",
        x: 10,
        y: 10,
      },
      global: { plugins: [i18n] },
    });
    expect(bodyEl("dashboard-query-annotation-tooltip-time")!.textContent).toBe(
      "2023-11-14 22:13 – 2023-11-14 23:13",
    );
    wrapper.unmount();
  });

  it("shows only the start time when end_time is earlier than start_time", () => {
    const wrapper = mount(QueryAnnotationTooltip, {
      props: {
        marker: { ...marker("#34d399"), end_time: 1_699_996_400_000_000 },
        timezone: "UTC",
        x: 10,
        y: 10,
      },
      global: { plugins: [i18n] },
    });
    expect(bodyEl("dashboard-query-annotation-tooltip-time")!.textContent).toBe("2023-11-14 22:13");
    wrapper.unmount();
  });

  it("shows only the start time when end_time equals start_time", () => {
    const wrapper = mount(QueryAnnotationTooltip, {
      props: {
        marker: { ...marker("#34d399"), end_time: 1_700_000_000_000_000 },
        timezone: "UTC",
        x: 10,
        y: 10,
      },
      global: { plugins: [i18n] },
    });
    expect(bodyEl("dashboard-query-annotation-tooltip-time")!.textContent).toBe("2023-11-14 22:13");
    wrapper.unmount();
  });

  it("hides the title and description rows when the marker carries neither", () => {
    const wrapper = mount(QueryAnnotationTooltip, {
      props: {
        marker: { ...marker("#34d399"), title: "", text: "" },
        timezone: "UTC",
        x: 10,
        y: 10,
      },
      global: { plugins: [i18n] },
    });
    expect(bodyEl("dashboard-query-annotation-tooltip-title")).toBeNull();
    expect(bodyEl("dashboard-query-annotation-tooltip-description")).toBeNull();
    wrapper.unmount();
  });

  it("shows the description row when the marker carries one", () => {
    const wrapper = mount(QueryAnnotationTooltip, {
      props: {
        marker: { ...marker("#34d399"), text: "service: checkout" },
        timezone: "UTC",
        x: 10,
        y: 10,
      },
      global: { plugins: [i18n] },
    });
    expect(bodyEl("dashboard-query-annotation-tooltip-description")!.textContent).toBe(
      "service: checkout",
    );
    wrapper.unmount();
  });

  it("flips to the left of the pointer near the viewport's right edge, clamped to its measured width", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(280);
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
    const wrapper = mount(QueryAnnotationTooltip, {
      props: { marker: marker("#34d399"), timezone: "UTC", x: window.innerWidth - 20, y: 100 },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(bodyEl("dashboard-query-annotation-tooltip")!.style.left).toBe(
      `${window.innerWidth - 20 - 280}px`,
    );
    wrapper.unmount();
    width.mockRestore();
    height.mockRestore();
  });
});
