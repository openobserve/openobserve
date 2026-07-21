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
//
// AddTab is migrated to OForm + Zod (AddTab.schema.ts) + auto-loading, and is
// single-source-of-truth: the OForm owns the `name` field (no local `tabData`
// mirror, no mirror watch, no manual reset).
//   • `@submit="onSubmit"` is a plain async fn — its `value` payload is the
//     source of truth for the name; the externally-loaded `editingTab` carries
//     panels/tabId in edit mode.
//   • create seeds blank via `:default-values`; edit re-baselines via
//     `form.reset(values)` once the async dashboard fetch resolves.
//   • no `useLoading`, no `:primary-button-loading`, no per-field `:validators`.
// These tests assert behavior (add/edit/folder/notifications/emits) by driving
// the exposed `onSubmit(value)` handler, not removed internals.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import AddTab from "./AddTab.vue";
import enLocaleFull from "@/locales/languages/en-US.json";

// Mock vue-router
const mockRoute = {
  params: { dashboard: "test-dashboard" },
  query: { folder: "test-folder" } as Record<string, string>,
  name: "dashboards",
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
}));

// Mock vue-i18n
// Inline overrides the assertions depend on. These are merged on top of the
// real en locale so every migrated key resolves to its actual English text
// while these explicit values still win.
const inlineOverrides: any = {
  "dashboard.nameRequired": "Name is required",
  "dashboard.cancel": "Cancel",
  "dashboard.save": "Save",
  "dashboard.name": "Name",
  "dashboard.newTab": "Add Tab",
  "dashboard.editTab": "Edit Tab",
};

// Resolve a dotted key path against the full en.json locale.
const resolveFromLocale = (key: string): string | undefined => {
  return key
    .split(".")
    .reduce(
      (acc: any, part: string) =>
        acc && typeof acc === "object" ? acc[part] : undefined,
      enLocaleFull as any,
    );
};

const mockI18n = {
  t: (key: string) => {
    if (Object.prototype.hasOwnProperty.call(inlineOverrides, key)) {
      return inlineOverrides[key];
    }
    const resolved = resolveFromLocale(key);
    return typeof resolved === "string" ? resolved : key;
  },
};

vi.mock("vue-i18n", () => ({
  useI18n: () => mockI18n,
}));

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock console methods
global.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
  log: vi.fn(),
};

// Mock composables
const mockShowPositiveNotification = vi.fn();
const mockShowErrorNotification = vi.fn();
const mockShowConflictErrorNotification = vi.fn();

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: mockShowPositiveNotification,
    showErrorNotification: mockShowErrorNotification,
    showConfictErrorNotificationWithRefreshBtn: mockShowConflictErrorNotification,
  }),
}));

// Mock dashboard utilities
vi.mock("@/utils/commons", () => ({
  addTab: vi.fn(),
  getDashboard: vi.fn(),
  editTab: vi.fn(),
}));

vi.mock("../../../utils/commons", () => ({
  editTab: vi.fn(),
  addTab: vi.fn(),
  getDashboard: vi.fn(),
}));

