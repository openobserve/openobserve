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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import AlertWizardRightColumn from "./AlertWizardRightColumn.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("./PreviewAlert.vue", () => ({
  default: {
    name: "PreviewAlert",
    template: "<div data-test='mock-preview-alert'></div>",
    props: [
      "formData",
      "query",
      "selectedTab",
      "isAggregationEnabled",
      "isUsingBackendSql",
      "isEditorOpen",
    ],
    expose: ["refreshData", "resizeChart", "evaluationStatus"],
    setup() {
      return { refreshData: vi.fn(), resizeChart: vi.fn(), evaluationStatus: null };
    },
  },
}));

vi.mock("./AlertSummary.vue", () => ({
  default: {
    name: "AlertSummary",
    template: "<div data-test='mock-alert-summary'></div>",
    props: [
      "formData",
      "destinations",
      "focusManager",
      "wizardStep",
      "previewQuery",
      "generatedSqlQuery",
    ],
  },
}));

const baseFormData = () => ({
  name: "Test Alert",
  stream_type: "logs",
  stream_name: "test-stream",
  is_real_time: "false",
  query_condition: {
    type: "custom",
    aggregation: {
      group_by: [""],
      function: "avg",
      having: { column: "", operator: ">=", value: 1 },
    },
  },
  trigger_condition: { period: 10 },
  destinations: [],
});

async function mountComp(props: Record<string, any> = {}) {
  localStorage.clear();
  return mount(AlertWizardRightColumn, {
    global: {
      plugins: [i18n, store],
    },
    props: {
      formData: baseFormData(),
      previewQuery: "SELECT * FROM test",
      generatedSqlQuery: "",
      selectedTab: "custom",
      isAggregationEnabled: false,
      destinations: [],
      focusManager: {},
      wizardStep: 1,
      isUsingBackendSql: false,
      isEditorOpen: false,
      ...props,
    },
  });
}

describe("AlertWizardRightColumn - rendering", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
    localStorage.clear();
  });

  it("renders without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the PreviewAlert child", () => {
    expect(wrapper.find('[data-test="mock-preview-alert"]').exists()).toBe(true);
  });

  it("renders the AlertSummary child", () => {
    expect(wrapper.find('[data-test="mock-alert-summary"]').exists()).toBe(true);
  });
});

describe("AlertWizardRightColumn - initial state", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("initializes expandState.preview to true by default", async () => {
    const w = await mountComp();
    expect(w.vm.expandState.preview).toBe(true);
    w.unmount();
  });

  it("initializes expandState.summary to true by default", async () => {
    const w = await mountComp();
    expect(w.vm.expandState.summary).toBe(true);
    w.unmount();
  });

  it("loads saved expandState from localStorage", async () => {
    // Mount without clearing localStorage first
    localStorage.setItem("alertWizardExpandState", JSON.stringify({ preview: false, summary: true }));
    const w = mount(AlertWizardRightColumn, {
      global: { plugins: [i18n, store] },
      props: {
        formData: baseFormData(),
        previewQuery: "",
        wizardStep: 1,
      },
    });
    expect(w.vm.expandState.preview).toBe(false);
    expect(w.vm.expandState.summary).toBe(true);
    w.unmount();
  });

  it("falls back to defaults when localStorage is corrupt JSON", async () => {
    localStorage.setItem("alertWizardExpandState", "not-json-{{{");
    const w = await mountComp();
    expect(w.vm.expandState.preview).toBe(true);
    expect(w.vm.expandState.summary).toBe(true);
    w.unmount();
  });
});

