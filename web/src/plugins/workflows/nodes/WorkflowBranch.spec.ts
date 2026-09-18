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

// WorkflowBranch is the Branch node's config body: a top-down, first-match-wins
// list of cases (each a labelled ConditionBuilder) plus a permanent trailing
// "Everything else" row. What's tested here is the wrapper's own contract:
//   - one ConditionBuilder per case, fed the CURRENT trigger's payload fields
//   - the saved cases are read off workflowObj.currentSelectedNodeData
//   - add / remove / reorder keep handles STABLE (never re-indexed on delete)
//   - submit() emits { cases, else_handle } exactly as BranchParams expects
//   - setNodeIncomplete mirrors "no case has a complete condition"
// The builder is stubbed so its internals (zod/FilterGroup) aren't re-tested.

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => p,
  getUUID: () => "uuid",
}));
vi.mock("@/services/workflows", () => ({ default: {} }));

// Each mounted builder instance gets its own submit result, keyed by the order in
// which it mounted — that is what lets a test give case-0 and case-1 different rules.
const builderSubmits: Array<(...args: any[]) => any> = [];
let builderMountOrder = 0;
vi.mock("@/components/flow/forms/ConditionBuilder.vue", () => ({
  default: {
    name: "ConditionBuilder",
    props: {
      fields: { default: () => [] },
      initialConditions: { default: null },
      normalizeOperators: { type: Boolean, default: false },
      normalizeColumnNames: { type: Boolean, default: false },
      optional: { type: Boolean, default: false },
    },
    data() {
      return { slot: builderMountOrder++ };
    },
    methods: {
      submit(this: any) {
        const fn = builderSubmits[this.slot];
        return fn ? fn() : null;
      },
    },
    template: '<div class="condition-builder-stub"><slot name="guidelines" /></div>',
  },
}));

import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { ALERT_PAYLOAD_FIELDS } from "@/plugins/workflows/alertFields";
import { INCIDENT_PAYLOAD_FIELDS } from "@/plugins/workflows/incidentFields";
import WorkflowBranch from "./WorkflowBranch.vue";

const seedTrigger = (kind = "alert_fired") => {
  workflowObj.currentSelectedWorkflow.nodes = [
    { id: "t1", data: { node_type: "workflow_trigger", trigger_kind: kind } },
  ];
};

// A complete v2 rule, the shape ConditionBuilder hands back in `optional` mode.
const rule = (column: string, value: string) => ({
  filterType: "group",
  logicalOperator: "AND",
  conditions: [{ filterType: "condition", column, operator: "=", value }],
});

// Queue one builder result per case row, in row order.
const queueBuilders = (...results: any[]) => {
  builderSubmits.length = 0;
  results.forEach((r, i) => {
    builderSubmits[i] = () => r;
  });
};

function createWrapper() {
  builderMountOrder = 0;
  return mount(WorkflowBranch, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OIcon: { name: "OIcon", props: ["name", "size"], template: '<i :data-name="name" />' },
      },
    },
  });
}

const caseRows = (w: any) => w.findAll('[data-test^="workflow-branch-case-"]');
// OInput forwards the consumer's data-test to its WRAPPER and stamps `-field` on
// the real <input>, so value writes must target the -field node.
const labelInputs = (w: any) =>
  w.findAll('[data-test^="workflow-branch-label-"][data-test$="-field"]');
const builders = (w: any) => w.findAllComponents({ name: "ConditionBuilder" });

