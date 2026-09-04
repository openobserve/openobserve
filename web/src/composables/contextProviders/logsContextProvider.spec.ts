import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createLogsContextProvider } from "./logsContextProvider";

vi.mock("@/utils/date", () => ({
  getConsumableRelativeTime: vi.fn(() => ({
    startTime: 100,
    endTime: 200,
  })),
}));

describe("createLogsContextProvider", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const store = {
    state: {
      selectedOrganization: {
        identifier: "org-ctx",
      },
    },
  };

  it("creates logs context in logs mode with deduplicated interesting fields", async () => {
    const searchObj: any = {
      meta: {
        logsVisualizeToggle: "logs",
        sqlMode: true,
        quickMode: true,
      },
      data: {
        query: "select * from logs",
        tempFunctionContent: "vrl_fn",
        stream: {
          selectedStream: ["default"],
          streamType: "logs",
          selectedInterestingStreamFields: [
            {
              name: "level",
              streams: ["default"],
              isInterestingField: true,
              isSchemaField: true,
              label: false,
            },
            {
              name: "level",
              streams: ["default"],
              isInterestingField: true,
              isSchemaField: true,
              label: false,
            },
            {
              name: "service",
              streams: ["default", "infra"],
              isInterestingField: true,
              isSchemaField: true,
              label: false,
            },
            {
              name: "ignored",
              streams: ["default"],
              isInterestingField: false,
              isSchemaField: true,
              label: false,
            },
          ],
        },
        datetime: {
          type: "relative",
          relativeTimePeriod: "15m",
        },
      },
    };

    const provider = createLogsContextProvider(searchObj, store);
    const context = await provider.getContext();

    expect(context.currentPage).toBe("logs");
    expect(context.currentSQLQuery).toBe("select * from logs");
    expect(context.currentVRLQuery).toBe("vrl_fn");
    expect(context.selectedStreams).toEqual(["default"]);
    expect(context.streamType).toBe("logs");
    expect(context.interestingFields).toEqual({
      default: ["level", "service"],
      infra: ["service"],
    });
    expect(context.timeRange).toEqual({
      type: "relative",
      relativeTimePeriod: "15m",
      startTime: 100,
      endTime: 200,
    });
    expect(context.organization_identifier).toBe("org-ctx");
    expect(context.quickMode).toBe(true);
    expect(context.request_timestamp).toBe(1_900_000_000_000_000);
  });

  it("creates dashboard mode context and keeps absolute range fields", async () => {
    const searchObj: any = {
      meta: {
        logsVisualizeToggle: "visualize",
      },
      data: {
        query: "",
        stream: {
          selectedInterestingStreamFields: [],
        },
        datetime: {
          type: "absolute",
          startTime: 10,
          endTime: 20,
          selectedDate: "2026-03-18",
          selectedTime: "10:30",
          queryRangeRestrictionMsg: "too wide",
          queryRangeRestrictionInHour: 12,
        },
      },
    };

    const dashboardPanelData = {
      layout: {
        currentQueryIndex: 0,
      },
      data: {
        queries: [
          {
            fields: {
              stream: "metrics_stream",
              stream_type: "metrics",
            },
          },
        ],
      },
    };

    const provider = createLogsContextProvider(searchObj, store, dashboardPanelData);
    const context = await provider.getContext();

    expect(context.selectedStreams).toEqual(["metrics_stream"]);
    expect(context.streamType).toBe("metrics");
    expect(context.timeRange).toEqual({
      type: "absolute",
      startTime: 10,
      endTime: 20,
      selectedDate: "2026-03-18",
      selectedTime: "10:30",
      queryRangeRestrictionMsg: "too wide",
      queryRangeRestrictionInHour: 12,
    });
  });

  it("returns fallback context on extraction errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const provider = createLogsContextProvider(
      {
        meta: null,
        data: {
          query: "select 1",
          stream: {
            selectedStream: ["s1"],
          },
        },
      },
      {},
    );

    const context = await provider.getContext();

    expect(context.currentPage).toBe("logs");
    expect(context.currentSQLQuery).toBe("select 1");
    expect(context.selectedStreams).toEqual(["s1"]);
    expect(context.organization_identifier).toBe("");
    expect(context.error).toBe("Failed to extract full context");
    expect(typeof context.timestamp).toBe("string");

    consoleSpy.mockRestore();
  });
});
