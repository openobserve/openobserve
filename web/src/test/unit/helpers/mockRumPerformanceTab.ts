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
 * Shared test double for `@/composables/rum/useRumPerformanceTab`, used by every RUM
 * Performance tab spec (WebVitalsDashboard, PerformanceSummary, ErrorsDashboard,
 * ApiDashboard). Callers `vi.mock` the composable module themselves (mocks must stay in
 * the spec file so Vitest can hoist them) and use this factory to build the mocked
 * return value with per-test overrides.
 */

import { computed, ref } from "vue";
import { vi } from "vitest";

export const DEFAULT_MOCK_DASHBOARD_DATA = {
  title: "Mock RUM Dashboard",
  panels: [],
};

export interface RumPerformanceTabMockOverrides {
  dashboardData?: unknown;
  schemaResolved?: boolean;
  showEmptyState?: boolean;
  wasFiltered?: boolean;
  ensureRumSchema?: ReturnType<typeof vi.fn>;
}

/**
 * Builds a mocked return value for `useRumPerformanceTab`. Defaults represent the
 * "resolved, non-empty, unfiltered" state — i.e. the dashboard branch renders.
 */
export function createRumPerformanceTabMock(overrides: RumPerformanceTabMockOverrides = {}) {
  const {
    dashboardData = DEFAULT_MOCK_DASHBOARD_DATA,
    schemaResolved = true,
    showEmptyState = false,
    wasFiltered = false,
    ensureRumSchema = vi.fn().mockResolvedValue(undefined),
  } = overrides;

  return {
    dashboardData: computed(() => dashboardData),
    schemaResolved: ref(schemaResolved),
    showEmptyState: computed(() => showEmptyState),
    wasFiltered: computed(() => wasFiltered),
    ensureRumSchema,
  };
}
