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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { reactive, ref } from "vue";
import type { ExecutedRecordedEvent, LogsSignature } from "@/composables/useLogs/useAutoRun";

const searchObj: any = reactive({});
const route = ref<any>({ name: "logs", query: {} });
const router = {
  currentRoute: route,
  push: vi.fn(async (to: any) => {
    route.value = { name: "logs", query: to.query };
  }),
  replace: vi.fn(async (to: any) => {
    route.value = { name: "logs", query: to.query };
  }),
};
const store = {
  state: {
    selectedOrganization: { identifier: "default" },
    zoConfig: { timestamp_column: "_timestamp", super_cluster_enabled: false },
  },
};
const localFields = vi.hoisted(() => ({ value: {} as Record<string, unknown>, set: vi.fn() }));

vi.mock("@/composables/useLogs/searchState", () => ({ searchState: () => ({ searchObj }) }));
vi.mock("vuex", () => ({ useStore: () => store }));
vi.mock("vue-router", () => ({ useRouter: () => router }));
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  useLocalLogFilterField: (value?: unknown) => {
    if (value !== undefined) localFields.set(value);
    return { value: localFields.value };
  },
}));

import { logsUtils } from "@/composables/useLogs/logsUtils";
import {
  decodeColumns,
  recordShownSearch,
  resetLogsUrlForTests,
} from "@/composables/useLogs/useLogsUrl";
import {
  activePermalink,
  columnsFromUrl,
  resetPermalinkForTests,
} from "@/composables/useLogs/useLogPermalink";

const decode = (value: string) => Buffer.from(value, "base64").toString();

const signature = (overrides: Partial<LogsSignature> = {}): LogsSignature => ({
  query: "level = 'error'",
  sqlMode: false,
  streams: ["app"],
  streamType: "logs",
  time: { type: "relative", period: "15m" },
  transform: null,
  quickMode: false,
  quickModeFields: [],
  regions: [],
  clusters: [],
  effectiveSortOrder: "desc",
  definedSchemas: "user_defined_schema",
  ...overrides,
});

const recordGrid = (
  generation: number,
  overrides: Partial<LogsSignature> = {},
  req: Record<string, unknown> = { from: 0, size: 50, start_time: 1000, end_time: 2000 },
) => {
  const event: ExecutedRecordedEvent = {
    surface: "logs",
    generation,
    signature: signature(overrides),
    req: { query: req },
  };
  return recordShownSearch(event, { selectedStreams: [...(overrides.streams ?? ["app"])] });
};

const resetSearchObj = () => {
  Object.assign(searchObj, {
    organizationIdentifier: "default",
    data: {
      query: "level = 'error'",
      datetime: { type: "relative", startTime: 1000, endTime: 2000, relativeTimePeriod: "15m" },
      stream: { streamType: "logs", selectedStream: ["app"], selectedFields: [] },
      tempFunctionContent: "",
      transformType: "",
    },
    meta: {
      sqlMode: false,
      showTransformEditor: false,
      pageType: "logs",
      showHistogram: true,
      quickMode: false,
      refreshInterval: 0,
      useUserDefinedSchemas: "user_defined_schema",
      regions: [],
      clusters: [],
      logsVisualizeToggle: "logs",
      isFtsDefaultColumn: false,
      resultGrid: { rowsPerPage: 50 },
    },
  });
};

