// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  modifySQLQuery,
  getConsumableDateTime,
  getAllDashboards,
  getFoldersListByType,
  getAllDashboardsByFolderId,
  getTabDataFromTabId,
  addPanel,
  addVariable,
  deleteVariable,
  deletePanel,
  updateVariable,
  updatePanel,
  updateDashboard,
  getDashboard,
  deleteDashboardById,
  getPanel,
  getPanelId,
  getTabId,
  deleteTab,
  editTab,
  addTab,
  movePanelToAnotherTab,
  getFoldersList,
  deleteFolderById,
  deleteFolderByIdByType,
  createFolder,
  createFolderByType,
  updateFolder,
  updateFolderByType,
  moveDashboardToAnotherFolder,
  moveModuleToAnotherFolder,
  checkIfVariablesAreLoaded,
} from "./commons";

// Mock dependencies
vi.mock("../services/dashboards", () => ({
  default: {
    list: vi.fn(),
    get_Dashboard: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    list_Folders: vi.fn(),
    delete_Folder: vi.fn(),
    new_Folder: vi.fn(),
    edit_Folder: vi.fn(),
    move_Dashboard: vi.fn(),
  },
}));

vi.mock("../services/common", () => ({
  default: {
    list_Folders: vi.fn(),
    delete_Folder: vi.fn(),
    new_Folder: vi.fn(),
    edit_Folder: vi.fn(),
    move_across_folders: vi.fn(),
  },
}));

vi.mock("./dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data),
}));

vi.mock("quasar", () => ({
  date: {
    subtractFromDate: vi.fn((date, obj) => new Date(date.getTime() - 3600000)),
  },
}));

// Mock moment globally
global.moment = vi.fn((date) => ({
  format: vi.fn((format) => {
    if (format === "YYYY-MM-DDThh:mm:ssZ") {
      return "2023-01-01T12:00:00Z";
    }
    return "2023-01-01T12:00:00Z";
  }),
}));

vi.mock("moment", () => ({
  default: global.moment,
}));

import dashboardService from "../services/dashboards";
import commonService from "../services/common";

