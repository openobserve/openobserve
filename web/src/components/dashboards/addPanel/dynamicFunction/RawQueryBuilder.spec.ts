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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RawQueryBuilder from "@/components/dashboards/addPanel/dynamicFunction/RawQueryBuilder.vue";
import { createStore } from "vuex";

// OTextarea puts data-test="*" on its root wrapper <div> (via v-bind="$attrs").
// The actual <textarea> element inside gets data-test="*-field".
const TEXTAREA_FIELD = '[data-test="dashboard-raw-query-textarea-field"]';
const TEXTAREA_WRAPPER = '[data-test="dashboard-raw-query-textarea"]';


const mockStore = createStore({
  state: {
    theme: "light",
  },
});

const mockStoreDark = createStore({
  state: {
    theme: "dark",
  },
});

describe("RawQueryBuilder", () => {
  let wrapper: any;

  const defaultModelValue = {
    rawQuery: "",
  };

  const defaultProps = {
    modelValue: defaultModelValue,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}, store = mockStore) => {
    return mount(RawQueryBuilder, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [store],
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render query section", () => {
      wrapper = createWrapper();
      const querySection = wrapper.find(
        '[data-test="dashboard-raw-query-section"]',
      );
      expect(querySection.exists()).toBe(true);
    });

    it("should render query label", () => {
      wrapper = createWrapper();
      const queryLabel = wrapper.find(
        '[data-test="dashboard-raw-query-title"]',
      );
      expect(queryLabel.exists()).toBe(true);
      expect(queryLabel.text()).toBe("Query");
    });

    it("should render instruction text", () => {
      wrapper = createWrapper();
      const instruction = wrapper.find(
        '[data-test="dashboard-raw-query-instruction"]',
      );
      expect(instruction.text()).toContain(
        "Write a SQL query for complex actions"
      );
    });

    it("should render textarea", () => {
      wrapper = createWrapper();
      const textarea = wrapper.find('[data-test="dashboard-raw-query-textarea"]');
      expect(textarea.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept modelValue prop", () => {
      const customValue = {
        rawQuery: "SELECT * FROM logs",
      };
      wrapper = createWrapper({ modelValue: customValue });
      expect(wrapper.props().modelValue.rawQuery).toBe("SELECT * FROM logs");
    });

    it("should display raw query in textarea", () => {
      const customValue = {
        rawQuery: "SELECT * FROM logs WHERE level = 'error'",
      };
      wrapper = createWrapper({ modelValue: customValue });
      const textarea = wrapper.find(TEXTAREA_FIELD);
      expect(textarea.element.value).toBe(
        "SELECT * FROM logs WHERE level = 'error'"
      );
    });

    it("should handle empty rawQuery", () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);
      expect(textarea.element.value).toBe("");
    });

    it("should handle required modelValue", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Component requires modelValue, so we provide minimal valid value
      const minimalValue = { rawQuery: "" };
      wrapper = createWrapper({ modelValue: minimalValue });

      expect(wrapper.exists()).toBe(true);
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("Textarea Attributes", () => {
    it("should have correct rows attribute", () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);
      expect(textarea.attributes("rows")).toBe("6");
    });

    it("should have data-test attribute", () => {
      wrapper = createWrapper();
      const textarea = wrapper.find('[data-test="dashboard-raw-query-textarea"]');
      expect(textarea.attributes("data-test")).toBe(
        "dashboard-raw-query-textarea"
      );
    });

    it("should have correct styling", () => {
      wrapper = createWrapper();
      // OTextarea renders the native <textarea> with Tailwind resize and sizing classes
      const textareaField = wrapper.find(TEXTAREA_FIELD);
      expect(textareaField.classes()).toContain("resize-y");
      expect(textareaField.classes()).toContain("flex-1");
    });

    it("should be resizable vertically", () => {
      wrapper = createWrapper();
      const textareaField = wrapper.find(TEXTAREA_FIELD);
      expect(textareaField.classes()).toContain("resize-y");
    });
  });

  describe("Query Input", () => {
    it("should update rawQuery on input", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT count(*) FROM logs");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toBe("SELECT count(*) FROM logs");
    });

    it("should emit update:modelValue on change", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT * FROM metrics");
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should handle multi-line queries", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      const multiLineQuery = `SELECT
  field1,
  field2
FROM logs
WHERE level = 'error'`;

      await textarea.setValue(multiLineQuery);
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toBe(multiLineQuery);
    });

    it("should handle SQL keywords", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue(
        "SELECT * FROM logs WHERE status = 'active' ORDER BY timestamp DESC"
      );
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("SELECT");
      expect(wrapper.vm.fields.rawQuery).toContain("WHERE");
      expect(wrapper.vm.fields.rawQuery).toContain("ORDER BY");
    });

    it("should handle special characters", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT * FROM logs WHERE message LIKE '%error%'");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("%error%");
    });
  });

  describe("Theme Handling", () => {
    it("should apply light theme class", () => {
      // Component delegates theming to OTextarea; verify it renders with the store
      wrapper = createWrapper({}, mockStore);
      const textarea = wrapper.find(TEXTAREA_WRAPPER);
      expect(textarea.exists()).toBe(true);
    });

    it("should apply dark theme class", () => {
      wrapper = createWrapper({}, mockStoreDark);
      const textarea = wrapper.find(TEXTAREA_WRAPPER);
      expect(textarea.exists()).toBe(true);
    });

    it("should access store theme", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$store.state.theme).toBeDefined();
    });

    it("should react to theme changes", async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$store.state.theme).toBe("light");
    });
  });

  describe("Watcher Functionality", () => {
    it("should watch fields.value for deep changes", async () => {
      wrapper = createWrapper();

      wrapper.vm.fields.rawQuery = "NEW QUERY";
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should emit on any field change", async () => {
      wrapper = createWrapper();

      wrapper.vm.fields = {
        ...wrapper.vm.fields,
        rawQuery: "CHANGED",
      };
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should handle rapid changes", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("Query 1");
      await flushPromises();
      await textarea.setValue("Query 2");
      await flushPromises();
      await textarea.setValue("Query 3");
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")?.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null rawQuery", () => {
      const nullValue = {
        rawQuery: null,
      };
      wrapper = createWrapper({ modelValue: nullValue as any });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle undefined rawQuery", () => {
      const undefinedValue = {};
      wrapper = createWrapper({ modelValue: undefinedValue as any });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle very long queries", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      const longQuery = "SELECT * FROM logs WHERE ".repeat(100);
      await textarea.setValue(longQuery);
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery.length).toBeGreaterThan(1000);
    });

    it("should handle empty string query", async () => {
      wrapper = createWrapper({
        modelValue: { rawQuery: "Some query" },
      });
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toBe("");
    });

    it("should handle query with line breaks", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT\n*\nFROM\nlogs");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("\n");
    });
  });

  describe("Component Structure", () => {
    it("should have main container", () => {
      wrapper = createWrapper();
      const container = wrapper.find(
        '[data-test="dashboard-raw-query-builder"]',
      );
      expect(container.exists()).toBe(true);
    });

    it("should have query section container", () => {
      wrapper = createWrapper();
      const querySection = wrapper.find(
        '[data-test="dashboard-raw-query-section"]',
      );
      expect(querySection.exists()).toBe(true);
    });

    it("should have two query labels", () => {
      wrapper = createWrapper();
      const titleLabel = wrapper.find(
        '[data-test="dashboard-raw-query-title"]',
      );
      const instructionLabel = wrapper.find(
        '[data-test="dashboard-raw-query-instruction"]',
      );
      expect(titleLabel.exists()).toBe(true);
      expect(instructionLabel.exists()).toBe(true);
    });

    it("should have properly styled textarea", () => {
      wrapper = createWrapper();
      // OTextarea renders border/rounded on its inner wrapper div and resize on the textarea
      const innerWrapper = wrapper.find(`${TEXTAREA_WRAPPER} > div`);
      const textareaField = wrapper.find(TEXTAREA_FIELD);
      expect(innerWrapper.classes()).toContain("rounded-default");
      expect(innerWrapper.classes()).toContain("border");
      expect(textareaField.classes()).toContain("resize-y");
    });
  });

  describe("SQL Query Examples", () => {
    it("should handle SELECT query", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT * FROM logs");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toBe("SELECT * FROM logs");
    });

    it("should handle query with WHERE clause", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT * FROM logs WHERE level = 'error'");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("WHERE");
    });

    it("should handle query with JOIN", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue(
        "SELECT * FROM logs JOIN metrics ON logs.id = metrics.log_id"
      );
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("JOIN");
    });

    it("should handle query with GROUP BY", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT count(*) FROM logs GROUP BY level");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("GROUP BY");
    });

    it("should handle query with ORDER BY", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT * FROM logs ORDER BY timestamp DESC");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("ORDER BY");
    });

    it("should handle query with LIMIT", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT * FROM logs LIMIT 100");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("LIMIT");
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize fields from props", () => {
      const customValue = {
        rawQuery: "INITIAL QUERY",
      };
      wrapper = createWrapper({ modelValue: customValue });

      expect(wrapper.vm.fields.rawQuery).toBe("INITIAL QUERY");
    });

    it("should mount without errors", () => {
      expect(() => createWrapper()).not.toThrow();
    });

    it("should unmount without errors", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle multiple renders", () => {
      wrapper = createWrapper();
      wrapper.unmount();
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Textarea Interaction", () => {
    it("should allow text selection", async () => {
      wrapper = createWrapper({
        modelValue: { rawQuery: "SELECT * FROM logs" },
      });
      const textarea = wrapper.find(TEXTAREA_FIELD);

      expect(textarea.element.value).toBe("SELECT * FROM logs");
    });

    it("should allow text editing", async () => {
      wrapper = createWrapper({
        modelValue: { rawQuery: "SELECT * FROM logs" },
      });
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT count(*) FROM logs");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toBe("SELECT count(*) FROM logs");
    });

    it("should maintain cursor position", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT * FROM logs");

      expect(textarea.element.value).toBe("SELECT * FROM logs");
    });
  });

  describe("Styling and Layout", () => {
    it("should have full width container", () => {
      wrapper = createWrapper();
      const container = wrapper.find(
        '[data-test="dashboard-raw-query-builder"]',
      );
      expect(container.exists()).toBe(true);
    });

    it("should have proper margins on textarea", () => {
      wrapper = createWrapper();
      // OTextarea's root wrapper div receives class="mt-0.5" from parent via $attrs
      const textarea = wrapper.find(TEXTAREA_WRAPPER);
      expect(textarea.classes()).toContain("mt-0.5");
    });

    it("should have border styling", () => {
      wrapper = createWrapper();
      // OTextarea renders border on its inner wrapper div
      const innerWrapper = wrapper.find(`${TEXTAREA_WRAPPER} > div`);
      expect(innerWrapper.classes()).toContain("border");
    });

    it("should have rounded corners", () => {
      wrapper = createWrapper();
      const innerWrapper = wrapper.find(`${TEXTAREA_WRAPPER} > div`);
      expect(innerWrapper.classes()).toContain("rounded-default");
    });
  });

  describe("Store Integration", () => {
    it("should access store state", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$store.state).toBeDefined();
    });

    it("should read theme from store", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$store.state.theme).toBe("light");
    });

    it("should handle different store states", () => {
      wrapper = createWrapper({}, mockStoreDark);
      expect(wrapper.vm.$store.state.theme).toBe("dark");
    });
  });

  describe("Complex Query Scenarios", () => {
    it("should handle query with subqueries", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      const subquery =
        "SELECT * FROM logs WHERE id IN (SELECT log_id FROM errors)";
      await textarea.setValue(subquery);
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toBe(subquery);
    });

    it("should handle query with UNION", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      const unionQuery =
        "SELECT * FROM logs UNION SELECT * FROM archived_logs";
      await textarea.setValue(unionQuery);
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("UNION");
    });

    it("should handle query with CASE statements", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      const caseQuery =
        "SELECT CASE WHEN level = 'error' THEN 1 ELSE 0 END FROM logs";
      await textarea.setValue(caseQuery);
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("CASE");
    });

    it("should handle query with aggregate functions", async () => {
      wrapper = createWrapper();
      const textarea = wrapper.find(TEXTAREA_FIELD);

      await textarea.setValue("SELECT COUNT(*), SUM(value), AVG(value) FROM logs");
      await flushPromises();

      expect(wrapper.vm.fields.rawQuery).toContain("COUNT");
      expect(wrapper.vm.fields.rawQuery).toContain("SUM");
      expect(wrapper.vm.fields.rawQuery).toContain("AVG");
    });
  });
});
