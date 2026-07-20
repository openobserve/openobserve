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

// The Alert Trigger body is a READ-ONLY reference of the payload a fired alert
// hands the workflow: a collapsible schema tree over TRIGGER_META_VARS (fixed
// `meta` block) plus an illustrative `data[]` row. It has no editable fields —
// submit() only carries the trigger kind through.

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => p,
  getUUID: () => "uuid",
}));

vi.mock("@/services/workflows", () => ({ default: {} }));

import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { TRIGGER_META_VARS } from "@/plugins/workflows/alertFields";
import WorkflowAlertTrigger from "./WorkflowAlertTrigger.vue";

function createWrapper() {
  return mount(WorkflowAlertTrigger, {
    global: {
      plugins: [i18n, store],
      stubs: {
        OIcon: {
          name: "OIcon",
          props: ["name", "size"],
          template: '<i class="o-icon" :data-name="name" />',
        },
      },
    },
  });
}

describe("WorkflowAlertTrigger", () => {
  beforeEach(() => {
    workflowObj.currentSelectedNodeData = null;
  });
  afterEach(() => {
    workflowObj.currentSelectedNodeData = null;
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders the trigger body and the schema tree", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="workflow-trigger-body"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="workflow-trigger-structure"]').exists(),
      ).toBe(true);
    });

    it("renders both toggles (meta + data)", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="workflow-trigger-meta-toggle"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="workflow-trigger-data-toggle"]').exists(),
      ).toBe(true);
    });

    it("renders one leaf row per TRIGGER_META_VARS entry, keyed without the `meta.` prefix", () => {
      const wrapper = createWrapper();
      for (const v of TRIGGER_META_VARS) {
        const key = v.ref.replace(/^meta\./, "");
        const row = wrapper.find(`[data-test="workflow-trigger-field-${key}"]`);
        expect(row.exists()).toBe(true);
        expect(row.text()).toContain(key);
      }
      expect(
        wrapper.findAll('[data-test^="workflow-trigger-field-"]').length,
      ).toBe(TRIGGER_META_VARS.length);
    });

    it("renders every non-enum field as string (the real payload's meta is all strings)", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="workflow-trigger-field-org_id"]').text(),
      ).toContain("string");
      expect(
        wrapper
          .find('[data-test="workflow-trigger-field-alert_period"]')
          .text(),
      ).toContain("string");
      expect(
        wrapper
          .find('[data-test="workflow-trigger-field-alert_start_time"]')
          .text(),
      ).toContain("string");
    });

    it('renders enum fields Datadog-style as `"a" | "b"`', () => {
      const wrapper = createWrapper();
      const row = wrapper.find(
        '[data-test="workflow-trigger-field-alert_type"]',
      );
      expect(row.text()).toContain('"realtime" | "scheduled"');
      // Asserted via data-kind, not the colour class: the styling moved to
      // utilities, and pinning utility classes makes every restyle a test edit.
      expect(row.find('[data-kind="enum"]').exists()).toBe(true);
      expect(row.find('[data-kind="type"]').exists()).toBe(false);
    });

    it("shows each field's translated description as a native title", () => {
      const wrapper = createWrapper();
      const row = wrapper.find(
        '[data-test="workflow-trigger-field-alert_name"]',
      );
      const title = row.attributes("title");
      expect(title).toBeTruthy();
      // resolved through i18n — not the raw key
      expect(title).not.toBe("workflow.triggerMeta.alertName");
    });
  });

  describe("meta expand / collapse", () => {
    it("is expanded by default", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="workflow-trigger-field-org_id"]').exists(),
      ).toBe(true);
      // aria-expanded is the semantic state of a disclosure toggle — more
      // meaningful than the chevron's rotation class, and it also pins the a11y
      // attribute so it cannot be dropped in a restyle.
      expect(
        wrapper
          .find('[data-test="workflow-trigger-meta-toggle"]')
          .attributes("aria-expanded"),
      ).toBe("true");
    });

    it("collapses to a `{…}` summary with the key count on click", async () => {
      const wrapper = createWrapper();
      await wrapper
        .find('[data-test="workflow-trigger-meta-toggle"]')
        .trigger("click");

      expect(
        wrapper.find('[data-test="workflow-trigger-field-org_id"]').exists(),
      ).toBe(false);
      const toggle = wrapper.find('[data-test="workflow-trigger-meta-toggle"]');
      expect(toggle.text()).toContain("{…}");
      expect(toggle.text()).toContain(`${TRIGGER_META_VARS.length} keys`);
      // aria-expanded, not the chevron class: asserting the ABSENCE of a class
      // that no longer exists would pass vacuously and guard nothing.
      expect(toggle.attributes("aria-expanded")).toBe("false");
    });

    it("re-expands on a second click", async () => {
      const wrapper = createWrapper();
      const toggle = wrapper.find('[data-test="workflow-trigger-meta-toggle"]');
      await toggle.trigger("click");
      await toggle.trigger("click");
      expect(
        wrapper.find('[data-test="workflow-trigger-field-org_id"]').exists(),
      ).toBe(true);
    });
  });

  describe("data expand / collapse", () => {
    it("shows the example row columns when expanded (default)", () => {
      const wrapper = createWrapper();
      const text = wrapper.find(
        '[data-test="workflow-trigger-structure"]',
      ).text();
      expect(text).toContain("_timestamp");
      expect(text).toContain("job");
      expect(text).toContain("level");
      expect(text).toContain("log");
      expect(text).toContain('"test message for openobserve"');
      expect(text).toContain("1784027838234393");
    });

    it("renders the dynamic-columns note when expanded", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="workflow-trigger-note"]').exists()).toBe(true);
    });

    it("hides the example row + note when collapsed", async () => {
      const wrapper = createWrapper();
      await wrapper
        .find('[data-test="workflow-trigger-data-toggle"]')
        .trigger("click");
      const text = wrapper.find(
        '[data-test="workflow-trigger-structure"]',
      ).text();
      expect(text).not.toContain("_timestamp");
      expect(text).not.toContain('"test message for openobserve"');
      expect(wrapper.find('[data-test="workflow-trigger-note"]').exists()).toBe(false);
    });

    it("always shows `data: Array<object>` on the toggle", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="workflow-trigger-data-toggle"]').text(),
      ).toContain("Array<object>");
    });
  });

  describe("submit()", () => {
    it("defaults to alert_fired when there is no selected node data", () => {
      const wrapper = createWrapper();
      expect((wrapper.vm as any).submit()).toEqual({
        trigger_kind: "alert_fired",
      });
    });

    it("defaults to alert_fired when the node has data but no trigger_kind", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "workflow_trigger" },
      } as any;
      const wrapper = createWrapper();
      expect((wrapper.vm as any).submit()).toEqual({
        trigger_kind: "alert_fired",
      });
    });

    it("carries the saved trigger_kind through unchanged", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "workflow_trigger", trigger_kind: "schedule" },
      } as any;
      const wrapper = createWrapper();
      expect((wrapper.vm as any).submit()).toEqual({
        trigger_kind: "schedule",
      });
    });
  });
});
