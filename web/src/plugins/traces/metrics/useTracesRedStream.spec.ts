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
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";

const { mockFetch, mockCancel } = vi.hoisted(() => ({ mockFetch: vi.fn(), mockCancel: vi.fn() }));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mockFetch,
    cancelStreamQueryBasedOnRequestId: mockCancel,
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "org" } } }),
}));

import { useTracesRedStream } from "./useTracesRedStream";

const setup = () => {
  let api!: ReturnType<typeof useTracesRedStream>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useTracesRedStream();
        return () => null;
      },
    }),
  );
  return { api, wrapper };
};

const request = { sql: `SELECT 1`, size: -1, startTime: 1, endTime: 2 };
const meta = (streamingAggs = false) => ({
  type: "search_response_metadata",
  content: { ...(streamingAggs ? { streaming_aggs: true } : {}), results: { hits: [] } },
});
const hits = (rows: Record<string, unknown>[]) => ({
  type: "search_response_hits",
  content: { results: { hits: rows } },
});

// Runs one request, feeds it the replies and returns what `done` got.
const runWith = (replies: unknown[]) => {
  const { api, wrapper } = setup();
  const done = vi.fn();
  api.run(request, done, vi.fn());
  const [, handlers] = mockFetch.mock.calls.at(-1)!;
  for (const reply of replies) handlers.data({}, reply);
  handlers.complete({});
  wrapper.unmount();
  return done.mock.calls[0]?.[0];
};

describe("useTracesRedStream", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockCancel.mockClear();
  });

  it("joins the batches of a plain query", () => {
    expect(runWith([meta(), hits([{ t: 1 }]), meta(), hits([{ t: 2 }])])).toEqual([
      { t: 1 },
      { t: 2 },
    ]);
  });

  it("keeps only the last running total of a streaming aggregate", () => {
    expect(
      runWith([
        meta(true),
        hits([{ t: 1, n: 3 }]),
        meta(true),
        hits([
          { t: 1, n: 5 },
          { t: 2, n: 1 },
        ]),
      ]),
    ).toEqual([
      { t: 1, n: 5 },
      { t: 2, n: 1 },
    ]);
  });

  it("keeps the totals when a streaming aggregate ends with an empty batch", () => {
    expect(runWith([meta(true), hits([{ t: 1, n: 3 }]), meta(true), hits([])])).toEqual([
      { t: 1, n: 3 },
    ]);
  });

  it("replaces with each later chunk of one partition of a streaming aggregate", () => {
    expect(runWith([meta(true), hits([{ t: 1 }]), hits([{ t: 2 }])])).toEqual([{ t: 2 }]);
  });

  it("ignores a superseded run and cancels it", () => {
    const { api, wrapper } = setup();
    const first = vi.fn();
    api.run(request, first, vi.fn());
    const [, oldHandlers] = mockFetch.mock.calls.at(-1)!;
    api.run(request, vi.fn(), vi.fn());
    expect(mockCancel).toHaveBeenCalledTimes(1);
    oldHandlers.data({}, hits([{ t: 1 }]));
    oldHandlers.complete({});
    expect(first).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
