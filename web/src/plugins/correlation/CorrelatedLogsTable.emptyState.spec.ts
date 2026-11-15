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

// Runs the real useCorrelatedLogs so the table is checked against what the composable produces.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import CorrelatedLogsTable from "./CorrelatedLogsTable.vue";

const mockFetchQueryDataWithHttpStream = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useStreamingSearch", () => ({
  default: vi.fn(() => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  })),
}));

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: vi.fn(() => ({
    loadKeyFields: vi.fn().mockResolvedValue({}),
  })),
  clearSemanticGroupsCaches: vi.fn(),
  getSemanticGroupsCacheStatus: vi.fn(),
}));

describe("CorrelatedLogsTable empty states", () => {
  let wrapper: VueWrapper | undefined;

  const mountTable = async (logStreams: unknown[]) => {
    wrapper = mount(CorrelatedLogsTable, {
      props: {
        matchedDimensions: { service: "api" },
        logStreams,
        sourceStream: "traces",
        sourceType: "traces",
        timeRange: { startTime: 0, endTime: 1 },
      },
      global: {
        plugins: [i18n, store],
        stubs: { OTable: true, DimensionFiltersBar: true },
      },
    });
    await flushPromises();
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    mockFetchQueryDataWithHttpStream.mockReset();
  });

  it("shows no correlated log stream as an empty state, not the error state", async () => {
    await mountTable([]);

    const empty = wrapper!.find('[data-test="no-log-streams-state"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain("No log stream available for correlation");
    expect(wrapper!.find('[data-test="error-state"]').exists()).toBe(false);
    expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
  });

  it("shows a query with no rows as the same kind of empty state", async () => {
    mockFetchQueryDataWithHttpStream.mockImplementation(
      (_params: unknown, callbacks: { complete?: (v: null) => void }) => {
        callbacks.complete?.(null);
        return Promise.resolve();
      },
    );

    await mountTable([{ stream_name: "app-logs", stream_type: "logs", filters: {} }]);

    expect(wrapper!.find('[data-test="empty-state"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="no-log-streams-state"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="error-state"]').exists()).toBe(false);
  });
});
