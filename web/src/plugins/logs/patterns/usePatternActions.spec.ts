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
import { ref, reactive } from "vue";

// -- Mocks (hoisted) --

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

// usePatternActions calls useI18n() directly (outside a component), so stub it.
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

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
// Partial mock: only the constant extraction is stubbed (tests drive it to
// simulate usable / unusable patterns). The SQL builder and the pattern cap stay
// real, so these tests exercise the query the user would actually get.
vi.mock("./patternUtils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    extractConstantsFromPattern: vi.fn(),
    escapeForMatchAll: vi.fn((s: string) => s),
  };
});

// -- Import after mocks --
import { usePatternActions } from "./usePatternActions";
import { extractConstantsFromPattern } from "./patternUtils";

describe("usePatternActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared state between tests
    mockSearchObj.data.stream.addToFilter = "";
    mockSearchObj.meta.logsVisualizeToggle = "patterns";
    const { selectedPattern, showPatternDetails, setActiveSeverities } = usePatternActions();
    selectedPattern.value = null;
    showPatternDetails.value = false;
    // The severity filter is module-scoped (shared with the alert builder), so
    // it must be reset between tests like any other singleton.
    setActiveSeverities([]);
  });

  describe("openPatternDetails", () => {
    it("should set selectedPattern and showPatternDetails", () => {
      const { openPatternDetails, selectedPattern, showPatternDetails } = usePatternActions();
      const pattern = { template: "test", pattern_id: "p1" };

      openPatternDetails(pattern, 0);

      expect(selectedPattern.value).toEqual({ pattern, index: 0 });
      expect(showPatternDetails.value).toBe(true);
    });
  });

  describe("navigatePatternDetail", () => {
    it("should navigate to next pattern", () => {
      const { openPatternDetails, navigatePatternDetail, selectedPattern } = usePatternActions();
      openPatternDetails({ template: "first", pattern_id: "p1" }, 0);

      navigatePatternDetail(true, false);

      expect(selectedPattern.value!.index).toBe(1);
      expect(selectedPattern.value!.pattern.template).toBe("Error <*> occurred");
    });

    it("should navigate to previous pattern", () => {
      const { openPatternDetails, navigatePatternDetail, selectedPattern } = usePatternActions();
      openPatternDetails({ template: "first", pattern_id: "p1" }, 1);

      navigatePatternDetail(false, true);

      expect(selectedPattern.value!.index).toBe(0);
    });

    it("should not navigate beyond the first pattern when going prev", () => {
      const { openPatternDetails, navigatePatternDetail, selectedPattern } = usePatternActions();
      openPatternDetails({ template: "first", pattern_id: "p1" }, 0);

      navigatePatternDetail(false, true);

      expect(selectedPattern.value!.index).toBe(0);
    });

    it("should not navigate beyond the last pattern when going next", () => {
      const { openPatternDetails, navigatePatternDetail, selectedPattern } = usePatternActions();
      openPatternDetails({ template: "second", pattern_id: "p2" }, 1);

      navigatePatternDetail(true, false);

      expect(selectedPattern.value!.index).toBe(1);
    });

    it("should do nothing when no pattern is selected", () => {
      const { navigatePatternDetail, selectedPattern } = usePatternActions();

      navigatePatternDetail(true, false);

      expect(selectedPattern.value).toBeNull();
    });

    it("navigates the passed visible list, not the full pattern set", () => {
      // Simulate a severity filter: the visible list is a 2-item subset in a
      // different order than the full mockPatternsState list.
      const visible = [
        { template: "visible-A", pattern_id: "vA" },
        { template: "visible-B", pattern_id: "vB" },
      ];
      const { openPatternDetails, navigatePatternDetail, selectedPattern, navTotal } =
        usePatternActions();
      openPatternDetails(visible[0], 0, visible);

      // Total reflects the visible list, not the full set.
      expect(navTotal.value).toBe(2);

      navigatePatternDetail(true, false);
      expect(selectedPattern.value!.index).toBe(1);
      expect(selectedPattern.value!.pattern.template).toBe("visible-B");

      // Cannot step past the visible list's end.
      navigatePatternDetail(true, false);
      expect(selectedPattern.value!.index).toBe(1);
    });
  });

  describe("addPatternToSearch", () => {
    it("should build filter from constants and set addToFilter", () => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue(["User logged in", "from address"]);
      const { addPatternToSearch } = usePatternActions();

      addPatternToSearch({ template: "User <*> from <:IP>" }, "include");

      expect(mockSearchObj.data.stream.addToFilter).toBe(
        "match_all('User logged in') AND match_all('from address')",
      );
      expect(mockSearchObj.meta.logsVisualizeToggle).toBe("logs");
    });

    it("should wrap with NOT for exclude action", () => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue(["User logged in"]);
      const { addPatternToSearch } = usePatternActions();

      addPatternToSearch({ template: "User <*> from <:IP>" }, "exclude");

      expect(mockSearchObj.data.stream.addToFilter).toBe("NOT match_all('User logged in')");
    });

    it("should wrap multiple clauses with NOT (...) for exclude action", () => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue(["User logged in", "from address"]);
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

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(mockSearchObj.data.stream.addToFilter).toBe("");
    });
  });

  describe("addWildcardValueToSearch", () => {
    it("should create match_all filter for include action", () => {
      const { addWildcardValueToSearch } = usePatternActions();

      addWildcardValueToSearch("192.168.1.1", "include");

      expect(mockSearchObj.data.stream.addToFilter).toBe("match_all('192.168.1.1')");
      expect(mockSearchObj.meta.logsVisualizeToggle).toBe("logs");
    });

    it("should wrap with NOT for exclude action", () => {
      const { addWildcardValueToSearch } = usePatternActions();

      addWildcardValueToSearch("error_message", "exclude");

      expect(mockSearchObj.data.stream.addToFilter).toBe("NOT match_all('error_message')");
    });
  });

  describe("severity filter (shared with the alert builder)", () => {
    it("is module-scoped so the list and the builder cannot disagree", () => {
      const a = usePatternActions();
      const b = usePatternActions();

      a.setActiveSeverities(["error"]);
      expect(b.activeSeverities.value).toEqual(["error"]);
    });
  });

  describe("buildPatternsAlertPrefill", () => {
    // Templates whose constants survive the real extractConstantsFromPattern,
    // which the SQL builder calls internally.
    const ERR = "Connection refused to upstream <*>";
    const PROBE = "Health probe succeeded for endpoint <*>";

    beforeEach(() => {
      vi.mocked(extractConstantsFromPattern).mockReturnValue(["Connection refused to upstream"]);
      mockSearchObj.data.stream.selectedStream = ["test-stream"];
      mockSearchObj.meta.sqlMode = false;
      mockSearchObj.data.query = "";
      mockPatternsState.value.patterns.patterns = [
        { pattern_id: "p1", template: ERR, level: "error" },
        { pattern_id: "p2", template: PROBE, level: "info" },
      ];
      usePatternActions().setActiveSeverities([]);
    });

    it("folds every visible pattern into the filter, excluding by default", () => {
      const prefill = usePatternActions().buildPatternsAlertPrefill();

      expect(prefill.source).toBe("patterns");
      expect(prefill.streamName).toBe("test-stream");
      expect(prefill.patternFilter?.mode).toBe("exclude");
      expect(prefill.patternFilter?.visibleCount).toBe(2);
      expect(prefill.patternFilter?.totalCount).toBe(2);
      expect(prefill.sql).toContain("NOT (");
    });

    it("honours the mode the dialog asks for", () => {
      const prefill = usePatternActions().buildPatternsAlertPrefill({ patternMode: "include" });

      expect(prefill.patternFilter?.mode).toBe("include");
      expect(prefill.sql).not.toContain("NOT (");
    });

    it("uses only the patterns the severity filter leaves visible", () => {
      const api = usePatternActions();
      api.setActiveSeverities(["error"]);

      const prefill = api.buildPatternsAlertPrefill();

      expect(prefill.patternFilter?.visibleCount).toBe(1);
      expect(prefill.patternFilter?.totalCount).toBe(2);
      expect(prefill.patternFilter?.filtered).toBe(true);
    });

    it("reports an unfiltered list as such", () => {
      expect(usePatternActions().buildPatternsAlertPrefill().patternFilter?.filtered).toBe(false);
    });

    it("ANDs the current search filter in front of the pattern terms", () => {
      mockSearchObj.data.query = "code = 500";
      expect(usePatternActions().buildPatternsAlertPrefill().sql).toContain("(code = 500)");
    });

    it("says so when a SQL-mode query cannot be spliced in", () => {
      mockSearchObj.meta.sqlMode = true;
      mockSearchObj.data.query = 'SELECT * FROM "test-stream"';

      const prefill = usePatternActions().buildPatternsAlertPrefill();

      expect(prefill.warnings.map((w: any) => w.key)).toContain("sqlModeFilterDropped");
      expect(prefill.sql).not.toContain('SELECT * FROM "test-stream")');
    });

    it("builds a single-pattern prefill for the detail drawer", () => {
      const prefill = usePatternActions().buildSinglePatternAlertPrefill({
        template: ERR,
        pattern_id: "p1",
      });

      expect(prefill.source).toBe("patterns");
      expect(prefill.patternFilter?.mode).toBe("include");
      expect(prefill.meta?.appliedPatterns).toEqual([ERR]);
    });
  });
});
