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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useLogs from "@/composables/useLogs";
import { searchState } from "@/composables/useLogs/searchState";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";
import { resetFreeTextSchemasForTests } from "@/composables/useLogs/freeTextSearch";

const { sent, getStreamMock } = vi.hoisted(() => ({
  sent: [] as { payload: any; handlers: any }[],
  getStreamMock: vi.fn(),
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any, handlers: any) => {
      sent.push({ payload, handlers });
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async () => ({ list: [] })),
    getStream: (...args: unknown[]) => getStreamMock(...args),
    isStreamExists: vi.fn(() => true),
    isStreamFetched: vi.fn(() => true),
    getMultiStreams: vi.fn(async () => []),
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ currentRoute: { value: { name: "logs", query: {} } }, push: vi.fn() }),
}));

const ftsStream = {
  name: "app",
  stream_type: "logs",
  schema: [
    { name: "_timestamp", type: "Int64" },
    { name: "body", type: "Utf8" },
  ],
  settings: { full_text_search_keys: ["body"] },
};

const Host = defineComponent({
  template: "<div />",
  setup() {
    const { runGridSearch } = useLogs((key: string) => key as any);
    return { runGridSearch, autoRun: useLogsAutoRun() };
  },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("runGridSearch after a deferred free-text schema refresh (item 1, spec 6.3)", () => {
  const { searchObj } = searchState();
  let wrapper: any;

  beforeEach(() => {
    sent.length = 0;
    getStreamMock.mockReset();
    resetFreeTextSchemasForTests();
    searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;
    searchObj.meta.sqlMode = false;
    searchObj.meta.refreshInterval = 0;
    searchObj.data.stream.streamType = "logs";
    searchObj.data.stream.streamLists = [{ label: "app", value: "app" }] as any;
    searchObj.data.stream.selectedStream = ["app"];
    searchObj.data.stream.selectedStreamFields = ftsStream.schema.map((f) => ({
      name: f.name,
    })) as any;
    searchObj.data.streamResults = { list: [ftsStream] } as any;
    searchObj.data.datetime = { type: "relative", relativeTimePeriod: "15m" } as any;
    wrapper = mount(Host, { global: { provide: { store }, plugins: [i18n, store] } });
  });

  afterEach(() => {
    wrapper?.unmount();
    searchObj.meta.sqlMode = false;
    searchObj.data.query = "";
  });

  const openGrid = () =>
    wrapper.vm.autoRun.engine.newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "run",
      op: "full",
      signature: wrapper.vm.autoRun.readSignature(),
    });

  it("keeps run B's rows when run A's schema refresh resolves after B completed", async () => {
    const schemaA = deferred<typeof ftsStream>();
    getStreamMock.mockImplementationOnce(() => schemaA.promise);

    searchObj.data.query = "timeout";
    const runA = wrapper.vm.runGridSearch(openGrid().id);
    await vi.waitFor(() => expect(getStreamMock).toHaveBeenCalledTimes(1));
    expect(getStreamMock.mock.calls[0][0]).toBe("app");

    searchObj.meta.sqlMode = true;
    searchObj.data.query = 'SELECT * FROM "app"';
    const generationB = openGrid().id;
    await wrapper.vm.runGridSearch(generationB);
    expect(sent.map((s) => s.payload.queryReq.query.sql)).toEqual(['SELECT * FROM "app"']);

    const [{ payload, handlers }] = sent;
    const rowsB = [{ _timestamp: 1, body: "from B" }];
    handlers.data(payload, {
      type: "search_response_metadata",
      content: { results: { hits: [], total: 1, took: 1, scan_size: 0, from: 0 } },
    });
    handlers.data(payload, {
      type: "search_response_hits",
      content: { results: { hits: rowsB, total: 1, took: 1, scan_size: 0, from: 0 } },
    });
    handlers.complete(payload, { type: "end" });
    await flushPromises();
    expect(searchObj.data.queryResults.hits).toEqual(rowsB);

    schemaA.resolve(ftsStream);
    await runA;
    await flushPromises();

    expect(searchObj.data.queryResults.hits).toEqual(rowsB);
    // B's own follow-up (its page count) may go out; nothing of A's does.
    expect(sent.filter((s) => s.payload.type === "search")).toHaveLength(1);
    expect(sent.every((s) => s.payload.generationId === generationB)).toBe(true);
  });

  it("still sends a current run once its refresh resolves", async () => {
    const schemaA = deferred<typeof ftsStream>();
    getStreamMock.mockImplementationOnce(() => schemaA.promise);

    searchObj.data.query = "timeout";
    const runA = wrapper.vm.runGridSearch(openGrid().id);
    await vi.waitFor(() => expect(getStreamMock).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(0);

    schemaA.resolve(ftsStream);
    await runA;

    expect(sent.map((s) => s.payload.queryReq.query.sql)).toEqual([
      `select * from "app"  WHERE match_all('timeout')`,
    ]);
  });
});
