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

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  return {
    ...actual,
    default: {
      preview: vi.fn(() => new Promise(() => undefined)),
      decide: vi.fn(),
      decideBatch: vi.fn(),
      undo: vi.fn(),
      list: vi.fn(() =>
        Promise.resolve({ data: { decisions: [], total: 0, limit: 1, offset: 0 } }),
      ),
    },
  };
});

import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import AlertCalibrationFindingCard from "./AlertCalibrationFindingCard.vue";
import type { FindingRecord } from "./digests";

const noise = {
  _timestamp: 1,
  org: "default",
  config_id: "c1",
  window_start: 0,
  window_end: 1,
  finding_count: 1,
  skip_count: 0,
  alerts_in_scope: 3,
  schema_version: 2,
  kind: "finding",
  rule_id: "noise",
  severity: "Medium",
  confidence: "High",
  title: "ops_cpu fired 40 times",
  alert_id: "a1",
  alert_name: "ops_cpu",
  finding_id: "f1",
  insight_actions: JSON.stringify([
    {
      type: "apply_suggestion",
      alert_id: "a1",
      patch: [{ field: "silence_minutes", from: 10, to: 45 }],
    },
  ]),
} as unknown as FindingRecord;

describe("AlertCalibrationFindingCard with the decision route on", () => {
  it("review_change_opens_the_same_dialog_as_the_dashboard", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { render: () => h("div") } }],
    });
    await router.push("/");
    const wrapper = mount(AlertCalibrationFindingCard, {
      props: { finding: noise },
      attachTo: document.body,
      global: { plugins: [store, router, withQueryClient()] },
    });
    await flushPromises();
    await wrapper
      .get('[data-test="alert-calibration-finding-action-apply_suggestion-button"]')
      .trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="review-change-dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-test="alert-calibration-apply-dialog"]')).toBeNull();
    wrapper.unmount();
  });
});
