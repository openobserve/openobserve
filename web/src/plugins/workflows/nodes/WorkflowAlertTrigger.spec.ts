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
// hands the workflow. It used to hand-roll a collapsible schema tree (its own
// expand/collapse buttons, syntax colours and hover titles); it now renders the
// SAME text the Test dialog seeds (buildTestSampleText) in a read-only Monaco
// editor, where folding replaces the old toggles. No editable fields —
// submit() only carries the trigger kind through.
//
// These assert the CONTENT handed to the editor rather than Monaco's rendering:
// the editor is stubbed, so what matters is that the documented fields reach it
// and that it stays read-only.

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
import { buildTestSampleText } from "@/plugins/workflows/testSample";
import { INCIDENT_EVENT_TYPES } from "@/plugins/workflows/incidentSample";
import WorkflowAlertTrigger from "./WorkflowAlertTrigger.vue";

function createWrapper() {
  return mount(WorkflowAlertTrigger, {
    global: {
      plugins: [i18n, store],
      stubs: {
        QueryEditor: {
          name: "QueryEditor",
          props: [
            "editorId",
            "query",
            "language",
            "readOnly",
            "showAutoComplete",
            "showLineNumbers",
            "stickyScroll",
          ],
          template: '<div class="query-editor" />',
        },
        // Emits update:modelValue so v-model drives the previewed variant.
        OSelect: {
          name: "OSelect",
          props: ["modelValue", "options", "label"],
          emits: ["update:modelValue"],
          template: '<div class="o-select-stub" />',
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

  const editor = (w: any) => w.findComponent({ name: "QueryEditor" });
  const payload = (w: any) => editor(w).props("query") as string;

  describe("rendering", () => {
    it("renders the intro and a read-only JSON editor", () => {
      const w = createWrapper();
      expect(w.find('[data-test="workflow-trigger-body"]').exists()).toBe(true);
      expect(w.find('[data-test="workflow-trigger-structure"]').exists()).toBe(true);
      expect(editor(w).exists()).toBe(true);
      expect(editor(w).props("language")).toBe("json");
      // Reference only — it must never become editable.
      expect(editor(w).props("readOnly")).toBe(true);
    });

    it("gives the editor a definite height (Monaco collapses without one)", () => {
      const box = createWrapper().find('[data-test="workflow-trigger-structure"]');
      expect(box.classes().some((c: string) => /^h-\d/.test(c))).toBe(true);
    });
  });

  describe("payload content", () => {
    it("hands the editor valid JSON", () => {
      const parsed = JSON.parse(payload(createWrapper()));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty("meta");
      expect(parsed[0]).toHaveProperty("data");
      expect(Array.isArray(parsed[0].data)).toBe(true);
    });

    it("includes every TRIGGER_META_VARS field, keyed without the `meta.` prefix", () => {
      const [{ meta }] = JSON.parse(payload(createWrapper()));
      for (const v of TRIGGER_META_VARS) {
        expect(meta).toHaveProperty(v.ref.replace(/^meta\./, ""));
      }
    });

    it("is the SAME text the Test dialog seeds, so the two cannot drift", () => {
      expect(payload(createWrapper())).toBe(buildTestSampleText());
    });
  });

  describe("incident event-type preview (split view)", () => {
    const select = (w: any) => w.findComponent({ name: "OSelect" });
    const jsonEditors = (w: any) => w.findAllComponents({ name: "QueryEditor" });
    // common block is the first editor; its sample is the `[{meta,data}]` envelope
    const commonMeta = (w: any) => JSON.parse(jsonEditors(w)[0].props("query"))[0].meta;
    const asIncident = () => {
      workflowObj.currentSelectedNodeData = {
        data: { trigger_kind: "incident_event" },
      } as any;
    };

    it("shows NO dropdown / split for an alert trigger (single sample)", () => {
      workflowObj.currentSelectedNodeData = {
        data: { trigger_kind: "alert_fired" },
      } as any;
      const w = createWrapper();
      expect(select(w).exists()).toBe(false);
      expect(w.find('[data-test="workflow-trigger-structure"]').exists()).toBe(true);
    });

    it("offers a dropdown of every incident event_type", () => {
      asIncident();
      const options = select(createWrapper())
        .props("options")
        .map((o: any) => o.value);
      expect(options).toEqual(INCIDENT_EVENT_TYPES);
    });

    it("shows only the common fields in the common block", () => {
      asIncident();
      const w = createWrapper();
      expect(w.find('[data-test="workflow-trigger-common-structure"]').exists()).toBe(true);
      const meta = commonMeta(w);
      expect(meta.event_type).toBe(INCIDENT_EVENT_TYPES[0]);
      expect(meta).toHaveProperty("incident_id");
      expect(meta).toHaveProperty("status");
    });

    it("shows the no-extra-fields note for an event with no extras (created)", () => {
      asIncident(); // default first event = "created" → no extras
      const w = createWrapper();
      expect(w.find('[data-test="workflow-trigger-no-extras"]').exists()).toBe(true);
      expect(w.find('[data-test="workflow-trigger-specific-structure"]').exists()).toBe(false);
    });

    it("reveals ONLY the added fields when picking an event with extras", async () => {
      asIncident();
      const w = createWrapper();
      select(w).vm.$emit("update:modelValue", "resolved");
      await w.vm.$nextTick();

      // common block reflects the picked event but stays common-only
      const meta = commonMeta(w);
      expect(meta.event_type).toBe("resolved");
      expect(meta.status).toBe("resolved");
      expect(meta).not.toHaveProperty("user_id");

      // event-specific block appears with ONLY the extras
      expect(w.find('[data-test="workflow-trigger-specific-structure"]').exists()).toBe(true);
      const specific = JSON.parse(jsonEditors(w)[1].props("query"));
      expect(specific).toHaveProperty("user_id");
      expect(specific).not.toHaveProperty("incident_id");
    });
  });

  describe("submit", () => {
    it("carries the saved trigger kind through", () => {
      workflowObj.currentSelectedNodeData = {
        data: { trigger_kind: "alert_fired" },
      } as any;
      expect((createWrapper().vm as any).submit()).toEqual({
        trigger_kind: "alert_fired",
      });
    });

    it("defaults the trigger kind when nothing is saved", () => {
      expect((createWrapper().vm as any).submit()).toEqual({
        trigger_kind: "alert_fired",
      });
    });
  });
});