describe("AlertWizardRightColumn - props", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("accepts all props", async () => {
    const w = await mountComp();
    expect(w.props("previewQuery")).toBe("SELECT * FROM test");
    expect(w.props("selectedTab")).toBe("custom");
    expect(w.props("wizardStep")).toBe(1);
    w.unmount();
  });

  it("has default values for optional props", async () => {
    const w = await mountComp();
    expect(w.props("generatedSqlQuery")).toBe("");
    expect(w.props("isAggregationEnabled")).toBe(false);
    expect(w.props("destinations")).toEqual([]);
    expect(w.props("isUsingBackendSql")).toBe(false);
    w.unmount();
  });

  it("passes formData to PreviewAlert", async () => {
    const w = await mountComp();
    const preview = w.findComponent({ name: "PreviewAlert" });
    expect(preview.props("formData")).toEqual(baseFormData());
    w.unmount();
  });

  it("passes previewQuery to PreviewAlert", async () => {
    const w = await mountComp();
    const preview = w.findComponent({ name: "PreviewAlert" });
    expect(preview.props("query")).toBe("SELECT * FROM test");
    w.unmount();
  });

  it("passes isUsingBackendSql to PreviewAlert", async () => {
    const w = await mountComp({ isUsingBackendSql: true });
    const preview = w.findComponent({ name: "PreviewAlert" });
    expect(preview.props("isUsingBackendSql")).toBe(true);
    w.unmount();
  });

  it("passes generatedSqlQuery to AlertSummary", async () => {
    const w = await mountComp({ generatedSqlQuery: "SELECT * FROM generated" });
    const summary = w.findComponent({ name: "AlertSummary" });
    expect(summary.props("generatedSqlQuery")).toBe("SELECT * FROM generated");
    w.unmount();
  });

  it("passes formData to AlertSummary", async () => {
    const w = await mountComp();
    const summary = w.findComponent({ name: "AlertSummary" });
    expect(summary.props("formData")).toEqual(baseFormData());
    w.unmount();
  });
});

describe("AlertWizardRightColumn - togglePreview", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("toggles preview from true to false", async () => {
    const w = await mountComp();
    expect(w.vm.expandState.preview).toBe(true);
    w.vm.togglePreview();
    expect(w.vm.expandState.preview).toBe(false);
    w.unmount();
  });

  it("toggles preview from false to true", async () => {
    localStorage.setItem("alertWizardExpandState", JSON.stringify({ preview: false, summary: true }));
    const w = mount(AlertWizardRightColumn, {
      global: { plugins: [i18n, store] },
      props: { formData: baseFormData(), previewQuery: "", wizardStep: 1 },
    });
    w.vm.togglePreview();
    expect(w.vm.expandState.preview).toBe(true);
    w.unmount();
  });

  it("saves state to localStorage when toggling preview", async () => {
    const w = await mountComp();
    w.vm.togglePreview();
    const saved = JSON.parse(localStorage.getItem("alertWizardExpandState") || "{}");
    expect(saved.preview).toBe(false);
    w.unmount();
  });

  it("handles localStorage.setItem failure gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => { throw new Error("quota exceeded"); });

    const w = await mountComp();
    expect(() => w.vm.togglePreview()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();

    Storage.prototype.setItem = original;
    consoleSpy.mockRestore();
    w.unmount();
  });
});

describe("AlertWizardRightColumn - toggleSummary", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("toggles summary from true to false", async () => {
    const w = await mountComp();
    expect(w.vm.expandState.summary).toBe(true);
    w.vm.toggleSummary();
    expect(w.vm.expandState.summary).toBe(false);
    w.unmount();
  });

  it("toggles summary from false to true", async () => {
    localStorage.setItem("alertWizardExpandState", JSON.stringify({ preview: true, summary: false }));
    const w = mount(AlertWizardRightColumn, {
      global: { plugins: [i18n, store] },
      props: { formData: baseFormData(), previewQuery: "", wizardStep: 1 },
    });
    w.vm.toggleSummary();
    expect(w.vm.expandState.summary).toBe(true);
    w.unmount();
  });

  it("saves state to localStorage when toggling summary", async () => {
    const w = await mountComp();
    w.vm.toggleSummary();
    const saved = JSON.parse(localStorage.getItem("alertWizardExpandState") || "{}");
    expect(saved.summary).toBe(false);
    w.unmount();
  });
});

