// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect } from "vitest";
import { validateAlert, ValidationResult } from "./alerts/alertValidation";

describe("Alert Validation", () => {
  const validAlert = {
    name: "Test Alert",
    stream_type: "logs",
    stream_name: "test_stream",
    is_real_time: false,
    query_condition: {
      type: "custom" as const,
      conditions: {
        groupId: "group1",
        label: "test",
        items: [{
          column: "level",
          operator: "=",
          value: "ERROR",
          ignore_case: true,
          id: "1"
        }]
      },
      multi_time_range: null,
      vrl_function: null
    },
    trigger_condition: {
      period: 10,
      operator: ">=",
      frequency: 5,
      cron: "",
      threshold: 1,
      silence: 30,
      frequency_type: "minutes" as const,
      timezone: "UTC"
    },
    destinations: ["webhook1"],
    context_attributes: [],
    enabled: true,
    org_id: "org123"
  };

  const validContext = {
    streamList: ["test_stream", "other_stream"],
    destinationsList: ["webhook1", "email1"],
    selectedOrgId: "org123"
  };

  describe("Valid alert validation", () => {
    it("should pass validation for a completely valid alert", () => {
      const result = validateAlert(validAlert, validContext);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation without context", () => {
      // When no context is provided, we need to remove org_id to avoid validation error
      const alertWithoutOrgId = { ...validAlert };
      delete (alertWithoutOrgId as any).org_id;
      
      const result = validateAlert(alertWithoutOrgId);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Name validation", () => {
    it("should fail if name is empty", () => {
      const alert = { ...validAlert, name: "" };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Name is mandatory and should be a valid string");
    });

    it("should fail if name is null", () => {
      const alert = { ...validAlert, name: null as any };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Name is mandatory and should be a valid string");
    });

    it("should fail if name is undefined", () => {
      const alert = { ...validAlert };
      delete (alert as any).name;
      const result = validateAlert(alert as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Name is mandatory and should be a valid string");
    });

    it("should fail if name is whitespace only", () => {
      const alert = { ...validAlert, name: "   " };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Name is mandatory and should be a valid string");
    });
  });

  describe("Organization ID validation", () => {
    it("should pass if org_id matches context", () => {
      const alert = { ...validAlert, org_id: "org123" };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if org_id doesn't match context", () => {
      const alert = { ...validAlert, org_id: "wrong_org" };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Organization Id should be equal to org123");
    });

    it("should pass if org_id is not provided", () => {
      const alert = { ...validAlert };
      delete (alert as any).org_id;
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });
  });

  describe("Stream type validation", () => {
    it("should pass for valid stream types", () => {
      const streamTypes = ["logs", "metrics", "traces"];
      streamTypes.forEach(streamType => {
        const alert = { ...validAlert, stream_type: streamType };
        const result = validateAlert(alert, validContext);
        expect(result.isValid).toBe(true);
      });
    });

    it("should fail for invalid stream types", () => {
      const alert = { ...validAlert, stream_type: "invalid" };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Stream Type is mandatory and should be one of: logs, metrics, traces");
    });

    it("should fail if stream_type is empty", () => {
      const alert = { ...validAlert, stream_type: "" };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Stream Type is mandatory and should be one of: logs, metrics, traces");
    });
  });

  describe("Stream name validation", () => {
    it("should pass if stream exists in context", () => {
      const alert = { ...validAlert, stream_name: "test_stream" };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if stream doesn't exist in context", () => {
      const alert = { ...validAlert, stream_name: "nonexistent_stream" };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Stream "nonexistent_stream" does not exist in the stream list');
    });

    it("should fail if stream_name is empty", () => {
      const alert = { ...validAlert, stream_name: "" };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Stream Name is mandatory and should be a valid string");
    });

    it("should pass if no context provided", () => {
      const alert = { ...validAlert, stream_name: "any_stream" };
      delete (alert as any).org_id; // Remove org_id to avoid context validation error
      
      const result = validateAlert(alert);
      expect(result.isValid).toBe(true);
    });
  });

  describe("Real-time flag validation", () => {
    it("should pass for boolean values", () => {
      const alert1 = { ...validAlert, is_real_time: true };
      const alert2 = { ...validAlert, is_real_time: false };
      
      expect(validateAlert(alert1, validContext).isValid).toBe(true);
      expect(validateAlert(alert2, validContext).isValid).toBe(true);
    });

    it("should convert string 'true' to boolean", () => {
      const alert = { ...validAlert, is_real_time: "true" as any };
      const result = validateAlert(alert, validContext);
      expect(alert.is_real_time).toBe(true);
      expect(result.isValid).toBe(true);
    });

    it("should convert string 'false' to boolean", () => {
      const alert = { ...validAlert, is_real_time: "false" as any };
      const result = validateAlert(alert, validContext);
      expect(alert.is_real_time).toBe(false);
      expect(result.isValid).toBe(true);
    });

    it("should convert invalid string values to boolean", () => {
      const alert = { ...validAlert, is_real_time: "maybe" as any };
      const result = validateAlert(alert, validContext);
      
      // The function converts any string to boolean:
      // - "true" becomes true
      // - any other string becomes false
      // Then it validates that the result is a boolean, which it is
      expect(alert.is_real_time).toBe(false); // "maybe" converted to false
      expect(result.isValid).toBe(true); // Should pass because false is a valid boolean
    });

    it("should fail for non-string/non-boolean values", () => {
      const alert = { ...validAlert, is_real_time: 123 as any };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Is Real-Time is mandatory and should be a boolean value");
    });
  });

  describe("Query condition validation - Custom type", () => {
    it("should validate custom query with items format", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "custom" as const,
          conditions: {
            groupId: "group1",
            label: "test",
            items: [{
              column: "level",
              operator: "=",
              value: "ERROR",
              ignore_case: true,
              id: "1"
            }]
          },
          multi_time_range: null
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should validate custom query with or format", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "custom" as const,
          conditions: {
            or: [{
              column: "level",
              operator: "=",
              value: "ERROR",
              ignore_case: true
            }]
          },
          multi_time_range: null
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should validate custom query with and format", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "custom" as const,
          conditions: {
            and: [{
              column: "level",
              operator: ">=",
              value: "100",
              ignore_case: false
            }]
          },
          multi_time_range: null
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if items array contains invalid items", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "custom" as const,
          conditions: {
            items: [
              { column: "", operator: "=", value: "ERROR", ignore_case: true, id: "1" },
              { column: "level", operator: "", value: "ERROR", ignore_case: true, id: "2" },
              { column: "level", operator: "=", value: undefined, ignore_case: true, id: "3" }
            ]
          },
          multi_time_range: null
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query condition item 1 must have column, operator, and value");
      expect(result.errors).toContain("Query condition item 2 must have column, operator, and value");
      expect(result.errors).toContain("Query condition item 3 must have column, operator, and value");
    });

    it("should fail for invalid operators in items", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "custom" as const,
          conditions: {
            items: [{
              column: "level",
              operator: "INVALID",
              value: "ERROR",
              ignore_case: true,
              id: "1"
            }]
          },
          multi_time_range: null
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid operator "INVALID" in query condition item 1');
    });

    it("should validate all valid operators", () => {
      const validOperators = ['=', '>', '<', '>=', '<=', 'Contains', 'NotContains'];
      
      validOperators.forEach(operator => {
        const alert = {
          ...validAlert,
          query_condition: {
            type: "custom" as const,
            conditions: {
              items: [{
                column: "level",
                operator: operator,
                value: "ERROR",
                ignore_case: true,
                id: "1"
              }]
            },
            multi_time_range: null
          }
        };
        const result = validateAlert(alert, validContext);
        expect(result.isValid).toBe(true);
      });
    });

    it("should fail if multi_time_range is not null or empty array", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "custom" as const,
          conditions: {
            items: [{
              column: "level",
              operator: "=",
              value: "ERROR",
              ignore_case: true,
              id: "1"
            }]
          },
          multi_time_range: ["invalid"]
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Multi Time Range should be an empty array or null");
    });

    it("should fail for invalid conditions format", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "custom" as const,
          conditions: {
            // No items, or, or and arrays
            groupId: "test"
          },
          multi_time_range: null
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Invalid conditions format. Must use either items array or or/and array");
    });
  });

  describe("Query condition validation - SQL type", () => {
    it("should pass for valid SQL query", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "sql" as const,
          sql: "SELECT level, message FROM logs WHERE level = 'ERROR'"
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail for SELECT * queries", () => {
      const queries = [
        "SELECT * FROM logs",
        "select * from logs",
        "SELECT\n* FROM logs",
        "SELECT\t* FROM logs"
      ];
      
      queries.forEach(sql => {
        const alert = {
          ...validAlert,
          query_condition: {
            type: "sql" as const,
            sql: sql
          }
        };
        const result = validateAlert(alert, validContext);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Selecting all columns is not allowed. Please specify the columns explicitly");
      });
    });

    it("should fail for non-SELECT queries", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "sql" as const,
          sql: "INSERT INTO logs VALUES (1, 'test')"
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("SQL query must start with SELECT");
    });

    it("should fail for empty SQL", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "sql" as const,
          sql: ""
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("SQL query is required");
    });
  });

  describe("Query condition validation - PromQL type", () => {
    it("should pass for valid PromQL query", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "promql" as const,
          promql: "rate(http_requests_total[5m])"
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail for empty PromQL", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          type: "promql" as const,
          promql: ""
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("PromQL query is required");
    });
  });

  describe("Query condition validation - VRL function", () => {
    it("should pass for valid VRL function", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          ...validAlert.query_condition,
          vrl_function: ". | select(.level == \"ERROR\")"
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if VRL function is not a string", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          ...validAlert.query_condition,
          vrl_function: 123 as any
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("VRL function should be a string when provided");
    });
  });

  describe("Query condition validation - Aggregation", () => {
    it("should pass for valid aggregation", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          ...validAlert.query_condition,
          aggregation: {
            group_by: ["level", "service"],
            function: "count(*)",
            having: {
              column: "count",
              operator: ">=",
              value: 10
            }
          }
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if group_by is not an array", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          ...validAlert.query_condition,
          aggregation: {
            group_by: "level" as any,
            function: "count(*)",
            having: {
              column: "count",
              operator: ">=",
              value: 10
            }
          }
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Aggregation group_by should be an array");
    });

    it("should fail if function is empty", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          ...validAlert.query_condition,
          aggregation: {
            group_by: ["level"],
            function: "",
            having: {
              column: "count",
              operator: ">=",
              value: 10
            }
          }
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Aggregation function is required and should be a non-empty string");
    });

    it("should fail for invalid having operator", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          ...validAlert.query_condition,
          aggregation: {
            group_by: ["level"],
            function: "count(*)",
            having: {
              column: "count",
              operator: "INVALID",
              value: 10
            }
          }
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Aggregation having clause operator must be a valid comparison operator");
    });

    it("should fail if having value is not a number", () => {
      const alert = {
        ...validAlert,
        query_condition: {
          ...validAlert.query_condition,
          aggregation: {
            group_by: ["level"],
            function: "count(*)",
            having: {
              column: "count",
              operator: ">=",
              value: "not_a_number" as any
            }
          }
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Aggregation having clause value must be a number when provided");
    });
  });

  describe("Trigger condition validation", () => {
    it("should pass for valid trigger condition with minutes frequency", () => {
      const alert = {
        ...validAlert,
        trigger_condition: {
          period: 10,
          operator: ">=",
          frequency: 5,
          cron: "",
          threshold: 1,
          silence: 30,
          frequency_type: "minutes" as const,
          timezone: "UTC"
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should pass for valid trigger condition with cron frequency", () => {
      const alert = {
        ...validAlert,
        trigger_condition: {
          period: 10,
          operator: ">=",
          frequency: 5,
          cron: "0 */5 * * *",
          threshold: 1,
          silence: 30,
          frequency_type: "cron" as const,
          timezone: "America/New_York"
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if trigger_condition is missing", () => {
      const alert = { ...validAlert };
      delete (alert as any).trigger_condition;
      const result = validateAlert(alert as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Trigger condition is required");
    });

    it("should fail for invalid period values", () => {
      const invalidPeriods = [0, -1, "5" as any];
      
      invalidPeriods.forEach(period => {
        const alert = {
          ...validAlert,
          trigger_condition: {
            ...validAlert.trigger_condition,
            period: period
          }
        };
        const result = validateAlert(alert, validContext);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Period should be a positive number greater than 0");
      });
    });

    it("should fail for invalid operators", () => {
      const alert = {
        ...validAlert,
        trigger_condition: {
          ...validAlert.trigger_condition,
          operator: "INVALID"
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid operator "INVALID" in trigger condition');
    });

    it("should validate all valid trigger operators", () => {
      const validOperators = ['=', '!=', '>=', '<=', '>', '<', 'Contains', 'NotContains'];
      
      validOperators.forEach(operator => {
        const alert = {
          ...validAlert,
          trigger_condition: {
            ...validAlert.trigger_condition,
            operator: operator
          }
        };
        const result = validateAlert(alert, validContext);
        expect(result.isValid).toBe(true);
      });
    });

    it("should fail for cron frequency without cron expression", () => {
      const alert = {
        ...validAlert,
        trigger_condition: {
          ...validAlert.trigger_condition,
          frequency_type: "cron" as const,
          cron: ""
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Cron expression is required when frequency type is cron");
    });

    it("should fail for cron frequency without timezone", () => {
      const alert = {
        ...validAlert,
        trigger_condition: {
          ...validAlert.trigger_condition,
          frequency_type: "cron" as const,
          cron: "0 */5 * * *",
          timezone: ""
        }
      };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Timezone is required when frequency type is cron");
    });
  });

  describe("Destinations validation", () => {
    it("should pass for valid destinations", () => {
      const alert = { ...validAlert, destinations: ["webhook1", "email1"] };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if destinations is not an array", () => {
      const alert = { ...validAlert, destinations: "webhook1" as any };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Destinations must be an array");
    });

    it("should fail if destinations array is empty", () => {
      const alert = { ...validAlert, destinations: [] };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("At least one destination is required");
    });

    it("should fail for invalid destinations", () => {
      const alert = { ...validAlert, destinations: ["invalid1", "webhook1", "invalid2"] };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid destinations: "invalid1", "invalid2" - must be from available destinations list');
    });

    it("should fail if context destinations list is empty", () => {
      const emptyContext = { ...validContext, destinationsList: [] };
      const alert = { ...validAlert, destinations: ["webhook1"] };
      const result = validateAlert(alert, emptyContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("No available destinations found in system");
    });
  });

  describe("Enabled flag validation", () => {
    it("should pass for boolean enabled values", () => {
      const alert1 = { ...validAlert, enabled: true };
      const alert2 = { ...validAlert, enabled: false };
      
      expect(validateAlert(alert1, validContext).isValid).toBe(true);
      expect(validateAlert(alert2, validContext).isValid).toBe(true);
    });

    it("should fail for non-boolean enabled values", () => {
      const alert = { ...validAlert, enabled: "true" as any };
      const result = validateAlert(alert, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Enabled flag must be a boolean");
    });
  });

  describe("Complex validation scenarios", () => {
    it("should accumulate multiple errors", () => {
      const invalidAlert = {
        name: "",
        stream_type: "invalid",
        stream_name: "",
        is_real_time: "maybe" as any,
        query_condition: {
          type: "invalid" as any
        },
        destinations: [],
        context_attributes: [],
        enabled: "yes" as any
      };
      
      const result = validateAlert(invalidAlert as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(5);
    });

    it("should handle missing required fields gracefully", () => {
      const incompleteAlert = {
        name: "Test Alert"
      };
      
      const result = validateAlert(incompleteAlert as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Stream Type is mandatory and should be one of: logs, metrics, traces");
      expect(result.errors).toContain("Stream Name is mandatory and should be a valid string");
      expect(result.errors).toContain("Is Real-Time is mandatory and should be a boolean value");
      expect(result.errors).toContain("Trigger condition is required");
    });
  });
});