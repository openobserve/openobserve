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

import { describe, expect, it } from "vitest";
import {
  ANOMALY_FILTER_OPERATORS,
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "./anomalyFilterOperators";

describe("ANOMALY_FILTER_OPERATORS", () => {
  it("should include all expected operator strings", () => {
    expect(ANOMALY_FILTER_OPERATORS).toContain("=");
    expect(ANOMALY_FILTER_OPERATORS).toContain("<>");
    expect(ANOMALY_FILTER_OPERATORS).toContain(">=");
    expect(ANOMALY_FILTER_OPERATORS).toContain("<=");
    expect(ANOMALY_FILTER_OPERATORS).toContain(">");
    expect(ANOMALY_FILTER_OPERATORS).toContain("<");
    expect(ANOMALY_FILTER_OPERATORS).toContain("IN");
    expect(ANOMALY_FILTER_OPERATORS).toContain("NOT IN");
    expect(ANOMALY_FILTER_OPERATORS).toContain("str_match");
    expect(ANOMALY_FILTER_OPERATORS).toContain("str_match_ignore_case");
    expect(ANOMALY_FILTER_OPERATORS).toContain("match_all");
    expect(ANOMALY_FILTER_OPERATORS).toContain("re_match");
    expect(ANOMALY_FILTER_OPERATORS).toContain("re_not_match");
    expect(ANOMALY_FILTER_OPERATORS).toContain("Contains");
    expect(ANOMALY_FILTER_OPERATORS).toContain("Starts With");
    expect(ANOMALY_FILTER_OPERATORS).toContain("Ends With");
    expect(ANOMALY_FILTER_OPERATORS).toContain("Not Contains");
    expect(ANOMALY_FILTER_OPERATORS).toContain("Is Null");
    expect(ANOMALY_FILTER_OPERATORS).toContain("Is Not Null");
  });

  it("should contain exactly 19 operators", () => {
    expect(ANOMALY_FILTER_OPERATORS.length).toBe(19);
  });
});

describe("operatorNeedsValue", () => {
  it("should return false when operator is Is Null", () => {
    expect(operatorNeedsValue("Is Null")).toBe(false);
  });

  it("should return false when operator is Is Not Null", () => {
    expect(operatorNeedsValue("Is Not Null")).toBe(false);
  });

  it("should return true when operator is =", () => {
    expect(operatorNeedsValue("=")).toBe(true);
  });

  it("should return true when operator is <>", () => {
    expect(operatorNeedsValue("<>")).toBe(true);
  });

  it("should return true when operator is >=", () => {
    expect(operatorNeedsValue(">=")).toBe(true);
  });

  it("should return true when operator is <=", () => {
    expect(operatorNeedsValue("<=")).toBe(true);
  });

  it("should return true when operator is >", () => {
    expect(operatorNeedsValue(">")).toBe(true);
  });

  it("should return true when operator is <", () => {
    expect(operatorNeedsValue("<")).toBe(true);
  });

  it("should return true when operator is IN", () => {
    expect(operatorNeedsValue("IN")).toBe(true);
  });

  it("should return true when operator is NOT IN", () => {
    expect(operatorNeedsValue("NOT IN")).toBe(true);
  });

  it("should return true when operator is str_match", () => {
    expect(operatorNeedsValue("str_match")).toBe(true);
  });

  it("should return true when operator is str_match_ignore_case", () => {
    expect(operatorNeedsValue("str_match_ignore_case")).toBe(true);
  });

  it("should return true when operator is match_all", () => {
    expect(operatorNeedsValue("match_all")).toBe(true);
  });

  it("should return true when operator is re_match", () => {
    expect(operatorNeedsValue("re_match")).toBe(true);
  });

  it("should return true when operator is re_not_match", () => {
    expect(operatorNeedsValue("re_not_match")).toBe(true);
  });

  it("should return true when operator is Contains", () => {
    expect(operatorNeedsValue("Contains")).toBe(true);
  });

  it("should return true when operator is Starts With", () => {
    expect(operatorNeedsValue("Starts With")).toBe(true);
  });

  it("should return true when operator is Ends With", () => {
    expect(operatorNeedsValue("Ends With")).toBe(true);
  });

  it("should return true when operator is Not Contains", () => {
    expect(operatorNeedsValue("Not Contains")).toBe(true);
  });

  it("should return true for an unknown operator", () => {
    expect(operatorNeedsValue("UNKNOWN")).toBe(true);
  });
});

describe("buildAnomalyFilterExpression", () => {
  describe("empty field guard", () => {
    it("should return empty string when field is empty", () => {
      expect(buildAnomalyFilterExpression("", "=", "200")).toBe("");
    });

    it("should return empty string when field is empty and operator is Is Null", () => {
      expect(buildAnomalyFilterExpression("", "Is Null", "")).toBe("");
    });
  });

  describe("comparison operators", () => {
    it("should return field = 'value' when operator is =", () => {
      expect(buildAnomalyFilterExpression("status", "=", "200")).toBe(
        "status = '200'",
      );
    });

    it("should return field <> 'value' when operator is <>", () => {
      expect(buildAnomalyFilterExpression("status", "<>", "500")).toBe(
        "status <> '500'",
      );
    });

    it("should return field >= 'value' when operator is >=", () => {
      expect(buildAnomalyFilterExpression("latency", ">=", "100")).toBe(
        "latency >= '100'",
      );
    });

    it("should return field <= 'value' when operator is <=", () => {
      expect(buildAnomalyFilterExpression("latency", "<=", "500")).toBe(
        "latency <= '500'",
      );
    });

    it("should return field > 'value' when operator is >", () => {
      expect(buildAnomalyFilterExpression("bytes", ">", "1024")).toBe(
        "bytes > '1024'",
      );
    });

    it("should return field < 'value' when operator is <", () => {
      expect(buildAnomalyFilterExpression("bytes", "<", "1024")).toBe(
        "bytes < '1024'",
      );
    });
  });

  describe("IN / NOT IN operators", () => {
    it("should return field IN (value) when operator is IN", () => {
      expect(
        buildAnomalyFilterExpression("status", "IN", "200,404,500"),
      ).toBe("status IN (200,404,500)");
    });

    it("should return field NOT IN (value) when operator is NOT IN", () => {
      expect(
        buildAnomalyFilterExpression("status", "NOT IN", "200,404"),
      ).toBe("status NOT IN (200,404)");
    });
  });

  describe("null check operators", () => {
    it("should return field IS NULL when operator is Is Null", () => {
      expect(buildAnomalyFilterExpression("error_msg", "Is Null", "")).toBe(
        "error_msg IS NULL",
      );
    });

    it("should return field IS NOT NULL when operator is Is Not Null", () => {
      expect(
        buildAnomalyFilterExpression("error_msg", "Is Not Null", ""),
      ).toBe("error_msg IS NOT NULL");
    });
  });

  describe("string match operators", () => {
    it("should return str_match(field, 'value') when operator is str_match", () => {
      expect(
        buildAnomalyFilterExpression("message", "str_match", "error"),
      ).toBe("str_match(message, 'error')");
    });

    it("should return str_match(field, 'value') when operator is Contains", () => {
      expect(
        buildAnomalyFilterExpression("message", "Contains", "error"),
      ).toBe("str_match(message, 'error')");
    });

    it("should return str_match_ignore_case(field, 'value') when operator is str_match_ignore_case", () => {
      expect(
        buildAnomalyFilterExpression(
          "message",
          "str_match_ignore_case",
          "ERROR",
        ),
      ).toBe("str_match_ignore_case(message, 'ERROR')");
    });

    it("should return match_all('value') when operator is match_all", () => {
      expect(buildAnomalyFilterExpression("message", "match_all", "error")).toBe(
        "match_all('error')",
      );
    });
  });

  describe("regex operators", () => {
    it("should return re_match(field, 'pattern') when operator is re_match", () => {
      expect(
        buildAnomalyFilterExpression("level", "re_match", "^(error|warn)$"),
      ).toBe("re_match(level, '^(error|warn)$')");
    });

    it("should return re_not_match(field, 'pattern') when operator is re_not_match", () => {
      expect(
        buildAnomalyFilterExpression("level", "re_not_match", "^debug$"),
      ).toBe("re_not_match(level, '^debug$')");
    });
  });

  describe("LIKE operators", () => {
    it("should return field LIKE 'value%' when operator is Starts With", () => {
      expect(
        buildAnomalyFilterExpression("path", "Starts With", "/api"),
      ).toBe("path LIKE '/api%'");
    });

    it("should return field LIKE '%value' when operator is Ends With", () => {
      expect(buildAnomalyFilterExpression("path", "Ends With", ".json")).toBe(
        "path LIKE '%.json'",
      );
    });

    it("should return field NOT LIKE '%value%' when operator is Not Contains", () => {
      expect(
        buildAnomalyFilterExpression("message", "Not Contains", "debug"),
      ).toBe("message NOT LIKE '%debug%'");
    });
  });

  describe("special characters in values", () => {
    it("should embed single quotes in the value as-is for comparison operators", () => {
      expect(buildAnomalyFilterExpression("env", "=", "prod")).toBe(
        "env = 'prod'",
      );
    });

    it("should handle values with spaces for str_match", () => {
      expect(
        buildAnomalyFilterExpression("message", "str_match", "out of memory"),
      ).toBe("str_match(message, 'out of memory')");
    });
  });
});
