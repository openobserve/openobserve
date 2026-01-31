import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import GeneratedQueryDisplay from "./GeneratedQueryDisplay.vue";
import { createI18n } from "vue-i18n";
import { Quasar, copyToClipboard } from "quasar";

// Mock quasar copyToClipboard
vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    useQuasar: () => ({
      notify: vi.fn(),
    }),
  };
});

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      panel: {
        generatedSql: "Generated SQL",
        customSql: "Custom SQL",
        enterCustomSql: "Enter custom SQL...",
      },
      common: {
        copy: "Copy",
        copySuccess: "Copied to clipboard",
        copyError: "Failed to copy",
      },
    },
  },
});

describe("GeneratedQueryDisplay.vue", () => {
  let wrapper: any;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should display generated SQL label when not in custom mode", () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const label = wrapper.find(".query-label");
      expect(label.text()).toBe("Generated SQL");
    });

    it("should display custom SQL label when in custom mode", () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: true,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const label = wrapper.find(".query-label");
      expect(label.text()).toBe("Custom SQL");
    });
  });

  describe("Query Display", () => {
    it("should display query in pre tag when not in custom mode", () => {
      const testQuery = "SELECT COUNT(*) FROM logs GROUP BY level";
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: testQuery,
          isCustomMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const preElement = wrapper.find('[data-test="generated-query-text"]');
      expect(preElement.exists()).toBe(true);
      expect(preElement.text()).toBe(testQuery);
    });

    it("should display textarea when in custom mode", () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: true,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const textarea = wrapper.find('[data-test="custom-query-textarea"]');
      expect(textarea.exists()).toBe(true);
    });

    it("should NOT display textarea when not in custom mode", () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const textarea = wrapper.find('[data-test="custom-query-textarea"]');
      expect(textarea.exists()).toBe(false);
    });
  });

  describe("Expand/Collapse", () => {
    it("should be expanded by default", () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.vm.isExpanded).toBe(true);
    });

    it("should toggle expand state when header is clicked", async () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const header = wrapper.find(".query-header");
      await header.trigger("click");

      expect(wrapper.vm.isExpanded).toBe(false);

      await header.trigger("click");
      expect(wrapper.vm.isExpanded).toBe(true);
    });
  });

  describe("Copy Functionality", () => {
    it("should copy query to clipboard when copy button is clicked", async () => {
      const testQuery = "SELECT * FROM logs WHERE level = 'ERROR'";
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: testQuery,
          isCustomMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const copyBtn = wrapper.find('[data-test="generated-query-copy-btn"]');
      await copyBtn.trigger("click");

      expect(copyToClipboard).toHaveBeenCalledWith(testQuery);
    });

    it("should copy editable query in custom mode", async () => {
      const testQuery = "SELECT * FROM logs";
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: testQuery,
          isCustomMode: true,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      // Modify the editable query
      const textarea = wrapper.find('[data-test="custom-query-textarea"]');
      await textarea.setValue("SELECT COUNT(*) FROM logs");

      const copyBtn = wrapper.find('[data-test="generated-query-copy-btn"]');
      await copyBtn.trigger("click");

      expect(copyToClipboard).toHaveBeenCalledWith("SELECT COUNT(*) FROM logs");
    });
  });

  describe("Query Editing (Custom Mode)", () => {
    it("should emit update:query when textarea content changes", async () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: true,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const textarea = wrapper.find('[data-test="custom-query-textarea"]');
      await textarea.setValue("SELECT COUNT(*) FROM logs");
      await textarea.trigger("input");

      expect(wrapper.emitted("update:query")).toBeTruthy();
      expect(wrapper.emitted("update:query")[0]).toEqual(["SELECT COUNT(*) FROM logs"]);
    });

    it("should update editableQuery when query prop changes", async () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
          isCustomMode: true,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.vm.editableQuery).toBe("SELECT * FROM logs");

      await wrapper.setProps({ query: "SELECT COUNT(*) FROM logs" });
      await nextTick();

      expect(wrapper.vm.editableQuery).toBe("SELECT COUNT(*) FROM logs");
    });
  });

  describe("Props Defaults", () => {
    it("should have default query as empty string", () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          isCustomMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.props("query")).toBe("");
    });

    it("should have default isCustomMode as false", () => {
      wrapper = mount(GeneratedQueryDisplay, {
        props: {
          query: "SELECT * FROM logs",
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.props("isCustomMode")).toBe(false);
    });
  });
});
