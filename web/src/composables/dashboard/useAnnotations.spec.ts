import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useAnnotations } from "./useAnnotations";
import { annotationService } from "../../services/dashboard_annotations";
import { queryClient } from "@/composables/query/queryClient";
import { createAnnotationMutation } from "@/services/dashboard_annotations.queries";
import { annotationKeys } from "@/services/dashboard_annotations.querykeys";

// Mock the annotation service
vi.mock("../../services/dashboard_annotations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    annotationService: {
      get_timed_annotations: vi.fn(),
    },
  });
});

const mockAnnotationService = vi.mocked(annotationService);

describe("useAnnotations", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // The cache key has no panel id, so an entry from one test would answer the next.
    queryClient.clear();
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
          start_time: 1000,
          end_time: 2000,
        },
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
          start_time: 1000,
          end_time: 2000,
        },
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
          start_time: 1000,
          end_time: 2000,
        },
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
          start_time: 1000,
          end_time: 2000,
        },
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
          start_time: 5000,
          end_time: 10000,
        },
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
          start_time: 0,
          end_time: 0,
        },
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
          start_time: -1000,
          end_time: -500,
        },
      );
    });

    it("should handle service response without data property", async () => {
      const mockResponse = { annotations: [] };
      mockAnnotationService.get_timed_annotations.mockResolvedValue(mockResponse);

      const composable = useAnnotations("test-org", "test-dashboard", "test-panel");
      const result = await composable.refreshAnnotations(1000, 2000);

      // Normalised to null with the other two "no annotations" shapes: a cached
      // query result may not be undefined.
      expect(result).toBeNull();
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
    expect(mockAnnotationService.get_timed_annotations).toHaveBeenNthCalledWith(
      1,
      "org1",
      "dash1",
      { start_time: 1000, end_time: 2000 },
    );
    expect(mockAnnotationService.get_timed_annotations).toHaveBeenNthCalledWith(
      2,
      "org2",
      "dash2",
      { start_time: 3000, end_time: 4000 },
    );
  });
});

describe("useAnnotations: one request per dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const rows = [
    { annotation_id: "a", panels: ["p1"] },
    { annotation_id: "b", panels: ["p2"] },
    { annotation_id: "c", panels: ["p1", "p2"] },
    { annotation_id: "d", panels: [] },
  ];

  it("sends one request for many panels and gives each panel its own rows", async () => {
    mockAnnotationService.get_timed_annotations.mockResolvedValue({ data: rows } as any);

    const [r1, r2, r3] = await Promise.all(
      ["p1", "p2", "p3"].map((p) => useAnnotations("org", "dash", p).refreshAnnotations(1, 2)),
    );

    expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledTimes(1);
    expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledWith("org", "dash", {
      start_time: 1,
      end_time: 2,
    });
    expect(r1.map((a: any) => a.annotation_id)).toEqual(["a", "c", "d"]);
    expect(r2.map((a: any) => a.annotation_id)).toEqual(["b", "c", "d"]);
    expect(r3.map((a: any) => a.annotation_id)).toEqual(["d"]);
  });

  it("sends a new request for a different window", async () => {
    mockAnnotationService.get_timed_annotations.mockResolvedValue({ data: rows } as any);

    await useAnnotations("org", "dash", "p1").refreshAnnotations(1, 2);
    await useAnnotations("org", "dash", "p2").refreshAnnotations(1, 3);

    expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 503 and draws the panel without annotations", async () => {
    mockAnnotationService.get_timed_annotations.mockRejectedValue({
      response: { status: 503 },
    });

    const result = await useAnnotations("org", "dash", "p1").refreshAnnotations(1, 2);

    expect(result).toBeNull();
    expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledTimes(1);
  });

  it("keeps a 503 answer so that a panel that loads later sends no request", async () => {
    mockAnnotationService.get_timed_annotations.mockRejectedValue({
      response: { status: 503 },
    });

    await useAnnotations("org", "dash", "p1").refreshAnnotations(1, 2);
    const later = await useAnnotations("org", "dash", "p2").refreshAnnotations(1, 2);

    expect(later).toBeNull();
    expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledTimes(1);
  });

  it("drops the idle lists of older revisions after a write", async () => {
    mockAnnotationService.get_timed_annotations.mockResolvedValue({ data: [] } as any);
    vi.spyOn(annotationService, "create_timed_annotations").mockResolvedValue({ data: {} } as any);
    const lists = () =>
      queryClient.getQueryCache().findAll({ queryKey: annotationKeys.dashboard("org", "dash") });

    for (let i = 0; i < 3; i++) {
      await useAnnotations("org", "dash", "p1").refreshAnnotations(1, 2);
      await queryClient
        .getMutationCache()
        .build(queryClient, createAnnotationMutation("org", "dash"))
        .execute([{ title: `edit ${i}` }]);
    }
    await useAnnotations("org", "dash", "p1").refreshAnnotations(1, 2);

    expect(lists()).toHaveLength(1);
  });

  it("does not let the reload after a write join a read that started before it", async () => {
    let finishOldRead: (value: unknown) => void = () => {};
    mockAnnotationService.get_timed_annotations
      .mockImplementationOnce(() => new Promise((resolve) => (finishOldRead = resolve)) as any)
      .mockResolvedValueOnce({ data: [{ annotation_id: "new", panels: ["p1"] }] } as any);
    vi.spyOn(annotationService, "create_timed_annotations").mockResolvedValue({ data: {} } as any);

    const oldRead = useAnnotations("org", "dash", "p2").refreshAnnotations(1, 2);
    const write = queryClient
      .getMutationCache()
      .build(queryClient, createAnnotationMutation("org", "dash"));
    await write.execute([{ title: "new" }]);
    const reload = await useAnnotations("org", "dash", "p1").refreshAnnotations(1, 2);
    finishOldRead({ data: [] });
    await oldRead;

    expect(mockAnnotationService.get_timed_annotations).toHaveBeenCalledTimes(2);
    expect(reload.map((a: any) => a.annotation_id)).toEqual(["new"]);
  });
});
