// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  CompositeAlertChild,
  CompositeAlertCondition,
  CompositeAlertDetail,
  CompositeAlertDraft,
  CompositeAlertListItem,
  CompositeAlertReferenceResponse,
  CompositeAlertValidationRequest,
  CompositeAlertValidationResponse,
  StaleChildPolicy,
} from "./alert";

describe("composite alert DTO contracts", () => {
  it("models the API condition and draft without query-only fields", () => {
    const condition: CompositeAlertCondition = {
      expression: "{id-a} && {id-b}",
      warning_counts_as_firing: true,
      stale_child_policy: "use_last_state",
    };
    const draft: CompositeAlertDraft = {
      alert_type: "composite",
      name: "Checkout degraded",
      description: "Page when errors and latency coincide",
      enabled: true,
      destinations: ["pager"],
      template: "composite_page",
      context_attributes: { service: "checkout" },
      trigger_condition: { silence: 15 },
      creates_incident: true,
      workflows: [],
      priority: 1,
      tags: ["service:checkout"],
      composite_condition: condition,
    };

    expect(draft.alert_type).toBe("composite");
    expect(draft).not.toHaveProperty("query_condition");
    expect(draft).not.toHaveProperty("stream_name");
    expectTypeOf(condition.stale_child_policy).toEqualTypeOf<StaleChildPolicy>();
  });

  it("models detail diagnostics, masking, list counts, references, and validation", () => {
    const readable: CompositeAlertChild = {
      alert_id: "id-a",
      accessible: true,
      name: "High error rate",
      alert_type: "scheduled",
      folder_id: "default",
      enabled: true,
      level: "critical",
      last_outcome: "firing",
      level_at: 1_786_500_000_000_000,
      effective_cadence_seconds: 60,
      stale_deadline: 1_786_500_180_000_000,
      stale: false,
      truth: true,
    };
    const hidden: CompositeAlertChild = { alert_id: "secret-id", accessible: false };
    const detail: CompositeAlertDetail = {
      id: "composite-1",
      alert_type: "composite",
      name: "Checkout degraded",
      enabled: true,
      scheduler_job_present: true,
      trigger_condition: { silence: 15 },
      composite_condition: {
        expression: "({id-a} && {secret-id})",
        warning_counts_as_firing: true,
        stale_child_policy: "use_last_state",
      },
      children: [readable, hidden],
      evaluation: {
        result: true,
        level: "critical",
        evaluated_at: 1_786_500_015_000_000,
      },
    };
    const listItem: CompositeAlertListItem = {
      alert_id: detail.id,
      alert_type: "composite",
      name: detail.name,
      enabled: detail.enabled,
      condition: null,
      child_count: 2,
      referenced_by_composite_count: 1,
      expression_summary: "High error rate AND inaccessible child",
    };
    const references: CompositeAlertReferenceResponse = {
      references: [{ alert_id: "parent-1", name: "Parent", folder_id: "default" }],
      hidden_reference_count: 2,
    };
    const request: CompositeAlertValidationRequest = {
      composite_condition: detail.composite_condition,
      composite_id: detail.id,
      folder_id: "default",
    };
    const response: CompositeAlertValidationResponse = {
      valid: true,
      canonical_expression: detail.composite_condition.expression,
      children: detail.children,
      warnings: [],
      errors: [],
      result: true,
      result_level: "critical",
    };

    expect(hidden).toEqual({ alert_id: "secret-id", accessible: false });
    expect(listItem.child_count).toBe(2);
    expect(references.hidden_reference_count).toBe(2);
    expect(request.composite_id).toBe(detail.id);
    expect(response.result_level).toBe("critical");
  });
});
