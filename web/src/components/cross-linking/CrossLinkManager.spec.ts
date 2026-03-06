import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { nextTick } from "vue";

import CrossLinkManager from "./CrossLinkManager.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("./CrossLinkDialog.vue", () => ({
  default: {
    name: "CrossLinkDialog",
    template:
      '<div data-test="cross-link-dialog"><slot /></div>',
    props: ["modelValue", "link", "availableFields"],
    emits: ["update:modelValue", "save", "cancel"],
  },
}));

installQuasar();

describe("CrossLinkManager Component", () => {
  let wrapper: any;

  const sampleLinks = [
    {
      name: "View Trace",
      url: "https://example.com/trace/${trace_id}",
      fields: [{ name: "trace_id" }],
    },
    {
      name: "View Logs",
      url: "https://logs.example.com/${service}",
      fields: [{ name: "service" }],
    },
  ];

  const defaultProps = {
    modelValue: [],
    title: "Cross-Links",
    subtitle: "",
    readonly: false,
    availableFields: ["trace_id", "service", "host"],
  };

  const createWrapper = (props = {}) => {
    return mount(CrossLinkManager, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: {
          "q-btn": {
            template:
              '<button @click="$emit(\'click\')" :data-test="$attrs[\'data-test\']" :disabled="$attrs.disable"><slot />{{ $attrs.label }}</button>',
            emits: ["click"],
          },
          "q-chip": {
            template:
              '<span class="q-chip"><slot /></span>',
          },
          "q-badge": {
            template:
              '<span class="q-badge">{{ $attrs.label }}</span>',
          },
        },
      },
    });
  };

  beforeEach(() => {
    store.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("CrossLinkManager");
    });

    it("should accept all props", () => {
      wrapper = createWrapper({
        modelValue: sampleLinks,
        title: "My Links",
        subtitle: "Some subtitle",
        readonly: false,
        availableFields: ["field1"],
      });

      expect(wrapper.props("modelValue")).toEqual(sampleLinks);
      expect(wrapper.props("title")).toBe("My Links");
      expect(wrapper.props("subtitle")).toBe("Some subtitle");
      expect(wrapper.props("readonly")).toBe(false);
      expect(wrapper.props("availableFields")).toEqual(["field1"]);
    });
  });

  describe("Props Default Values", () => {
    it("should default title to 'Cross-Links'", () => {
      wrapper = createWrapper({ title: undefined });
      expect(wrapper.vm.$options.props.title.default).toBe("Cross-Links");
    });

    it("should default subtitle to empty string", () => {
      wrapper = createWrapper({ subtitle: undefined });
      expect(wrapper.vm.$options.props.subtitle.default).toBe("");
    });

    it("should default readonly to false", () => {
      wrapper = createWrapper({ readonly: undefined });
      expect(wrapper.vm.$options.props.readonly.default).toBe(false);
    });

    it("should default modelValue to empty array", () => {
      expect(typeof wrapper?.vm?.$options.props.modelValue.default).toBe(
        "function",
      );
    });
  });

  describe("Rendering Links List", () => {
    it("should render all links", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      const items = wrapper.findAll('[data-test^="cross-link-item-"]');
      expect(items.length).toBe(2);
    });

    it("should display link names", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      expect(wrapper.text()).toContain("View Trace");
      expect(wrapper.text()).toContain("View Logs");
    });

    it("should display link URLs", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      expect(wrapper.text()).toContain(
        "https://example.com/trace/${trace_id}",
      );
    });

    it("should display field chips", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      const chips = wrapper.findAll(".q-chip");
      expect(chips.length).toBeGreaterThan(0);
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no links", () => {
      wrapper = createWrapper({ modelValue: [] });
      const empty = wrapper.find('[data-test="cross-link-empty"]');
      expect(empty.exists()).toBe(true);
      expect(empty.text()).toContain("No cross-links configured");
    });

    it("should hide links list when empty", () => {
      wrapper = createWrapper({ modelValue: [] });
      const list = wrapper.find('[data-test="cross-link-list"]');
      expect(list.exists()).toBe(false);
    });
  });

  describe("Title and Subtitle", () => {
    it("should render title", () => {
      wrapper = createWrapper({ title: "My Cross-Links" });
      expect(wrapper.text()).toContain("My Cross-Links");
    });

    it("should render subtitle when provided", () => {
      wrapper = createWrapper({ subtitle: "Some description" });
      expect(wrapper.text()).toContain("Some description");
    });

    it("should hide subtitle when empty", () => {
      wrapper = createWrapper({ subtitle: "" });
      const subtitleElements = wrapper.findAll(".tw\\:text-xs");
      const hasSubtitle = subtitleElements.some(
        (el: any) => el.text().length > 0 && !el.text().includes("Show link"),
      );
      expect(hasSubtitle).toBe(false);
    });
  });

  describe("Add Button Visibility", () => {
    it("should show add button when not readonly", () => {
      wrapper = createWrapper({ readonly: false });
      const addBtn = wrapper.find('[data-test="add-cross-link-btn"]');
      expect(addBtn.exists()).toBe(true);
    });

    it("should hide add button when readonly", () => {
      wrapper = createWrapper({ readonly: true });
      const addBtn = wrapper.find('[data-test="add-cross-link-btn"]');
      expect(addBtn.exists()).toBe(false);
    });
  });

  describe("Edit/Delete Button Visibility", () => {
    it("should show edit and delete buttons when not readonly", () => {
      wrapper = createWrapper({ modelValue: sampleLinks, readonly: false });
      const editBtn = wrapper.find('[data-test="cross-link-edit-0"]');
      const deleteBtn = wrapper.find('[data-test="cross-link-delete-0"]');
      expect(editBtn.exists()).toBe(true);
      expect(deleteBtn.exists()).toBe(true);
    });

    it("should hide edit and delete buttons when readonly", () => {
      wrapper = createWrapper({ modelValue: sampleLinks, readonly: true });
      const editBtn = wrapper.find('[data-test="cross-link-edit-0"]');
      const deleteBtn = wrapper.find('[data-test="cross-link-delete-0"]');
      expect(editBtn.exists()).toBe(false);
      expect(deleteBtn.exists()).toBe(false);
    });
  });

  describe("onAddClick", () => {
    it("should open dialog", () => {
      wrapper = createWrapper();
      wrapper.vm.onAddClick();

      expect(wrapper.vm.showAddDialog).toBe(true);
    });

    it("should clear editing link", () => {
      wrapper = createWrapper();
      wrapper.vm.editingLink = { name: "old", url: "", fields: [] };
      wrapper.vm.onAddClick();

      expect(wrapper.vm.editingLink).toBeNull();
    });
  });

  describe("editLink", () => {
    it("should open dialog with link copy", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      wrapper.vm.editLink(sampleLinks[0]);

      expect(wrapper.vm.showAddDialog).toBe(true);
      expect(wrapper.vm.editingLink).toEqual(sampleLinks[0]);
      expect(wrapper.vm.editingLink).not.toBe(sampleLinks[0]);
    });
  });

  describe("removeLink", () => {
    it("should emit update:modelValue without the removed link", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      wrapper.vm.removeLink(sampleLinks[0]);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toEqual([
        sampleLinks[1],
      ]);
    });

    it("should emit change event", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      wrapper.vm.removeLink(sampleLinks[0]);

      expect(wrapper.emitted("change")).toBeTruthy();
    });
  });

  describe("onSaveLink - Adding New Link", () => {
    it("should emit update:modelValue with appended link", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      const newLink = {
        name: "New Link",
        url: "https://new.com",
        fields: [],
      };

      wrapper.vm.onSaveLink(newLink);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      const emitted = wrapper.emitted("update:modelValue")[0][0];
      expect(emitted).toHaveLength(3);
      expect(emitted[2]).toEqual(newLink);
    });

    it("should emit change event", () => {
      wrapper = createWrapper({ modelValue: [] });
      wrapper.vm.onSaveLink({
        name: "New",
        url: "https://new.com",
        fields: [],
      });

      expect(wrapper.emitted("change")).toBeTruthy();
    });

    it("should close dialog after save", () => {
      wrapper = createWrapper({ modelValue: [] });
      wrapper.vm.showAddDialog = true;
      wrapper.vm.onSaveLink({
        name: "New",
        url: "https://new.com",
        fields: [],
      });

      expect(wrapper.vm.showAddDialog).toBe(false);
    });

    it("should clear editing state after save", () => {
      wrapper = createWrapper({ modelValue: [] });
      wrapper.vm.onSaveLink({
        name: "New",
        url: "https://new.com",
        fields: [],
      });

      expect(wrapper.vm.editingLink).toBeNull();
    });
  });

  describe("onSaveLink - Editing Existing Link", () => {
    it("should emit update:modelValue with updated link at same index", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      wrapper.vm.editLink(sampleLinks[0]);

      const updatedLink = {
        name: "Updated Trace",
        url: "https://updated.com/trace/${trace_id}",
        fields: [{ name: "trace_id" }],
      };

      wrapper.vm.onSaveLink(updatedLink);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      const emitted = wrapper.emitted("update:modelValue")[0][0];
      expect(emitted).toHaveLength(2);
      expect(emitted[0]).toEqual(updatedLink);
      expect(emitted[1]).toEqual(sampleLinks[1]);
    });

    it("should append if original name not found", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      wrapper.vm.editLink({ name: "nonexistent", url: "", fields: [] });

      const newLink = {
        name: "Brand New",
        url: "https://new.com",
        fields: [],
      };
      wrapper.vm.onSaveLink(newLink);

      const emitted = wrapper.emitted("update:modelValue")[0][0];
      expect(emitted).toHaveLength(3);
    });
  });

  describe("Links Computed Property", () => {
    it("should reflect modelValue", () => {
      wrapper = createWrapper({ modelValue: sampleLinks });
      expect(wrapper.vm.links).toEqual(sampleLinks);
    });

    it("should be empty when modelValue is empty", () => {
      wrapper = createWrapper({ modelValue: [] });
      expect(wrapper.vm.links).toEqual([]);
    });

    it("should update when modelValue changes", async () => {
      wrapper = createWrapper({ modelValue: [] });
      expect(wrapper.vm.links).toEqual([]);

      await wrapper.setProps({ modelValue: sampleLinks });
      expect(wrapper.vm.links).toEqual(sampleLinks);
    });
  });
});