describe("AlertWizardRightColumn - expand state independence", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("toggling preview does not affect summary state", async () => {
    const w = await mountComp();
    w.vm.togglePreview();
    expect(w.vm.expandState.preview).toBe(false);
    expect(w.vm.expandState.summary).toBe(true);
    w.unmount();
  });

  it("toggling summary does not affect preview state", async () => {
    const w = await mountComp();
    w.vm.toggleSummary();
    expect(w.vm.expandState.preview).toBe(true);
    expect(w.vm.expandState.summary).toBe(false);
    w.unmount();
  });

  it("rapid toggling ends up at odd-count flip from start", async () => {
    const w = await mountComp();
    const initial = w.vm.expandState.preview;
    w.vm.togglePreview();
    w.vm.togglePreview();
    w.vm.togglePreview();
    expect(w.vm.expandState.preview).toBe(!initial);
    w.unmount();
  });
});

describe("AlertWizardRightColumn - computed styles", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("previewSectionStyle has flex:1 when preview is expanded", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = true;
    const style = w.vm.previewSectionStyle;
    expect(style.flex).toBe("1");
    w.unmount();
  });

  it("previewSectionStyle has flex:0 0 auto when preview is collapsed", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = false;
    const style = w.vm.previewSectionStyle;
    expect(style.flex).toBe("0 0 auto");
    w.unmount();
  });

  it("summarySectionStyle has flex:1 when summary is expanded", async () => {
    const w = await mountComp();
    w.vm.expandState.summary = true;
    const style = w.vm.summarySectionStyle;
    expect(style.flex).toBe("1");
    w.unmount();
  });

  it("summarySectionStyle has flex:0 0 auto when summary is collapsed", async () => {
    const w = await mountComp();
    w.vm.expandState.summary = false;
    const style = w.vm.summarySectionStyle;
    expect(style.flex).toBe("0 0 auto");
    w.unmount();
  });

  it("both expanded → both have minHeight:250px", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = true;
    w.vm.expandState.summary = true;
    expect(w.vm.previewSectionStyle.minHeight).toBe("250px");
    expect(w.vm.summarySectionStyle.minHeight).toBe("250px");
    w.unmount();
  });
});

describe("AlertWizardRightColumn - exposed refreshData", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("exposes refreshData method", async () => {
    const w = await mountComp();
    expect(typeof w.vm.refreshData).toBe("function");
    w.unmount();
  });

  it("calls previewAlertRef.refreshData when invoked", async () => {
    const w = await mountComp();
    const mockRefresh = vi.fn();
    w.vm.previewAlertRef = { refreshData: mockRefresh };
    w.vm.refreshData();
    expect(mockRefresh).toHaveBeenCalled();
    w.unmount();
  });

  it("does not throw when previewAlertRef is null", async () => {
    const w = await mountComp();
    w.vm.previewAlertRef = null;
    expect(() => w.vm.refreshData()).not.toThrow();
    w.unmount();
  });

  it("does not throw when previewAlertRef is undefined", async () => {
    const w = await mountComp();
    w.vm.previewAlertRef = undefined;
    expect(() => w.vm.refreshData()).not.toThrow();
    w.unmount();
  });
});

describe("AlertWizardRightColumn - isRealTime computed", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns true when is_real_time is string 'true'", async () => {
    const w = await mountComp({ formData: { ...baseFormData(), is_real_time: "true" } });
    expect(w.vm.isRealTime).toBe(true);
    w.unmount();
  });

  it("returns true when is_real_time is boolean true", async () => {
    const w = await mountComp({ formData: { ...baseFormData(), is_real_time: true } });
    expect(w.vm.isRealTime).toBe(true);
    w.unmount();
  });

  it("returns false when is_real_time is 'false'", async () => {
    const w = await mountComp({ formData: { ...baseFormData(), is_real_time: "false" } });
    expect(w.vm.isRealTime).toBe(false);
    w.unmount();
  });
});