// ODialog stub: exposes the migrated props and drives the
// primary/secondary buttons via emits (click:primary / click:secondary).
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "formId",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div
      data-test-stub="o-dialog"
      :data-open="open"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <div data-test-stub="o-dialog-body"><slot /></div>
      <div data-test-stub="o-dialog-footer">
        <slot name="footer" />
        <button data-test-stub="o-dialog-primary" @click="$emit('click:primary', $event)">{{ primaryButtonLabel }}</button>
        <button data-test-stub="o-dialog-secondary" @click="$emit('click:secondary', $event)">{{ secondaryButtonLabel }}</button>
      </div>
    </div>
  `,
  inheritAttrs: false,
};

// OForm stub: passthrough that emits `submit` (tests provide the value payload)
// and exposes the `form.reset` surface the component's ref touches for async
// edit-prefill re-baselining.
const OFormStub = {
  name: "OForm",
  props: ["defaultValues", "schema"],
  emits: ["submit"],
  template: `<form data-test-stub="o-form" @submit.prevent="$emit('submit', defaultValues)"><slot /></form>`,
  setup() {
    return {
      form: {
        state: { values: { name: "" } },
        reset() {},
      },
    };
  },
};

const OFormInputStub = {
  name: "OFormInput",
  // `required` typed Boolean so the `required` shorthand coerces to true (as the real component does).
  props: {
    name: String,
    label: String,
    required: { type: Boolean, default: false },
    modelValue: { type: null, default: undefined },
  },
  template: `<input data-test="dashboard-add-tab-name" :name="name" :required="required" />`,
};

describe("AddTab", () => {
  let wrapper: VueWrapper<any>;
  let mockAddTab: any;
  let mockEditTab: any;
  let mockGetDashboard: any;

  const createWrapper = (props = {}) =>
    mount(AddTab, {
      props: {
        dashboardId: "test-dashboard-id",
        open: true,
        ...props,
      },
      global: {
        plugins: [],
        stubs: {
          ODialog: ODialogStub,
          OForm: OFormStub,
          OFormInput: OFormInputStub,
        },
      },
    });

  beforeEach(async () => {
    vi.clearAllMocks();

    mockShowPositiveNotification.mockClear();
    mockShowErrorNotification.mockClear();
    mockShowConflictErrorNotification.mockClear();

    const { addTab, getDashboard } = await import("@/utils/commons");
    const { editTab } = await import("../../../utils/commons");

    mockAddTab = addTab as any;
    mockEditTab = editTab as any;
    mockGetDashboard = getDashboard as any;

    mockAddTab.mockResolvedValue({ tabId: "new-tab", name: "New Tab" });
    mockEditTab.mockResolvedValue({ tabId: "edit-tab", name: "Edited Tab" });

    const mockDashboardData = {
      dashboardId: "test-dashboard-id",
      tabs: [
        { tabId: "tab1", name: "Tab 1", panels: [] },
        { tabId: "tab2", name: "Tab 2", panels: [] },
      ],
    };
    mockGetDashboard.mockResolvedValue(mockDashboardData);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const findDialog = (w: VueWrapper<any>) => w.findComponent({ name: "ODialog" });

  describe("Component Initialization", () => {
    it("should render correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(findDialog(wrapper).exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("AddTab");
    });

    it("should show 'Add Tab' title by default", () => {
      wrapper = createWrapper();
      expect(findDialog(wrapper).props("title")).toBe("Add Tab");
    });

    it("should show 'Edit Tab' title when editMode is true", () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      expect(findDialog(wrapper).props("title")).toBe("Edit Tab");
    });

    it("should forward 'open' prop to ODialog", () => {
      wrapper = createWrapper({ open: true });
      expect(findDialog(wrapper).props("open")).toBe(true);
    });

    it("should not show dialog as open when open prop is false", () => {
      wrapper = createWrapper({ open: false });
      expect(findDialog(wrapper).props("open")).toBe(false);
    });
  });

  describe("Props Validation", () => {
    it("should require dashboardId prop", () => {
      const component = AddTab as any;
      expect(component.props.dashboardId.required).toBe(true);
    });

    it("should have correct prop validators", () => {
      const component = AddTab as any;
      expect(component.props.tabId.validator("string")).toBe(true);
      expect(component.props.tabId.validator(null)).toBe(true);
      expect(component.props.tabId.validator(123)).toBe(false);
      expect(component.props.dashboardId.validator("string")).toBe(true);
      expect(component.props.dashboardId.validator(null)).toBe(true);
      expect(component.props.dashboardId.validator(123)).toBe(false);
    });

    it("should have correct default values", () => {
      wrapper = createWrapper();
      expect(wrapper.props("editMode")).toBe(false);
      expect(wrapper.props("tabId")).toBe(null);
      expect(wrapper.props("open")).toBe(true);
    });

    it("should default 'open' to false when not passed", () => {
      const component = AddTab as any;
      expect(component.props.open.default).toBe(false);
      expect(component.props.open.type).toBe(Boolean);
    });
  });

  describe("Form Elements", () => {
    it("should render form with name input", () => {
      wrapper = createWrapper();
      expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-tab-name"]').exists()).toBe(true);
    });

    it("should mark the name field required (renders the *)", () => {
      wrapper = createWrapper();
      const input = wrapper.findComponent({ name: "OFormInput" });
      expect(input.props("required")).toBe(true);
    });

    it("should pass a Zod schema to OForm (no per-field validators)", () => {
      wrapper = createWrapper();
      expect(wrapper.findComponent({ name: "OForm" }).props("schema")).toBeDefined();
    });

    it("should seed blank default-values into OForm in add mode", () => {
      wrapper = createWrapper();
      expect(
        wrapper.findComponent({ name: "OForm" }).props("defaultValues"),
      ).toEqual({ name: "" });
    });

    it("should expose primary (Save) and secondary (Cancel) buttons via ODialog", () => {
      wrapper = createWrapper();
      const dialog = findDialog(wrapper);
      expect(dialog.props("primaryButtonLabel")).toBe("Save");
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
    });

    it("should pass form-id to ODialog for enter-key submission", () => {
      wrapper = createWrapper();
      expect(findDialog(wrapper).props("formId")).toBe("add-tab-form");
    });
  });

  describe("Add Tab Functionality", () => {
    it("should call addTab utility with the submitted value in add mode", async () => {
      wrapper = createWrapper();
      await wrapper.vm.onSubmit({ name: "New Tab" });

      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
        { name: "New Tab", panels: [] },
      );
    });

    it("should call addTab when the OForm emits submit", async () => {
      wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      await form.vm.$emit("submit", { name: "From Primary" });
      await flushPromises();

      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
        { name: "From Primary", panels: [] },
      );
    });

    it("should emit refresh event after successful add", async () => {
      wrapper = createWrapper();
      await wrapper.vm.onSubmit({ name: "New Tab" });

      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")![0][0]).toEqual({
        tabId: "new-tab",
        name: "New Tab",
      });
    });

    it("should emit update:open(false) after successful add", async () => {
      wrapper = createWrapper();
      await wrapper.vm.onSubmit({ name: "New Tab" });

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen![updateOpen!.length - 1][0]).toBe(false);
    });

    it("should show success notification after add", async () => {
      wrapper = createWrapper();
      await wrapper.vm.onSubmit({ name: "New Tab" });

      expect(mockShowPositiveNotification).toHaveBeenCalledWith(
        "Tab added successfully",
      );
    });
  });

  describe("Edit Tab Functionality", () => {
    it("should load dashboard data in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1", open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();

      expect(mockGetDashboard).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
      );
    });

    it("should call editTab utility with the submitted value in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1", open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();

      // editingTab is now { tabId: "tab1", name: "Tab 1", panels: [] } from the
      // async fetch; the submitted value supplies the new name.
      await wrapper.vm.onSubmit({ name: "Updated Tab" });

      expect(mockEditTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
        "tab1",
        { tabId: "tab1", name: "Updated Tab", panels: [] },
      );
    });

    it("should prefill the form from the loaded tab in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1", open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();

      // The OForm is seeded from the externally-loaded record (no local mirror):
      // editingTab holds the fetched tab and `:default-values` projects its name.
      expect(wrapper.vm.editingTab).toEqual({
        tabId: "tab1",
        name: "Tab 1",
        panels: [],
      });
      expect(wrapper.vm.addTabDefaults).toEqual({ name: "Tab 1" });
    });

    it("should emit refresh event after successful edit", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      wrapper.vm.editingTab = { tabId: "tab1", name: "Updated Tab", panels: [] };
      await wrapper.vm.onSubmit({ name: "Updated Tab" });

      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")![0][0]).toEqual({
        tabId: "edit-tab",
        name: "Edited Tab",
      });
    });

    it("should show success notification after edit", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      wrapper.vm.editingTab = { tabId: "tab1", name: "Updated Tab", panels: [] };
      await wrapper.vm.onSubmit({ name: "Updated Tab" });

      expect(mockShowPositiveNotification).toHaveBeenCalledWith(
        "Tab updated successfully",
      );
    });
  });

  describe("Dialog Interactions", () => {
    it("should emit update:open(false) when secondary (Cancel) is clicked", async () => {
      wrapper = createWrapper();
      await findDialog(wrapper).vm.$emit("click:secondary");

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen![0][0]).toBe(false);
    });

    it("should not call addTab when secondary (Cancel) is clicked", async () => {
      wrapper = createWrapper();
      await findDialog(wrapper).vm.$emit("click:secondary");
      expect(mockAddTab).not.toHaveBeenCalled();
    });

    it("should forward update:open from ODialog to its parent", async () => {
      wrapper = createWrapper();
      await findDialog(wrapper).vm.$emit("update:open", false);

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen![0][0]).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should not call addTab before any submission is triggered", () => {
      wrapper = createWrapper();
      expect(mockAddTab).not.toHaveBeenCalled();
    });

    it("should handle 409 conflict errors", async () => {
      wrapper = createWrapper();
      mockAddTab.mockRejectedValue({
        response: { status: 409, data: { message: "Tab already exists" } },
      });

      await wrapper.vm.onSubmit({ name: "Test Tab" });

      expect(mockShowConflictErrorNotification).toHaveBeenCalledWith(
        "Tab already exists",
      );
    });

    it("should handle general errors", async () => {
      wrapper = createWrapper();
      mockAddTab.mockRejectedValue(new Error("Network error"));

      await wrapper.vm.onSubmit({ name: "Test Tab" });

      expect(mockShowErrorNotification).toHaveBeenCalledWith("Network error", {
        timeout: 2000,
      });
    });

    it("should handle errors without message in add mode", async () => {
      wrapper = createWrapper();
      mockAddTab.mockRejectedValue({});

      await wrapper.vm.onSubmit({ name: "Test Tab" });

      expect(mockShowErrorNotification).toHaveBeenCalledWith("Failed to add tab", {
        timeout: 2000,
      });
    });

    it("should handle errors without message in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      wrapper.vm.editingTab = { tabId: "tab1", name: "Test Tab", panels: [] };
      mockEditTab.mockRejectedValue({});

      await wrapper.vm.onSubmit({ name: "Test Tab" });

      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        "Failed to update tab",
        { timeout: 2000 },
      );
    });
  });

  describe("Folder Handling", () => {
    it("should use folderId prop when provided", async () => {
      wrapper = createWrapper({ folderId: "custom-folder" });
      await wrapper.vm.onSubmit({ name: "Test Tab" });

      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "custom-folder",
        { name: "Test Tab", panels: [] },
      );
    });

    it("should fall back to route query folder", async () => {
      wrapper = createWrapper();
      await wrapper.vm.onSubmit({ name: "Test Tab" });

      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
        { name: "Test Tab", panels: [] },
      );
    });

    it("should use default folder when no folder specified", async () => {
      const originalQuery = mockRoute.query;
      mockRoute.query = {};

      wrapper = createWrapper();
      await wrapper.vm.onSubmit({ name: "Test Tab" });

      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "default",
        { name: "Test Tab", panels: [] },
      );

      mockRoute.query = originalQuery;
    });
  });

  describe("Component Methods", () => {
    it("should have correct setup return values", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.addTabSchema).toBeDefined();
      expect(wrapper.vm.addTabDefaults).toBeDefined();
      expect("editingTab" in wrapper.vm).toBe(true);
      expect(wrapper.vm.addTabForm).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(typeof wrapper.vm.onSubmit).toBe("function");
    });
  });

  describe("Component Lifecycle", () => {
    it("should load dashboard data on open in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1", open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();
      expect(mockGetDashboard).toHaveBeenCalled();
    });

    it("should not load dashboard data in add mode", () => {
      wrapper = createWrapper();
      expect(mockGetDashboard).not.toHaveBeenCalled();
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Event Emissions", () => {
    it("should have correct emits configuration", () => {
      const component = AddTab as any;
      expect(component.emits).toContain("refresh");
      expect(component.emits).toContain("update:open");
    });

    it("should emit refresh with correct payload", async () => {
      wrapper = createWrapper();
      await wrapper.vm.onSubmit({ name: "Test Tab" });

      const refreshEvents = wrapper.emitted("refresh");
      expect(refreshEvents).toBeTruthy();
      expect(refreshEvents![0][0]).toEqual({ tabId: "new-tab", name: "New Tab" });
    });
  });

  describe("Internationalization", () => {
    it("should use i18n for translations", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.t("dashboard.nameRequired")).toBe("Name is required");
    });
  });
});
