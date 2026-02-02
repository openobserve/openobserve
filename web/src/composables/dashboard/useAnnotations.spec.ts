import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useAnnotations } from "./useAnnotations";
import { annotationService } from "../../services/dashboard_annotations";

// Mock the annotation service
vi.mock("../../services/dashboard_annotations", () => ({
  annotationService: {
    get_timed_annotations: vi.fn(),
  },
}));

const mockAnnotationService = vi.mocked(annotationService);

describe("useAnnotations", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("should create useAnnotations composable with correct parameters", () => {
    const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
    
    expect(composable).toBeDefined();
    expect(composable.refreshAnnotations).toBeDefined();
    expect(typeof composable.refreshAnnotations).toBe("function");
  });

  describe("refreshAnnotations", () => {
    it("should return early if panelId is empty", async () => {
      const composable = useAnnotations("test-org", "test-dashboard", "");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeUndefined();
      expect(mockAnnotationService.get_timed_annotations).not.toHaveBeenCalled();
    });

    it("should return early if dashboardId is empty", async () => {
      const composable = useAnnotations("test-org", "", "test-panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeUndefined();
      expect(mockAnnotationService.get_timed_annotations).not.toHaveBeenCalled();
    });

    it("should call annotation service with correct parameters when all required params are present", async () => {
      const mockResponse = { data: [{ id: 1, text: "test annotation" }] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledWith(
        "test-org",
        "test-dashboard",
        {
          panels: ["test-panel"],
          start_time: 1000,
          end_time: 2000,
        }
      );
      expect(result).toEqual([{ id: 1, text: "test annotation" }]);
    });

    it("should handle successful API response and return data", async () => {
      const mockAnnotations = [
        { id: 1, text: "annotation 1", timestamp: 1500 },
        { id: 2, text: "annotation 2", timestamp: 1800 },
      ];
      const mockResponse = { data: mockAnnotations };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("org1", "dashboard1", "panel1");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toEqual(mockAnnotations);
    });

    it("should handle API errors and return null", async () => {
      const mockError = new Error("API Error");
      mockAnnotationService.get_timed_annotations.mockRejectedValue(mockError);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error fetching annotations:", mockError);
    });

    it("should handle different error types", async () => {
      const mockError = { message: "Network error", status: 500 };
      mockAnnotationService.get_timed_annotations.mockRejectedValue(mockError);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error fetching annotations:", mockError);
    });

    it("should work with different organization names", async () => {
      const mockResponse = { data: [] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("different-org", "test-dashboard", "test-panel");
      await composable.refreshAnnotations(1000, 2000);

      expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledWith(
        "different-org",
        "test-dashboard",
        {
          panels: ["test-panel"],
          start_time: 1000,
          end_time: 2000,
        }
      );
    });

    it("should work with different dashboard IDs", async () => {
      const mockResponse = { data: [] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("test-org", "another-dashboard", "test-panel");
      await composable.refreshAnnotations(1000, 2000);

      expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledWith(
        "test-org",
        "another-dashboard",
        {
          panels: ["test-panel"],
          start_time: 1000,
          end_time: 2000,
        }
      );
    });

    it("should work with different panel IDs", async () => {
      const mockResponse = { data: [] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("test-org", "test-dashboard", "different-panel");
      await composable.refreshAnnotations(1000, 2000);

      expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledWith(
        "test-org",
        "test-dashboard",
        {
          panels: ["different-panel"],
          start_time: 1000,
          end_time: 2000,
        }
      );
    });

    it("should work with different time ranges", async () => {
      const mockResponse = { data: [] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      await composable.refreshAnnotations(5000, 10000);

      expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledWith(
        "test-org",
        "test-dashboard",
        {
          panels: ["test-panel"],
          start_time: 5000,
          end_time: 10000,
        }
      );
    });

    it("should handle zero timestamp values", async () => {
      const mockResponse = { data: [] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      await composable.refreshAnnotations(0, 0);

      expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledWith(
        "test-org",
        "test-dashboard",
        {
          panels: ["test-panel"],
          start_time: 0,
          end_time: 0,
        }
      );
    });

    it("should handle negative timestamp values", async () => {
      const mockResponse = { data: [] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      await composable.refreshAnnotations(-1000, -500);

      expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledWith(
        "test-org",
        "test-dashboard",
        {
          panels: ["test-panel"],
          start_time: -1000,
          end_time: -500,
        }
      );
    });

    it("should handle service response without data property", async () => {
      const mockResponse = { annotations: [] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeUndefined();
    });

    it("should handle null service response", async () => {
      mockAnnotationService.get_timed_annotations.mockResolvedValue(null);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeNull();
    });

    it("should handle undefined service response", async () => {
      mockAnnotationService.get_timed_annotations.mockResolvedValue(undefined);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeNull();
    });

    it("should handle empty string parameters", async () => {
      const composable = useAnnotations("", "", "");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeUndefined();
      expect(mockAnnotationService.get_timed_annotations).not.toHaveBeenCalled();
    });

    it("should handle only panelId being empty", async () => {
      const composable = useAnnotations("org", "dashboard", "");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeUndefined();
      expect(mockAnnotationService.get_timed_annotations).not.toHaveBeenCalled();
    });

    it("should handle only dashboardId being empty", async () => {
      const composable = useAnnotations("org", "", "panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      expect(result).toBeUndefined();
      expect(mockAnnotationService.get_timed_annotations).not.toHaveBeenCalled();
    });

    it("should make multiple calls with different parameters", async () => {
      const mockResponse1 = { data: [{ id: 1 }] };
      const mockResponse2 = { data: [{ id: 2 }] };
      mockAnnotationService.get_timed_annotations
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      
      const result1 = await composable.refreshAnnotations(1000, 2000);
      const result2 = await composable.refreshAnnotations(3000, 4000);

      expect(result1).toEqual([{ id: 1 }]);
      expect(result2).toEqual([{ id: 2 }]);
      expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledTimes(2);
    });
  });

  it("should return the same function reference on multiple calls", () => {
    const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
    const refreshFn1 = composable.refreshAnnotations;
    const refreshFn2 = composable.refreshAnnotations;

    expect(refreshFn1).toBe(refreshFn2);
  });

  it("should create independent instances with different parameters", async () => {
    const mockResponse = { data: [] };
    mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

    const composable1 = useAnnotations("org1", "dash1", "panel1");
    const composable2 = useAnnotations("org2", "dash2", "panel2");

    await composable1.refreshAnnotations(1000, 2000);
    await composable2.refreshAnnotations(3000, 4000);

    expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledTimes(2);
    expect(mockAnnotationService.get_timed_annotations).toHaveBeenNthCalledWith(1,
      "org1", "dash1", { panels: ["panel1"], start_time: 1000, end_time: 2000 }
    );
    expect(mockAnnotationService.get_timed_annotations).toHaveBeenNthCalledWith(2,
      "org2", "dash2", { panels: ["panel2"], start_time: 3000, end_time: 4000 }
    );
  });
});