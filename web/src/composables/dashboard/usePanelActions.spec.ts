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
import {
  wrapCsvValue,
  usePanelAlertCreation,
  usePanelDownload,
} from "./usePanelActions";
import { exportFile } from "quasar";

vi.mock("quasar", () => ({
  exportFile: vi.fn(),
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
      expect(args.contextMenuData.value).toEqual(
        expect.objectContaining({ seriesName: "errors" }),
      );

      args.allowAlertCreation.value = false;
      api.hideContextMenu();
      api.onChartDomContextMenu({ x: 1, y: 2, value: 3 });
      expect(api.contextMenuVisible.value).toBe(false);
    });

    it("navigates to alert creation with encoded panel payload", () => {
      const args = makeBase();
      const api = usePanelAlertCreation(args as any);
      args.contextMenuData.value = { seriesName: "errors" };

      api.handleCreateAlert({ condition: ">", threshold: 10 });

      expect(args.router.push).toHaveBeenCalledTimes(1);
      const pushArg = args.router.push.mock.calls[0][0];
      expect(pushArg.name).toBe("addAlert");
      expect(pushArg.query.org_identifier).toBe("org-1");
      expect(pushArg.query.fromPanel).toBe("true");

      const decoded = JSON.parse(decodeURIComponent(pushArg.query.panelData));
      expect(decoded.panelTitle).toBe("Errors");
      expect(decoded.queryType).toBe("sql");
      expect(decoded.threshold).toBe(10);
      expect(decoded.condition).toBe(">"
      );
      expect(decoded.yAxisColumn).toBe("errors");
      expect(decoded.executedQuery).toContain("where level");
    });

    it("does nothing when query is missing", () => {
      const args = makeBase();
      args.panelSchema.value.queries = [];
      const api = usePanelAlertCreation(args as any);

      api.handleCreateAlert({ condition: ">", threshold: 1 });

      expect(args.router.push).not.toHaveBeenCalled();
    });
  });

  describe("usePanelDownload", () => {
    const makeDeps = () => ({
      panelSchema: { value: { type: "line", queryType: "sql" } },
      data: { value: [[{ a: 1, b: "x" }, { a: 2, b: "y" }]] },
      filteredData: { value: [{ result: [{ value: [1, "10"] }] }] },
      tableRendererRef: {
        value: {
          downloadTableAsCSV: vi.fn(),
          downloadTableAsJSON: vi.fn(),
        },
      },
      showErrorNotification: vi.fn(),
      showPositiveNotification: vi.fn(),
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
      (exportFile as any).mockReturnValue(true);
      const api = usePanelDownload(deps as any);

      api.downloadDataAsCSV("chart");

      expect(exportFile).toHaveBeenCalledWith(
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
      (exportFile as any).mockReturnValue(true);
      const api = usePanelDownload(deps as any);

      api.downloadDataAsJSON("prom");

      expect(exportFile).toHaveBeenCalledWith(
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