describe("logsUtils URL registry (4c C7, C7b)", () => {
  let utils: ReturnType<typeof logsUtils>;

  beforeEach(() => {
    resetLogsUrlForTests();
    resetPermalinkForTests();
    resetSearchObj();
    route.value = { name: "logs", query: {} };
    router.push.mockClear();
    router.replace.mockClear();
    localFields.set.mockClear();
    utils = logsUtils();
  });

  describe("sources (J-C26, J-C29, J-C30)", () => {
    it("names the shown run, not drafts typed or picked after it", () => {
      recordGrid(1);
      searchObj.data.stream.selectedStream = ["web"];
      searchObj.data.query = "draft";
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "1h",
        startTime: 5,
        endTime: 6,
      };
      const query = utils.generateURLQuery();
      expect(query.stream).toBe("app");
      expect(query.period).toBe("15m");
      expect(decode(query.query)).toBe("level = 'error'");
    });

    it("a shown run without VRL stays without it in both URLs, whatever the draft (F2)", () => {
      recordGrid(1);
      searchObj.meta.showTransformEditor = true;
      searchObj.data.transformType = "function";
      searchObj.data.tempFunctionContent = ".draft = 1";
      for (const query of [utils.generateURLQuery(), utils.generateURLQuery(true)]) {
        expect(query.functionContent).toBeUndefined();
        expect(query.fn_editor).toBe(false);
      }
      recordGrid(2, { transform: ".ran = 1" });
      const ran = utils.generateURLQuery();
      expect(decode(ran.functionContent)).toBe(".ran = 1");
      expect(ran.fn_editor).toBe(true);
    });

    it("a share link carries the shown run's bounds; the address bar carries its period", () => {
      recordGrid(1);
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: 9000,
        endTime: 9900,
      };
      const share = utils.generateURLQuery(true);
      expect([share.from, share.to]).toEqual([1000, 2000]);
      expect(share.period).toBeUndefined();
      expect(utils.generateURLQuery().period).toBe("15m");
    });

    it("Patterns writes its own record; a surface that never ran falls back to the grid's", () => {
      recordGrid(1);
      searchObj.meta.logsVisualizeToggle = "patterns";
      expect(decode(utils.generateURLQuery().query)).toBe("level = 'error'");
      recordShownSearch({
        surface: "patterns",
        generation: 2,
        signature: signature({ query: "b" }),
      });
      expect(decode(utils.generateURLQuery().query)).toBe("b");
    });

    it("before anything ran (no record), the live state is written as today", () => {
      searchObj.data.stream.selectedStream = ["live"];
      expect(utils.generateURLQuery().stream).toBe("live");
    });
  });

  describe("columns, rows, page (C7)", () => {
    it("writes the picked columns without the timestamp; [] is a valid selection", () => {
      recordGrid(1);
      searchObj.data.stream.selectedFields = ["_timestamp", "level", "message"];
      expect(decodeColumns(utils.generateURLQuery().columns)).toEqual(["level", "message"]);
      searchObj.data.stream.selectedFields = [];
      expect(decodeColumns(utils.generateURLQuery().columns)).toEqual([]);
    });

    it("omits columns for a system FTS pick and in SQL mode", () => {
      searchObj.data.stream.selectedFields = ["body"];
      searchObj.meta.isFtsDefaultColumn = true;
      expect(utils.generateURLQuery().columns).toBeUndefined();
      searchObj.meta.isFtsDefaultColumn = false;
      recordGrid(1, { sqlMode: true, query: "SELECT * FROM app" });
      expect(utils.generateURLQuery().columns).toBeUndefined();
    });

    it("writes the displayed page only above 1 and only without auto-refresh; rows only when not 50", () => {
      recordGrid(1, {}, { from: 50, size: 25, start_time: 1, end_time: 2 });
      let query = utils.generateURLQuery();
      expect(query.page).toBe(3);
      expect(query.rows).toBe(25);
      searchObj.meta.refreshInterval = 5;
      query = utils.generateURLQuery();
      expect(query.page).toBeUndefined();
      recordGrid(2);
      expect(utils.generateURLQuery().rows).toBeUndefined();
    });
  });

  describe("line link params (C3, C5 step 3)", () => {
    it("re-emits log_* into the address bar while the permalink is open, never into a share link", () => {
      activePermalink.value = {
        org: "default",
        link: { stream: "app", ts: 77, fp: "abc" },
        generation: 1,
        multiStream: false,
        regions: [],
        clusters: [],
        outcome: null,
      };
      const bar = utils.generateURLQuery();
      expect([bar.log_stream, bar.log_ts, bar.log_fp, bar.log_id]).toEqual([
        "app",
        "77",
        "abc",
        undefined,
      ]);
      const share = utils.generateURLQuery(true);
      expect(Object.keys(share).filter((key) => key.startsWith("log_"))).toEqual([]);
    });
  });

  describe("writers", () => {
    it("a new run pushes; the same run on another page replaces (Back does not step through pages)", async () => {
      recordGrid(1);
      await utils.updateUrlQueryParams();
      expect(router.push).toHaveBeenCalledTimes(1);
      recordGrid(1, {}, { from: 50, size: 50, start_time: 1000, end_time: 2000 });
      await utils.updateUrlQueryParams();
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(route.value.query.page).toBe(2);
      recordGrid(2, { query: "other" });
      await utils.updateUrlQueryParams();
      expect(router.push).toHaveBeenCalledTimes(2);
    });

    it("a view-state patch keeps the address bar's search inputs and replaces", async () => {
      route.value = {
        name: "logs",
        query: { stream: "app", period: "15m", refresh: "0", timezone: "UTC" },
      };
      searchObj.data.stream.selectedStream = ["draft-stream"];
      searchObj.meta.refreshInterval = 10;
      await utils.patchUrlViewState();
      expect(router.push).not.toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(route.value.query.stream).toBe("app");
      expect(route.value.query.refresh).toBe(10);
      expect(route.value.query.timezone).toBeUndefined();
    });

    it("writes nothing off the logs route", async () => {
      route.value = { name: "dashboards", query: {} };
      await utils.updateUrlQueryParams();
      await utils.patchUrlViewState();
      expect(router.push).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  it("does not persist a shared link's columns to this user's local selection (C7 guard)", () => {
    searchObj.data.stream.selectedFields = ["level"];
    columnsFromUrl.value = true;
    utils.updatedLocalLogFilterField();
    expect(localFields.set).not.toHaveBeenCalled();
    columnsFromUrl.value = false;
    utils.updatedLocalLogFilterField();
    expect(localFields.set).toHaveBeenCalledWith({ default_app: ["level"] });
  });
});
