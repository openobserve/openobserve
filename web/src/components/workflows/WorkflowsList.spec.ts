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

// Workflows list page: row mapping from the list API, search, row actions
// (pause/resume, edit, delete), the history drawer and the child-route escape
// hatch. Heavy children (OTable, drawers, the graph preview) are stubbed.

import { vi } from "vitest";

const { mockRouter, mockToast, mockHydrate } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    currentRoute: { value: { name: "workflows", query: {} } },
  },
  mockToast: vi.fn(),
  mockHydrate: vi.fn(),
}));

vi.mock("vue-router", () => ({ useRouter: () => mockRouter }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

vi.mock("@/services/workflows", () => ({
  default: {
    listWorkflows: vi.fn(),
    deleteWorkflow: vi.fn(),
    enableWorkflow: vi.fn(),
  },
}));

vi.mock("@/plugins/workflows/useWorkflowCanvas", () => ({
  hydrateWorkflow: (...a: any[]) => mockHydrate(...a),
}));

vi.mock("@/components/workflows/WorkflowView.vue", () => ({
  default: {
    name: "WorkflowView",
    props: ["workflow"],
    template: '<div class="workflow-view-stub" />',
  },
}));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowsList from "./WorkflowsList.vue";
import workflowService from "@/services/workflows";

const t = (k: string, v?: any) => i18n.global.t(k, v ?? {});
const listWorkflows = workflowService.listWorkflows as any;
const deleteWorkflow = workflowService.deleteWorkflow as any;
const enableWorkflow = workflowService.enableWorkflow as any;

// ── stubs ────────────────────────────────────────────────────────────────────

const OTableStub = {
  name: "OTable",
  props: {
    data: { default: () => [] },
    columns: { default: () => [] },
    loading: { default: false },
  },
  emits: ["row-click"],
  template: `
    <div data-test="o-table-stub" v-bind="$attrs">
      <slot name="toolbar" />
      <slot name="toolbar-trailing" />
      <slot v-if="!data.length" name="empty" />
      <template v-for="row in data" :key="row.id">
        <slot name="cell-trigger" :row="row" />
        <slot name="cell-actions" :row="row" />
      </template>
      <slot name="bottom" />
    </div>
  `,
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "iconLeft", "loading", "title"],
  emits: ["click"],
  template:
    '<button class="o-button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
};

const globalStubs = {
  OTable: OTableStub,
  OButton: OButtonStub,
  OInput: {
    name: "OInput",
    inheritAttrs: false,
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue"],
    template:
      '<span class="o-input-wrap"><slot name="icon-left" />' +
      '<input class="o-input" v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' +
      "</span>",
  },
  OTag: {
    name: "OTag",
    props: ["value", "variant"],
    template: '<span class="o-tag">{{ value }}</span>',
  },
  OBadge: { name: "OBadge", template: '<span class="o-badge"><slot /></span>' },
  OIcon: { name: "OIcon", props: ["name", "size"], template: '<i class="o-icon" />' },
  OTooltip: {
    name: "OTooltip",
    template: '<span class="o-tooltip"><slot name="content" /></span>',
  },
  ODropdown: {
    name: "ODropdown",
    template: '<div class="o-dropdown"><slot name="trigger" /><slot /></div>',
  },
  ODropdownItem: {
    name: "ODropdownItem",
    emits: ["select"],
    template:
      '<button class="o-dropdown-item" v-bind="$attrs" @click="$emit(\'select\')"><slot name="icon-left" /><slot /></button>',
  },
  OEmptyState: {
    name: "OEmptyState",
    props: ["size", "preset", "filtered"],
    emits: ["action"],
    template: '<div data-test="empty-state-stub" :data-filtered="String(filtered)" />',
  },
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "title", "message"],
    emits: ["update:ok", "update:cancel", "update:modelValue"],
    template: '<div data-test="confirm-dialog-stub" :data-open="String(modelValue)" />',
  },
  PageLayout: {
    name: "PageLayout",
    template: '<div class="page-layout"><slot name="header" /><slot /></div>',
  },
  OPageHeader: {
    name: "OPageHeader",
    props: ["title", "subtitle", "icon"],
    template: '<div class="app-page-header"><slot name="title" /><slot name="actions" /></div>',
  },
  // Renders the child-route slot with a fake editor component so the
  // `<component :is="Component" @saved="getWorkflows" />` binding is exercised.
  RouterView: {
    name: "RouterView",
    setup(_: any, { slots }: any) {
      return () =>
        slots.default?.({
          Component: {
            name: "FakeEditor",
            emits: ["saved"],
            template: '<div data-test="router-view-stub" />',
          },
        });
    },
  },
};

