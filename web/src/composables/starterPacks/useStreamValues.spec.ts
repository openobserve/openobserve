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

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

const fake = vi.hoisted(() => ({ requests: [] as any[] }));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (request: any, handlers: any) => {
      fake.requests.push(request);
      handlers.complete(request, {});
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

import { useStreamValues } from "./useStreamValues";

const DAY_US = 24 * 60 * 60 * 1_000_000;

const reader = () => {
  let api!: ReturnType<typeof useStreamValues>;
  mount(
    defineComponent({
      setup() {
        api = useStreamValues("org");
        return () => null;
      },
    }),
  );
  return api;
};

describe("useStreamValues", () => {
  it("reads a stale stream's values in the day before its last data", async () => {
    const lastIngested = Date.now() * 1000 - 3 * DAY_US;
    await reader().readValues("events", ["service_name"], "logs", lastIngested);
    const { queryReq } = fake.requests.at(-1);
    expect(queryReq.end_time).toBe(lastIngested + 1);
    expect(queryReq.start_time).toBe(lastIngested + 1 - DAY_US);
  });

  it("reads up to now for a stream whose data is younger than a day", async () => {
    const before = Date.now() * 1000;
    await reader().readValues("events", ["service_name"], "logs", before - 3_600_000_000);
    const { queryReq } = fake.requests.at(-1);
    expect(queryReq.end_time).toBeGreaterThanOrEqual(before);
    expect(queryReq.end_time - queryReq.start_time).toBe(DAY_US);
  });

  it("reads the last day up to now without a last data time", async () => {
    const before = Date.now() * 1000;
    await reader().readValues("events", ["service_name"]);
    const { queryReq } = fake.requests.at(-1);
    expect(queryReq.end_time).toBeGreaterThanOrEqual(before);
    expect(queryReq.end_time - queryReq.start_time).toBe(DAY_US);
  });
});