describe("AlertWizardRightColumn - section content visibility (v-show)", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("preview content is visible when expandState.preview is true", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = true;
    await nextTick();
    const content = w.find('[data-test="mock-preview-alert"]');
    expect(content.isVisible()).toBe(true);
    w.unmount();
  });

  it("preview content is hidden when expandState.preview is false", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = false;
    await nextTick();
    const content = w.find('[data-test="mock-preview-alert"]');
    expect(content.isVisible()).toBe(false);
    w.unmount();
  });

  it("summary content is visible when expandState.summary is true", async () => {
    const w = await mountComp();
    w.vm.expandState.summary = true;
    await nextTick();
    const content = w.find('[data-test="mock-alert-summary"]');
    expect(content.isVisible()).toBe(true);
    w.unmount();
  });

  it("summary content is hidden when expandState.summary is false", async () => {
    const w = await mountComp();
    w.vm.expandState.summary = false;
    await nextTick();
    const content = w.find('[data-test="mock-alert-summary"]');
    expect(content.isVisible()).toBe(false);
    w.unmount();
  });
});

describe("AlertWizardRightColumn - icon names in expand toggle buttons", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("preview expand-toggle shows expand-less icon when preview is expanded", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = true;
    await nextTick();
    const icons = w.findAllComponents({ name: "OIcon" });
    const previewToggleIcon = icons.find((i) => {
      const name = i.props("name") as string;
      return name?.includes("expand");
    });
    expect(previewToggleIcon?.props("name")).toMatch(/expand-less/);
    w.unmount();
  });

  it("preview expand-toggle shows expand-more icon when preview is collapsed", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = false;
    await nextTick();
    const icons = w.findAllComponents({ name: "OIcon" });
    // First expand icon found should correspond to preview
    const expandIcon = icons.find((i) => {
      const name = i.props("name") as string;
      return name?.includes("expand");
    });
    expect(expandIcon?.props("name")).toMatch(/expand-more/);
    w.unmount();
  });
});

describe("AlertWizardRightColumn - localStorage persistence", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("persists mixed state (preview=true, summary=false) after toggle + toggle-back", async () => {
    const w = await mountComp();
    w.vm.expandState.summary = false;
    w.vm.togglePreview();
    w.vm.togglePreview(); // back to true

    const saved = JSON.parse(localStorage.getItem("alertWizardExpandState") || "{}");
    expect(saved.preview).toBe(true);
    expect(saved.summary).toBe(false);
    w.unmount();
  });

  it("restores state on remount", async () => {
    // First: set the localStorage state directly, then mount fresh
    localStorage.setItem("alertWizardExpandState", JSON.stringify({ preview: false, summary: true }));

    const w2 = mount(AlertWizardRightColumn, {
      global: { plugins: [i18n, store] },
      props: { formData: baseFormData(), previewQuery: "", wizardStep: 1 },
    });
    expect(w2.vm.expandState.preview).toBe(false);
    expect(w2.vm.expandState.summary).toBe(true);
    w2.unmount();
  });
});

describe("AlertWizardRightColumn - edge cases", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("does not auto-expand preview on wizardStep change", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = false;
    await w.setProps({ wizardStep: 2, selectedTab: "custom" });
    await nextTick();
    expect(w.vm.expandState.preview).toBe(false);
    w.unmount();
  });

  it("maintains expand state across prop updates", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = false;
    w.vm.expandState.summary = false;
    await w.setProps({ previewQuery: "NEW QUERY" });
    await nextTick();
    expect(w.vm.expandState.preview).toBe(false);
    expect(w.vm.expandState.summary).toBe(false);
    w.unmount();
  });

  it("handles formData change without affecting expand state", async () => {
    const w = await mountComp();
    w.vm.expandState.preview = false;
    await w.setProps({ formData: { ...baseFormData(), name: "Updated" } });
    await nextTick();
    expect(w.vm.expandState.preview).toBe(false);
    w.unmount();
  });
});
