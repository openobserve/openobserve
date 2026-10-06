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
import { gt } from "@/types/i18n";
import { wrapCsvValue, usePanelAlertCreation, usePanelDownload } from "./usePanelActions";
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
          ],
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

    it("prefills the clicked series' query with its executed text", () => {
      const args = makePromql();
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({
        condition: "above",
        threshold: 5,
        panelQueryIndex: 1,
        seriesRole: "primary",
      });

      expect(args.router.push).toHaveBeenCalledTimes(1);
      const stored = readAlertPrefill();
      expect(stored?.streamName).toBe("io_ops");
      expect(stored?.promql).toBe("sum(rate(io_ops[1m]))");
      expect(stored?.promqlCondition).toEqual({ column: "value", operator: ">=", value: 5 });
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

      const stored = readAlertPrefill();
      expect(stored?.promql).toBe("sum(rate(io_ops[1m]))");
      expect(stored?.promqlCondition?.operator).toBe("<=");
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

  describe("usePanelAlertCreation on a forecast line (entry B)", () => {
    const DAY = 86_400;
    const END_S = 1_800_000_000;
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
        value: { queries: [{ startTime: (END_S - 6 * 3600) * 1e6, endTime: END_S * 1e6 }] },
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
          forecastPoint: { startTime: END_S, startValue: 0.8, clickedTime: END_S + 2.5 * DAY },
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
        buildForecastAlertPromql({ U: expr, T: 0.9, direction: "rises", W: "6h" }),
      );
      expect(stored?.promqlCondition).toEqual({ column: "value", operator: "<=", value: 3 });
      expect(stored?.promqlMultiAlert).toBe(true);
      expect(stored?.periodMinutes).toBe(5);
      expect(stored?.frequencyMinutes).toBe(30);
      // The form recognises its own output, so it opens in Forecast mode on these fields.
      expect(parseForecastAlertPromql(stored?.promql, stored?.promqlCondition)).toEqual({
        U: expr,
        T: 0.9,
        direction: "rises",
        W: "6h",
        H: 3,
      });
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