describe("WorkflowBranch", () => {
  beforeEach(() => {
    workflowObj.currentSelectedNodeData = null;
    seedTrigger();
    builderSubmits.length = 0;
    builderMountOrder = 0;
  });
  afterEach(() => {
    workflowObj.currentSelectedNodeData = null;
    workflowObj.currentSelectedWorkflow.nodes = [];
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("renders the body and starts a fresh node with ONE empty case", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="workflow-branch-body"]').exists()).toBe(true);
      // A case-less Branch is rejected by the backend validator, so the panel can
      // never open on zero cases.
      expect(caseRows(wrapper)).toHaveLength(1);
      expect(builders(wrapper)).toHaveLength(1);
    });

    it("renders the permanent, non-deletable 'Everything else' row", () => {
      const wrapper = createWrapper();
      const elseRow = wrapper.find('[data-test="workflow-branch-else"]');
      expect(elseRow.exists()).toBe(true);
      // The else row is not a case: it carries no ConditionBuilder and no remove control.
      expect(elseRow.findComponent({ name: "ConditionBuilder" }).exists()).toBe(false);
      expect(wrapper.find('[data-test="workflow-branch-else-remove"]').exists()).toBe(false);
    });

    it("hydrates one case row per saved case", () => {
      workflowObj.currentSelectedNodeData = {
        id: "b1",
        data: {
          node_type: "branch",
          cases: [
            {
              handle: "case-0",
              label: "sev high",
              conditions: { version: 2, conditions: rule("meta_alert_name", "a") },
            },
            {
              handle: "case-1",
              conditions: { version: 2, conditions: rule("meta_alert_name", "b") },
            },
          ],
          else_handle: "else",
        },
      } as any;
      const wrapper = createWrapper();
      expect(caseRows(wrapper)).toHaveLength(2);
      expect(builders(wrapper)).toHaveLength(2);
    });
  });

  describe("props passed to each case's ConditionBuilder", () => {
    it("passes the fired-alert payload fields for an alert trigger", () => {
      seedTrigger("alert_fired");
      const wrapper = createWrapper();
      expect(builders(wrapper)[0].props("fields")).toEqual(ALERT_PAYLOAD_FIELDS);
    });

    it("passes the incident payload fields for an incident trigger", () => {
      seedTrigger("incident_event");
      const wrapper = createWrapper();
      expect(builders(wrapper)[0].props("fields")).toEqual(INCIDENT_PAYLOAD_FIELDS);
    });

    it("passes no fields when the workflow has no trigger", () => {
      workflowObj.currentSelectedWorkflow.nodes = [];
      const wrapper = createWrapper();
      expect(builders(wrapper)[0].props("fields")).toEqual([]);
    });

    it("opts into custom-column normalization and the optional (non-blocking) mode", () => {
      const wrapper = createWrapper();
      expect(builders(wrapper)[0].props("normalizeColumnNames")).toBe(true);
      expect(builders(wrapper)[0].props("optional")).toBe(true);
    });

    it("feeds each case its OWN saved rule as initial-conditions", () => {
      const a = rule("meta_alert_name", "a");
      const b = rule("meta_alert_name", "b");
      workflowObj.currentSelectedNodeData = {
        id: "b1",
        data: {
          node_type: "branch",
          cases: [
            { handle: "case-0", conditions: { version: 2, conditions: a } },
            { handle: "case-1", conditions: { version: 2, conditions: b } },
          ],
        },
      } as any;
      const wrapper = createWrapper();
      expect(builders(wrapper)[0].props("initialConditions")).toEqual(a);
      expect(builders(wrapper)[1].props("initialConditions")).toEqual(b);
    });

    it("passes null initial-conditions for a brand-new case", () => {
      const wrapper = createWrapper();
      expect(builders(wrapper)[0].props("initialConditions")).toBeNull();
    });
  });

  describe("add / remove cases", () => {
    it("appends a new case with the NEXT free handle", async () => {
      const wrapper = createWrapper();
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();
      expect(caseRows(wrapper)).toHaveLength(2);
      queueBuilders(
        { version: 2, conditions: rule("meta_alert_name", "a"), complete: true },
        { version: 2, conditions: rule("meta_alert_name", "b"), complete: true },
      );
      const payload = await (wrapper.vm as any).submit();
      expect(payload.cases.map((c: any) => c.handle)).toEqual(["case-0", "case-1"]);
    });

    it("removes a case", async () => {
      const wrapper = createWrapper();
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();
      expect(caseRows(wrapper)).toHaveLength(2);
      await wrapper.findAll('[data-test^="workflow-branch-remove-case-"]')[0].trigger("click");
      await nextTick();
      expect(caseRows(wrapper)).toHaveLength(1);
    });

    // STABLE handles: re-indexing on delete would silently re-point every edge that
    // already references `case-1` at a different arm.
    it("keeps the surviving case's handle STABLE after a delete (never re-indexed)", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "b1",
        data: {
          node_type: "branch",
          cases: [
            {
              handle: "case-0",
              conditions: { version: 2, conditions: rule("meta_alert_name", "a") },
            },
            {
              handle: "case-1",
              conditions: { version: 2, conditions: rule("meta_alert_name", "b") },
            },
          ],
        },
      } as any;
      const wrapper = createWrapper();
      await wrapper.findAll('[data-test^="workflow-branch-remove-case-"]')[0].trigger("click");
      await nextTick();

      queueBuilders({ version: 2, conditions: rule("meta_alert_name", "b"), complete: true });
      const payload = await (wrapper.vm as any).submit();
      // The surviving row keeps `case-1` — it is NOT renumbered down to `case-0`.
      expect(payload.cases.map((c: any) => c.handle)).toEqual(["case-1"]);
    });

    it("never reuses a deleted handle for a newly added case", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "b1",
        data: {
          node_type: "branch",
          cases: [
            {
              handle: "case-0",
              conditions: { version: 2, conditions: rule("meta_alert_name", "a") },
            },
            {
              handle: "case-1",
              conditions: { version: 2, conditions: rule("meta_alert_name", "b") },
            },
          ],
        },
      } as any;
      const wrapper = createWrapper();
      await wrapper.findAll('[data-test^="workflow-branch-remove-case-"]')[1].trigger("click");
      await nextTick();
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();

      queueBuilders(
        { version: 2, conditions: rule("meta_alert_name", "a"), complete: true },
        { version: 2, conditions: rule("meta_alert_name", "c"), complete: true },
      );
      const payload = await (wrapper.vm as any).submit();
      const handles = payload.cases.map((c: any) => c.handle);
      expect(handles).toEqual(["case-0", "case-2"]);
      expect(new Set(handles).size).toBe(handles.length);
    });

    it("does not offer a remove control when only ONE case is left", async () => {
      const wrapper = createWrapper();
      expect(wrapper.findAll('[data-test^="workflow-branch-remove-case-"]')).toHaveLength(0);
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();
      expect(wrapper.findAll('[data-test^="workflow-branch-remove-case-"]')).toHaveLength(2);
    });
  });

  describe("reordering (first match wins, so order is semantic)", () => {
    it("moves a case up, changing evaluation order without changing its handle", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "b1",
        data: {
          node_type: "branch",
          cases: [
            {
              handle: "case-0",
              conditions: { version: 2, conditions: rule("meta_alert_name", "a") },
            },
            {
              handle: "case-1",
              conditions: { version: 2, conditions: rule("meta_alert_name", "b") },
            },
          ],
        },
      } as any;
      const wrapper = createWrapper();
      await wrapper.findAll('[data-test^="workflow-branch-move-up-"]')[1].trigger("click");
      await nextTick();

      queueBuilders(
        { version: 2, conditions: rule("meta_alert_name", "b"), complete: true },
        { version: 2, conditions: rule("meta_alert_name", "a"), complete: true },
      );
      const payload = await (wrapper.vm as any).submit();
      // Handles ride with the row: case-1 is now evaluated FIRST.
      expect(payload.cases.map((c: any) => c.handle)).toEqual(["case-1", "case-0"]);
    });

    it("moves a case down", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "b1",
        data: {
          node_type: "branch",
          cases: [
            {
              handle: "case-0",
              conditions: { version: 2, conditions: rule("meta_alert_name", "a") },
            },
            {
              handle: "case-1",
              conditions: { version: 2, conditions: rule("meta_alert_name", "b") },
            },
          ],
        },
      } as any;
      const wrapper = createWrapper();
      await wrapper.findAll('[data-test^="workflow-branch-move-down-"]')[0].trigger("click");
      await nextTick();

      queueBuilders(
        { version: 2, conditions: rule("meta_alert_name", "b"), complete: true },
        { version: 2, conditions: rule("meta_alert_name", "a"), complete: true },
      );
      const payload = await (wrapper.vm as any).submit();
      expect(payload.cases.map((c: any) => c.handle)).toEqual(["case-1", "case-0"]);
    });

    it("disables move-up on the first row and move-down on the last", async () => {
      const wrapper = createWrapper();
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();
      const ups = wrapper.findAll('[data-test^="workflow-branch-move-up-"]');
      const downs = wrapper.findAll('[data-test^="workflow-branch-move-down-"]');
      expect(ups[0].attributes("disabled")).toBeDefined();
      expect(downs[downs.length - 1].attributes("disabled")).toBeDefined();
      expect(ups[1].attributes("disabled")).toBeUndefined();
      expect(downs[0].attributes("disabled")).toBeUndefined();
    });
  });

  describe("submit() — the BranchParams contract", () => {
    // The end-to-end round trip: two labelled cases + the else, producing exactly
    // what the Rust validator accepts (>=1 case, unique handles, else distinct).
    it("emits { cases, else_handle } the Rust BranchParams validator would accept", async () => {
      const wrapper = createWrapper();
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();

      const labels = labelInputs(wrapper);
      await labels[0].setValue("High severity");
      await labels[1].setValue("Everything warning");

      const ruleA = rule("meta_alert_name", "High Error Rate");
      const ruleB = rule("meta_alert_name", "Warning Rate");
      queueBuilders(
        { version: 2, conditions: ruleA, complete: true },
        { version: 2, conditions: ruleB, complete: true },
      );

      const payload = await (wrapper.vm as any).submit();

      expect(payload).toEqual({
        cases: [
          {
            handle: "case-0",
            label: "High severity",
            conditions: { version: 2, conditions: ruleA },
          },
          {
            handle: "case-1",
            label: "Everything warning",
            conditions: { version: 2, conditions: ruleB },
          },
        ],
        else_handle: "else",
      });

      // Restate the backend rules explicitly so a regression names the rule it broke.
      expect(payload.cases.length).toBeGreaterThanOrEqual(1);
      const handles = payload.cases.map((c: any) => c.handle);
      expect(new Set(handles).size).toBe(handles.length);
      expect(handles).not.toContain(payload.else_handle);
      // `complete` is a builder-only flag and must never reach persisted node data.
      payload.cases.forEach((c: any) => expect(c.conditions.complete).toBeUndefined());
    });

    it("omits `label` entirely when it is blank (serde skips None)", async () => {
      const wrapper = createWrapper();
      queueBuilders({ version: 2, conditions: rule("meta_alert_name", "a"), complete: true });
      const payload = await (wrapper.vm as any).submit();
      expect(payload.cases[0]).not.toHaveProperty("label");
    });

    it("trims a label and drops a whitespace-only one", async () => {
      const wrapper = createWrapper();
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();
      const labels = labelInputs(wrapper);
      await labels[0].setValue("  padded  ");
      await labels[1].setValue("   ");
      queueBuilders(
        { version: 2, conditions: rule("meta_alert_name", "a"), complete: true },
        { version: 2, conditions: rule("meta_alert_name", "b"), complete: true },
      );
      const payload = await (wrapper.vm as any).submit();
      expect(payload.cases[0].label).toBe("padded");
      expect(payload.cases[1]).not.toHaveProperty("label");
    });

    it("always declares `else` as the else_handle, never colliding with a case", async () => {
      const wrapper = createWrapper();
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();
      queueBuilders(
        { version: 2, conditions: rule("meta_alert_name", "a"), complete: true },
        { version: 2, conditions: rule("meta_alert_name", "b"), complete: true },
      );
      const payload = await (wrapper.vm as any).submit();
      expect(payload.else_handle).toBe("else");
      expect(payload.cases.every((c: any) => c.handle !== "else")).toBe(true);
    });
  });

  describe("submit() — the incomplete flag", () => {
    it("clears meta.incomplete when at least one case has a complete condition", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "b1",
        data: { node_type: "branch" },
        meta: { incomplete: "true" },
      } as any;
      const wrapper = createWrapper();
      queueBuilders({ version: 2, conditions: rule("meta_alert_name", "a"), complete: true });
      await (wrapper.vm as any).submit();
      expect(workflowObj.currentSelectedNodeData.meta?.incomplete).toBeUndefined();
    });

    it("flags meta.incomplete when NO case has a complete condition (placeholder)", async () => {
      workflowObj.currentSelectedNodeData = { id: "b1", data: { node_type: "branch" } } as any;
      const wrapper = createWrapper();
      queueBuilders({ version: 2, conditions: {}, complete: false });
      const payload = await (wrapper.vm as any).submit();
      expect(payload.cases).toHaveLength(1);
      expect(workflowObj.currentSelectedNodeData.meta?.incomplete).toBe("true");
    });

    // Partially-configured is still usable: one good arm routes, the empty one just
    // never matches. Blocking here would make a half-built Branch unsavable.
    it("is complete when SOME case is complete, even if another is not", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "b1",
        data: { node_type: "branch" },
        meta: { incomplete: "true" },
      } as any;
      const wrapper = createWrapper();
      await wrapper.find('[data-test="workflow-branch-add-case"]').trigger("click");
      await nextTick();
      queueBuilders(
        { version: 2, conditions: {}, complete: false },
        { version: 2, conditions: rule("meta_alert_name", "b"), complete: true },
      );
      await (wrapper.vm as any).submit();
      expect(workflowObj.currentSelectedNodeData.meta?.incomplete).toBeUndefined();
    });

    it("keeps a case whose builder returned null, so its handle (and edges) survive", async () => {
      workflowObj.currentSelectedNodeData = { id: "b1", data: { node_type: "branch" } } as any;
      const wrapper = createWrapper();
      queueBuilders(null);
      const payload = await (wrapper.vm as any).submit();
      expect(payload.cases).toHaveLength(1);
      expect(payload.cases[0].handle).toBe("case-0");
      expect(workflowObj.currentSelectedNodeData.meta?.incomplete).toBe("true");
    });

    it("emits a rule-less arm as plain null — the {version, conditions: null} envelope 422s serde", async () => {
      workflowObj.currentSelectedNodeData = { id: "b1", data: { node_type: "branch" } } as any;
      const wrapper = createWrapper();
      queueBuilders(null);
      const payload = await (wrapper.vm as any).submit();
      expect(payload.cases[0].conditions).toBeNull();
    });
  });
});
