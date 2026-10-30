// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  filterDimensionsForCorrelation,
  buildFieldToGroupIdMap,
  quoteSqlIdentifier,
  quoteSqlLiteral,
  buildSqlCondition,
  applyFilterOverlay,
  applyDimensionEditsToFilters,
  mergeSubjectOverrides,
} from "./telemetryCorrelation";
import type { ServiceIdentityConfig, FieldAlias } from "@/services/service_streams";

describe("telemetryCorrelation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("buildFieldToGroupIdMap", () => {
    it("should map each field to its group ID", () => {
      const semanticGroups: FieldAlias[] = [
        {
          id: "deployment.environment",
          display: "Environment",
          fields: ["deployment.environment"],
        },
        { id: "service.name", display: "Service Name", fields: ["service.name", "service_name"] },
      ];

      const result = buildFieldToGroupIdMap(semanticGroups);

      expect(result.size).toBe(3);
      expect(result.get("deployment.environment")).toBe("deployment.environment");
      expect(result.get("service.name")).toBe("service.name");
      expect(result.get("service_name")).toBe("service.name");
    });

    it("should apply definition-order priority when fields overlap across groups", () => {
      const semanticGroups: FieldAlias[] = [
        { id: "group-a", display: "Group A", fields: ["host.name"] },
        { id: "group-b", display: "Group B", fields: ["host.name"] }, // same field in group-b
      ];

      const result = buildFieldToGroupIdMap(semanticGroups);

      // The first group that contains the field wins
      expect(result.get("host.name")).toBe("group-a");
    });

    it("should lowercase field names when using them as map keys", () => {
      const semanticGroups: FieldAlias[] = [
        {
          id: "k8s.cluster.name",
          display: "Cluster",
          fields: ["k8s.cluster.name", "K8S_CLUSTER_NAME"],
        },
      ];

      const result = buildFieldToGroupIdMap(semanticGroups);

      // Lowercase lookups should work regardless of the original field casing
      expect(result.get("k8s.cluster.name")).toBe("k8s.cluster.name");
      expect(result.get("k8s_cluster_name")).toBe("k8s.cluster.name");
      // The function always lowercases fields before setting, so uppercase lookups should miss
      expect(result.get("K8S_CLUSTER_NAME")).toBeUndefined();
    });

    it("should return an empty map for an empty groups array", () => {
      const result = buildFieldToGroupIdMap([]);

      expect(result.size).toBe(0);
    });

    it("should not add entries for groups with empty fields arrays", () => {
      const semanticGroups: FieldAlias[] = [
        { id: "group-a", display: "Group A", fields: [] },
        { id: "group-b", display: "Group B", fields: ["valid.field"] },
      ];

      const result = buildFieldToGroupIdMap(semanticGroups);

      expect(result.size).toBe(1);
      expect(result.get("valid.field")).toBe("group-b");
      // group-a with empty fields should produce no entries
      expect(result.get("group-a")).toBeUndefined();
    });

    it("should map all fields from a single group to the same group ID", () => {
      const semanticGroups: FieldAlias[] = [
        {
          id: "k8s.namespace.name",
          display: "Namespace",
          fields: ["k8s.namespace.name", "namespace", "k8s_namespace_name"],
        },
      ];

      const result = buildFieldToGroupIdMap(semanticGroups);

      expect(result.size).toBe(3);
      expect(result.get("k8s.namespace.name")).toBe("k8s.namespace.name");
      expect(result.get("namespace")).toBe("k8s.namespace.name");
      expect(result.get("k8s_namespace_name")).toBe("k8s.namespace.name");
    });
  });

  describe("filterDimensionsForCorrelation", () => {
    it("should union distinguish_by fields from all identity sets", () => {
      // Test data representing a typical config with AWS, Azure, and Kubernetes sets
      const identityConfig: ServiceIdentityConfig = {
        sets: [
          {
            id: "aws",
            label: "AWS",
            distinguish_by: ["aws-ecs-cluster", "availability-zone", "faas-name"],
          },
          {
            id: "azure",
            label: "Azure",
            distinguish_by: ["azure-resource-group", "azure-function-name"],
          },
          {
            id: "k8s",
            label: "Kubernetes",
            distinguish_by: ["k8s-cluster", "k8s-namespace", "k8s-deployment"],
          },
        ],
        tracked_alias_ids: [],
      };

      const allDimensions = {
        service: "my-service",
        "aws-ecs-cluster": "prod-cluster",
        "availability-zone": "us-west-2a",
        "azure-resource-group": "my-rg",
        "k8s-cluster": "prod-k8s",
        "k8s-namespace": "default",
        "some-other-field": "should-be-filtered-out",
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      // Should include service + all distinguish_by fields from all sets
      expect(result).toEqual({
        service: "my-service",
        "aws-ecs-cluster": "prod-cluster",
        "availability-zone": "us-west-2a",
        "azure-resource-group": "my-rg",
        "k8s-cluster": "prod-k8s",
        "k8s-namespace": "default",
      });

      // Should not include fields not in any distinguish_by
      expect(result).not.toHaveProperty("some-other-field");
      expect(result).not.toHaveProperty("faas-name"); // AWS field not present in input
      expect(result).not.toHaveProperty("azure-function-name"); // Azure field not present in input
      expect(result).not.toHaveProperty("k8s-deployment"); // K8s field not present in input
    });

    it("should handle duplicate fields across identity sets", () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [
          {
            id: "aws",
            label: "AWS",
            distinguish_by: ["region", "service-name"],
          },
          {
            id: "gcp",
            label: "GCP",
            distinguish_by: ["region", "project-id"], // 'region' appears in both
          },
        ],
        tracked_alias_ids: [],
      };

      const allDimensions = {
        service: "my-service",
        region: "us-west-2",
        "service-name": "api-service",
        "project-id": "my-gcp-project",
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual({
        service: "my-service",
        region: "us-west-2",
        "service-name": "api-service",
        "project-id": "my-gcp-project",
      });
    });

    it("should fallback to tracked_alias_ids when no sets available", () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [],
        tracked_alias_ids: ["fallback-field-1", "fallback-field-2"],
      };

      const allDimensions = {
        service: "my-service",
        "fallback-field-1": "value1",
        "fallback-field-2": "value2",
        "other-field": "should-be-filtered",
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual({
        service: "my-service",
        "fallback-field-1": "value1",
        "fallback-field-2": "value2",
      });
    });

    it("should return all dimensions when no config available", () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [],
        tracked_alias_ids: [],
      };

      const allDimensions = {
        service: "my-service",
        field1: "value1",
        field2: "value2",
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual(allDimensions);
    });

    it("should handle empty distinguish_by arrays gracefully", () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [
          {
            id: "aws",
            label: "AWS",
            distinguish_by: [], // Empty array
          },
          {
            id: "k8s",
            label: "Kubernetes",
            distinguish_by: ["k8s-cluster"],
          },
        ],
        tracked_alias_ids: [],
      };

      const allDimensions = {
        service: "my-service",
        "k8s-cluster": "prod-cluster",
        "other-field": "value",
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual({
        service: "my-service",
        "k8s-cluster": "prod-cluster",
      });
    });

    it("should handle undefined distinguish_by gracefully", () => {
      const identityConfig: ServiceIdentityConfig = {
        sets: [
          {
            id: "aws",
            label: "AWS",
            distinguish_by: undefined as any, // Undefined
          },
          {
            id: "k8s",
            label: "Kubernetes",
            distinguish_by: ["k8s-cluster"],
          },
        ],
        tracked_alias_ids: [],
      };

      const allDimensions = {
        service: "my-service",
        "k8s-cluster": "prod-cluster",
        "other-field": "value",
      };

      const result = filterDimensionsForCorrelation(allDimensions, identityConfig);

      expect(result).toEqual({
        service: "my-service",
        "k8s-cluster": "prod-cluster",
      });
    });
  });

  describe("sql escaping helpers", () => {
    it("quotes identifiers and doubles embedded double quotes", () => {
      expect(quoteSqlIdentifier("k8s_pod_name")).toBe('"k8s_pod_name"');
      expect(quoteSqlIdentifier('bad"field')).toBe('"bad""field"');
    });

    it("quotes literals and doubles embedded single quotes", () => {
      expect(quoteSqlLiteral("prod")).toBe("'prod'");
      expect(quoteSqlLiteral("a' OR 1=1 --")).toBe("'a'' OR 1=1 --'");
    });

    it("builds a fully escaped condition", () => {
      expect(buildSqlCondition("svc", "a'b")).toBe("\"svc\" = 'a''b'");
    });

    it("always quotes identifiers, including ones with special characters", () => {
      expect(buildSqlCondition("k8s-pod.name", "web-1")).toBe("\"k8s-pod.name\" = 'web-1'");
    });

    it("coerces non-string inputs before escaping", () => {
      expect(quoteSqlLiteral(42 as unknown as string)).toBe("'42'");
      expect(quoteSqlIdentifier(7 as unknown as string)).toBe('"7"');
    });
  });

  describe("applyFilterOverlay", () => {
    const groups = new Map<string, string>([
      ["k8s_namespace_name", "k8s-namespace"],
      ["service_k8s_namespace_name", "k8s-namespace"],
    ]);

    it("applies exact-key overrides", () => {
      expect(
        applyFilterOverlay({ k8s_namespace_name: "a" }, { k8s_namespace_name: "b" }, groups),
      ).toEqual({ k8s_namespace_name: "b" });
    });

    it("resolves an override to the stream's own alias for the same group (F35)", () => {
      // Chip key came from stream A ("k8s_namespace_name"); stream B uses the other alias.
      expect(
        applyFilterOverlay(
          { service_k8s_namespace_name: "a" },
          { k8s_namespace_name: "b" },
          groups,
        ),
      ).toEqual({ service_k8s_namespace_name: "b" });
    });

    it("ignores overrides with no group and no matching base key", () => {
      expect(applyFilterOverlay({ x: "1" }, { unrelated: "z" }, groups)).toEqual({ x: "1" });
    });

    it("ignores a grouped override when the stream has no field in that group", () => {
      expect(applyFilterOverlay({ x: "1" }, { k8s_namespace_name: "b" }, groups)).toEqual({
        x: "1",
      });
    });

    it("resolves group aliases case-insensitively", () => {
      expect(
        applyFilterOverlay(
          { SERVICE_K8S_NAMESPACE_NAME: "a" },
          { K8S_NAMESPACE_NAME: "b" },
          groups,
        ),
      ).toEqual({ SERVICE_K8S_NAMESPACE_NAME: "b" });
    });

    it("prefers the exact key when the base has both the exact key and a group sibling", () => {
      expect(
        applyFilterOverlay(
          { k8s_namespace_name: "a", service_k8s_namespace_name: "a2" },
          { k8s_namespace_name: "b" },
          groups,
        ),
      ).toEqual({ k8s_namespace_name: "b", service_k8s_namespace_name: "a2" });
    });

    it("returns a copy and does not mutate the base filters", () => {
      const base = { k8s_namespace_name: "a" };
      const result = applyFilterOverlay(base, { k8s_namespace_name: "b" }, groups);
      expect(base).toEqual({ k8s_namespace_name: "a" });
      expect(result).not.toBe(base);
    });

    it("passes base filters through untouched with an empty group map", () => {
      expect(applyFilterOverlay({ a: "1" }, { a: "2", b: "3" }, new Map())).toEqual({ a: "2" });
    });
  });

  describe("applyDimensionEditsToFilters", () => {
    const f2d = new Map<string, string>([
      ["k8s_namespace_name", "k8s-namespace"],
      ["service_k8s_namespace_name", "k8s-namespace"],
    ]);

    it("applies semantic-ID-keyed edits (IncidentDetailDrawer path)", () => {
      expect(
        applyDimensionEditsToFilters({ k8s_namespace_name: "a" }, { "k8s-namespace": "b" }, f2d),
      ).toEqual({ k8s_namespace_name: "b" });
    });

    it("applies raw-field-keyed edits (SearchResult dialog path — F36)", () => {
      expect(
        applyDimensionEditsToFilters({ k8s_namespace_name: "a" }, { k8s_namespace_name: "b" }, f2d),
      ).toEqual({ k8s_namespace_name: "b" });
    });

    it("resolves a raw-field-keyed edit to the stream's own alias for the same group", () => {
      // The dimension bar was seeded from a log stream's field name; the metric
      // stream spells the same concept differently.
      expect(
        applyDimensionEditsToFilters(
          { service_k8s_namespace_name: "a" },
          { k8s_namespace_name: "b" },
          f2d,
        ),
      ).toEqual({ service_k8s_namespace_name: "b" });
    });

    it("prefers the raw-field edit over the semantic-ID edit for the same filter", () => {
      expect(
        applyDimensionEditsToFilters(
          { k8s_namespace_name: "a" },
          { k8s_namespace_name: "raw", "k8s-namespace": "semantic" },
          f2d,
        ),
      ).toEqual({ k8s_namespace_name: "raw" });
    });

    it("leaves filters without an edit untouched", () => {
      expect(applyDimensionEditsToFilters({ x: "1" }, { "k8s-namespace": "b" }, f2d)).toEqual({
        x: "1",
      });
    });

    it("resolves filter keys case-insensitively", () => {
      expect(
        applyDimensionEditsToFilters({ K8S_NAMESPACE_NAME: "a" }, { "k8s-namespace": "b" }, f2d),
      ).toEqual({ K8S_NAMESPACE_NAME: "b" });
    });

    it("keeps an empty-string edit (clearing a value is a real edit)", () => {
      expect(
        applyDimensionEditsToFilters({ k8s_namespace_name: "a" }, { k8s_namespace_name: "" }, f2d),
      ).toEqual({ k8s_namespace_name: "" });
    });

    it("never adds a filter key the stream does not already have", () => {
      expect(
        applyDimensionEditsToFilters({ x: "1" }, { k8s_namespace_name: "b", other: "c" }, f2d),
      ).toEqual({ x: "1" });
    });

    it("returns a copy and does not mutate the input filters", () => {
      const filters = { k8s_namespace_name: "a" };
      const result = applyDimensionEditsToFilters(filters, { "k8s-namespace": "b" }, f2d);
      expect(filters).toEqual({ k8s_namespace_name: "a" });
      expect(result).not.toBe(filters);
    });
  });

  describe("mergeSubjectOverrides", () => {
    const groups = new Map<string, string>([
      ["k8s_namespace_name", "k8s-namespace"],
      ["service_k8s_namespace_name", "k8s-namespace"],
      ["k8s_pod_name", "k8s-pod"],
    ]);

    it("replaces the same-group backend key instead of adding a duplicate (F31)", () => {
      expect(
        mergeSubjectOverrides(
          { service_k8s_namespace_name: "prod" }, // backend-resolved key
          { k8s_namespace_name: "staging" }, // schema-resolved override, different alias
          groups,
        ),
      ).toEqual({ k8s_namespace_name: "staging" }); // ONE condition, not two
    });

    it("overwrites in place when keys match", () => {
      expect(
        mergeSubjectOverrides({ k8s_namespace_name: "a" }, { k8s_namespace_name: "b" }, groups),
      ).toEqual({ k8s_namespace_name: "b" });
    });

    it("adds an override whose group is not present in the filters", () => {
      expect(
        mergeSubjectOverrides({ k8s_pod_name: "p" }, { k8s_namespace_name: "n" }, groups),
      ).toEqual({ k8s_pod_name: "p", k8s_namespace_name: "n" });
    });

    it("leaves filters of other groups untouched while replacing one group", () => {
      expect(
        mergeSubjectOverrides(
          { service_k8s_namespace_name: "prod", k8s_pod_name: "p" },
          { k8s_namespace_name: "staging" },
          groups,
        ),
      ).toEqual({ k8s_pod_name: "p", k8s_namespace_name: "staging" });
    });

    it("matches the existing filter key case-insensitively", () => {
      expect(
        mergeSubjectOverrides(
          { SERVICE_K8S_NAMESPACE_NAME: "prod" },
          { k8s_namespace_name: "staging" },
          groups,
        ),
      ).toEqual({ k8s_namespace_name: "staging" });
    });

    it("adds an ungrouped override without disturbing existing filters", () => {
      expect(mergeSubjectOverrides({ a: "1" }, { unknown_field: "2" }, groups)).toEqual({
        a: "1",
        unknown_field: "2",
      });
    });

    it("returns a copy and does not mutate the input filters", () => {
      const filters = { service_k8s_namespace_name: "prod" };
      const result = mergeSubjectOverrides(filters, { k8s_namespace_name: "staging" }, groups);
      expect(filters).toEqual({ service_k8s_namespace_name: "prod" });
      expect(result).not.toBe(filters);
    });

    it("passes filters through untouched with no overrides", () => {
      expect(mergeSubjectOverrides({ a: "1" }, {}, groups)).toEqual({ a: "1" });
    });
  });
});
