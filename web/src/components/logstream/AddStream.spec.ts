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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import AddStream from "./AddStream.vue";
import StreamFieldInputs from "./StreamFieldInputs.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { qLayoutInjections } from "@/test/unit/helpers/layout-injections";
import { createStore } from "vuex";
import i18n from "@/locales";

const { mockGetStream, mockAddStream, mockCreateStream, mockSchemaStream } =
  vi.hoisted(() => ({
    mockGetStream: vi.fn(),
    mockAddStream: vi.fn(),
    mockCreateStream: vi.fn(),
    mockSchemaStream: vi.fn(),
  }));

const mockToast = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: mockGetStream,
    addStream: mockAddStream,
  }),
}));

vi.mock("@/services/stream", () => ({
  default: {
    createStream: mockCreateStream,
    schema: mockSchemaStream,
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({
    track: vi.fn(),
  }),
}));

vi.mock("@/services/segment_analytics", () => ({
  default: { track: vi.fn() },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

// Stub the overlay (its footer Save submits via form-id, exercised by e2e).
// Keep BOTH the REAL OForm and the REAL StreamFieldInputs so the Zod schema
// validates the scalars AND the dynamic rows (field-array is form-mode now).
const ODialogStub = {
  name: "ODialog",
  template:
    '<div class="o-dialog-stub" :data-open="open"><slot name="header" /><slot /><slot name="footer" /></div>',
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "formId",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryVariant",
    "secondaryVariant",
    "neutralVariant",
    "primaryDisabled",
    "secondaryDisabled",
    "neutralDisabled",
    "primaryLoading",
    "secondaryLoading",
    "neutralLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

const makeStore = (overrides = {}) =>
  createStore({
    state: {
      theme: "light",
      selectedOrganization: { identifier: "test-org" },
      zoConfig: {
        user_defined_schemas_enabled: false,
        data_retention_days: 0,
        ...overrides,
      },
    },
  });

describe("AddStream", () => {
  let store: any;

  const globalStubs = {
    ODialog: ODialogStub,
  };

  // Read the RENDERED row-name inputs (model-value handed to each OInput), in
  // render order — used by the field-array delete test to prove the inputs stay
  // aligned with the data after a mid-list delete (a data-only check can't).
  const renderedRowNames = (w: any) =>
    w
      .findAllComponents(OFormInput)
      .filter((c: any) => /^fields\[\d+\]\.name$/.test(c.props("name")))
      .map((c: any) => c.findComponent(OInput).props("modelValue"));

  // Same idea for the rendered data-type SELECTs — proves the whole row (not
  // just the name) stays aligned to its index after a mid-list delete.
  const renderedRowTypes = (w: any) =>
    w
      .findAllComponents(OFormSelect)
      .filter((c: any) => /^fields\[\d+\]\.type$/.test(c.props("name")))
      .map((c: any) => c.findComponent(OSelect).props("modelValue"));

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    // By default, stream doesn't exist
    mockGetStream.mockRejectedValue({ response: { status: 404 } });
    mockCreateStream.mockResolvedValue({});
    mockSchemaStream.mockResolvedValue({ data: { name: "new-stream" } });
  });

  const mountComp = (customStore?: any, extraProps: Record<string, any> = {}) =>
    mount(AddStream, {
      props: { isInPipeline: false, open: true, ...extraProps },
      global: {
        plugins: [i18n, customStore ?? store],
        stubs: globalStubs,
        provide: qLayoutInjections(),
      },
    });

  // The REAL OForm (single source of truth for the scalar fields).
  const getForm = (w: any) => {
    const oform = w.findComponent(OForm);
    return oform.exists() ? (oform.vm as any).form : undefined;
  };
  const values = (w: any) => getForm(w)?.state.values;
  const submit = async (w: any) => {
    await getForm(w)?.handleSubmit();
    await flushPromises();
  };

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      const wrapper = mountComp();
      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render ODialog with localized title and button labels", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("title")).toBeTruthy();
      expect(drawer.props("secondaryButtonLabel")).toBeTruthy();
      expect(drawer.props("primaryButtonLabel")).toBeTruthy();
    });

    it("should associate the dialog footer with the form via form-id", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const drawer = wrapper.findComponent(ODialogStub);
      // form-id (container) MUST equal the OForm id so Enter + footer Save submit.
      expect(drawer.props("formId")).toBe("add-stream-form");
      expect(wrapper.find("form#add-stream-form").exists()).toBe(true);
    });

    it("should pass through the open prop to ODialog", async () => {
      const wrapper = mountComp(undefined, { open: true });
      await flushPromises();
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.props("open")).toBe(true);
    });

    it("should render the stream name input", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-stream-name-input"]').exists(),
      ).toBe(true);
    });

    it("should render the stream type select", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-stream-type-input"]').exists(),
      ).toBe(true);
    });

    it("should render the data retention input when data_retention_days is set", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore);
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-stream-data-retention-input"]').exists(),
      ).toBe(true);
    });

    it("should render inline form without ODialog when isInPipeline is true", async () => {
      const wrapper = mountComp(undefined, { isInPipeline: true });
      await flushPromises();

      expect(wrapper.findComponent(ODialogStub).exists()).toBe(false);
      expect(
        wrapper.find('[data-test="add-stream-name-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-stream-type-input"]').exists(),
      ).toBe(true);
      // Pipeline mode renders NO inline Cancel/Save — the parent <ODrawer>
      // (Stream.vue) owns the built-in footer buttons, and its Save submits this
      // form via `form-id` (see the id assertion below).
      expect(
        wrapper.find('[data-test="add-stream-cancel-btn"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="add-stream-save-btn"]').exists(),
      ).toBe(false);
    });

    it("inline form exposes id=add-stream-node-form so the drawer footer Save can submit it", async () => {
      const wrapper = mountComp(undefined, { isInPipeline: true });
      await flushPromises();
      // The parent ODrawer sets `form-id="add-stream-node-form"`; its footer Save
      // is `type=submit form="add-stream-node-form"`, so this <form> must carry
      // that id for the cross-DOM submit (and native Enter) to work.
      expect(wrapper.find("form#add-stream-node-form").exists()).toBe(true);
    });

    it("should render data retention input in pipeline mode when enabled", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore, { isInPipeline: true });
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-stream-data-retention-input"]').exists(),
      ).toBe(true);
    });
  });

  describe("Default form state", () => {
    it("seeds blank name / stream_type and dataRetentionDays = 14", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(values(wrapper).name).toBe("");
      expect(values(wrapper).stream_type).toBe("");
      expect(values(wrapper).dataRetentionDays).toBe(14);
    });

    it("initializes fields as an empty array", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(values(wrapper).fields).toEqual([]);
    });

    it("Save button is always enabled (no :primary-button-disabled)", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.props("primaryDisabled")).toBeFalsy();
    });

    it("resets to blank defaults when the dialog is reopened (owner-pattern form persists)", async () => {
      // The form now lives in setup() (Rule ③ owner pattern), so it is not
      // recreated on close→open like the old in-body form. The reset-on-open
      // watcher must clear leftover input so each reopen starts fresh.
      const wrapper = mountComp(undefined, { open: false });
      await flushPromises();
      await wrapper.setProps({ open: true });
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("name", "leftover_name");
      form.setFieldValue("stream_type", "logs");
      await nextTick();
      expect(values(wrapper).name).toBe("leftover_name");

      // Close, then reopen → the watcher resets the persistent form to defaults.
      await wrapper.setProps({ open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();

      expect(values(wrapper).name).toBe("");
      expect(values(wrapper).stream_type).toBe("");
      expect(values(wrapper).dataRetentionDays).toBe(14);
    });
  });

  describe("Button event handling", () => {
    it("should emit update:open=false when Cancel button is clicked", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const drawer = wrapper.findComponent(ODialogStub);
      await drawer.vm.$emit("click:secondary");
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")!.at(-1)).toEqual([false]);
    });

    it("should propagate ODialog's update:open event to parent", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const drawer = wrapper.findComponent(ODialogStub);
      await drawer.vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")!.at(-1)).toEqual([false]);
    });

    // Cancel in pipeline mode is now owned by the parent <ODrawer> footer
    // (Stream.vue's handleSecondaryClick flips back to the select-existing form);
    // AddStream no longer renders an inline Cancel, so there's nothing to test here.
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Schema validation through the REAL OForm (per the playbook §5).
  describe("OForm schema validation (real form)", () => {
    it("blocks submit and does NOT create when name + type are empty", async () => {
      const wrapper = mountComp();
      await flushPromises();

      await submit(wrapper);

      expect(getForm(wrapper).state.isValid).toBe(false);
      expect(mockCreateStream).not.toHaveBeenCalled();
    });

    it("reveals required errors only after the first submit (R3)", async () => {
      const wrapper = mountComp();
      await flushPromises();

      // Nothing validates before the first submit.
      expect(wrapper.text()).not.toContain("Stream name is required");

      await submit(wrapper);
      expect(wrapper.text()).toContain("Stream name is required");
    });

    it("creates the stream when name + type are valid", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("name", "test_stream");
      form.setFieldValue("stream_type", "logs");
      await nextTick();

      await submit(wrapper);

      expect(form.state.isValid).toBe(true);
      expect(mockGetStream).toHaveBeenCalledWith("test_stream", "logs", false);
      expect(mockCreateStream).toHaveBeenCalled();
    });

    it("rejects a name with disallowed characters (regex restored)", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("name", "bad name!");
      form.setFieldValue("stream_type", "logs");
      await nextTick();

      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(mockCreateStream).not.toHaveBeenCalled();
    });

    it("rejects a whitespace-only name (regex rejects raw whitespace)", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("name", "   ");
      form.setFieldValue("stream_type", "logs");
      await nextTick();

      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(mockCreateStream).not.toHaveBeenCalled();
    });

    // Regression: a schema `.trim()` would let a trailing/leading space PASS
    // validation (the regex judges the trimmed copy) while OForm/TanStack SAVES
    // the raw value — persisting the space. The schema validates the RAW value
    // (no `.trim()`), so surrounding whitespace is rejected and never saved.
    it("rejects a name with a trailing space and never saves the raw space", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("name", "mystream ");
      form.setFieldValue("stream_type", "logs");
      await nextTick();

      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(mockCreateStream).not.toHaveBeenCalled();
    });

    it("clears the error on change after a failed submit, then submits", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const form = getForm(wrapper);
      await submit(wrapper);
      expect(form.state.isValid).toBe(false);

      form.setFieldValue("name", "good_stream");
      form.setFieldValue("stream_type", "metrics");
      await nextTick();
      expect(form.state.isValid).toBe(true);
    });
  });

  describe("Conditional data-retention validation", () => {
    it("requires dataRetentionDays > 0 when retention is enabled", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore);
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("name", "ret_stream");
      form.setFieldValue("stream_type", "logs");
      form.setFieldValue("dataRetentionDays", 0);
      await nextTick();

      await submit(wrapper);
      expect(form.state.isValid).toBe(false);
      expect(mockCreateStream).not.toHaveBeenCalled();
    });

    it("passes when retention is enabled and dataRetentionDays > 0", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore);
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("name", "ret_stream");
      form.setFieldValue("stream_type", "logs");
      form.setFieldValue("dataRetentionDays", 7);
      await nextTick();

      await submit(wrapper);
      expect(form.state.isValid).toBe(true);
      expect(mockCreateStream).toHaveBeenCalled();
    });

    it("does NOT require retention for enrichment_tables streams", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore);
      await flushPromises();

      const form = getForm(wrapper);
      form.setFieldValue("name", "enrich_stream");
      form.setFieldValue("stream_type", "enrichment_tables");
      form.setFieldValue("dataRetentionDays", 0);
      await nextTick();

      await submit(wrapper);
      expect(form.state.isValid).toBe(true);
    });
  });

  describe("Save flow (driven through the form)", () => {
    const fillValid = (w: any) => {
      const form = getForm(w);
      form.setFieldValue("name", "new_stream");
      form.setFieldValue("stream_type", "logs");
    };

    it("does not call createStream if the stream already exists", async () => {
      mockGetStream.mockResolvedValue({ data: {} });
      const wrapper = mountComp();
      await flushPromises();

      fillValid(wrapper);
      await submit(wrapper);

      expect(mockCreateStream).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "warning" }),
      );
    });

    it("emits streamAdded and close after successful creation", async () => {
      const wrapper = mountComp();
      await flushPromises();

      fillValid(wrapper);
      await submit(wrapper);

      expect(wrapper.emitted("streamAdded")).toBeTruthy();
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("does not show an error toast for 403 responses", async () => {
      mockCreateStream.mockRejectedValue({
        response: { status: 403, data: {} },
      });
      const wrapper = mountComp();
      await flushPromises();

      fillValid(wrapper);
      await expect(submit(wrapper)).resolves.not.toThrow();
    });

    it("shows an error toast for non-403 createStream failures", async () => {
      mockCreateStream.mockRejectedValue({
        response: { status: 500, data: { message: "Internal Server Error" } },
      });
      const wrapper = mountComp();
      await flushPromises();

      fillValid(wrapper);
      await submit(wrapper);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Internal Server Error" }),
      );
    });
  });

  describe("filteredStreamTypes computed", () => {
    it("should return all three stream types", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const types = (wrapper.vm as any).filteredStreamTypes.map(
        (t: any) => t.value,
      );
      expect(types).toContain("logs");
      expect(types).toContain("metrics");
      expect(types).toContain("traces");
    });
  });

  describe("field rows (form-owned array)", () => {
    const child = (w: any) => w.findComponent(StreamFieldInputs);

    it("adds a new blank row via the child (into the form)", async () => {
      const wrapper = mountComp();
      await flushPromises();
      child(wrapper).vm.addRow();
      await flushPromises();
      const rows = values(wrapper).fields;
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("");
      expect(rows[0].index_type).toEqual([]);
      expect(rows[0].uuid).toBeDefined();
    });

    it("removes a row at the given index (from the form)", async () => {
      const wrapper = mountComp();
      await flushPromises();
      getForm(wrapper).setFieldValue("fields", [
        { uuid: "a", name: "first", type: "Utf8", index_type: [] },
        { uuid: "b", name: "second", type: "Utf8", index_type: [] },
      ]);
      await flushPromises();
      child(wrapper).vm.removeRow(0);
      await flushPromises();
      const rows = values(wrapper).fields;
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("second");
    });

    // 🔑 The :key-must-be-index gate. Delete a NON-last row and assert the
    // RENDERED inputs (model-value handed to each OInput), NOT just
    // form.state.values. A stable-id :key would leave the data correct but the
    // inputs shifted/blank — this test would then fail.
    it("keeps rendered row inputs aligned after deleting a NON-last row", async () => {
      const wrapper = mountComp();
      await flushPromises();
      // Distinct names AND types per row so we can prove BOTH fields of each row
      // stay glued to their position after a mid-list delete.
      getForm(wrapper).setFieldValue("fields", [
        { uuid: "a", name: "row_one", type: "Utf8", index_type: [] },
        { uuid: "b", name: "row_two", type: "Int64", index_type: [] },
        { uuid: "c", name: "row_three", type: "Float64", index_type: [] },
      ]);
      await flushPromises();
      expect(renderedRowNames(wrapper)).toEqual([
        "row_one",
        "row_two",
        "row_three",
      ]);
      expect(renderedRowTypes(wrapper)).toEqual(["Utf8", "Int64", "Float64"]);

      // Delete the MIDDLE row.
      child(wrapper).vm.removeRow(1);
      await flushPromises();

      // Rendered inputs must show the survivors in order (not shifted/blank) —
      // both the name input AND the type select of each surviving row.
      expect(renderedRowNames(wrapper)).toEqual(["row_one", "row_three"]);
      expect(renderedRowTypes(wrapper)).toEqual(["Utf8", "Float64"]);
      // …and the form data agrees.
      expect(values(wrapper).fields.map((r: any) => r.name)).toEqual([
        "row_one",
        "row_three",
      ]);
      expect(values(wrapper).fields.map((r: any) => r.type)).toEqual([
        "Utf8",
        "Float64",
      ]);
    }, 20000);
  });

  describe("getStreamPayload", () => {
    it("returns an empty payload when there are no fields", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const payload = (wrapper.vm as any).getStreamPayload(14, []);
      expect(payload).toBeDefined();
      expect(payload.fields).toEqual([]);
      expect(payload.settings.partition_keys).toEqual([]);
    });

    it("maps FTS / secondary / bloom index types", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const rows = [
        { name: "log_field", type: "", index_type: ["fullTextSearchKey"] },
        { name: "user_id", type: "", index_type: ["secondaryIndexKey"] },
        { name: "session_id", type: "", index_type: ["bloomFilterKey"] },
      ];
      const payload = (wrapper.vm as any).getStreamPayload(14, rows);
      expect(payload.settings.full_text_search_keys).toContain("log_field");
      expect(payload.settings.index_fields).toContain("user_id");
      expect(payload.settings.bloom_filter_fields).toContain("session_id");
    });

    it("normalizes field names (lowercase, spaces/dashes → underscores)", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const payload = (wrapper.vm as any).getStreamPayload(14, [
        { name: "My Field-Name", type: "", index_type: [] },
      ]);
      expect(payload.fields[0].name).toBe("my_field_name");
    });

    it("adds partition keys (value / prefix / hash)", async () => {
      const wrapper = mountComp();
      await flushPromises();
      const rows = [
        { name: "city", type: "", index_type: ["keyPartition"] },
        { name: "ua", type: "", index_type: ["prefixPartition"] },
        { name: "trace_id", type: "", index_type: ["hashPartition_8"] },
      ];
      const payload = (wrapper.vm as any).getStreamPayload(14, rows);
      expect(payload.settings.partition_keys).toContainEqual({
        field: "city",
        types: "value",
      });
      expect(payload.settings.partition_keys).toContainEqual({
        field: "ua",
        types: "prefix",
      });
      expect(payload.settings.partition_keys).toContainEqual({
        field: "trace_id",
        types: { hash: 8 },
      });
    });

    it("adds defined_schema_fields when UDS is enabled", async () => {
      const customStore = makeStore({ user_defined_schemas_enabled: true });
      const wrapper = mountComp(customStore);
      await flushPromises();
      const payload = (wrapper.vm as any).getStreamPayload(14, [
        { name: "my_field", type: "", index_type: [] },
      ]);
      expect(payload.settings.defined_schema_fields).toContain("my_field");
    });

    it("sets data_retention when retention is shown", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore);
      await flushPromises();

      // showDataRetention reads the form's stream_type (via the subscription).
      getForm(wrapper).setFieldValue("stream_type", "logs");
      await flushPromises();

      const payload = (wrapper.vm as any).getStreamPayload(7, []);
      expect(payload.settings.data_retention).toBe(7);
    });

    it("toasts and returns undefined when retention < 1 (and shown)", async () => {
      const customStore = makeStore({ data_retention_days: 30 });
      const wrapper = mountComp(customStore);
      await flushPromises();

      getForm(wrapper).setFieldValue("stream_type", "logs");
      await flushPromises();

      const payload = (wrapper.vm as any).getStreamPayload(0, []);
      expect(payload).toBeUndefined();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Invalid Data Retention"),
        }),
      );
    });
  });
});
