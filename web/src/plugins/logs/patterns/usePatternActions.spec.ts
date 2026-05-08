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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ref, reactive } from "vue";

// -- Mocks (hoisted) --

const mockNotify = vi.fn();
vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({ notify: mockNotify, dialog: vi.fn() }),
  };
});

const mockRouterPush = vi.fn();
vi.mock("vue-router", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useRouter: () => ({ push: mockRouterPush }),
    useRoute: () => ({}),
  };
});

const mockStore = { state: { selectedOrganization: { identifier: "default" } } };
vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: () => mockStore,
  };
});

// searchState mock
const createMockSearchObj = () =>
  reactive({
    data: {
      stream: {
        selectedStream: ["test-stream"],
        addToFilter: "",
      },
      datetime: {
        startTime: 3600000000,
        endTime: 7200000000,
      },
      queryResults: {
        scan_records: 5000,
      },
    },
    meta: {
      logsVisualizeToggle: "patterns",
    },
  });

const mockSearchObj = createMockSearchObj();

vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({ searchObj: mockSearchObj }),
}));

// usePatterns mock
const mockPatternsState = ref<{ patterns: any }>({
  patterns: {
    patterns: [
      { template: "User <*> logged in", frequency: 100, percentage: 50, pattern_id: "p1" },
      { template: "Error <*> occurred", frequency: 50, percentage: 25, pattern_id: "p2" },
    ],
    statistics: { total_logs_analyzed: 1000 },
  },
});

vi.mock("@/composables/useLogs/usePatterns", () => ({
  default: () => ({ patternsState: mockPatternsState }),
}));

// patternUtils mock
vi.mock("./patternUtils", () => ({
  extractConstantsFromPattern: vi.fn(),
  escapeForMatchAll: vi.fn((s: string) => s),
  buildPatternAlertData: vi.fn(() => ({
    streamName: "test-stream",
    sqlQuery: "SELECT *",
    alertName: "Alert_test-stream_User",
  })),
}));

// -- Import after mocks --
import { usePatternActions } from "./usePatternActions";
import {
  extractConstantsFromPattern,
  buildPatternAlertData,
} from "./patternUtils";

