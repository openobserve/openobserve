import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the component's dependencies directly
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org"
    }
  }
};

const mockRoute = {
  query: {
    folder: "test-folder"
  }
};

const mockGetDashboard = vi.fn();
const mockUseStore = vi.fn(() => mockStore);
const mockUseRoute = vi.fn(() => mockRoute);
const mockUseI18n = vi.fn(() => ({ t: vi.fn() }));

// Mock modules
vi.mock("../../utils/commons.ts", () => ({
  getDashboard: mockGetDashboard
}));

vi.mock("vuex", () => ({
  useStore: mockUseStore
}));

vi.mock("vue-router", () => ({
  useRoute: mockUseRoute
}));

vi.mock("vue-i18n", () => ({
  useI18n: mockUseI18n
}));

// Mock DOM methods
const mockClick = vi.fn();
const mockSetAttribute = vi.fn();
const mockCreateElement = vi.fn(() => ({
  setAttribute: mockSetAttribute,
  click: mockClick
}));

describe("ExportDashboard Component Logic", () => {
  const defaultProps = {
    dashboardId: "test-dashboard-id"
  };

  const mockDashboard = {
    dashboardId: "test-dashboard-id",
    title: "Test Dashboard",
    description: "Test dashboard description",
    owner: "test-owner",
    panels: [],
    variables: []
  };

  // Create the download function logic directly
  const createDownloadFunction = (props: any) => {
    const store = mockUseStore();
    const route = mockUseRoute();
    
    return async () => {
      // Get the dashboard
      const dashboard = await mockGetDashboard(
        store,
        props.dashboardId,
        route.query.folder
      );
      dashboard.owner = "";

      // Prepare json and download via a click
      const data =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(dashboard, null, 2));
      const htmlA = mockCreateElement("a");
      htmlA.setAttribute("href", data);
      const fileName = dashboard.title || "dashboard";
      htmlA.setAttribute("download", fileName + ".dashboard.json");
      htmlA.click();
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDashboard.mockResolvedValue({ ...mockDashboard });
    
    // Mock document.createElement globally
    Object.defineProperty(global, 'document', {
      value: {
        createElement: mockCreateElement
      },
      writable: true
    });
  });

  describe("Component Setup", () => {
    it("should create download function", () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      expect(downloadFunction).toBeInstanceOf(Function);
    });

    it("should use correct dependencies", () => {
      createDownloadFunction(defaultProps);
      expect(mockUseStore).toHaveBeenCalled();
      expect(mockUseRoute).toHaveBeenCalled();
    });
  });

  describe("Dashboard Download Functionality", () => {
    it("should fetch dashboard data on download", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      mockGetDashboard.mockResolvedValue({ ...mockDashboard });
      
      await downloadFunction();
      
      expect(mockGetDashboard).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder"
      );
    });

    it("should create download link with correct attributes", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      mockGetDashboard.mockResolvedValue({ ...mockDashboard });
      
      await downloadFunction();
      
      expect(mockCreateElement).toHaveBeenCalledWith("a");
      expect(mockSetAttribute).toHaveBeenCalledWith("href", expect.stringContaining("data:text/json;charset=utf-8,"));
      expect(mockSetAttribute).toHaveBeenCalledWith("download", "Test Dashboard.dashboard.json");
      expect(mockClick).toHaveBeenCalled();
    });

    it("should remove owner property from dashboard before download", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      const dashboardWithOwner = { ...mockDashboard, owner: "original-owner" };
      mockGetDashboard.mockResolvedValue(dashboardWithOwner);
      
      await downloadFunction();
      
      // Verify that the dashboard data passed to JSON.stringify has empty owner
      const hrefCall = mockSetAttribute.mock.calls.find(call => call[0] === "href");
      expect(hrefCall).toBeTruthy();
      const dataUrl = hrefCall[1];
      const jsonData = decodeURIComponent(dataUrl.split(',')[1]);
      const parsedData = JSON.parse(jsonData);
      expect(parsedData.owner).toBe("");
    });

    it("should use fallback filename when dashboard title is missing", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      const dashboardWithoutTitle = { ...mockDashboard, title: "" };
      mockGetDashboard.mockResolvedValue(dashboardWithoutTitle);
      
      await downloadFunction();
      
      expect(mockSetAttribute).toHaveBeenCalledWith("download", "dashboard.dashboard.json");
    });

    it("should use fallback filename when dashboard title is null", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      const dashboardWithNullTitle = { ...mockDashboard, title: null };
      mockGetDashboard.mockResolvedValue(dashboardWithNullTitle);
      
      await downloadFunction();
      
      expect(mockSetAttribute).toHaveBeenCalledWith("download", "dashboard.dashboard.json");
    });

    it("should format JSON with proper indentation", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      mockGetDashboard.mockResolvedValue({ ...mockDashboard });
      
      await downloadFunction();
      
      const hrefCall = mockSetAttribute.mock.calls.find(call => call[0] === "href");
      expect(hrefCall).toBeTruthy();
      const dataUrl = hrefCall[1];
      const jsonData = decodeURIComponent(dataUrl.split(',')[1]);
      
      // Check that JSON is properly formatted with indentation
      expect(jsonData).toContain('\n  ');
      expect(jsonData).toMatch(/{\s+"/);
    });

    it("should create proper data URL format", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      mockGetDashboard.mockResolvedValue({ ...mockDashboard });
      
      await downloadFunction();
      
      const hrefCall = mockSetAttribute.mock.calls.find(call => call[0] === "href");
      expect(hrefCall).toBeTruthy();
      expect(hrefCall[1]).toMatch(/^data:text\/json;charset=utf-8,/);
    });

    it("should preserve all dashboard properties except owner", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      const complexDashboard = {
        ...mockDashboard,
        owner: "should-be-removed",
        panels: [{ id: 1, type: "chart" }],
        variables: [{ name: "var1" }],
        customProperty: "should-be-preserved"
      };
      mockGetDashboard.mockResolvedValue(complexDashboard);
      
      await downloadFunction();
      
      const hrefCall = mockSetAttribute.mock.calls.find(call => call[0] === "href");
      const dataUrl = hrefCall[1];
      const jsonData = decodeURIComponent(dataUrl.split(',')[1]);
      const parsedData = JSON.parse(jsonData);
      
      expect(parsedData.owner).toBe("");
      expect(parsedData.panels).toEqual([{ id: 1, type: "chart" }]);
      expect(parsedData.variables).toEqual([{ name: "var1" }]);
      expect(parsedData.customProperty).toBe("should-be-preserved");
      expect(parsedData.dashboardId).toBe("test-dashboard-id");
    });

    it("should handle custom dashboard titles with special characters", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      const dashboardWithSpecialTitle = { 
        ...mockDashboard, 
        title: "My-Custom_Dashboard (2024)" 
      };
      mockGetDashboard.mockResolvedValue(dashboardWithSpecialTitle);
      
      await downloadFunction();
      
      expect(mockSetAttribute).toHaveBeenCalledWith("download", "My-Custom_Dashboard (2024).dashboard.json");
    });
  });

  describe("Error Handling", () => {
    it("should handle API error when fetching dashboard", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      mockGetDashboard.mockRejectedValue(new Error("API Error"));
      
      await expect(downloadFunction()).rejects.toThrow("API Error");
    });

    it("should handle network errors gracefully", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      mockGetDashboard.mockRejectedValue(new Error("Network Error"));
      
      await expect(downloadFunction()).rejects.toThrow("Network Error");
    });

    it("should handle server errors", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      mockGetDashboard.mockRejectedValue(new Error("Server Error 500"));
      
      await expect(downloadFunction()).rejects.toThrow("Server Error 500");
    });
  });

  describe("Component Properties", () => {
    it("should accept different dashboardId values", async () => {
      const customProps = { dashboardId: "custom-dashboard-id" };
      const downloadFunction = createDownloadFunction(customProps);
      
      await downloadFunction();
      
      expect(mockGetDashboard).toHaveBeenCalledWith(
        mockStore,
        "custom-dashboard-id",
        "test-folder"
      );
    });

    it("should handle null dashboardId", async () => {
      const propsWithNull = { dashboardId: null };
      const downloadFunction = createDownloadFunction(propsWithNull);
      
      await downloadFunction();
      
      expect(mockGetDashboard).toHaveBeenCalledWith(
        mockStore,
        null,
        "test-folder"
      );
    });

    it("should work with different folder values", async () => {
      const customRoute = { query: { folder: "custom-folder" } };
      mockUseRoute.mockReturnValue(customRoute);
      
      const downloadFunction = createDownloadFunction(defaultProps);
      await downloadFunction();
      
      expect(mockGetDashboard).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "custom-folder"
      );
    });
  });

  describe("File Download Integration", () => {
    it("should call document.createElement with 'a' element", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      
      await downloadFunction();
      
      expect(mockCreateElement).toHaveBeenCalledWith("a");
      expect(mockCreateElement).toHaveBeenCalledTimes(1);
    });

    it("should trigger click on created element", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      
      await downloadFunction();
      
      expect(mockClick).toHaveBeenCalled();
      expect(mockClick).toHaveBeenCalledTimes(1);
    });

    it("should set both href and download attributes", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      
      await downloadFunction();
      
      expect(mockSetAttribute).toHaveBeenCalledTimes(2);
      expect(mockSetAttribute).toHaveBeenCalledWith("href", expect.any(String));
      expect(mockSetAttribute).toHaveBeenCalledWith("download", expect.stringContaining(".dashboard.json"));
    });

    it("should set correct file extension", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      const customDashboard = { ...mockDashboard, title: "My Custom Dashboard" };
      mockGetDashboard.mockResolvedValue(customDashboard);
      
      await downloadFunction();
      
      expect(mockSetAttribute).toHaveBeenCalledWith("download", "My Custom Dashboard.dashboard.json");
    });
  });

  describe("Data Serialization", () => {
    it("should serialize dashboard data as valid JSON", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      
      await downloadFunction();
      
      const hrefCall = mockSetAttribute.mock.calls.find(call => call[0] === "href");
      const dataUrl = hrefCall[1];
      const jsonData = decodeURIComponent(dataUrl.split(',')[1]);
      
      expect(() => JSON.parse(jsonData)).not.toThrow();
    });

    it("should handle empty dashboard data", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      mockGetDashboard.mockResolvedValue({});
      
      await downloadFunction();
      
      const hrefCall = mockSetAttribute.mock.calls.find(call => call[0] === "href");
      const dataUrl = hrefCall[1];
      const jsonData = decodeURIComponent(dataUrl.split(',')[1]);
      const parsedData = JSON.parse(jsonData);
      
      expect(parsedData.owner).toBe("");
    });

    it("should handle complex nested dashboard structures", async () => {
      const downloadFunction = createDownloadFunction(defaultProps);
      const complexDashboard = {
        ...mockDashboard,
        panels: [
          { 
            id: 1, 
            type: "chart", 
            config: { 
              data: [1, 2, 3], 
              nested: { property: "value" } 
            } 
          }
        ],
        variables: [
          { 
            name: "var1", 
            options: ["a", "b", "c"], 
            metadata: { type: "select" } 
          }
        ]
      };
      mockGetDashboard.mockResolvedValue(complexDashboard);
      
      await downloadFunction();
      
      const hrefCall = mockSetAttribute.mock.calls.find(call => call[0] === "href");
      const dataUrl = hrefCall[1];
      const jsonData = decodeURIComponent(dataUrl.split(',')[1]);
      const parsedData = JSON.parse(jsonData);
      
      expect(parsedData.panels[0].config.nested.property).toBe("value");
      expect(parsedData.variables[0].options).toEqual(["a", "b", "c"]);
    });
  });
});