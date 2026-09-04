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

import { describe, expect, it, vi, beforeEach } from "vitest";

// lodash-es must be mocked before the composable is imported so the module-level
// `cloneDeep(defaultObject)` executes with the mock in place.
vi.mock("lodash-es", () => ({
  cloneDeep: vi.fn((obj) => JSON.parse(JSON.stringify(obj))),
}));

import useMetrics from "./useMetrics";

// Because searchObj is a module-level ref (singleton), resetSearchObj() is called
// in beforeEach to guarantee a clean baseline for every test.
describe("useMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { resetSearchObj } = useMetrics();
    resetSearchObj();
  });

  describe("return shape", () => {
    it("returns searchObj and resetSearchObj", () => {
      const result = useMetrics();
      expect(result).toHaveProperty("searchObj");
      expect(result).toHaveProperty("resetSearchObj");
      expect(typeof result.resetSearchObj).toBe("function");
    });
  });

  describe("initial searchObj structure", () => {
    it("has organizationIdentifier as empty string", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.organizationIdentifier).toBe("");
    });

    it("has runQuery as false", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.runQuery).toBe(false);
    });

    it("has loading as false", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.loading).toBe(false);
    });

    it("has config object with splitterModel of 20", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.config.splitterModel).toBe(20);
    });

    it("has config.lastSplitterPosition of 0", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.config.lastSplitterPosition).toBe(0);
    });

    it("has config.splitterLimit as [0, 40]", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.config.splitterLimit).toEqual([0, 40]);
    });

    it("has config.refreshTimes as a nested array", () => {
      const { searchObj } = useMetrics();
      expect(Array.isArray(searchObj.config.refreshTimes)).toBe(true);
      expect(searchObj.config.refreshTimes.length).toBeGreaterThan(0);
    });

    it("has meta.refreshInterval of 0", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.meta.refreshInterval).toBe(0);
    });

    it("has meta.refreshIntervalLabel of 'Off'", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.meta.refreshIntervalLabel).toBe("Off");
    });

    it("has meta.totalMetricValues of 1000", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.meta.totalMetricValues).toBe(1000);
    });

    it("has data.errorMsg as empty string", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.data.errorMsg).toBe("");
    });

    it("has data.errorCode of 0", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.data.errorCode).toBe(0);
    });

    it("has data.metrics.metricList as empty array", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.data.metrics.metricList).toEqual([]);
    });

    it("has data.metrics.selectedMetric as null", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.data.metrics.selectedMetric).toBeNull();
    });

    it("has data.datetime.relativeTimePeriod of '15m'", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.data.datetime.relativeTimePeriod).toBe("15m");
    });

    it("has data.datetime.type of 'relative'", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.data.datetime.type).toBe("relative");
    });

    it("has data.query as empty string", () => {
      const { searchObj } = useMetrics();
      expect(searchObj.data.query).toBe("");
    });
  });

  describe("resetSearchObj", () => {
    it("restores organizationIdentifier to empty string after modification", () => {
      const { searchObj, resetSearchObj } = useMetrics();
      searchObj.organizationIdentifier = "my-org";
      resetSearchObj();
      // After reset, a new call must see the default
      const { searchObj: fresh } = useMetrics();
      expect(fresh.organizationIdentifier).toBe("");
    });

    it("restores runQuery to false after setting it to true", () => {
      const { searchObj, resetSearchObj } = useMetrics();
      searchObj.runQuery = true;
      resetSearchObj();
      const { searchObj: fresh } = useMetrics();
      expect(fresh.runQuery).toBe(false);
    });

    it("restores loading to false after setting it to true", () => {
      const { searchObj, resetSearchObj } = useMetrics();
      searchObj.loading = true;
      resetSearchObj();
      const { searchObj: fresh } = useMetrics();
      expect(fresh.loading).toBe(false);
    });

    it("restores config.splitterModel to 20 after modification", () => {
      const { searchObj, resetSearchObj } = useMetrics();
      searchObj.config.splitterModel = 99;
      resetSearchObj();
      const { searchObj: fresh } = useMetrics();
      expect(fresh.config.splitterModel).toBe(20);
    });

    it("restores data.datetime.relativeTimePeriod to '15m'", () => {
      const { searchObj, resetSearchObj } = useMetrics();
      searchObj.data.datetime.relativeTimePeriod = "1h";
      resetSearchObj();
      const { searchObj: fresh } = useMetrics();
      expect(fresh.data.datetime.relativeTimePeriod).toBe("15m");
    });

    it("restores data.query to empty string after modification", () => {
      const { searchObj, resetSearchObj } = useMetrics();
      searchObj.data.query = "SELECT * FROM metrics";
      resetSearchObj();
      const { searchObj: fresh } = useMetrics();
      expect(fresh.data.query).toBe("");
    });
  });
});