// ── fixtures ─────────────────────────────────────────────────────────────────

const triggerNode = { id: "t1", data: { node_type: "workflow_trigger" } };

const makeWorkflow = (i: number, overrides: any = {}) => ({
  id: `wf-${i}`,
  name: `workflow-${i}`,
  description: `description ${i}`,
  enabled: true,
  updated_at: 1_700_000_000_000_000,
  nodes: [triggerNode, { id: `d${i}`, data: { node_type: "destination" } }],
  edges: [{ id: `e${i}`, source: "t1", target: `d${i}` }],
  ...overrides,
});

const mountList = () =>
  mount(WorkflowsList, {
    global: { plugins: [i18n, store], stubs: globalStubs },
  });

const table = (w: any) => w.findComponent(OTableStub);
const rows = (w: any) => table(w).props("data") as any[];

describe("WorkflowsList", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.currentRoute.value = { name: "workflows", query: {} } as any;
    listWorkflows.mockResolvedValue({
      data: [makeWorkflow(1), makeWorkflow(2, { enabled: false })],
    });
    deleteWorkflow.mockResolvedValue({});
    enableWorkflow.mockResolvedValue({});
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  // ── loading + row mapping ──────────────────────────────────────────────────

  describe("data loading", () => {
    it("fetches the workflows for the selected org on mount", async () => {
      wrapper = mountList();
      await flushPromises();
      expect(listWorkflows).toHaveBeenCalledWith("default");
      expect(rows(wrapper)).toHaveLength(2);
    });

    it("renders the list page shell", async () => {
      wrapper = mountList();
      await flushPromises();
      expect(wrapper.find('[data-test="workflows-list-page"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="router-view-stub"]').exists()).toBe(false);
    });

    it("clears the loading flag after the fetch resolves", async () => {
      wrapper = mountList();
      expect(table(wrapper).props("loading")).toBe(true);
      await flushPromises();
      expect(table(wrapper).props("loading")).toBe(false);
    });

    it("adds a zero-padded index for the first nine rows and a plain one after", async () => {
      listWorkflows.mockResolvedValue({
        data: Array.from({ length: 10 }, (_, i) => makeWorkflow(i + 1)),
      });
      wrapper = mountList();
      await flushPromises();
      const r = rows(wrapper);
      expect(r[0]["#"]).toBe("01");
      expect(r[8]["#"]).toBe("09");
      expect(r[9]["#"]).toBe(10);
    });

    it("derives the Trigger label from the trigger node in the graph", async () => {
      wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)[0].trigger).toBe(t("workflow.triggerAlertFired"));
      // target the trigger tag explicitly: the header's Beta tag is also an
      // `.o-tag`, so a bare `.find(".o-tag")` would match that one instead.
      expect(wrapper.find('[data-test="workflow-list-trigger-tag"]').text()).toBe(
        t("workflow.triggerAlertFired"),
      );
    });

    it("shows a dash when the graph has no trigger node", async () => {
      listWorkflows.mockResolvedValue({
        data: [makeWorkflow(1, { nodes: [{ id: "x", data: { node_type: "condition" } }] })],
      });
      wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)[0].trigger).toBe("—");
    });

    it("shows a dash when the workflow has no nodes at all", async () => {
      listWorkflows.mockResolvedValue({ data: [makeWorkflow(1, { nodes: undefined })] });
      wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)[0].trigger).toBe("—");
    });

    it("formats a microsecond updated_at timestamp", async () => {
      wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)[0].updated_at_display).toBe(
        new Date(1_700_000_000_000).toLocaleString(),
      );
    });

    it("formats a millisecond updated_at timestamp as-is", async () => {
      listWorkflows.mockResolvedValue({
        data: [makeWorkflow(1, { updated_at: 1_700_000_000_000 })],
      });
      wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)[0].updated_at_display).toBe(
        new Date(1_700_000_000_000).toLocaleString(),
      );
    });

    it("shows a dash for a missing updated_at", async () => {
      listWorkflows.mockResolvedValue({ data: [makeWorkflow(1, { updated_at: 0 })] });
      wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)[0].updated_at_display).toBe("—");
    });

    it("accepts a { list: [...] } envelope instead of a bare array", async () => {
      listWorkflows.mockResolvedValue({ data: { list: [makeWorkflow(1)] } });
      wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)).toHaveLength(1);
    });

    it("treats an object response with no list as empty", async () => {
      listWorkflows.mockResolvedValue({ data: {} });
      wrapper = mountList();
      await flushPromises();
      expect(rows(wrapper)).toEqual([]);
    });

    it("swallows an API error, stops loading and shows the empty state", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      listWorkflows.mockRejectedValue(new Error("boom"));
      wrapper = mountList();
      await flushPromises();
      expect(spy).toHaveBeenCalled();
      expect(rows(wrapper)).toEqual([]);
      expect(table(wrapper).props("loading")).toBe(false);
      expect(wrapper.find('[data-test="empty-state-stub"]').exists()).toBe(true);
      spy.mockRestore();
    });
  });

  // ── columns ────────────────────────────────────────────────────────────────

  describe("columns", () => {
    it("declares the expected columns in order", async () => {
      wrapper = mountList();
      await flushPromises();
      expect(
        table(wrapper)
          .props("columns")
          .map((c: any) => c.id),
      ).toEqual(["#", "name", "description", "trigger", "updated_at", "actions"]);
    });

    it("marks the actions column as an action column", async () => {
      wrapper = mountList();
      await flushPromises();
      const actions = (table(wrapper).props("columns") as any[]).find((c) => c.id === "actions");
      expect(actions.isAction).toBe(true);
      expect(actions.sortable).toBe(false);
    });
  });

  // ── search ─────────────────────────────────────────────────────────────────

  describe("search", () => {
    const search = (w: any) => w.find('[data-test="workflow-list-search-input"]');

    it("filters by name (case-insensitive)", async () => {
      wrapper = mountList();
      await flushPromises();
      await search(wrapper).setValue("WORKFLOW-2");
      await nextTick();
      expect(rows(wrapper)).toHaveLength(1);
      expect(rows(wrapper)[0].name).toBe("workflow-2");
    });

    it("filters by description", async () => {
      wrapper = mountList();
      await flushPromises();
      await search(wrapper).setValue("description 1");
      await nextTick();
      expect(rows(wrapper)).toHaveLength(1);
      expect(rows(wrapper)[0].name).toBe("workflow-1");
    });

    it("ignores surrounding whitespace", async () => {
      wrapper = mountList();
      await flushPromises();
      await search(wrapper).setValue("   ");
      await nextTick();
      expect(rows(wrapper)).toHaveLength(2);
    });

    it("tolerates rows without a name or description", async () => {
      listWorkflows.mockResolvedValue({
        data: [makeWorkflow(1, { name: undefined, description: undefined })],
      });
      wrapper = mountList();
      await flushPromises();
      await search(wrapper).setValue("zzz");
      await nextTick();
      expect(rows(wrapper)).toEqual([]);
    });

    it("shows the filtered empty state when nothing matches", async () => {
      wrapper = mountList();
      await flushPromises();
      await search(wrapper).setValue("no-such-workflow");
      await nextTick();
      const empty = wrapper.findComponent({ name: "OEmptyState" });
      expect(empty.exists()).toBe(true);
      expect(empty.props("filtered")).toBe(true);
    });

    it("shows the unfiltered empty state when the org has no workflows", async () => {
      listWorkflows.mockResolvedValue({ data: [] });
      wrapper = mountList();
      await flushPromises();
      expect(wrapper.findComponent({ name: "OEmptyState" }).props("filtered")).toBe(false);
    });

    it("clears the filter from the empty state's clear-filters action", async () => {
      wrapper = mountList();
      await flushPromises();
      await search(wrapper).setValue("no-such-workflow");
      await nextTick();

      wrapper.findComponent({ name: "OEmptyState" }).vm.$emit("action", "clear-filters");
      await nextTick();
      expect(rows(wrapper)).toHaveLength(2);
    });

    it("opens the create editor from the empty state's primary action", async () => {
      listWorkflows.mockResolvedValue({ data: [] });
      wrapper = mountList();
      await flushPromises();

      wrapper.findComponent({ name: "OEmptyState" }).vm.$emit("action", "create");
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createWorkflow",
        query: { org_identifier: "default" },
      });
    });

    it("reports the filtered total in the footer", async () => {
      wrapper = mountList();
      await flushPromises();
      expect(wrapper.find(".o2-table-footer-title").text()).toContain("2");

      await search(wrapper).setValue("workflow-1");
      await nextTick();
      expect(wrapper.find(".o2-table-footer-title").text()).toContain("1");
    });
  });

  // ── navigation ─────────────────────────────────────────────────────────────

  describe("navigation", () => {
    it("routes to the create editor (the trigger is chosen on the canvas)", async () => {
      wrapper = mountList();
      await flushPromises();
      await wrapper.find('[data-test="workflow-list-add-btn"]').trigger("click");
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "createWorkflow",
        query: { org_identifier: "default" },
      });
    });

    it("hydrates the shared editor state and routes to the editor on Edit", async () => {
      wrapper = mountList();
      await flushPromises();
      await wrapper.find('[data-test="workflow-list-workflow-1-edit"]').trigger("click");

      expect(mockHydrate).toHaveBeenCalledTimes(1);
      expect(mockHydrate.mock.calls[0][0].id).toBe("wf-1");
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflowEditor",
        query: { id: "wf-1", name: "workflow-1", org_identifier: "default" },
      });
    });

    it("refetches the list from the refresh button", async () => {
      wrapper = mountList();
      await flushPromises();
      expect(listWorkflows).toHaveBeenCalledTimes(1);

      await wrapper.find('[data-test="workflow-list-refresh"]').trigger("click");
      await flushPromises();
      expect(listWorkflows).toHaveBeenCalledTimes(2);
    });

    it("renders the child route instead of the list when the editor route is active", async () => {
      mockRouter.currentRoute.value = { name: "workflowEditor", query: {} } as any;
      wrapper = mountList();
      await flushPromises();
      expect(wrapper.find('[data-test="workflows-list-page"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="router-view-stub"]').exists()).toBe(true);
    });

    it("refetches the list when the child editor emits saved", async () => {
      mockRouter.currentRoute.value = { name: "workflowEditor", query: {} } as any;
      wrapper = mountList();
      await flushPromises();
      expect(listWorkflows).toHaveBeenCalledTimes(1);

      wrapper.findComponent({ name: "FakeEditor" }).vm.$emit("saved");
      await flushPromises();

      expect(listWorkflows).toHaveBeenCalledTimes(2);
    });
  });

  // ── enable / disable ───────────────────────────────────────────────────────

  describe("pause / resume", () => {
    const pauseBtn = (w: any, name: string) =>
      w.find(`[data-test="workflow-list-${name}-pause-start-action"]`);

    it("pauses an enabled workflow and refetches", async () => {
      wrapper = mountList();
      await flushPromises();

      expect(pauseBtn(wrapper, "workflow-1").attributes("data-row-action")).toBe("pause");
      await pauseBtn(wrapper, "workflow-1").trigger("click");
      await flushPromises();

      expect(enableWorkflow).toHaveBeenCalledWith({
        org_identifier: "default",
        id: "wf-1",
        value: false,
      });
      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.pauseSuccess", { name: "workflow-1" }),
        variant: "success",
      });
      expect(listWorkflows).toHaveBeenCalledTimes(2);
    });

    it("resumes a disabled workflow", async () => {
      wrapper = mountList();
      await flushPromises();

      expect(pauseBtn(wrapper, "workflow-2").attributes("data-row-action")).toBe("resume");
      await pauseBtn(wrapper, "workflow-2").trigger("click");
      await flushPromises();

      expect(enableWorkflow).toHaveBeenCalledWith({
        org_identifier: "default",
        id: "wf-2",
        value: true,
      });
      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.resumeSuccess", { name: "workflow-2" }),
        variant: "success",
      });
    });

    it("surfaces the API error message on failure", async () => {
      enableWorkflow.mockRejectedValue({
        response: { status: 500, data: { message: "nope" } },
      });
      wrapper = mountList();
      await flushPromises();

      await pauseBtn(wrapper, "workflow-1").trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({ message: "nope", variant: "error" });
      expect(listWorkflows).toHaveBeenCalledTimes(1);
    });

    it("falls back to the generic toggle error message", async () => {
      enableWorkflow.mockRejectedValue({ response: { status: 500, data: {} } });
      wrapper = mountList();
      await flushPromises();

      await pauseBtn(wrapper, "workflow-1").trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.toggleError"),
        variant: "error",
      });
    });

    it("stays silent on a 403 (permission errors are handled globally)", async () => {
      enableWorkflow.mockRejectedValue({ response: { status: 403 } });
      wrapper = mountList();
      await flushPromises();

      await pauseBtn(wrapper, "workflow-1").trigger("click");
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe("delete", () => {
    const openDelete = async (w: any, name = "workflow-1") => {
      await w.find(`[data-test="workflow-list-${name}-delete"]`).trigger("click");
      await nextTick();
    };
    const confirm = (w: any) => w.findComponent({ name: "ConfirmDialog" });

    it("opens the delete confirmation with the workflow copy", async () => {
      wrapper = mountList();
      await flushPromises();
      await openDelete(wrapper);

      expect(confirm(wrapper).props("modelValue")).toBe(true);
      expect(confirm(wrapper).props("title")).toBe(t("workflow.deleteTitle"));
      expect(confirm(wrapper).props("message")).toBe(t("workflow.deleteMessage"));
      expect(deleteWorkflow).not.toHaveBeenCalled();
    });

    it("deletes on confirm, toasts and refetches", async () => {
      wrapper = mountList();
      await flushPromises();
      await openDelete(wrapper);

      confirm(wrapper).vm.$emit("update:ok");
      await flushPromises();

      expect(deleteWorkflow).toHaveBeenCalledWith({
        org_identifier: "default",
        id: "wf-1",
      });
      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.deleteSuccess"),
        variant: "success",
      });
      expect(listWorkflows).toHaveBeenCalledTimes(2);
      expect(confirm(wrapper).props("modelValue")).toBe(false);
    });

    it("closes without deleting on cancel", async () => {
      wrapper = mountList();
      await flushPromises();
      await openDelete(wrapper);

      confirm(wrapper).vm.$emit("update:cancel");
      await flushPromises();

      expect(deleteWorkflow).not.toHaveBeenCalled();
      expect(confirm(wrapper).props("modelValue")).toBe(false);
    });

    it("closes when the dialog itself dismisses (v-model)", async () => {
      wrapper = mountList();
      await flushPromises();
      await openDelete(wrapper);

      confirm(wrapper).vm.$emit("update:modelValue", false);
      await nextTick();

      expect(confirm(wrapper).props("modelValue")).toBe(false);
      expect(deleteWorkflow).not.toHaveBeenCalled();
    });

    it("is a no-op when confirmed with no row staged", async () => {
      wrapper = mountList();
      await flushPromises();

      confirm(wrapper).vm.$emit("update:ok");
      await flushPromises();

      expect(deleteWorkflow).not.toHaveBeenCalled();
    });

    it("surfaces the API error message on a failed delete", async () => {
      deleteWorkflow.mockRejectedValue({
        response: { status: 500, data: { message: "in use" } },
      });
      wrapper = mountList();
      await flushPromises();
      await openDelete(wrapper);

      confirm(wrapper).vm.$emit("update:ok");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({ message: "in use", variant: "error" });
      expect(confirm(wrapper).props("modelValue")).toBe(false);
    });

    it("falls back to the generic delete error message", async () => {
      deleteWorkflow.mockRejectedValue({ response: { status: 500, data: {} } });
      wrapper = mountList();
      await flushPromises();
      await openDelete(wrapper);

      confirm(wrapper).vm.$emit("update:ok");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.deleteError"),
        variant: "error",
      });
    });

    it("stays silent on a 403 delete failure", async () => {
      deleteWorkflow.mockRejectedValue({ response: { status: 403 } });
      wrapper = mountList();
      await flushPromises();
      await openDelete(wrapper);

      confirm(wrapper).vm.$emit("update:ok");
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  // ── runs navigation ────────────────────────────────────────────────────────
  // Clicking a row opens the dedicated read-only Runs inspection view (not the
  // editor, not a drawer) — hydrating the row first so the canvas renders at once.

  describe("runs navigation", () => {
    it("navigates to the read-only Runs view for the clicked row", async () => {
      wrapper = mountList();
      await flushPromises();

      table(wrapper).vm.$emit("row-click", rows(wrapper)[0]);
      await nextTick();

      expect(mockHydrate).toHaveBeenCalledTimes(1);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "workflowRuns",
        query: {
          id: "wf-1",
          name: "workflow-1",
          org_identifier: "default",
        },
      });
    });

    it("ignores a row-click with no workflow id", async () => {
      wrapper = mountList();
      await flushPromises();

      table(wrapper).vm.$emit("row-click", { name: "ghost" });
      await nextTick();

      expect(mockRouter.push).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: "workflowRuns" }),
      );
    });
  });

  // ── row preview ────────────────────────────────────────────────────────────

  describe("row preview", () => {
    it("passes the row to the graph preview inside the view tooltip", async () => {
      wrapper = mountList();
      await flushPromises();
      const previews = wrapper.findAllComponents({ name: "WorkflowView" });
      expect(previews).toHaveLength(2);
      expect(previews[0].props("workflow").id).toBe("wf-1");
    });
  });
});
