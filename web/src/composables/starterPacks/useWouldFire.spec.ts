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

import { describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";

const fetchStream = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: fetchStream,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

import { useWouldFire } from "./useWouldFire";

describe("useWouldFire", () => {
  it("never answers history from the cache", async () => {
    fetchStream.mockImplementation((_request, handlers) => handlers.complete());
    const { check } = effectScope().run(() => useWouldFire("org"))!;
    await check({
      query_condition: { type: "promql", promql: "up", promql_condition: {} },
      trigger_condition: { frequency: 5 },
    });
    expect(fetchStream.mock.calls[0][0].skipCache).toBe(true);
  });
});