describe("usePatternActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared state between tests
    mockSearchObj.data.stream.addToFilter = "";
    mockSearchObj.meta.logsVisualizeToggle = "patterns";
    const { selectedPattern, showPatternDetails } = usePatternActions();
    selectedPattern.value = null;
    showPatternDetails.value = false;
  });

  describe("openPatternDetails", () => {
    it("should set selectedPattern and showPatternDetails", () => {
      const { openPatternDetails, selectedPattern, showPatternDetails } =
        usePatternActions();
      const pattern = { template: "test", pattern_id: "p1" };

      openPatternDetails(pattern, 0);

      expect(selectedPattern.value).toEqual({ pattern, index: 0 });
      expect(showPatternDetails.value).toBe(true);
    });
  });

  describe("navigatePatternDetail", () => {
    it("should navigate to next pattern", () => {
      const { openPatternDetails, navigatePatternDetail, selectedPattern } =
        usePatternActions();
      openPatternDetails({ template: "first", pattern_id: "p1" }, 0);

      navigatePatternDetail(true, false);

      expect(selectedPattern.value!.index).toBe(1);
      expect(selectedPattern.value!.pattern.template).toBe("Error <*> occurred");
    });

    it("should navigate to previous pattern", () => {
      const { openPatternDetails, navigatePatternDetail, selectedPattern } =
        usePatternActions();
      openPatternDetails({ template: "first", pattern_id: "p1" }, 1);

      navigatePatternDetail(false, true);

      expect(selectedPattern.value!.index).toBe(0);
    });

    it("should not navigate beyond the first pattern when going prev", () => {
      const { openPatternDetails, navigatePatternDetail, selectedPattern } =
        usePatternActions();
      openPatternDetails({ template: "first", pattern_id: "p1" }, 0);

      navigatePatternDetail(false, true);

      expect(selectedPattern.value!.index).toBe(0);
    });

    it("should not navigate beyond the last pattern when going next", () => {
      const { openPatternDetails, navigatePatternDetail, selectedPattern } =
        usePatternActions();
      openPatternDetails({ template: "second", pattern_id: "p2" }, 1);

      navigatePatternDetail(true, false);

      expect(selectedPattern.value!.index).toBe(1);
    });

    it("should do nothing when no pattern is selected", () => {
      const { navigatePatternDetail, selectedPattern } = usePatternActions();

      navigatePatternDetail(true, false);

      expect(selectedPattern.value).toBeNull();
    });
  });

  describe("addPatternToSearch", () => {
    it("should build filter from constants and set addToFilter", () => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue([
        "User logged in",
        "from address",
      ]);
      const { addPatternToSearch } = usePatternActions();

      addPatternToSearch({ template: "User <*> from <:IP>" }, "include");

      expect(mockSearchObj.data.stream.addToFilter).toBe(
        "match_all('User logged in') AND match_all('from address')",
      );
      expect(mockSearchObj.meta.logsVisualizeToggle).toBe("logs");
    });

    it("should wrap with NOT for exclude action", () => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue([
        "User logged in",
      ]);
      const { addPatternToSearch } = usePatternActions();

      addPatternToSearch({ template: "User <*> from <:IP>" }, "exclude");

      expect(mockSearchObj.data.stream.addToFilter).toBe(
        "NOT match_all('User logged in')",
      );
    });

    it("should wrap multiple clauses with NOT (...) for exclude action", () => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue([
        "User logged in",
        "from address",
      ]);
      const { addPatternToSearch } = usePatternActions();

      addPatternToSearch({ template: "User <*> from <:IP>" }, "exclude");

      expect(mockSearchObj.data.stream.addToFilter).toBe(
        "NOT (match_all('User logged in') AND match_all('from address'))",
      );
    });

    it("should show warning and skip when no constants found", () => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue([]);
      const { addPatternToSearch } = usePatternActions();

      addPatternToSearch({ template: "<*>" }, "include");

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "warning" }),
      );
      expect(mockSearchObj.data.stream.addToFilter).toBe("");
    });
  });

  describe("addWildcardValueToSearch", () => {
    it("should create match_all filter for include action", () => {
      const { addWildcardValueToSearch } = usePatternActions();

      addWildcardValueToSearch("192.168.1.1", "include");

      expect(mockSearchObj.data.stream.addToFilter).toBe(
        "match_all('192.168.1.1')",
      );
      expect(mockSearchObj.meta.logsVisualizeToggle).toBe("logs");
    });

    it("should wrap with NOT for exclude action", () => {
      const { addWildcardValueToSearch } = usePatternActions();

      addWildcardValueToSearch("error_message", "exclude");

      expect(mockSearchObj.data.stream.addToFilter).toBe(
        "NOT match_all('error_message')",
      );
    });
  });

  describe("createAlertFromPattern", () => {
    beforeEach(() => {
      // Provide constants so alert creation proceeds
      vi.mocked(extractConstantsFromPattern).mockReturnValue([
        "User logged in",
      ]);
      // Re-set buildPatternAlertData return value (cleared by outer beforeEach vi.clearAllMocks)
      vi.mocked(buildPatternAlertData).mockReturnValue({
        streamName: "test-stream",
        sqlQuery: "SELECT *",
        alertName: "Alert_test-stream_User",
      });
      // Ensure stream is selected (previous tests may have cleared it)
      mockSearchObj.data.stream.selectedStream = ["test-stream"];
    });

    it("should navigate to addAlert with pattern data", () => {
      const { createAlertFromPattern } = usePatternActions();

      createAlertFromPattern({
        template: "User <*> logged in",
        pattern_id: "p1",
        frequency: 100,
        percentage: 50,
      });

      expect(mockRouterPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "addAlert",
          query: expect.objectContaining({ fromPattern: "true" }),
        }),
      );
    });

    it("should warn when no stream is selected", () => {
      mockSearchObj.data.stream.selectedStream = [];
      const { createAlertFromPattern } = usePatternActions();

      createAlertFromPattern({ template: "User <*> logged in" });

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "warning" }),
      );
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("should warn when pattern has no long constants", () => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue([]);
      const { createAlertFromPattern } = usePatternActions();

      createAlertFromPattern({ template: "<*>" });

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "warning" }),
      );
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("should store patternData in sessionStorage", () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      const { createAlertFromPattern } = usePatternActions();

      createAlertFromPattern({
        template: "User <*> logged in",
        pattern_id: "p1",
      });

      expect(setItemSpy).toHaveBeenCalledWith(
        "patternData",
        expect.any(String),
      );
    });
  });
});
