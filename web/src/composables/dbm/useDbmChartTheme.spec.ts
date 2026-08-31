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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import { useDbmChartTheme } from "./useDbmChartTheme";

const store = reactive({ state: { theme: "light" } });

vi.mock("vuex", () => ({ useStore: () => store }));

const chartColor = vi.fn((token: string) => `${store.state.theme}:${token}`);

vi.mock("@/utils/chartTheme", () => ({ chartColor: (token: string) => chartColor(token) }));

describe("useDbmChartTheme", () => {
  beforeEach(() => {
    store.state.theme = "light";
    chartColor.mockClear();
  });

  // ECharts draws on canvas and can't read CSS custom properties, so every token must resolve to a literal; both callers draw the same chart and must not drift apart.
  it("resolves the scatter's tokens to literals", () => {
    expect(useDbmChartTheme().value).toEqual({
      calls: "light:--color-chart-series-1",
      errors: "light:--color-severity-error-color",
      axisLabel: "light:--color-text-secondary",
      splitLine: "light:--color-chart-gridline",
      tooltipBg: "light:--color-tooltip-bg",
      tooltipBorder: "light:--color-tooltip-border",
      tooltipText: "light:--color-tooltip-text",
      crosshairBg: "light:--color-chart-crosshair-bg",
    });
  });

  /**
   * The resolution is frozen at the moment it runs, so the theme has to be a
   * REACTIVE dependency. Without that read a page keeps painting the light
   * palette on a dark background until something unrelated invalidates it.
   */
  it("re-resolves when the user flips the theme", () => {
    const theme = useDbmChartTheme();
    expect(theme.value.calls).toBe("light:--color-chart-series-1");

    store.state.theme = "dark";

    expect(theme.value.calls).toBe("dark:--color-chart-series-1");
  });

  /** It is a computed: reading it twice under one theme resolves once. */
  it("resolves once per theme, not once per read", () => {
    const theme = useDbmChartTheme();
    void theme.value;
    void theme.value;

    expect(chartColor).toHaveBeenCalledTimes(8);
  });
});
