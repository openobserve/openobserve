import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { useAnnotationsData } from "./useAnnotationsData";
import { getDashboard } from "@/utils/commons";

// Mock dependencies
const mockShowInfoNotification = vi.fn();

vi.mock("../useNotifications", () => ({
  default: () => ({
    showInfoNotification: mockShowInfoNotification,
  }),
}));

vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn(),
}));

// Mock date-fns-tz to return the input date unchanged (simulate UTC timezone)
vi.mock("date-fns-tz", () => ({
  fromZonedTime: (date: Date, _timezone: string) => date,
}));

const mockGetDashboard = vi.mocked(getDashboard);

const mockStore = {
  state: {
    timezone: "UTC",
  },
  commit: vi.fn(),
  dispatch: vi.fn(),
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

describe("useAnnotationsData", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("should create useAnnotationsData composable with correct initial state", () => {
    const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
    
    expect(composable).toBeDefined();
    expect(composable.isAddAnnotationMode.value).toBe(false);
    expect(composable.isAddAnnotationDialogVisible.value).toBe(false);
    expect(composable.isEditMode.value).toBe(false);
    expect(composable.annotationToAddEdit.value).toBe(null);
    expect(composable.panelsList.value).toEqual([]);
    
    // Check that all functions are defined
    expect(typeof composable.enableAddAnnotationMode).toBe("function");
    expect(typeof composable.disableAddAnnotationMode).toBe("function");
    expect(typeof composable.toggleAddAnnotationMode).toBe("function");
    expect(typeof composable.showAddAnnotationDialog).toBe("function");
    expect(typeof composable.hideAddAnnotationDialog).toBe("function");
    expect(typeof composable.handleAddAnnotation).toBe("function");
    expect(typeof composable.handleAddAnnotationButtonClick).toBe("function");
    expect(typeof composable.closeAddAnnotation).toBe("function");
    expect(typeof composable.editAnnotation).toBe("function");
    expect(typeof composable.fetchAllPanels).toBe("function");
  });

  describe("mode toggle functions", () => {
    it("should enable add annotation mode", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      composable.enableAddAnnotationMode();
      
      expect(composable.isAddAnnotationMode.value).toBe(true);
    });

    it("should disable add annotation mode", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      composable.enableAddAnnotationMode();
      expect(composable.isAddAnnotationMode.value).toBe(true);
      
      composable.disableAddAnnotationMode();
      expect(composable.isAddAnnotationMode.value).toBe(false);
    });

    it("should toggle add annotation mode", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      expect(composable.isAddAnnotationMode.value).toBe(false);
      
      composable.toggleAddAnnotationMode();
      expect(composable.isAddAnnotationMode.value).toBe(true);
      
      composable.toggleAddAnnotationMode();
      expect(composable.isAddAnnotationMode.value).toBe(false);
    });
  });

  describe("dialog visibility functions", () => {
    it("should show add annotation dialog", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      composable.showAddAnnotationDialog();
      
      expect(composable.isAddAnnotationDialogVisible.value).toBe(true);
    });

    it("should hide add annotation dialog and reset state", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      // Set some initial state
      composable.showAddAnnotationDialog();
      composable.isEditMode.value = true;
      composable.annotationToAddEdit.value = { test: "data" };
      
      composable.hideAddAnnotationDialog();
      
      expect(composable.isAddAnnotationDialogVisible.value).toBe(false);
      expect(composable.isEditMode.value).toBe(false);
      expect(composable.annotationToAddEdit.value).toBe(null);
    });
  });

  describe("handleAddAnnotationButtonClick", () => {
    it("should disable add annotation mode and show dialog", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      composable.enableAddAnnotationMode();
      composable.isEditMode.value = true;
      composable.annotationToAddEdit.value = { test: "data" };
      
      composable.handleAddAnnotationButtonClick();
      
      expect(composable.isAddAnnotationMode.value).toBe(false);
      expect(composable.isEditMode.value).toBe(false);
      expect(composable.annotationToAddEdit.value).toBe(null);
      expect(composable.isAddAnnotationDialogVisible.value).toBe(true);
    });
  });

  describe("handleAddAnnotation", () => {
    it("should create annotation with start and end times", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");

      // Input is in milliseconds (chart timestamp format)
      composable.handleAddAnnotation(1500, 2500);

      expect(composable.annotationToAddEdit.value).toEqual({
        start_time: 1500000, // microseconds
        end_time: 2500000, // microseconds
        title: "",
        text: "",
        tags: [],
        panels: ["test-panel"],
      });
      expect(composable.isAddAnnotationDialogVisible.value).toBe(true);
    });

    it("should create annotation with only start time", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");

      composable.handleAddAnnotation(1500, null);

      expect(composable.annotationToAddEdit.value).toEqual({
        start_time: 1500000,
        end_time: null,
        title: "",
        text: "",
        tags: [],
        panels: ["test-panel"],
      });
    });

    it("should create annotation with null start time", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");

      composable.handleAddAnnotation(null, 2500);

      expect(composable.annotationToAddEdit.value).toEqual({
        start_time: null,
        end_time: 2500000,
        title: "",
        text: "",
        tags: [],
        panels: ["test-panel"],
      });
    });

    it("should create annotation with both null times", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");

      composable.handleAddAnnotation(null, null);

      expect(composable.annotationToAddEdit.value).toEqual({
        start_time: null,
        end_time: null,
        title: "",
        text: "",
        tags: [],
        panels: ["test-panel"],
      });
    });

    it("should handle zero times", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");

      composable.handleAddAnnotation(0, 0);

      expect(composable.annotationToAddEdit.value).toEqual({
        start_time: null,
        end_time: null,
        title: "",
        text: "",
        tags: [],
        panels: ["test-panel"],
      });
    });

    it("should handle negative times", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");

      composable.handleAddAnnotation(-1500, -500);

      expect(composable.annotationToAddEdit.value).toEqual({
        start_time: -1500000,
        end_time: -500000,
        title: "",
        text: "",
        tags: [],
        panels: ["test-panel"],
      });
    });

    it("should use correct panelId in annotation", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "different-panel", "test-folder");

      composable.handleAddAnnotation(1000, 2000);

      expect(composable.annotationToAddEdit.value.panels).toEqual(["different-panel"]);
    });
  });

  describe("editAnnotation", () => {
    it("should set annotation to edit and show dialog", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const annotationData = {
        id: 1,
        title: "Test annotation",
        text: "Test text",
      };
      
      composable.editAnnotation(annotationData);
      
      expect(composable.annotationToAddEdit.value).toEqual(annotationData);
      expect(composable.isAddAnnotationDialogVisible.value).toBe(true);
    });
  });

  describe("closeAddAnnotation", () => {
    it("should reset all states", () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      // Set initial state
      composable.isAddAnnotationDialogVisible.value = true;
      composable.isAddAnnotationMode.value = true;
      composable.isEditMode.value = true;
      composable.annotationToAddEdit.value = { test: "data" };
      
      composable.closeAddAnnotation();
      
      expect(composable.isAddAnnotationDialogVisible.value).toBe(false);
      expect(composable.isAddAnnotationMode.value).toBe(false);
      expect(composable.isEditMode.value).toBe(false);
      expect(composable.annotationToAddEdit.value).toBe(null);
    });
  });

  describe("watch behavior", () => {
    it("should show notification when add annotation mode is enabled", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      composable.enableAddAnnotationMode();
      await nextTick();
      
      expect(mockShowInfoNotification).toHaveBeenCalledWith(
        "Click on the chart data or select a range to add an annotation",
        {}
      );
    });

    it("should not show notification when add annotation mode is disabled", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      composable.enableAddAnnotationMode();
      await nextTick();
      
      mockShowInfoNotification.mockClear();
      
      composable.disableAddAnnotationMode();
      await nextTick();
      
      expect(mockShowInfoNotification).not.toHaveBeenCalled();
    });
  });

  describe("processTabPanels", () => {
    it("should process dashboard tabs and return chart panels", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const mockDashboardData = {
        tabs: [
          {
            tabId: "tab1",
            name: "Tab 1",
            panels: [
              {
                id: "panel1",
                type: "line",
                title: "Line Chart",
              },
              {
                id: "panel2",
                type: "bar",
                title: "Bar Chart",
              },
              {
                id: "panel3",
                type: "table",  // Should be filtered out
                title: "Table",
              },
            ],
          },
          {
            tabId: "tab2",
            name: "Tab 2",
            panels: [
              {
                id: "panel4",
                type: "area",
                title: "Area Chart",
              },
            ],
          },
        ],
      };

      mockGetDashboard.mockResolvedValue(mockDashboardData);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value).toHaveLength(3);
      expect(composable.panelsList.value).toEqual([
        {
          id: "panel1",
          type: "line",
          title: "Line Chart",
          tabName: "Tab 1",
          originalTabData: {
            tabId: "tab1",
            name: "Tab 1",
          },
        },
        {
          id: "panel2",
          type: "bar",
          title: "Bar Chart",
          tabName: "Tab 1",
          originalTabData: {
            tabId: "tab1",
            name: "Tab 1",
          },
        },
        {
          id: "panel4",
          type: "area",
          title: "Area Chart",
          tabName: "Tab 2",
          originalTabData: {
            tabId: "tab2",
            name: "Tab 2",
          },
        },
      ]);
    });

    it("should handle dashboard data without tabs", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const mockDashboardData = {};
      mockGetDashboard.mockResolvedValue(mockDashboardData);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value).toEqual([]);
    });

    it("should handle tabs without panels", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const mockDashboardData = {
        tabs: [
          {
            tabId: "tab1",
            name: "Empty Tab",
          },
        ],
      };
      mockGetDashboard.mockResolvedValue(mockDashboardData);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value).toEqual([]);
    });

    it("should handle tabs with empty panel arrays", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const mockDashboardData = {
        tabs: [
          {
            tabId: "tab1",
            name: "Tab 1",
            panels: [],
          },
        ],
      };
      mockGetDashboard.mockResolvedValue(mockDashboardData);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value).toEqual([]);
    });

    it("should handle tabs without names", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const mockDashboardData = {
        tabs: [
          {
            tabId: "tab1",
            panels: [
              {
                id: "panel1",
                type: "line",
                title: "Line Chart",
              },
            ],
          },
        ],
      };
      mockGetDashboard.mockResolvedValue(mockDashboardData);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value[0].tabName).toBe("Unnamed Tab");
    });

    it("should handle tabs with empty string names", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const mockDashboardData = {
        tabs: [
          {
            tabId: "tab1",
            name: "   ",
            panels: [
              {
                id: "panel1",
                type: "line",
                title: "Line Chart",
              },
            ],
          },
        ],
      };
      mockGetDashboard.mockResolvedValue(mockDashboardData);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value[0].tabName).toBe("Unnamed Tab");
    });

    it("should filter out non-chart panel types", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const mockDashboardData = {
        tabs: [
          {
            tabId: "tab1",
            name: "Tab 1",
            panels: [
              { id: "panel1", type: "line", title: "Line Chart" },
              { id: "panel2", type: "table", title: "Table" },
              { id: "panel3", type: "metric", title: "Metric" },
              { id: "panel4", type: "bar", title: "Bar Chart" },
            ],
          },
        ],
      };
      mockGetDashboard.mockResolvedValue(mockDashboardData);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value).toHaveLength(2);
      expect(composable.panelsList.value.map(p => p.type)).toEqual(["line", "bar"]);
    });

    it("should handle all supported chart types", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const supportedTypes = ["area", "area-stacked", "bar", "h-bar", "line", "scatter", "stacked", "h-stacked"];
      const mockDashboardData = {
        tabs: [
          {
            tabId: "tab1",
            name: "Tab 1",
            panels: supportedTypes.map((type, index) => ({
              id: `panel${index}`,
              type,
              title: `${type} Chart`,
            })),
          },
        ],
      };
      mockGetDashboard.mockResolvedValue(mockDashboardData);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value).toHaveLength(supportedTypes.length);
      expect(composable.panelsList.value.map(p => p.type)).toEqual(supportedTypes);
    });

    it("should handle getDashboard error", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      const mockError = new Error("Failed to fetch dashboard");
      mockGetDashboard.mockRejectedValue(mockError);

      await composable.fetchAllPanels();

      expect(composable.panelsList.value).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error fetching panels:", mockError);
    });

    it("should call getDashboard with correct parameters", async () => {
      const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");
      
      mockGetDashboard.mockResolvedValue({ tabs: [] });

      await composable.fetchAllPanels();

      expect(mockGetDashboard).toHaveBeenCalledWith(mockStore, "test-dashboard", "test-folder");
    });
  });

  it("should create independent instances", () => {
    const composable1 = useAnnotationsData("org1", "dash1", "panel1", "folder1");
    const composable2 = useAnnotationsData("org2", "dash2", "panel2", "folder2");

    composable1.enableAddAnnotationMode();
    
    expect(composable1.isAddAnnotationMode.value).toBe(true);
    expect(composable2.isAddAnnotationMode.value).toBe(false);
  });

  it("should handle multiple annotation operations", () => {
    const composable = useAnnotationsData("test-org", "test-dashboard", "test-panel", "test-folder");

    // Add annotation (input in milliseconds, output in microseconds)
    composable.handleAddAnnotation(1000, 2000);
    expect(composable.annotationToAddEdit.value.start_time).toBe(1000000);

    // Edit annotation
    const editData = { id: 1, title: "Edited" };
    composable.editAnnotation(editData);
    expect(composable.annotationToAddEdit.value).toEqual(editData);

    // Close dialog
    composable.closeAddAnnotation();
    expect(composable.annotationToAddEdit.value).toBe(null);
    expect(composable.isAddAnnotationDialogVisible.value).toBe(false);
  });
});