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

/**
 * The four colours the DBM sample scatter is drawn in.
 *
 * ECharts is a canvas: it cannot read a CSS custom property, so every token has
 * to be RESOLVED to a literal before the option is built. That resolution is
 * frozen at the moment it runs, which is why the store's theme is touched here
 * — the read is what makes this recompute when the user flips light/dark, and
 * without it a themed page keeps painting yesterday's palette until something
 * unrelated invalidates the chart.
 *
 * Both callers draw the SAME scatter (the query detail page's is the
 * slowest-calls one, scoped to a fingerprint), so they must not be able to
 * drift into two palettes.
 */

import { computed, type ComputedRef } from "vue";
import { useStore } from "vuex";

import { chartColor } from "@/utils/chartTheme";
import type { DbmChartTheme } from "@/utils/dbm/historyChart";

export const useDbmChartTheme = (): ComputedRef<DbmChartTheme> => {
  const store = useStore();

  return computed(() => {
    // Read, not used: this is the dependency that reruns the resolution on a
    // theme flip. Removing it silently freezes the palette.
    void store.state.theme;
    return {
      calls: chartColor("--color-chart-series-1"),
      errors: chartColor("--color-severity-error-color"),
      axisLabel: chartColor("--color-text-secondary"),
      splitLine: chartColor("--color-border-default"),
    };
  });
};