describe("Commons Utility Functions", () => {
  let mockStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
        organizationData: {
          allDashboardList: {},
          allDashboardData: {},
          allDashboardListHash: {},
          folders: [],
          foldersByType: {},
        },
      },
      dispatch: vi.fn(),
    };
  });

  describe("modifySQLQuery", () => {
    it("should modify SQL query with time_range when WHERE clause exists", async () => {
      const currentTimeObj = {
        start_time: "2023-01-01T00:00:00Z",
        end_time: "2023-01-01T23:59:59Z",
      };
      const querySQL = "SELECT * FROM logs WHERE level = 'error'";
      const timestampColumn = "_timestamp";

      const result = await modifySQLQuery(currentTimeObj, querySQL, timestampColumn);

      expect(result).toContain("time_range(_timestamp,'2023-01-01T12:00:00Z', '2023-01-01T12:00:00Z')");
      expect(result).toContain("WHERE");
      expect(result).toContain("level = 'error'");
    });

    it.skip("should modify SQL query by replacing existing time_range", async () => {
      const currentTimeObj = {
        start_time: "2023-01-01T00:00:00Z",
        end_time: "2023-01-01T23:59:59Z",
      };
      const querySQL = "SELECT * FROM logs WHERE time_range(_timestamp,'old_start','old_end') AND level = 'error'";
      const timestampColumn = "_timestamp";

      const result = await modifySQLQuery(currentTimeObj, querySQL, timestampColumn);

      expect(result).not.toContain("old_start");
      expect(result).not.toContain("old_end");
      expect(result).toContain("time_range(_timestamp,'2023-01-01T12:00:00Z', '2023-01-01T12:00:00Z')");
    });

    it.skip("should return original query when no WHERE clause and no existing time_range", async () => {
      const currentTimeObj = {
        start_time: "2023-01-01T00:00:00Z",
        end_time: "2023-01-01T23:59:59Z",
      };
      const querySQL = "SELECT * FROM logs";
      const timestampColumn = "_timestamp";

      const result = await modifySQLQuery(currentTimeObj, querySQL, timestampColumn);

      expect(result).toBe(querySQL);
    });

    it.skip("should handle complex time_range patterns", async () => {
      const currentTimeObj = {
        start_time: "2023-01-01T00:00:00Z",
        end_time: "2023-01-01T23:59:59Z",
      };
      const querySQL = "SELECT * FROM logs WHERE time_range(_timestamp, '2023-01-01', '2023-01-02') AND user_id = 123";
      const timestampColumn = "_timestamp";

      const result = await modifySQLQuery(currentTimeObj, querySQL, timestampColumn);

      expect(result).toContain("time_range(_timestamp,'2023-01-01T12:00:00Z', '2023-01-01T12:00:00Z')");
      expect(result).toContain("user_id = 123");
    });
  });

  describe("getConsumableDateTime", () => {
    it("should handle relative date with minutes", () => {
      const dateObj = {
        tab: "relative",
        relative: {
          value: 30,
          period: { label: "Minutes" },
        },
      };

      const result = getConsumableDateTime(dateObj);

      expect(result).toHaveProperty("start_time");
      expect(result).toHaveProperty("end_time");
      expect(result.start_time).toBeInstanceOf(Date);
      expect(result.end_time).toBeInstanceOf(Date);
    });

    it("should handle relative date with weeks (convert to days)", () => {
      const dateObj = {
        tab: "relative",
        relative: {
          value: 2,
          period: { label: "Weeks" },
        },
      };

      const result = getConsumableDateTime(dateObj);

      expect(result).toHaveProperty("start_time");
      expect(result).toHaveProperty("end_time");
      expect(result.start_time).toBeInstanceOf(Date);
      expect(result.end_time).toBeInstanceOf(Date);
    });

    it("should handle relative date with string value", () => {
      const dateObj = {
        tab: "relative",
        relative: {
          value: "5h",
          period: { label: "Hours" },
        },
      };

      const result = getConsumableDateTime(dateObj);

      expect(result).toHaveProperty("start_time");
      expect(result).toHaveProperty("end_time");
    });

    it("should handle absolute date with complete date and time", () => {
      const dateObj = {
        tab: "absolute",
        absolute: {
          date: {
            from: "2023-01-01",
            to: "2023-01-02",
          },
          startTime: "00:00:00",
          endTime: "23:59:59",
        },
      };

      const result = getConsumableDateTime(dateObj);

      expect(result).toHaveProperty("start_time");
      expect(result).toHaveProperty("end_time");
      expect(result.start_time).toBeInstanceOf(Date);
      expect(result.end_time).toBeInstanceOf(Date);
    });

    it("should handle absolute date with empty values (default to current date)", () => {
      const dateObj = {
        tab: "absolute",
        absolute: {
          date: { from: "", to: "" },
          startTime: "",
          endTime: "",
        },
      };

      const result = getConsumableDateTime(dateObj);

      expect(result).toHaveProperty("start_time");
      expect(result).toHaveProperty("end_time");
      expect(result.start_time).toBeInstanceOf(Date);
      expect(result.end_time).toBeInstanceOf(Date);
    });

    it("should handle partial absolute date values", () => {
      const dateObj = {
        tab: "absolute",
        absolute: {
          date: { from: "2023-01-01", to: "" },
          startTime: "12:00:00",
          endTime: "",
        },
      };

      const result = getConsumableDateTime(dateObj);

      expect(result).toHaveProperty("start_time");
      expect(result).toHaveProperty("end_time");
    });
  });

  describe("getAllDashboards", () => {
    it("should fetch and store dashboard list for given folderId", async () => {
      const folderId = "test-folder";
      const mockResponse = {
        data: {
          dashboards: [
            {
              version: 1,
              folder_id: "test-folder",
              folder_name: "Test Folder",
              dashboard_id: "dashboard-1",
              title: "Dashboard 1",
              description: "Test dashboard",
              role: "admin",
              owner: "user@test.com",
              created: "2023-01-01T00:00:00Z",
              hash: 123456,
            },
          ],
        },
      };

      (dashboardService.list as any).mockResolvedValue(mockResponse);

      await getAllDashboards(mockStore, folderId);

      expect(dashboardService.list).toHaveBeenCalledWith(
        0,
        1000,
        "name",
        false,
        "",
        "test-org",
        folderId,
        ""
      );
      expect(mockStore.dispatch).toHaveBeenCalledWith("setAllDashboardList", expect.any(Object));
    });

    it("should return early when no folderId provided", async () => {
      await getAllDashboards(mockStore, null);

      expect(dashboardService.list).not.toHaveBeenCalled();
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it("should throw error when API call fails", async () => {
      const folderId = "test-folder";
      const error = new Error("API Error");
      (dashboardService.list as any).mockRejectedValue(error);

      await expect(getAllDashboards(mockStore, folderId)).rejects.toThrow("API Error");
    });

    it("should sort dashboards by created date in descending order", async () => {
      const folderId = "test-folder";
      const mockResponse = {
        data: {
          dashboards: [
            {
              version: 1,
              folder_id: "test-folder",
              folder_name: "Test Folder",
              dashboard_id: "dashboard-1",
              title: "Dashboard 1",
              description: "Test dashboard",
              role: "admin",
              owner: "user@test.com",
              created: "2023-01-01T00:00:00Z",
              hash: 123456,
            },
            {
              version: 1,
              folder_id: "test-folder",
              folder_name: "Test Folder",
              dashboard_id: "dashboard-2",
              title: "Dashboard 2",
              description: "Test dashboard 2",
              role: "admin",
              owner: "user@test.com",
              created: "2023-01-02T00:00:00Z",
              hash: 123457,
            },
          ],
        },
      };

      (dashboardService.list as any).mockResolvedValue(mockResponse);

      await getAllDashboards(mockStore, folderId);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        "setAllDashboardList",
        expect.objectContaining({
          [folderId]: expect.arrayContaining([
            expect.objectContaining({ created: "2023-01-02T00:00:00Z" }),
            expect.objectContaining({ created: "2023-01-01T00:00:00Z" }),
          ]),
        })
      );
    });
  });

  describe("getFoldersListByType", () => {
    it("should fetch folders by type and put default folder first", async () => {
      const type = "dashboards";
      const mockResponse = {
        data: {
          list: [
            { folderId: "folder1", name: "Folder 1", description: "Folder 1" },
            { folderId: "default", name: "Default", description: "Default folder" },
            { folderId: "folder2", name: "Folder 2", description: "Folder 2" },
          ],
        },
      };

      (commonService.list_Folders as any).mockResolvedValue(mockResponse);
      mockStore.state.organizationData.foldersByType[type] = [
        { folderId: "default", name: "Default", description: "Default folder" },
        { folderId: "folder1", name: "Folder 1", description: "Folder 1" },
        { folderId: "folder2", name: "Folder 2", description: "Folder 2" },
      ];

      const result = await getFoldersListByType(mockStore, type);

      expect(commonService.list_Folders).toHaveBeenCalledWith("test-org", type);
      expect(mockStore.dispatch).toHaveBeenCalledWith("setFoldersByType", {
        [type]: expect.arrayContaining([
          expect.objectContaining({ folderId: "default" }),
          expect.objectContaining({ folderId: "folder1" }),
          expect.objectContaining({ folderId: "folder2" }),
        ]),
      });
      expect(result[0].folderId).toBe("default");
    });

    it("should create default folder when not present in response", async () => {
      const type = "dashboards";
      const mockResponse = {
        data: {
          list: [
            { folderId: "folder1", name: "Folder 1", description: "Folder 1" },
          ],
        },
      };

      (commonService.list_Folders as any).mockResolvedValue(mockResponse);
      mockStore.state.organizationData.foldersByType[type] = [
        { name: "default", folderId: "default", description: "default" },
        { folderId: "folder1", name: "Folder 1", description: "Folder 1" },
      ];

      const result = await getFoldersListByType(mockStore, type);

      expect(result[0]).toEqual({
        name: "default",
        folderId: "default",
        description: "default",
      });
    });

    it("should throw error when API call fails", async () => {
      const type = "dashboards";
      const error = new Error("API Error");
      (commonService.list_Folders as any).mockRejectedValue(error);

      await expect(getFoldersListByType(mockStore, type)).rejects.toThrow("API Error");
    });
  });

  describe("getAllDashboardsByFolderId", () => {
    it("should return dashboard list from store when available", async () => {
      const folderId = "test-folder";
      const dashboards = [{ dashboardId: "dashboard-1" }];
      mockStore.state.organizationData.allDashboardList[folderId] = dashboards;

      const result = await getAllDashboardsByFolderId(mockStore, folderId);

      expect(result).toBe(dashboards);
      expect(dashboardService.list).not.toHaveBeenCalled();
    });

    it("should fetch dashboard list when not in store", async () => {
      const folderId = "test-folder";
      const mockResponse = {
        data: {
          dashboards: [
            {
              version: 1,
              folder_id: "test-folder",
              folder_name: "Test Folder",
              dashboard_id: "dashboard-1",
              title: "Dashboard 1",
              description: "Test dashboard",
              role: "admin",
              owner: "user@test.com",
              created: "2023-01-01T00:00:00Z",
              hash: 123456,
            },
          ],
        },
      };

      (dashboardService.list as any).mockResolvedValue(mockResponse);

      await getAllDashboardsByFolderId(mockStore, folderId);

      expect(dashboardService.list).toHaveBeenCalled();
    });
  });

  describe("getTabDataFromTabId", () => {
    it("should return tab data for matching tabId", () => {
      const dashboardData = {
        tabs: [
          { tabId: "tab1", name: "Tab 1" },
          { tabId: "tab2", name: "Tab 2" },
        ],
      };

      const result = getTabDataFromTabId(dashboardData, "tab2");

      expect(result).toEqual({ tabId: "tab2", name: "Tab 2" });
    });

    it("should return undefined when tabId not found", () => {
      const dashboardData = {
        tabs: [
          { tabId: "tab1", name: "Tab 1" },
          { tabId: "tab2", name: "Tab 2" },
        ],
      };

      const result = getTabDataFromTabId(dashboardData, "tab3");

      expect(result).toBeUndefined();
    });

    it("should handle undefined dashboardData", () => {
      const result = getTabDataFromTabId(undefined, "tab1");

      expect(result).toBeUndefined();
    });

    it("should handle dashboardData with no tabs", () => {
      const dashboardData = {};

      const result = getTabDataFromTabId(dashboardData, "tab1");

      expect(result).toBeUndefined();
    });
  });

  describe("getPanelId", () => {
    it("should generate a panel ID with correct prefix", () => {
      const panelId = getPanelId();

      expect(panelId).toMatch(/^Panel_ID\d+$/);
      expect(panelId).toContain("Panel_ID");
    });

    it("should generate different IDs on multiple calls", () => {
      const id1 = getPanelId();
      const id2 = getPanelId();

      expect(id1).not.toBe(id2);
    });
  });

  describe("getTabId", () => {
    it("should generate a numeric tab ID as string", () => {
      const tabId = getTabId();

      expect(typeof tabId).toBe("string");
      expect(parseInt(tabId)).toBeGreaterThanOrEqual(10);
      expect(parseInt(tabId)).toBeLessThanOrEqual(100009);
    });

    it("should generate different IDs on multiple calls", () => {
      const id1 = getTabId();
      const id2 = getTabId();

      expect(id1).not.toBe(id2);
    });
  });

  describe("checkIfVariablesAreLoaded", () => {
    it("should return true when all variables are loaded", () => {
      const variablesData = {
        values: [
          { isLoading: false, isVariableLoadingPending: false },
          { isLoading: false, isVariableLoadingPending: false },
        ],
        isVariablesLoading: false,
      };

      const result = checkIfVariablesAreLoaded(variablesData);

      expect(result).toBe(true);
    });

    it("should return false when no values present", () => {
      const variablesData = {
        values: [],
        isVariablesLoading: false,
      };

      const result = checkIfVariablesAreLoaded(variablesData);

      expect(result).toBe(false);
    });

    it("should return false when some variables are loading", () => {
      const variablesData = {
        values: [
          { isLoading: true, isVariableLoadingPending: false },
          { isLoading: false, isVariableLoadingPending: false },
        ],
        isVariablesLoading: false,
      };

      const result = checkIfVariablesAreLoaded(variablesData);

      expect(result).toBe(false);
    });

    it("should return false when some variables have pending loading", () => {
      const variablesData = {
        values: [
          { isLoading: false, isVariableLoadingPending: true },
          { isLoading: false, isVariableLoadingPending: false },
        ],
        isVariablesLoading: false,
      };

      const result = checkIfVariablesAreLoaded(variablesData);

      expect(result).toBe(false);
    });

    it("should return false when isVariablesLoading is true", () => {
      const variablesData = {
        values: [
          { isLoading: false, isVariableLoadingPending: false },
          { isLoading: false, isVariableLoadingPending: false },
        ],
        isVariablesLoading: true,
      };

      const result = checkIfVariablesAreLoaded(variablesData);

      expect(result).toBe(false);
    });

    it("should handle undefined variablesData", () => {
      const result = checkIfVariablesAreLoaded(undefined);

      expect(result).toBe(false);
    });

    it("should handle variablesData with undefined values", () => {
      const variablesData = {
        values: undefined,
        isVariablesLoading: false,
      };

      const result = checkIfVariablesAreLoaded(variablesData);

      expect(result).toBe(false);
    });
  });

  describe("addPanel", () => {
    it("should add panel with correct layout to empty tab", async () => {
      const dashboardId = "dashboard-1";
      const panelData = { id: "panel-1", title: "Test Panel" };
      const folderId = "test-folder";
      const tabId = "tab-1";

      const mockDashboard = {
        tabs: [{ tabId: "tab-1", panels: [] }],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await addPanel(mockStore, dashboardId, panelData, folderId, tabId);

      expect(mockDashboard.tabs[0].panels).toHaveLength(1);
      expect(mockDashboard.tabs[0].panels[0].layout).toEqual({
        x: 0,
        y: 0,
        w: 96,
        h: 18,
        i: 1,
        panelId: "panel-1",
        static: false,
      });
    });

    it("should add panel with calculated position when tab has existing panels", async () => {
      const dashboardId = "dashboard-1";
      const panelData = { id: "panel-2", title: "Test Panel 2" };
      const folderId = "test-folder";
      const tabId = "tab-1";

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            panels: [
              {
                id: "panel-1",
                layout: { x: 0, y: 5, w: 24, h: 9, i: 1, panelId: "panel-1" },
              },
            ],
          },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await addPanel(mockStore, dashboardId, panelData, folderId, tabId);

      expect(mockDashboard.tabs[0].panels).toHaveLength(2);
      const newPanel = mockDashboard.tabs[0].panels[1];
      // Logic: 48 - (0 + 24) = 24, which equals the new panel width of 24
      // So it should place horizontally at x=24, y=5
      expect(newPanel.layout.x).toBe(24); // x + w of existing panel
      expect(newPanel.layout.y).toBe(5); // Same y as existing panel
      expect(newPanel.layout.i).toBe(2); // maxI + 1
    });

    it("should place panel next to existing panel when there's space", async () => {
      const dashboardId = "dashboard-1";
      const panelData = { id: "panel-2", title: "Test Panel 2" };
      const folderId = "test-folder";
      const tabId = "tab-1";

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            panels: [
              {
                id: "panel-1",
                layout: { x: 0, y: 0, w: 20, h: 9, i: 1, panelId: "panel-1" }, // leaves 28 space (48-20=28)
              },
            ],
          },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await addPanel(mockStore, dashboardId, panelData, folderId, tabId);

      const newPanel = mockDashboard.tabs[0].panels[1];
      expect(newPanel.layout.x).toBe(20); // x + w of previous panel
      expect(newPanel.layout.y).toBe(0); // same y as previous panel
    });
  });

  describe("addVariable", () => {
    it("should add variable to dashboard with empty variables", async () => {
      const dashboardId = "dashboard-1";
      const variableData = { name: "var1", type: "query", query: "SELECT 1" };
      const folderId = "test-folder";

      const mockDashboard = {};

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await addVariable(mockStore, dashboardId, variableData, folderId);

      expect(mockDashboard.variables).toEqual({
        showDynamicFilters: false,
        list: [variableData],
      });
    });

    it("should add variable to existing variables list", async () => {
      const dashboardId = "dashboard-1";
      const variableData = { name: "var2", type: "query", query: "SELECT 2" };
      const folderId = "test-folder";

      const mockDashboard = {
        variables: {
          showDynamicFilters: true,
          list: [{ name: "var1", type: "query", query: "SELECT 1" }],
        },
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await addVariable(mockStore, dashboardId, variableData, folderId);

      expect(mockDashboard.variables.list).toHaveLength(2);
      expect(mockDashboard.variables.list[1]).toBe(variableData);
    });

    it("should throw error when variable with same name exists", async () => {
      const dashboardId = "dashboard-1";
      const variableData = { name: "var1", type: "query", query: "SELECT 2" };
      const folderId = "test-folder";

      const mockDashboard = {
        variables: {
          showDynamicFilters: false,
          list: [{ name: "var1", type: "query", query: "SELECT 1" }],
        },
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;

      await expect(
        addVariable(mockStore, dashboardId, variableData, folderId)
      ).rejects.toThrow("Variable with same name already exists");
    });
  });

  describe("deleteVariable", () => {
    it("should delete variable by name", async () => {
      const dashboardId = "dashboard-1";
      const variableName = "var1";
      const folderId = "test-folder";

      const mockDashboard = {
        variables: {
          list: [
            { name: "var1", type: "query" },
            { name: "var2", type: "query" },
          ],
        },
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await deleteVariable(mockStore, dashboardId, variableName, folderId);

      expect(mockDashboard.variables.list).toHaveLength(1);
      expect(mockDashboard.variables.list[0].name).toBe("var2");
    });
  });

  describe("updateVariable", () => {
    it("should update variable data", async () => {
      const dashboardId = "dashboard-1";
      const variableName = "var1";
      const variableData = { name: "var1", type: "query", query: "UPDATE SELECT 1" };
      const folderId = "test-folder";

      const mockDashboard = {
        variables: {
          list: [{ name: "var1", type: "query", query: "SELECT 1" }],
        },
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await updateVariable(mockStore, dashboardId, variableName, variableData, folderId);

      expect(mockDashboard.variables.list[0]).toBe(variableData);
    });

    it("should throw error when renaming to existing variable name", async () => {
      const dashboardId = "dashboard-1";
      const variableName = "var1";
      const variableData = { name: "var2", type: "query", query: "SELECT 1" };
      const folderId = "test-folder";

      const mockDashboard = {
        variables: {
          list: [
            { name: "var1", type: "query", query: "SELECT 1" },
            { name: "var2", type: "query", query: "SELECT 2" },
          ],
        },
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;

      await expect(
        updateVariable(mockStore, dashboardId, variableName, variableData, folderId)
      ).rejects.toThrow("Variable with same name already exists");
    });
  });

  describe("deletePanel", () => {
    it("should remove panel from tab", async () => {
      const dashboardId = "dashboard-1";
      const panelId = "panel-1";
      const folderId = "test-folder";
      const tabId = "tab-1";

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            panels: [
              { id: "panel-1", title: "Panel 1" },
              { id: "panel-2", title: "Panel 2" },
            ],
          },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await deletePanel(mockStore, dashboardId, panelId, folderId, tabId);

      expect(mockDashboard.tabs[0].panels).toHaveLength(1);
      expect(mockDashboard.tabs[0].panels[0].id).toBe("panel-2");
    });
  });

  describe("updatePanel", () => {
    it("should update panel data in tab", async () => {
      const dashboardId = "dashboard-1";
      const panelData = { id: "panel-1", title: "Updated Panel 1" };
      const folderId = "test-folder";
      const tabId = "tab-1";

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            panels: [{ id: "panel-1", title: "Panel 1" }],
          },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await updatePanel(mockStore, dashboardId, panelData, folderId, tabId);

      expect(mockDashboard.tabs[0].panels[0]).toBe(panelData);
    });
  });

  describe("getPanel", () => {
    it("should return panel by ID from specified tab", async () => {
      const dashboardId = "dashboard-1";
      const panelId = "panel-2";
      const folderId = "test-folder";
      const tabId = "tab-1";

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            panels: [
              { id: "panel-1", title: "Panel 1" },
              { id: "panel-2", title: "Panel 2" },
            ],
          },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;

      const result = await getPanel(mockStore, dashboardId, panelId, folderId, tabId);

      expect(result).toEqual({ id: "panel-2", title: "Panel 2" });
    });

    it("should return undefined when panel not found", async () => {
      const dashboardId = "dashboard-1";
      const panelId = "panel-3";
      const folderId = "test-folder";
      const tabId = "tab-1";

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            panels: [{ id: "panel-1", title: "Panel 1" }],
          },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;

      const result = await getPanel(mockStore, dashboardId, panelId, folderId, tabId);

      expect(result).toBeUndefined();
    });
  });

  describe("deleteTab", () => {
    it("should delete tab without moving panels", async () => {
      const dashboardId = "dashboard-1";
      const folderId = "test-folder";
      const deleteTabId = "tab-2";

      const mockDashboard = {
        tabs: [
          { tabId: "tab-1", name: "Tab 1", panels: [] },
          { tabId: "tab-2", name: "Tab 2", panels: [] },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await deleteTab(mockStore, dashboardId, folderId, deleteTabId);

      expect(mockDashboard.tabs).toHaveLength(1);
      expect(mockDashboard.tabs[0].tabId).toBe("tab-1");
    });

    it("should delete tab and move panels to another tab", async () => {
      const dashboardId = "dashboard-1";
      const folderId = "test-folder";
      const deleteTabId = "tab-2";
      const moveToTabId = "tab-1";

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            name: "Tab 1",
            panels: [{ id: "panel-1", layout: { x: 0, y: 0, w: 24, h: 9, i: 1 } }],
          },
          {
            tabId: "tab-2",
            name: "Tab 2",
            panels: [{ id: "panel-2", layout: { x: 0, y: 0, w: 24, h: 9, i: 1 } }],
          },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await deleteTab(mockStore, dashboardId, folderId, deleteTabId, moveToTabId);

      expect(mockDashboard.tabs).toHaveLength(1);
      expect(mockDashboard.tabs[0].panels).toHaveLength(2);
      expect(mockDashboard.tabs[0].panels[1].id).toBe("panel-2");
      // Panel should be repositioned
      // maxY = max(all panel y values) = 0, then maxY += 20 → 20
      expect(mockDashboard.tabs[0].panels[1].layout.i).toBe(2);
      expect(mockDashboard.tabs[0].panels[1].layout.y).toBe(20);
    });
  });

  describe("editTab", () => {
    it("should update tab name", async () => {
      const dashboardId = "dashboard-1";
      const folderId = "test-folder";
      const tabId = "tab-1";
      const tabData = { name: "Updated Tab Name" };

      const mockDashboard = {
        tabs: [{ tabId: "tab-1", name: "Old Tab Name" }],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      const result = await editTab(mockStore, dashboardId, folderId, tabId, tabData);

      expect(mockDashboard.tabs[0].name).toBe("Updated Tab Name");
      expect(result.name).toBe("Updated Tab Name");
    });
  });

  describe("addTab", () => {
    it("should add new tab with generated tabId", async () => {
      const dashboardId = "dashboard-1";
      const folderId = "test-folder";
      const newTabData = { name: "New Tab", panels: [] };

      const mockDashboard = {
        tabs: [{ tabId: "tab-1", name: "Existing Tab" }],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      const result = await addTab(mockStore, dashboardId, folderId, newTabData);

      expect(mockDashboard.tabs).toHaveLength(2);
      expect(mockDashboard.tabs[1].name).toBe("New Tab");
      expect(result.tabId).toBeDefined();
      expect(typeof result.tabId).toBe("string");
    });
  });

  describe("movePanelToAnotherTab", () => {
    it("should move panel from one tab to another", async () => {
      const dashboardId = "dashboard-1";
      const panelId = "panel-1";
      const folderId = "test-folder";
      const currentTabId = "tab-1";
      const moveToTabId = "tab-2";

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            panels: [{ id: "panel-1", layout: { x: 0, y: 0, w: 24, h: 9, i: 1 } }],
          },
          {
            tabId: "tab-2",
            panels: [{ id: "panel-2", layout: { x: 0, y: 0, w: 24, h: 9, i: 1 } }],
          },
        ],
      };

      mockStore.state.organizationData.allDashboardData[dashboardId] = mockDashboard;
      (dashboardService.save as any).mockResolvedValue({ data: { success: true } });
      (dashboardService.get_Dashboard as any).mockResolvedValue({
        data: { version: 1, v1: mockDashboard, hash: 123 },
      });

      await movePanelToAnotherTab(mockStore, dashboardId, panelId, folderId, currentTabId, moveToTabId);

      expect(mockDashboard.tabs[0].panels).toHaveLength(0); // Panel removed from original tab
      expect(mockDashboard.tabs[1].panels).toHaveLength(2); // Panel added to target tab
      expect(mockDashboard.tabs[1].panels[1].id).toBe("panel-1");
      // Panel should be repositioned
      // maxY = max(all panel y values) = 0, then y = maxY + 20 → 20
      expect(mockDashboard.tabs[1].panels[1].layout.i).toBe(2);
      expect(mockDashboard.tabs[1].panels[1].layout.y).toBe(20);
    });
  });

  describe("getFoldersList", () => {
    it("should fetch dashboard folders and put default first", async () => {
      const mockResponse = {
        data: {
          list: [
            { folderId: "folder1", name: "Folder 1", description: "Folder 1" },
            { folderId: "default", name: "Default", description: "Default folder" },
          ],
        },
      };

      (dashboardService.list_Folders as any).mockResolvedValue(mockResponse);

      await getFoldersList(mockStore);

      expect(dashboardService.list_Folders).toHaveBeenCalledWith("test-org");
      expect(mockStore.dispatch).toHaveBeenCalledWith("setFolders", [
        { folderId: "default", name: "Default", description: "Default folder" },
        { folderId: "folder1", name: "Folder 1", description: "Folder 1" },
      ]);
    });

    it("should create default folder when not present", async () => {
      const mockResponse = {
        data: {
          list: [{ folderId: "folder1", name: "Folder 1", description: "Folder 1" }],
        },
      };

      (dashboardService.list_Folders as any).mockResolvedValue(mockResponse);

      await getFoldersList(mockStore);

      expect(mockStore.dispatch).toHaveBeenCalledWith("setFolders", [
        { name: "default", folderId: "default", description: "default" },
        { folderId: "folder1", name: "Folder 1", description: "Folder 1" },
      ]);
    });
  });

  describe("deleteDashboardById", () => {
    it("should delete dashboard and update store", async () => {
      const dashboardId = "dashboard-1";
      const folderId = "test-folder";

      mockStore.state.organizationData.allDashboardList = {
        [folderId]: [
          { dashboardId: "dashboard-1", title: "Dashboard 1" },
          { dashboardId: "dashboard-2", title: "Dashboard 2" },
        ],
      };
      mockStore.state.organizationData.allDashboardData = {
        [dashboardId]: { title: "Dashboard 1" },
      };
      mockStore.state.organizationData.allDashboardListHash = {
        [dashboardId]: "hash123",
      };

      (dashboardService.delete as any).mockResolvedValue({ success: true });

      await deleteDashboardById(mockStore, dashboardId, folderId);

      expect(dashboardService.delete).toHaveBeenCalledWith("test-org", dashboardId, folderId);
      expect(mockStore.dispatch).toHaveBeenCalledWith("setAllDashboardList", {
        [folderId]: [{ dashboardId: "dashboard-2", title: "Dashboard 2" }],
      });
      expect(mockStore.dispatch).toHaveBeenCalledWith("setDashboardData", {});
    });
  });

  describe("createFolder and updateFolder", () => {
    it("should create new folder", async () => {
      const data = { name: "New Folder", description: "Description" };
      const mockResponse = { data: { folderId: "new-folder" } };

      (dashboardService.new_Folder as any).mockResolvedValue(mockResponse);
      (dashboardService.list_Folders as any).mockResolvedValue({ data: { list: [] } });

      const result = await createFolder(mockStore, data);

      expect(dashboardService.new_Folder).toHaveBeenCalledWith("test-org", data);
      expect(result).toBe(mockResponse);
    });

    it("should update folder", async () => {
      const folderId = "folder-1";
      const data = { name: "Updated Folder" };

      (dashboardService.edit_Folder as any).mockResolvedValue({ success: true });
      (dashboardService.list_Folders as any).mockResolvedValue({ data: { list: [] } });

      await updateFolder(mockStore, folderId, data);

      expect(dashboardService.edit_Folder).toHaveBeenCalledWith("test-org", folderId, data);
    });

    it("should delete folder by id", async () => {
      const folderId = "folder-1";

      (dashboardService.delete_Folder as any).mockResolvedValue({ success: true });
      (dashboardService.list_Folders as any).mockResolvedValue({ data: { list: [] } });

      await deleteFolderById(mockStore, folderId);

      expect(dashboardService.delete_Folder).toHaveBeenCalledWith("test-org", folderId);
    });
  });

  describe("Type-specific folder operations", () => {
    it("should create folder by type", async () => {
      const data = { name: "New Alert Folder" };
      const type = "alerts";
      const mockResponse = { data: { folderId: "new-alert-folder" } };

      (commonService.new_Folder as any).mockResolvedValue(mockResponse);
      (commonService.list_Folders as any).mockResolvedValue({ data: { list: [] } });

      const result = await createFolderByType(mockStore, data, type);

      expect(commonService.new_Folder).toHaveBeenCalledWith("test-org", type, data);
      expect(result).toBe(mockResponse);
    });

    it("should update folder by type", async () => {
      const folderId = "folder-1";
      const data = { name: "Updated Alert Folder" };
      const type = "alerts";

      (commonService.edit_Folder as any).mockResolvedValue({ success: true });
      (commonService.list_Folders as any).mockResolvedValue({ data: { list: [] } });

      await updateFolderByType(mockStore, folderId, data, type);

      expect(commonService.edit_Folder).toHaveBeenCalledWith("test-org", type, folderId, data);
    });

    it("should delete folder by id by type", async () => {
      const folderId = "folder-1";
      const type = "alerts";

      (commonService.delete_Folder as any).mockResolvedValue({ success: true });
      (commonService.list_Folders as any).mockResolvedValue({ data: { list: [] } });

      await deleteFolderByIdByType(mockStore, folderId, type);

      expect(commonService.delete_Folder).toHaveBeenCalledWith("test-org", type, folderId);
    });
  });

  describe("moveDashboardToAnotherFolder", () => {
    it("should move dashboards between folders", async () => {
      const dashboardIds = ["dashboard-1", "dashboard-2"];
      const from = "folder-1";
      const to = "folder-2";

      (dashboardService.move_Dashboard as any).mockResolvedValue({ success: true });
      (dashboardService.list as any).mockResolvedValue({ data: { dashboards: [] } });

      await moveDashboardToAnotherFolder(mockStore, dashboardIds, from, to);

      expect(dashboardService.move_Dashboard).toHaveBeenCalledWith("test-org", dashboardIds, from, to);
    });
  });

  describe("moveModuleToAnotherFolder", () => {
    it("should move module items between folders", async () => {
      const data = { itemIds: ["item-1", "item-2"], from: "folder-1", to: "folder-2" };
      const type = "alerts";
      const folder_id = "folder-2";

      (commonService.move_across_folders as any).mockResolvedValue({ success: true });

      await moveModuleToAnotherFolder(mockStore, data, type, folder_id);

      expect(commonService.move_across_folders).toHaveBeenCalledWith("test-org", type, data, folder_id);
    });
  });
});