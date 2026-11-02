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

import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { setLanguage } from "@/utils/cookies";
import { gt } from "@/types/i18n";
import {
  flattenPanelResult,
  wrapCsvValue,
  usePanelAlertCreation,
  usePanelDownload,
} from "./usePanelActions";
import { downloadFile } from "@/utils/dom";
import { readAlertPrefill } from "@/utils/alerts/alertPrefillStorage";
import { buildForecastAlertPromql, parseForecastAlertPromql } from "@/utils/alerts/forecastAlert";
import {
  alertCreationDialog,
  closeAlertCreationDialog,
  rebuildAlertPrefill,
} from "@/composables/alerts/useAlertCreation";

vi.mock("@/utils/dom", () => ({
  downloadFile: vi.fn(),
}));

interface TestQuery {
  query: string;
  customQuery?: boolean;
  fields: {
    stream?: string;
    stream_type?: string;
    y?: { column: string; alias: string; aggregationFunction?: string }[];
  };
}

/** The same query as one built in the panel editor, counting its y-axis column. */
const builderQuery = (query: TestQuery): TestQuery => ({
  ...query,
  customQuery: false,
  fields: {
    ...query.fields,
    y: (query.fields.y ?? []).map((y) => ({ ...y, aggregationFunction: "count" })),
  },
});

