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
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import {
  resetLogsAutoRunForTests,
  useLogsAutoRun,
  type LogsRunSettled,
} from "@/composables/useLogs/logsAutoRun";
import { logsRunResult } from "@/utils/queryHistory/logs";

interface StreamCallbacks {
  onError: (payload: object, error: object) => void;
  onComplete: (payload: object) => void;
}

const { fake, connection } = vi.hoisted(() => ({
  fake: { searchObj: null as Record<string, unknown> | null },
  connection: {
    getDataThroughStream: vi.fn(),
    cleanupConnection: vi.fn(),
    buildWebSocketPayload: vi.fn(),
    initializeSearchConnection: vi.fn(),
  },
}));

vi.mock("vuex", () => ({ useStore: () => ({ state: { zoConfig: {} } }) }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ currentRoute: { value: { name: "logs", query: {} } }, push: vi.fn() }),
}));
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: fake.searchObj,
    resetQueryData: vi.fn(),
    notificationMsg: { value: "" },
    searchPartitionMap: {},
  }),
}));
vi.mock("@/composables/useLogs/logsUtils", () => ({
  logsUtils: () => ({ addTraceId: vi.fn(), removeTraceId: vi.fn() }),
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));
vi.mock("@/composables/useLogs/useSearchQuery", () => ({
  default: () => ({ getQueryReq: () => ({ query: { start_time: 10, end_time: 20 } }) }),
}));
vi.mock("@/composables/useLogs/useSearchConnection", () => ({ default: () => connection }));
vi.mock("@/composables/useLogs/useSearchResponseHandler", () => ({
  default: () => ({ handleSearchError: vi.fn(), handleSearchResponse: vi.fn() }),
}));
vi.mock("@/composables/useLogs/useSearchHistogramManager", () => ({
  default: () => ({ processHistogramRequest: vi.fn() }),
}));
vi.mock("@/composables/useLogs/useSearchPagination", () => ({ default: () => ({}) }));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false", isCloud: "false" } }));

const makeSearchObj = () =>
  reactive({
    organizationIdentifier: "org1",
    loading: false,
    loadingHistogram: false,
    meta: {
      sqlMode: true,
      quickMode: false,
      liveMode: false,
      refreshInterval: 0,
      showTransformEditor: false,
      useUserDefinedSchemas: "user_defined_schema",
      logsVisualizeToggle: "logs",
      regions: [],
      clusters: [],
    },
    data: {
      query: 'SELECT * FROM "app" WHERE method == "GET"',
      tempFunctionContent: "",
      datetime: { type: "relative", relativeTimePeriod: "15m" },
      stream: {
        selectedStream: ["app"],
        streamLists: [{ label: "app", value: "app" }],
        streamType: "logs",
        interestingFieldList: [],
      },
      resultGrid: { currentPage: 1, hitsSettled: true },
      searchRequestTraceIds: [],
      queryResults: { hits: [] },
      histogram: { xData: [], yData: [] },
      streamResults: { list: [] },
    },
  });

const startRun = async () => {
  const autoRun = useLogsAutoRun();
  const stream = useSearchStream((key: string) => key);
  autoRun.setExecutors({
    logs: (ctx) => stream.getDataThroughStream(false, ctx.generation.id),
  });
  autoRun.engine.requestRun("run");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const [queryReq, , callbacks, generationId] = connection.getDataThroughStream.mock.calls.at(-1)!;
  const payload = { traceId: "t1", type: "search", generationId, queryReq };
  autoRun.bindPayload(payload);
  return { callbacks: callbacks as StreamCallbacks, payload };
};

const settled = (): LogsRunSettled[] => {
  const runs: LogsRunSettled[] = [];
  useLogsAutoRun().onRunSettled((run) => runs.push(run));
  return runs;
};

describe("Logs run status from the search stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.searchObj = makeSearchObj();
    resetLogsAutoRunForTests();
  });

  it("records a streamed schema error (HTTP 400 in `code`) as failed", async () => {
    const runs = settled();
    const { callbacks, payload } = await startRun();
    callbacks.onError(payload, {
      type: "error",
      content: {
        code: 400,
        message: 'Search field not found: Schema error: No field named "GET".',
        error_detail: "",
        trace_id: "t1",
      },
    });
    expect(runs).toHaveLength(1);
    expect(logsRunResult(runs[0])).toEqual({
      status: "error",
      error: 'Search field not found: Schema error: No field named "GET".',
    });
  });

  it("records a refused request (HTTP status plus search code) as failed", async () => {
    const runs = settled();
    const { callbacks, payload } = await startRun();
    callbacks.onError(payload, {
      type: "error",
      content: { status: 400, code: 20001, message: "Search SQL not valid", trace_id: "t1" },
    });
    expect(logsRunResult(runs[0])?.status).toBe("error");
  });

  it("records a streamed timeout as ok with a warning", async () => {
    const runs = settled();
    const { callbacks, payload } = await startRun();
    callbacks.onError(payload, {
      type: "error",
      content: { code: 408, message: "Search query timed out", trace_id: "t1" },
    });
    expect(logsRunResult(runs[0])).toEqual({ status: "ok", warning: "Search query timed out" });
  });
});
