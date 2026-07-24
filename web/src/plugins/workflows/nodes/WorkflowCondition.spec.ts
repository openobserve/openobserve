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

// WorkflowCondition is a THIN WRAPPER over the shared ConditionBuilder (which
// has its own spec). What's tested here is the wrapper's own contract:
//   - the fields it hands down are the fired-alert payload (ALERT_PAYLOAD_FIELDS)
//   - the saved rule is read off workflowObj.currentSelectedNodeData
//   - submit() proxies the builder and normalizes undefined -> null
//   - the workflow-specific guidelines slot is rendered
// The builder is stubbed so its internals (zod/FilterGroup) aren't re-tested.

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => p,
  getUUID: () => "uuid",
}));
vi.mock("@/services/workflows", () => ({ default: {} }));

const builderSubmit = vi.fn();
vi.mock("@/components/flow/forms/ConditionBuilder.vue", () => ({
  default: {
    name: "ConditionBuilder",
    props: ["fields", "initialConditions", "normalizeOperators"],
    methods: {
      submit: (...args: any[]) => builderSubmit(...args),
    },
    template: '<div class="condition-builder-stub"><slot name="guidelines" /></div>',
  },
}));

import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { ALERT_PAYLOAD_FIELDS } from "@/plugins/workflows/alertFields";
import WorkflowCondition from "./WorkflowCondition.vue";

function createWrapper() {
  return mount(WorkflowCondition, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OIcon: { name: "OIcon", props: ["name", "size"], template: "<i />" },
      },
    },
  });
}

describe("WorkflowCondition", () => {
  beforeEach(() => {
    workflowObj.currentSelectedNodeData = null;
    builderSubmit.mockReset();
  });
  afterEach(() => {
    workflowObj.currentSelectedNodeData = null;
    vi.clearAllMocks();
  });

  describe("props passed to the shared ConditionBuilder", () => {
    it("renders the body and the shared builder", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="workflow-condition-body"]').exists()).toBe(true);
      expect(wrapper.findComponent({ name: "ConditionBuilder" }).exists()).toBe(true);
    });

    it("passes the fired-alert payload fields (ALERT_PAYLOAD_FIELDS) as `fields`", () => {
      const wrapper = createWrapper();
      const fields = wrapper.findComponent({ name: "ConditionBuilder" }).props("fields");
      expect(fields).toEqual(ALERT_PAYLOAD_FIELDS);
      // sanity: these are the flattened `meta_*` columns, not stream fields
      expect(fields.map((f: any) => f.value)).toContain("meta_alert_name");
    });

    it("passes null initial-conditions when there is no selected node data", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.findComponent({ name: "ConditionBuilder" }).props("initialConditions"),
      ).toBeNull();
    });

    it("passes null initial-conditions when the node has no saved conditions", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "condition" },
      } as any;
      const wrapper = createWrapper();
      expect(
        wrapper.findComponent({ name: "ConditionBuilder" }).props("initialConditions"),
      ).toBeNull();
    });

    it("passes the saved rule through as initial-conditions", () => {
      const saved = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "meta_alert_name",
            operator: "=",
            value: "High Error Rate",
          },
        ],
      };
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "condition", conditions: saved },
      } as any;
      const wrapper = createWrapper();
      expect(
        wrapper.findComponent({ name: "ConditionBuilder" }).props("initialConditions"),
      ).toEqual(saved);
    });
  });

  describe("guidelines slot", () => {
    it("renders the workflow-specific note inside the builder's guidelines slot", () => {
      const wrapper = createWrapper();
      const note = wrapper.find('[data-test="workflow-condition-note"]');
      expect(note.exists()).toBe(true);
      // the two example snippets the note calls out
      expect(note.text()).toContain('severity != ""');
      expect(note.text()).toContain("severity != null");
      expect(note.findAll("i").length).toBe(3); // one OIcon per bullet
    });
  });

  describe("submit()", () => {
    it("proxies the builder's payload", async () => {
      const payload = { version: 2, conditions: { filterType: "group" } };
      builderSubmit.mockResolvedValue(payload);
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toEqual(payload);
      expect(builderSubmit).toHaveBeenCalledTimes(1);
    });

    it("resolves null when the builder rejects the rule (returns null)", async () => {
      builderSubmit.mockResolvedValue(null);
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toBeNull();
    });

    it("normalizes an undefined builder result to null", async () => {
      builderSubmit.mockResolvedValue(undefined);
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toBeNull();
    });
  });
});