describe("usePanelActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("wrapCsvValue", () => {
    it("returns empty string for nullish values", () => {
      expect(wrapCsvValue(null)).toBe("");
      expect(wrapCsvValue(undefined)).toBe("");
    });

    it("escapes quotes and wraps when needed", () => {
      expect(wrapCsvValue('a"b')).toBe('"a""b"');
      expect(wrapCsvValue("a,b")).toBe('"a,b"');
      expect(wrapCsvValue("a\nb")).toBe('"a\nb"');
      expect(wrapCsvValue("plain")).toBe("plain");
    });
  });

  describe("flattenPanelResult", () => {
    it("joins every SQL dataset and keeps columns in first-seen order", () => {
      const out = flattenPanelResult([
        [{ x_axis_1: "a", y_axis_1: 1 }],
        [{ x_axis_1: "b", y_axis_1: 2, breakdown_1: "z" }],
      ]);
      expect(out.columns).toEqual(["x_axis_1", "y_axis_1", "breakdown_1"]);
      expect(out.rows).toHaveLength(2);
    });

    it("turns PromQL series into one row per point with its labels", () => {
      const out = flattenPanelResult(
        [
          {
            result: [
              {
                metric: { job: "api" },
                values: [
                  [1, "5"],
                  [2, "6"],
                ],
              },
            ],
          },
        ],
        "promql",
      );
      expect(out.columns).toEqual(["timestamp", "value", "job"]);
      expect(out.rows[1]).toEqual({ timestamp: 2, value: "6", job: "api" });
    });

    it("reads the single value pair of a PromQL instant query", () => {
      const out = flattenPanelResult(
        [{ result: [{ metric: { job: "api" }, value: [3, "9"] }] }],
        "promql",
      );
      expect(out.rows).toEqual([{ timestamp: 3, value: "9", job: "api" }]);
    });

    it("returns nothing for a missing or malformed response", () => {
      expect(flattenPanelResult(undefined)).toEqual({ columns: [], rows: [] });
      expect(flattenPanelResult([null, {}], "promql")).toEqual({ columns: [], rows: [] });
    });
  });

  describe("usePanelAlertCreation", () => {
    const makeBase = () => {
      const panelSchema = {
        value: {
          id: "panel-1",
          title: "Errors",
          queryType: "sql",
          queries: [
            {
              query: 'select count(*) as "errors" from logs',
              fields: {
                stream: "logs",
                stream_type: "logs",
                y: [{ column: "errors", alias: "errors" }],
              },
            },
          ] as TestQuery[],
        },
      };

      return {
        panelSchema,
        allowAlertCreation: { value: true },
        metadata: {
          value: {
            queries: [{ query: 'select count(*) as "errors" from logs where level = "error"' }],
          },
        },
        selectedTimeObj: { value: { start_time: 1, end_time: 2 } },
        contextMenuData: { value: null as any },
        store: { state: { selectedOrganization: { identifier: "org-1" } } },
        router: { push: vi.fn() },
        emit: vi.fn(),
      };
    };

    it("emits chart contextmenu with panel metadata", () => {
      const args = makeBase();
      const api = usePanelAlertCreation(args as any);

      api.onChartContextMenu({ x: 10 });

      expect(args.emit).toHaveBeenCalledWith(
        "contextmenu",
        expect.objectContaining({
          x: 10,
          panelTitle: "Errors",
          panelId: "panel-1",
        }),
      );
    });

    it("opens DOM context menu only when alert creation is allowed", () => {
      const args = makeBase();
      const api = usePanelAlertCreation(args as any);

      api.onChartDomContextMenu({ x: 100, y: 200, value: 42, seriesName: "errors" });

      expect(api.contextMenuVisible.value).toBe(true);
      expect(api.contextMenuPosition.value).toEqual({ x: 100, y: 200 });
      expect(api.contextMenuValue.value).toBe(42);
      expect(args.contextMenuData.value).toEqual(expect.objectContaining({ seriesName: "errors" }));

      args.allowAlertCreation.value = false;
      api.hideContextMenu();
      api.onChartDomContextMenu({ x: 1, y: 2, value: 3 });
      expect(api.contextMenuVisible.value).toBe(false);
    });

    it("names the surface the alert came from, when the host is not a dashboard", () => {
      const args = { ...makeBase(), alertSource: { value: "explorer" } };
      const api = usePanelAlertCreation(args as any);
      args.contextMenuData.value = { seriesName: "errors" };

      api.handleCreateAlert({ condition: "above", threshold: 10 });

      expect(readAlertPrefill()?.source).toBe("explorer");
    });

    it("navigates to alert creation, carrying the payload out of the URL", () => {
      const args = makeBase();
      const api = usePanelAlertCreation(args as any);
      args.contextMenuData.value = { seriesName: "errors" };

      api.handleCreateAlert({ condition: "above", threshold: 10 });

      expect(args.router.push).toHaveBeenCalledTimes(1);
      const pushArg = args.router.push.mock.calls[0][0];
      expect(pushArg.name).toBe("addAlert");
      expect(pushArg.query.org_identifier).toBe("org-1");
      expect(pushArg.query.prefill).toBe("panel");
      // The old scheme rode the URL and risked truncation; it must not come back.
      expect(pushArg.query.panelData).toBeUndefined();

      const stored = readAlertPrefill();
      expect(stored?.sourceLabel).toBe("Errors");
      expect(stored?.queryType).toBe("sql");
      expect(stored?.streamName).toBe("logs");
      expect(stored?.sql).toContain("where level");
      // The y-axis extraction is this surface's own knowledge — it survives as
      // the HAVING the consumer injects with the SQL parser.
      expect(stored?.meta?.sqlHaving).toEqual({
        column: "errors",
        operator: ">=",
        value: 10,
      });
    });

    it("explains itself in the confirm dialog instead of no-oping when the panel has no stream", () => {
      const args = makeBase();
      args.panelSchema.value.queries[0].fields = {
        y: [{ column: "errors", alias: "errors" }],
      };
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({ condition: "above", threshold: 10 });

      expect(args.router.push).not.toHaveBeenCalled();
      expect(alertCreationDialog.value?.open).toBe(true);
      expect(alertCreationDialog.value?.prefill.warnings.map((w) => w.key)).toContain("noStream");
    });

    it("leaves another query's threshold to the form when a series was clicked", () => {
      closeAlertCreationDialog();
      const args = makeBase();
      args.panelSchema.value.queries.push({
        query: 'select count(*) as "warns" from logs',
        fields: { stream: "logs", stream_type: "logs", y: [{ column: "warns", alias: "warns" }] },
      });
      const api = usePanelAlertCreation(args);
      args.contextMenuData.value = { seriesName: "errors" };

      api.handleCreateAlert({ condition: "above", threshold: 10, panelQueryIndex: 0 });
      expect(args.router.push).not.toHaveBeenCalled();
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving).toEqual({
        column: "errors",
        operator: ">=",
        value: 10,
      });

      rebuildAlertPrefill({ queryIndex: 1 });
      expect(alertCreationDialog.value?.prefill.sql).toBe('select count(*) as "warns" from logs');
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving).toBeUndefined();
      expect(alertCreationDialog.value?.prefill.warnings.map((w) => w.key)).toContain(
        "thresholdNotCarried",
      );

      rebuildAlertPrefill({ queryIndex: 0 });
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving?.value).toBe(10);
      expect(alertCreationDialog.value?.prefill.warnings.map((w) => w.key)).not.toContain(
        "thresholdNotCarried",
      );
      closeAlertCreationDialog();
    });

    it("keeps the clicked query's threshold on its own SQL alias when the event names no series", () => {
      closeAlertCreationDialog();
      const args = makeBase();
      args.panelSchema.value.queries[0] = {
        query: 'select histogram(_timestamp) as "x_axis_1", count(*) as "y_axis_1" from logs',
        fields: { stream: "logs", stream_type: "logs" },
      };
      args.metadata.value = { queries: [] };
      args.panelSchema.value.queries.push({ ...args.panelSchema.value.queries[0] });
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({ condition: "above", threshold: 4.42, panelQueryIndex: 0 });

      expect(alertCreationDialog.value?.prefill.queryIndex).toBe(0);
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving).toEqual({
        column: "y_axis_1",
        operator: ">=",
        value: 4.42,
      });
      closeAlertCreationDialog();
    });

    it("puts a single raw-SQL query's threshold on its own alias when it has no y-axis fields", () => {
      const args = makeBase();
      args.panelSchema.value.queries[0] = {
        query: 'select histogram(_timestamp) as "x_axis_1", count(*) as "y_axis_1" from logs',
        fields: { stream: "logs", stream_type: "logs" },
      };
      args.metadata.value = { queries: [] };
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({ condition: "above", threshold: 4.42, panelQueryIndex: 0 });

      expect(args.router.push).toHaveBeenCalledTimes(1);
      expect(readAlertPrefill()?.meta?.sqlHaving).toEqual({
        column: "y_axis_1",
        operator: ">=",
        value: 4.42,
      });
    });

    it("puts an empty-area threshold on a picked raw-SQL query's own column", () => {
      closeAlertCreationDialog();
      const args = makeBase();
      args.panelSchema.value.queries.push(
        { query: 'select avg(latency) as "p50" from logs', fields: { stream: "logs" } },
        {
          query: 'select approx_percentile_cont(latency, 0.95) as "p95" from logs',
          fields: { stream: "logs" },
        },
        { query: "select max(latency) as `slowest` from logs", fields: { stream: "logs" } },
        { query: "select now() as moment from logs", fields: { stream: "logs" } },
      );
      const api = usePanelAlertCreation(args);
      args.contextMenuData.value = { seriesName: "errors" };

      // An empty-area click ties the value to no series, so it rides to whichever query is picked.
      api.handleCreateAlert({ condition: "above", threshold: 10 });
      rebuildAlertPrefill({ queryIndex: 1 });
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving).toEqual({
        column: "p50",
        operator: ">=",
        value: 10,
      });

      rebuildAlertPrefill({ queryIndex: 2 });
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving?.column).toBe("p95");

      rebuildAlertPrefill({ queryIndex: 3 });
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving?.column).toBe("slowest");

      // No column of its own to find: better no HAVING than one on the clicked query's column.
      rebuildAlertPrefill({ queryIndex: 4 });
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving).toBeUndefined();

      rebuildAlertPrefill({ queryIndex: 0 });
      expect(alertCreationDialog.value?.prefill.meta?.sqlHaving?.column).toBe("errors");
      closeAlertCreationDialog();
    });

    it("keeps a builder query's right-clicked threshold in the SQL the form saves", () => {
      closeAlertCreationDialog();
      const args = makeBase();
      const built = builderQuery(args.panelSchema.value.queries[0]);
      args.panelSchema.value.queries = [built, { ...built }];
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({ condition: "above", threshold: 4.42 });

      const prefill = alertCreationDialog.value?.prefill;
      expect(prefill?.queryIndex).toBe(0);
      expect(prefill?.meta?.sqlHaving).toEqual({ column: "errors", operator: ">=", value: 4.42 });
      closeAlertCreationDialog();
    });

    it("writes a single builder query's right-clicked threshold into the SQL it saves", () => {
      const args = makeBase();
      args.panelSchema.value.queries = [builderQuery(args.panelSchema.value.queries[0])];
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({
        condition: "above",
        threshold: 4.179104477611935,
        panelQueryIndex: 0,
      });

      expect(args.router.push).toHaveBeenCalledTimes(1);
      const stored = readAlertPrefill();
      expect(stored?.queryChoices).toBeUndefined();
      expect(stored?.meta?.sqlHaving).toEqual({
        column: "errors",
        operator: ">=",
        value: 4.179104477611935,
      });
      expect(stored?.aggregation?.having).toMatchObject({ operator: ">=", value: 1 });
    });

    describe("a builder query plotting two y fields", () => {
      const twoY = () => {
        const args = makeBase();
        args.panelSchema.value.queries = [
          {
            query: 'select count(*) as "y_axis_1", avg(took) as "y_axis_2" from logs',
            customQuery: false,
            fields: {
              stream: "logs",
              stream_type: "logs",
              y: [
                { column: "_timestamp", alias: "y_axis_1", aggregationFunction: "count" },
                { column: "took", alias: "y_axis_2", aggregationFunction: "avg" },
              ],
            },
          },
          { query: 'select count(*) as "warns" from logs', fields: { stream: "logs" } },
        ];
        args.metadata.value = { queries: [] };
        return args;
      };
      beforeEach(() => closeAlertCreationDialog());

      it("writes the threshold on the y field the clicked series drew", () => {
        const args = twoY();
        args.contextMenuData.value = { yField: 1 };
        usePanelAlertCreation(args).handleCreateAlert({
          condition: "above",
          threshold: 250,
          panelQueryIndex: 0,
        });

        expect(alertCreationDialog.value?.prefill.meta?.sqlHaving).toEqual({
          column: "y_axis_2",
          operator: ">=",
          value: 250,
        });
      });

      it("falls back to the first y field and says so when the click names none", () => {
        const args = twoY();
        usePanelAlertCreation(args).handleCreateAlert({
          condition: "above",
          threshold: 250,
          panelQueryIndex: 0,
        });

        const prefill = alertCreationDialog.value?.prefill;
        expect(prefill?.meta?.sqlHaving).toEqual({
          column: "y_axis_1",
          operator: ">=",
          value: 250,
        });
        expect(prefill?.aggregation?.having).toMatchObject({ operator: ">=", value: 1 });
        expect(prefill?.warnings).toContainEqual({
          key: "thresholdColumnGuessed",
          level: "warning",
          params: { column: "y_axis_1" },
        });
      });

      it("works the same on a single-query panel, which still goes straight to the form", () => {
        const args = twoY();
        args.panelSchema.value.queries.pop();
        args.contextMenuData.value = { yField: 1 };
        const api = usePanelAlertCreation(args);

        api.handleCreateAlert({ condition: "above", threshold: 250 });
        expect(alertCreationDialog.value).toBeNull();
        expect(readAlertPrefill()?.meta?.sqlHaving).toEqual({
          column: "y_axis_2",
          operator: ">=",
          value: 250,
        });

        expect(readAlertPrefill()?.warnings.map((w) => w.key)).not.toContain(
          "thresholdColumnGuessed",
        );

        args.contextMenuData.value = {};
        api.handleCreateAlert({ condition: "above", threshold: 250 });
        expect(alertCreationDialog.value).toBeNull();
        expect(readAlertPrefill()?.meta?.sqlHaving).toEqual({
          column: "y_axis_1",
          operator: ">=",
          value: 250,
        });
        expect(readAlertPrefill()?.warnings.map((w) => w.key)).toContain("thresholdColumnGuessed");
        expect(args.router.push).toHaveBeenCalledTimes(2);
      });
    });

    describe("an empty query slot", () => {
      beforeEach(() => closeAlertCreationDialog());

      it("is no alert target, so the one real query goes straight to the form", () => {
        const args = makeBase();
        args.panelSchema.value.queries.push({ query: "  ", fields: { stream: "logs" } });
        const api = usePanelAlertCreation(args);

        api.handleCreateAlert({ condition: "above", threshold: 10 });
        expect(alertCreationDialog.value).toBeNull();
        expect(args.router.push).toHaveBeenCalledTimes(1);
        expect(readAlertPrefill()?.sql).toContain("where level");

        api.handleCreateAlert({ condition: "above", threshold: 10, panelQueryIndex: 0 });
        expect(alertCreationDialog.value).toBeNull();
        expect(args.router.push).toHaveBeenCalledTimes(2);
      });

      it("is left out of the choices beside two real queries", () => {
        const args = makeBase();
        args.panelSchema.value.queries.push(
          { query: "", fields: { stream: "logs" } },
          { query: 'select count(*) as "warns" from logs', fields: { stream: "logs" } },
        );
        usePanelAlertCreation(args).handleCreateAlert({ condition: "above", threshold: 10 });

        expect(alertCreationDialog.value?.prefill.queryChoices?.map((c) => c.index)).toEqual([
          0, 2,
        ]);
      });
    });

    it("does nothing when query is missing", () => {
      const args = makeBase();
      args.panelSchema.value.queries = [];
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({ condition: ">", threshold: 1 });

      expect(args.router.push).not.toHaveBeenCalled();
    });
  });

  describe("usePanelAlertCreation picks the query from the clicked series", () => {
    const makePromql = () => ({
      panelSchema: {
        value: {
          id: "panel-2",
          title: "Disk and IO",
          queryType: "promql",
          queries: [
            { query: "avg(disk_used)", fields: { stream: "disk_used", stream_type: "metrics" } },
            {
              query: "sum(rate(io_ops[$__rate_interval]))",
              fields: { stream: "io_ops", stream_type: "metrics" },
            },
          ],
        },
      },
      allowAlertCreation: { value: true },
      metadata: {
        value: {
          queries: [
            { query: "avg(disk_used)", panelQueryIndex: 0, timeRangeGap: { seconds: 0 } },
            {
              query: "sum(rate(io_ops[1m]))",
              panelQueryIndex: 1,
              timeRangeGap: { seconds: 0 },
            },
            {
              query: "sum(rate(io_ops[1m]))",
              panelQueryIndex: 1,
              timeRangeGap: { seconds: 86_400_000 },
            },
          ],
        },
      },
      selectedTimeObj: { value: { start_time: 1, end_time: 2 } },
      contextMenuData: { value: null as any },
      store: { state: { selectedOrganization: { identifier: "org-1" } } },
      router: { push: vi.fn() },
      emit: vi.fn(),
    });

    beforeEach(() => closeAlertCreationDialog());

    it("asks which query on a series click too, preselecting the clicked series' query", () => {
      const args = makePromql();
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({
        condition: "above",
        threshold: 5,
        panelQueryIndex: 1,
        seriesRole: "primary",
      });

      expect(args.router.push).not.toHaveBeenCalled();
      const prefill = alertCreationDialog.value?.prefill;
      expect(prefill?.queryChoices?.map((c) => c.index)).toEqual([0, 1]);
      expect(prefill?.queryIndex).toBe(1);
      expect(prefill?.streamName).toBe("io_ops");
      expect(prefill?.promql).toBe("sum(rate(io_ops[1m]))");
      expect(prefill?.promqlCondition).toEqual({ column: "value", operator: ">=", value: 5 });
    });

    it("does not carry a clicked series' value to a query on another scale", () => {
      const args = makePromql();
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({ condition: "below", threshold: 3, panelQueryIndex: 1 });
      rebuildAlertPrefill({ queryIndex: 0 });

      const prefill = alertCreationDialog.value?.prefill;
      expect(prefill?.queryIndex).toBe(0);
      expect(prefill?.promql).toBe("avg(disk_used)");
      expect(prefill?.promqlCondition).toBeUndefined();
      expect(prefill?.warnings).toContainEqual({
        key: "thresholdNotCarried",
        level: "warning",
        params: { value: "3" },
      });

      rebuildAlertPrefill({ queryIndex: 1 });
      expect(alertCreationDialog.value?.prefill.promqlCondition).toEqual({
        column: "value",
        operator: "<=",
        value: 3,
      });
    });

    it("alerts a shifted series on its parent's current-period query", () => {
      const args = makePromql();
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({
        condition: "below",
        threshold: 2,
        panelQueryIndex: 1,
        seriesRole: "shifted",
      });

      const prefill = alertCreationDialog.value?.prefill;
      expect(prefill?.queryIndex).toBe(1);
      expect(prefill?.promql).toBe("sum(rate(io_ops[1m]))");
      expect(prefill?.promqlCondition?.operator).toBe("<=");
    });

    it("keeps the source override through a query switch, so the explorer dialog stays minimal", () => {
      const args = { ...makePromql(), alertSource: { value: "explorer" } };
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({ condition: "above", threshold: 5, panelQueryIndex: 0 });
      expect(alertCreationDialog.value?.prefill.source).toBe("explorer");

      rebuildAlertPrefill({ queryIndex: 1 });
      expect(alertCreationDialog.value?.prefill.source).toBe("explorer");
    });

    it("treats a series naming a hidden query as no series, carrying its value to the visible one", () => {
      const args = { ...makePromql(), visibleQueryIndexes: { value: [1] } };
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({ condition: "above", threshold: 5, panelQueryIndex: 0 });

      expect(alertCreationDialog.value).toBeNull();
      const stored = readAlertPrefill();
      expect(stored?.promql).toBe("sum(rate(io_ops[1m]))");
      expect(stored?.promqlCondition).toEqual({ column: "value", operator: ">=", value: 5 });
      expect(stored?.warnings.map((w) => w.key)).not.toContain("thresholdNotCarried");
    });

    it("on several visible queries, asks without a preselection and carries the value like an empty-area click", () => {
      const args = makePromql();
      args.panelSchema.value.queries.push({
        query: "max(disk_used)",
        fields: { stream: "disk_used", stream_type: "metrics" },
      });
      const api = usePanelAlertCreation({ ...args, visibleQueryIndexes: { value: [0, 2] } });

      api.handleCreateAlert({ condition: "above", threshold: 5, panelQueryIndex: 1 });

      const prefill = alertCreationDialog.value?.prefill;
      expect(prefill?.queryChoices?.map((c) => c.index)).toEqual([0, 2]);
      expect(prefill?.queryIndex).toBe(0);
      expect(prefill?.promqlCondition?.value).toBe(5);

      rebuildAlertPrefill({ queryIndex: 2 });
      expect(alertCreationDialog.value?.prefill.promqlCondition?.value).toBe(5);
      expect(alertCreationDialog.value?.prefill.warnings.map((w) => w.key)).not.toContain(
        "thresholdNotCarried",
      );
    });

    describe("the not-carried threshold in the form's banner", () => {
      afterEach(() => {
        setLanguage("");
        vi.restoreAllMocks();
      });

      const shownValue = () => {
        closeAlertCreationDialog();
        const api = usePanelAlertCreation(makePromql());
        api.handleCreateAlert({ condition: "above", threshold: 1234.5678, panelQueryIndex: 1 });
        rebuildAlertPrefill({ queryIndex: 0 });
        return alertCreationDialog.value?.prefill.warnings.find(
          (w) => w.key === "thresholdNotCarried",
        )?.params?.value;
      };

      it("is written in the app's language, not the browser's", () => {
        vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
        setLanguage("en-us");
        expect(shownValue()).toBe("1,234.57");
        setLanguage("de");
        expect(shownValue()).toBe("1.234,57");
      });
    });

    it("skips the dialog for a clicked series when only its query is visible", () => {
      const args = { ...makePromql(), visibleQueryIndexes: { value: [1] } };
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({ condition: "above", threshold: 5, panelQueryIndex: 1 });

      expect(alertCreationDialog.value).toBeNull();
      expect(args.router.push).toHaveBeenCalledTimes(1);
      expect(readAlertPrefill()?.promqlCondition?.value).toBe(5);
    });

    it("asks which query when the click hit no series and the panel has several", () => {
      const args = makePromql();
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({ condition: "above", threshold: 7 });

      expect(args.router.push).not.toHaveBeenCalled();
      const dialog = alertCreationDialog.value;
      expect(dialog?.open).toBe(true);
      expect(dialog?.prefill.queryChoices?.map((c) => c.query)).toEqual([
        "avg(disk_used)",
        "sum(rate(io_ops[1m]))",
      ]);

      rebuildAlertPrefill({ queryIndex: 1 });

      expect(alertCreationDialog.value?.prefill.promql).toBe("sum(rate(io_ops[1m]))");
      expect(alertCreationDialog.value?.prefill.streamName).toBe("io_ops");
      expect(alertCreationDialog.value?.prefill.queryIndex).toBe(1);
      expect(alertCreationDialog.value?.prefill.promqlCondition?.value).toBe(7);
    });

    it("refuses the raw template text when the panel has not run, rather than storing $__", () => {
      const args = makePromql();
      args.metadata.value = { queries: [] };
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({ condition: "above", threshold: 5, panelQueryIndex: 1 });

      expect(args.router.push).not.toHaveBeenCalled();
      expect(alertCreationDialog.value?.prefill.warnings.map((w) => w.key)).toContain(
        "unresolvedQuery",
      );
    });

    it("offers only the visible queries, and skips the dialog when one is left", () => {
      const args = { ...makePromql(), visibleQueryIndexes: { value: [1] } };
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({ condition: "above", threshold: 7 });

      expect(alertCreationDialog.value).toBeNull();
      expect(readAlertPrefill()?.promql).toBe("sum(rate(io_ops[1m]))");
    });
  });

  describe("usePanelAlertCreation on a formula series", () => {
    const combined = "(sum(rate(errors[1m]))) / (sum(rate(requests[1m]))) * 100";
    const makeFormula = () => ({
      panelSchema: {
        value: {
          id: "panel-3",
          title: "Error ratio",
          queryType: "promql",
          queries: [
            {
              query: "sum(rate(errors[$__rate_interval]))",
              fields: { stream: "errors", stream_type: "metrics" },
              config: { ref: "A", hide: true },
            },
            {
              query: "sum(rate(requests[$__rate_interval]))",
              fields: { stream: "requests", stream_type: "metrics" },
              config: { ref: "B", hide: true },
            },
            { query: "", fields: { stream_type: "metrics" }, config: { formula: "A / B * 100" } },
          ],
        },
      },
      allowAlertCreation: { value: true },
      metadata: {
        value: {
          queries: [
            { query: "sum(rate(errors[1m]))", panelQueryIndex: 0, notSent: true },
            { query: "sum(rate(requests[1m]))", panelQueryIndex: 1, notSent: true },
            { query: combined, panelQueryIndex: 2, timeRangeGap: { seconds: 0 } },
          ],
        },
      },
      selectedTimeObj: { value: { start_time: 1, end_time: 2 } },
      contextMenuData: { value: null as any },
      store: { state: { selectedOrganization: { identifier: "org-1" } } },
      router: { push: vi.fn() },
      emit: vi.fn(),
      visibleQueryIndexes: { value: [2] },
    });

    beforeEach(() => closeAlertCreationDialog());

    it("prefills the combined expression and lets the user pick an input metric", () => {
      const args = makeFormula();
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({
        condition: "above",
        threshold: 5,
        panelQueryIndex: 2,
        seriesRole: "primary",
      });

      expect(args.router.push).not.toHaveBeenCalled();
      const prefill = alertCreationDialog.value?.prefill;
      expect(prefill?.promql).toBe(combined);
      expect(prefill?.streamCandidates?.map((c) => c.name)).toEqual(["errors", "requests"]);
      expect(prefill?.queryChoices).toBeUndefined();
    });

    it("opens nothing on empty chart area when every query is hidden", () => {
      const args = { ...makeFormula(), visibleQueryIndexes: { value: [] as number[] } };
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({ condition: "above", threshold: 5 });

      expect(args.router.push).not.toHaveBeenCalled();
      expect(alertCreationDialog.value).toBeNull();
    });

    it("on empty chart area, alerts on the one visible query, never a hidden input", () => {
      const args = makeFormula();
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({ condition: "above", threshold: 5 });

      const prefill = alertCreationDialog.value?.prefill;
      expect(prefill?.promql).toBe(combined);
      expect(prefill?.queryChoices).toBeUndefined();
      expect(prefill?.streamCandidates?.map((c) => c.name)).toEqual(["errors", "requests"]);
    });
  });

  describe("usePanelAlertCreation on a forecast line (entry B)", () => {
    const DAY = 86_400;
    const END_S = 1_800_000_000;
    // Executed text differs from the schema's, as variable substitution makes it.
    const executed = (expr: string) => expr.replace("(", "( ");
    const explorerPanel = (expr: string, stream: string) => ({
      panelSchema: {
        value: {
          id: "metrics-explorer-card",
          title: "",
          queryType: "promql",
          queries: [{ query: expr, fields: { stream, stream_type: "metrics" } }],
        },
      },
      allowAlertCreation: { value: true },
      metadata: {
        value: {
          queries: [
            {
              query: executed(expr),
              startTime: (END_S - 6 * 3600) * 1e6,
              endTime: END_S * 1e6,
            },
          ],
        },
      },
      // The Explorer's Date pair: built from ms epochs.
      selectedTimeObj: {
        value: {
          start_time: new Date((END_S - 6 * 3600) * 1000),
          end_time: new Date(END_S * 1000),
        },
      },
      contextMenuData: {
        value: {
          seriesRole: "forecast",
          forecastPoint: {
            rangeEndValue: 0.8,
            startTime: END_S,
            startValue: 0.8,
            endValue: 1,
            clickedTime: END_S + 2.5 * DAY,
          },
        },
      },
      store: { state: { selectedOrganization: { identifier: "org-1" } } },
      router: { push: vi.fn() },
      emit: vi.fn(),
    });

    it.each([
      ["a gauge's avg", "avg(node_disk_used_ratio)", "node_disk_used_ratio"],
      ["a gauge's sum", "sum(node_disk_used_bytes)", "node_disk_used_bytes"],
      [
        "a histogram percentile",
        "histogram_quantile(0.99, sum by (le) (rate(req_seconds_bucket[5m])))",
        "req_seconds_bucket",
      ],
    ])("alerts on %s as charted, with H from the clicked point", (_name, expr, stream) => {
      const args = explorerPanel(expr, stream);
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({
        condition: "forecast",
        threshold: 0.9,
        panelQueryIndex: 0,
        seriesRole: "forecast",
      });

      expect(args.router.push).toHaveBeenCalledTimes(1);
      const stored = readAlertPrefill();
      expect(stored?.streamName).toBe(stream);
      expect(stored?.promql).toBe(
        buildForecastAlertPromql({ U: executed(expr), T: 0.9, direction: "rises", W: "6h" }),
      );
      expect(stored?.promqlCondition).toEqual({ column: "value", operator: "<=", value: 3 });
      expect(stored?.promqlMultiAlert).toBe(true);
      expect(stored?.periodMinutes).toBe(5);
      expect(stored?.frequencyMinutes).toBe(30);
      // The form recognises its own output, so it opens in Forecast mode on these fields.
      expect(stored?.warnings.map((w) => w.key)).toEqual([]);
      expect(parseForecastAlertPromql(stored?.promql, stored?.promqlCondition)).toEqual({
        U: executed(expr),
        T: 0.9,
        direction: "rises",
        W: "6h",
        H: 3,
      });
    });

    it("stays on the clicked query of a multi-query card, since the forecast is fitted to it", () => {
      closeAlertCreationDialog();
      const args = explorerPanel("avg(node_disk_used_ratio)", "node_disk_used_ratio");
      args.panelSchema.value.queries.push({
        query: "max(node_disk_used_ratio)",
        fields: { stream: "node_disk_used_ratio", stream_type: "metrics" },
      });
      const api = usePanelAlertCreation(args);

      api.handleCreateAlert({
        condition: "forecast",
        threshold: 0.9,
        panelQueryIndex: 0,
        seriesRole: "forecast",
      });

      expect(alertCreationDialog.value).toBeNull();
      expect(args.router.push).toHaveBeenCalledTimes(1);
      expect(readAlertPrefill()?.promql).toBe(
        buildForecastAlertPromql({
          U: executed("avg(node_disk_used_ratio)"),
          T: 0.9,
          direction: "rises",
          W: "6h",
        }),
      );
    });
  });

  describe("usePanelDownload", () => {
    const makeDeps = () => ({
      panelSchema: { value: { type: "line", queryType: "sql" } },
      data: {
        value: [
          [
            { a: 1, b: "x" },
            { a: 2, b: "y" },
          ],
        ],
      },
      filteredData: { value: [{ result: [{ value: [1, "10"] }] }] },
      tableRendererRef: {
        value: {
          downloadTableAsCSV: vi.fn(),
          downloadTableAsJSON: vi.fn(),
        },
      },
      showErrorNotification: vi.fn(),
      showPositiveNotification: vi.fn(),
      t: gt,
    });

    it("delegates table downloads to table renderer", () => {
      const deps = makeDeps();
      deps.panelSchema.value.type = "table";
      const api = usePanelDownload(deps as any);

      api.downloadDataAsCSV("table-title");
      api.downloadDataAsJSON("table-title");

      expect(deps.tableRendererRef.value.downloadTableAsCSV).toHaveBeenCalledWith("table-title");
      expect(deps.tableRendererRef.value.downloadTableAsJSON).toHaveBeenCalledWith("table-title");
    });

    it("shows error when non-table chart has no CSV data", () => {
      const deps = makeDeps();
      deps.data.value = [];
      const api = usePanelDownload(deps as any);

      api.downloadDataAsCSV("empty");

      expect(deps.showErrorNotification).toHaveBeenCalledWith("No data available to download");
    });

    it("exports SQL chart data as CSV and shows success notification", () => {
      const deps = makeDeps();
      (downloadFile as any).mockReturnValue(true);
      const api = usePanelDownload(deps as any);

      api.downloadDataAsCSV("chart");

      expect(downloadFile).toHaveBeenCalledWith(
        "chart.csv",
        expect.stringContaining("a,b"),
        "text/csv",
      );
      expect(deps.showPositiveNotification).toHaveBeenCalledWith(
        "Chart data downloaded as a CSV file",
        { timeout: 2000 },
      );
    });

    it("exports a PromQL instant result as CSV", () => {
      const deps = makeDeps();
      deps.panelSchema.value.queryType = "promql";
      (downloadFile as any).mockReturnValue(true);
      usePanelDownload(deps as any).downloadDataAsCSV("instant");

      expect(downloadFile).toHaveBeenCalledWith(
        "instant.csv",
        "timestamp,value\r\n1,10",
        "text/csv",
      );
    });

    it("reports no data instead of an empty PromQL CSV", () => {
      const deps = makeDeps();
      deps.panelSchema.value.queryType = "promql";
      deps.filteredData.value = [{ result: [] }];
      usePanelDownload(deps as any).downloadDataAsCSV("empty");

      expect(downloadFile).not.toHaveBeenCalled();
      expect(deps.showErrorNotification).toHaveBeenCalledWith("No data available to download");
    });

    it("exports PromQL filtered data as JSON", () => {
      const deps = makeDeps();
      deps.panelSchema.value.queryType = "promql";
      (downloadFile as any).mockReturnValue(true);
      const api = usePanelDownload(deps as any);

      api.downloadDataAsJSON("prom");

      expect(downloadFile).toHaveBeenCalledWith(
        "prom.json",
        JSON.stringify(deps.filteredData.value, null, 2),
        "application/json",
      );
      expect(deps.showPositiveNotification).toHaveBeenCalledWith(
        "Chart data downloaded as a JSON file",
        { timeout: 2000 },
      );
    });
  });
});
