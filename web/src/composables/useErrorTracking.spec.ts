import { describe, it, expect, beforeEach } from "vitest";
import useErrorTracking from "./useErrorTracking";

describe("useErrorTracking", () => {
  let errorTrackingInstance: ReturnType<typeof useErrorTracking>;

  beforeEach(() => {
    errorTrackingInstance = useErrorTracking();
  });

  describe("initial state", () => {
    it("should have correct initial loading state", () => {
      expect(errorTrackingInstance.errorTrackingState.loading).toEqual([]);
      expect(Array.isArray(errorTrackingInstance.errorTrackingState.loading)).toBe(true);
    });

    it("should have correct initial config state", () => {
      const config = errorTrackingInstance.errorTrackingState.config;
      
      expect(config.splitterModel).toBe(20);
      expect(config.lastSplitterPosition).toBe(0);
      expect(config.splitterLimit).toEqual([0, 40]);
      expect(Array.isArray(config.splitterLimit)).toBe(true);
      expect(config.splitterLimit.length).toBe(2);
    });

    it("should have correct refresh times configuration", () => {
      const refreshTimes = errorTrackingInstance.errorTrackingState.config.refreshTimes;
      
      expect(Array.isArray(refreshTimes)).toBe(true);
      expect(refreshTimes.length).toBe(4);

      // Check first row of refresh times
      expect(refreshTimes[0]).toEqual([
        { label: "5 sec", value: 5 },
        { label: "1 min", value: 60 },
        { label: "1 hr", value: 3600 },
      ]);

      // Check second row of refresh times
      expect(refreshTimes[1]).toEqual([
        { label: "10 sec", value: 10 },
        { label: "5 min", value: 300 },
        { label: "2 hr", value: 7200 },
      ]);

      // Check third row of refresh times
      expect(refreshTimes[2]).toEqual([
        { label: "15 sec", value: 15 },
        { label: "15 min", value: 900 },
        { label: "1 day", value: 86400 },
      ]);

      // Check fourth row of refresh times
      expect(refreshTimes[3]).toEqual([
        { label: "30 sec", value: 30 },
        { label: "30 min", value: 1800 },
      ]);
    });

    it("should have correct initial meta state", () => {
      const meta = errorTrackingInstance.errorTrackingState.meta;
      
      expect(meta.resultGrid.wrapCells).toBe(false);
      expect(meta.resultGrid.rowsPerPage).toBe(150);
      expect(meta.resultGrid.chartInterval).toBe("1 second");
      expect(meta.resultGrid.chartKeyFormat).toBe("HH:mm:ss");
      expect(meta.resultGrid.navigation.currentRowIndex).toBe(0);
    });

    it("should have correct initial data state", () => {
      const data = errorTrackingInstance.errorTrackingState.data;
      
      expect(data.parsedQuery).toEqual({});
      expect(data.errorMsg).toBe("");
      expect(data.errorCode).toBe(0);
      expect(data.additionalErrorMsg).toBe("");
      expect(data.editorValue).toBe("");
    });

    it("should have correct stream configuration", () => {
      const stream = errorTrackingInstance.errorTrackingState.data.stream;
      
      expect(stream.errorStream).toBe("_rumdata");
      expect(stream.selectedStreamFields).toEqual([]);
      expect(Array.isArray(stream.selectedStreamFields)).toBe(true);
    });

    it("should have correct result grid configuration", () => {
      const resultGrid = errorTrackingInstance.errorTrackingState.data.resultGrid;
      
      expect(resultGrid.currentDateTime).toBeInstanceOf(Date);
      expect(resultGrid.currentPage).toBe(0);
      expect(resultGrid.columns).toEqual([]);
      expect(Array.isArray(resultGrid.columns)).toBe(true);
      expect(resultGrid.size).toBe(150);
    });

    it("should have correct initial arrays and objects", () => {
      const data = errorTrackingInstance.errorTrackingState.data;
      
      expect(data.errors).toEqual([]);
      expect(Array.isArray(data.errors)).toBe(true);
      expect(data.streamResults).toEqual([]);
      expect(Array.isArray(data.streamResults)).toBe(true);
      expect(data.histogram).toEqual({});
      expect(typeof data.histogram).toBe("object");
      expect(data.selectedError).toEqual({});
      expect(typeof data.selectedError).toBe("object");
    });

    it("should have correct initial datetime configuration", () => {
      const datetime = errorTrackingInstance.errorTrackingState.data.datetime;
      
      expect(datetime.startTime).toBe(0);
      expect(datetime.endTime).toBe(0);
      expect(datetime.relativeTimePeriod).toBe("15m");
      expect(datetime.valueType).toBe("relative");
    });
  });

  describe("state reactivity", () => {
    it("should be reactive when modifying loading array", () => {
      const initialLength = errorTrackingInstance.errorTrackingState.loading.length;
      
      errorTrackingInstance.errorTrackingState.loading.push("test-loading");
      
      expect(errorTrackingInstance.errorTrackingState.loading.length).toBe(initialLength + 1);
      expect(errorTrackingInstance.errorTrackingState.loading).toContain("test-loading");
    });

    it("should be reactive when modifying config values", () => {
      const originalValue = errorTrackingInstance.errorTrackingState.config.splitterModel;
      
      errorTrackingInstance.errorTrackingState.config.splitterModel = 30;
      
      expect(errorTrackingInstance.errorTrackingState.config.splitterModel).toBe(30);
      expect(errorTrackingInstance.errorTrackingState.config.splitterModel).not.toBe(originalValue);
    });

    it("should be reactive when modifying data properties", () => {
      errorTrackingInstance.errorTrackingState.data.errorMsg = "Test error message";
      errorTrackingInstance.errorTrackingState.data.errorCode = 404;
      
      expect(errorTrackingInstance.errorTrackingState.data.errorMsg).toBe("Test error message");
      expect(errorTrackingInstance.errorTrackingState.data.errorCode).toBe(404);
    });

    it("should be reactive when modifying nested objects", () => {
      errorTrackingInstance.errorTrackingState.data.parsedQuery = { sql: "SELECT * FROM logs" };
      errorTrackingInstance.errorTrackingState.data.selectedError = { id: 1, message: "Error" };
      
      expect(errorTrackingInstance.errorTrackingState.data.parsedQuery).toEqual({ sql: "SELECT * FROM logs" });
      expect(errorTrackingInstance.errorTrackingState.data.selectedError).toEqual({ id: 1, message: "Error" });
    });

    it("should be reactive when modifying array properties", () => {
      errorTrackingInstance.errorTrackingState.data.errors.push({ id: 1, error: "Test error" });
      errorTrackingInstance.errorTrackingState.data.streamResults.push({ result: "Test result" });
      
      expect(errorTrackingInstance.errorTrackingState.data.errors.length).toBe(1);
      expect(errorTrackingInstance.errorTrackingState.data.streamResults.length).toBe(1);
      expect(errorTrackingInstance.errorTrackingState.data.errors[0]).toEqual({ id: 1, error: "Test error" });
    });
  });

  describe("resetErrorTrackingState function", () => {
    it("should exist as a function", () => {
      expect(typeof errorTrackingInstance.resetErrorTrackingState).toBe("function");
    });

    it("should be callable without errors", () => {
      expect(() => errorTrackingInstance.resetErrorTrackingState()).not.toThrow();
    });
  });

  describe("multiple instances", () => {
    it("should share state between instances", () => {
      const instance1 = useErrorTracking();
      const instance2 = useErrorTracking();
      
      instance1.errorTrackingState.data.errorMsg = "Shared error message";
      
      expect(instance2.errorTrackingState.data.errorMsg).toBe("Shared error message");
    });
  });

  describe("data structure integrity", () => {
    it("should maintain refresh times structure after modifications", () => {
      // Modify some other properties
      errorTrackingInstance.errorTrackingState.data.errorMsg = "Test";
      
      const refreshTimes = errorTrackingInstance.errorTrackingState.config.refreshTimes;
      
      // Verify refresh times structure is unchanged
      expect(refreshTimes[0][0]).toEqual({ label: "5 sec", value: 5 });
      expect(refreshTimes[1][1]).toEqual({ label: "5 min", value: 300 });
      expect(refreshTimes[2][2]).toEqual({ label: "1 day", value: 86400 });
      expect(refreshTimes[3][0]).toEqual({ label: "30 sec", value: 30 });
    });

    it("should maintain resultGrid currentDateTime as Date object", () => {
      const currentDateTime = errorTrackingInstance.errorTrackingState.data.resultGrid.currentDateTime;
      
      expect(currentDateTime).toBeInstanceOf(Date);
      expect(typeof currentDateTime.getTime()).toBe("number");
    });

    it("should maintain splitterLimit as array with correct values", () => {
      const splitterLimit = errorTrackingInstance.errorTrackingState.config.splitterLimit;
      
      expect(Array.isArray(splitterLimit)).toBe(true);
      expect(splitterLimit[0]).toBe(0);
      expect(splitterLimit[1]).toBe(40);
      expect(splitterLimit.length).toBe(2);
    });

    it("should maintain stream configuration integrity", () => {
      const stream = errorTrackingInstance.errorTrackingState.data.stream;
      
      expect(typeof stream.errorStream).toBe("string");
      expect(stream.errorStream).toBe("_rumdata");
      expect(Array.isArray(stream.selectedStreamFields)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle state modifications gracefully", () => {
      errorTrackingInstance.errorTrackingState.data.errorMsg = "Test error message";
      errorTrackingInstance.resetErrorTrackingState();
      
      const newInstance = useErrorTracking();
      newInstance.errorTrackingState.data.errorMsg = "After reset";
      
      expect(newInstance.errorTrackingState.data.errorMsg).toBe("After reset");
    });

    it("should preserve refresh times values correctly", () => {
      const refreshTimes = errorTrackingInstance.errorTrackingState.config.refreshTimes;
      
      // Test all values are numbers and labels are strings
      refreshTimes.forEach((row, rowIndex) => {
        row.forEach((item, itemIndex) => {
          expect(typeof item.label).toBe("string");
          expect(typeof item.value).toBe("number");
          expect(item.value).toBeGreaterThan(0);
        });
      });
    });
  });
});