// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLogsState } from "@/composables/useLogsState";
import { ref, reactive } from "vue";

// Mock Vuex store
const mockStore = {
  state: {
    zoConfig: {
      actions_enabled: true
    }
  }
};

vi.mock("vuex", () => ({
  useStore: vi.fn(() => mockStore)
}));

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: "false"
  }
}));

// Mock constants
vi.mock("@/utils/logs/constants", () => ({
  DEFAULT_LOGS_CONFIG: {
    organizationIdentifier: "",
    runQuery: false,
    loading: false,
    loadingHistogram: false,
    loadingCounter: false,
    data: {
      errorMsg: "",
      errorCode: 0,
      stream: {
        streamLists: [],
        selectedStream: [],
        streamType: "logs"
      }
    }
  },
  DEFAULT_SEARCH_DEBUG_DATA: {
    debug: {
      enabled: false,
      query: ""
    }
  },
  DEFAULT_SEARCH_AGG_DATA: {
    aggregations: {}
  }
}));

describe("useLogsState", () => {
  let logsState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logsState = useLogsState();
  });

  describe("reactive state initialization", () => {
    it("should initialize searchObj with default configuration", () => {
      expect(logsState.searchObj).toBeDefined();
      expect(logsState.searchObj.data).toBeDefined();
      expect(logsState.searchObj.data.stream).toBeDefined();
      expect(logsState.searchObj.data.stream.streamLists).toEqual([]);
      expect(logsState.searchObj.data.stream.selectedStream).toEqual([]);
      expect(logsState.searchObj.data.stream.streamType).toBe("logs");
    });

    it("should initialize searchObjDebug with default debug data", () => {
      expect(logsState.searchObjDebug).toBeDefined();
      expect(logsState.searchObjDebug.debug).toBeDefined();
      expect(logsState.searchObjDebug.debug.enabled).toBe(false);
    });

    it("should initialize searchAggData with default aggregation data", () => {
      expect(logsState.searchAggData).toBeDefined();
      expect(logsState.searchAggData.aggregations).toBeDefined();
    });

    it("should initialize initialQueryPayload as null ref", () => {
      expect(logsState.initialQueryPayload).toBeDefined();
      expect(logsState.initialQueryPayload.value).toBeNull();
    });

    it("should initialize streamSchemaFieldsIndexMapping as empty ref", () => {
      expect(logsState.streamSchemaFieldsIndexMapping).toBeDefined();
      expect(logsState.streamSchemaFieldsIndexMapping.value).toEqual({});
    });

    it("should initialize fieldValues as undefined ref", () => {
      expect(logsState.fieldValues).toBeDefined();
      expect(logsState.fieldValues.value).toBeUndefined();
    });

    it("should initialize notificationMsg as empty string ref", () => {
      expect(logsState.notificationMsg).toBeDefined();
      expect(logsState.notificationMsg.value).toBe("");
    });

    it("should initialize ftsFields as empty array ref", () => {
      expect(logsState.ftsFields).toBeDefined();
      expect(logsState.ftsFields.value).toEqual([]);
    });
  });

  describe("computed properties", () => {
    it("should compute isActionsEnabled based on config and store state", () => {
      expect(logsState.isActionsEnabled.value).toBe(true);
    });

    it("should return false for isActionsEnabled when actions are disabled in store", () => {
      mockStore.state.zoConfig.actions_enabled = false;
      const newLogsState = useLogsState();
      expect(newLogsState.isActionsEnabled.value).toBe(false);
    });
  });

  describe("state management functions", () => {
    it("should have resetSearchObj function", () => {
      expect(typeof logsState.resetSearchObj).toBe("function");
      
      // Test that calling resetSearchObj doesn't throw an error
      expect(() => logsState.resetSearchObj()).not.toThrow();
    });

    it("should reset stream data", () => {
      // Set some stream data
      logsState.searchObj.data.stream.streamLists = ["stream1", "stream2"];
      logsState.searchObj.data.stream.selectedStream = ["stream1"];
      logsState.searchObj.data.stream.streamType = "logs";

      // Reset stream data
      logsState.resetStreamData();

      // Verify stream data is reset
      expect(logsState.searchObj.data.stream.streamLists).toEqual([]);
      expect(logsState.searchObj.data.stream.selectedStream).toEqual([]);
      expect(logsState.searchObj.data.stream.streamType).toBe("");
    });
  });

  describe("reactivity", () => {
    it("should maintain reactivity after state changes", () => {
      const initialValue = logsState.notificationMsg.value;
      logsState.notificationMsg.value = "Test message";
      expect(logsState.notificationMsg.value).toBe("Test message");
      expect(logsState.notificationMsg.value).not.toBe(initialValue);
    });

    it("should maintain object reactivity", () => {
      const initialLength = logsState.searchObj.data.stream.streamLists.length;
      logsState.searchObj.data.stream.streamLists.push("test-stream");
      expect(logsState.searchObj.data.stream.streamLists.length).toBe(initialLength + 1);
    });
  });
});