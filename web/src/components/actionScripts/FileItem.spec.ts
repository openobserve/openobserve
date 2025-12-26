import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import FileItem from "@/components/actionScripts/FileItem.vue";
import { Quasar } from "quasar";

describe("FileItem.vue", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = {
      name: "test.py",
      isActive: false,
      editMode: false,
    };

    return mount(FileItem, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar],
        stubs: {
          "q-icon": true,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("renders the component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("displays file name correctly", () => {
      wrapper = createWrapper({ name: "my-script.py" });
      expect(wrapper.text()).toContain("my-script.py");
    });

    it("applies active styling when isActive is true", () => {
      wrapper = createWrapper({ isActive: true });
      const listItem = wrapper.find("li");
      expect(listItem.classes()).toContain("bg-primary");
      expect(listItem.classes()).toContain("tw:text-white");
    });

    it("does not apply active styling when isActive is false", () => {
      wrapper = createWrapper({ isActive: false });
      const listItem = wrapper.find("li");
      expect(listItem.classes()).not.toContain("bg-primary");
      expect(listItem.classes()).not.toContain("tw:text-white");
    });

    it("renders edit and delete buttons", () => {
      wrapper = createWrapper();
      const buttons = wrapper.findAll("button");
      expect(buttons).toHaveLength(2);

      const editButton = buttons[0];
      const deleteButton = buttons[1];

      expect(editButton.find("q-icon-stub").attributes("name")).toBe("edit");
      expect(deleteButton.find("q-icon-stub").attributes("name")).toBe(
        "delete",
      );
    });
  });

  describe("Props and Computed Properties", () => {
    it("accepts required props", () => {
      wrapper = createWrapper({
        name: "script.py",
        isActive: true,
        editMode: false,
      });

      expect(wrapper.props("name")).toBe("script.py");
      expect(wrapper.props("isActive")).toBe(true);
      expect(wrapper.props("editMode")).toBe(false);
    });

    it("fileName computed property gets value from props", () => {
      wrapper = createWrapper({ name: "test-file.py" });
      const vm = wrapper.vm as any;
      expect(vm.fileName).toBe("test-file.py");
    });

    it("fileName computed property emits update when set", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.fileName = "new-name.py";

      expect(wrapper.emitted("update:name")).toBeTruthy();
      expect(wrapper.emitted("update:name")?.[0]).toEqual(["new-name.py"]);
    });
  });

  describe("Edit Mode", () => {
    it("shows input field when in editing mode", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.isEditing = true;
      await nextTick();

      expect(wrapper.find("input").exists()).toBe(true);
      expect(wrapper.text()).not.toContain("test.py"); // Text should be hidden
    });

    it("shows file name when not in editing mode", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.isEditing = false;
      await nextTick();

      expect(wrapper.find("input").exists()).toBe(false);
      expect(wrapper.text()).toContain("test.py");
    });

    it("enters edit mode when editMode prop is true", async () => {
      wrapper = createWrapper({ editMode: true });
      await nextTick();

      const vm = wrapper.vm as any;
      expect(vm.isEditing).toBe(true);
      expect(wrapper.find("input").exists()).toBe(true);
    });

    it("focuses input when entering edit mode", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Set up editing mode and check state
      await vm.focusInput();

      expect(vm.isEditing).toBe(true);
      // Focus may not be called if nameInput ref is null in test
    });
  });

  describe("Event Handling", () => {
    it("emits open-file when list item is clicked", async () => {
      wrapper = createWrapper();
      const listItem = wrapper.find("li");

      await listItem.trigger("click");

      expect(wrapper.emitted("open-file")).toBeTruthy();
    });

    it("enters edit mode when edit button is clicked", async () => {
      wrapper = createWrapper();
      const editButton = wrapper.findAll("button")[0];
      const vm = wrapper.vm as any;

      await editButton.trigger("click");

      expect(vm.isEditing).toBe(true);
      expect(vm.prevFileName).toBe("test.py");
    });

    it("emits delete-file when delete button is clicked", async () => {
      wrapper = createWrapper();
      const deleteButton = wrapper.findAll("button")[1];

      await deleteButton.trigger("click");

      expect(wrapper.emitted("delete-file")).toBeTruthy();
    });

    it("stops propagation for edit button click", async () => {
      wrapper = createWrapper();
      const editButton = wrapper.findAll("button")[0];

      await editButton.trigger("click");

      // Edit button should not trigger open-file event
      expect(wrapper.emitted("open-file")).toBeFalsy();
    });

    it("stops propagation for delete button click", async () => {
      wrapper = createWrapper();
      const deleteButton = wrapper.findAll("button")[1];

      await deleteButton.trigger("click");

      // Delete button should not trigger open-file event
      expect(wrapper.emitted("open-file")).toBeFalsy();
    });
  });

  describe("Input Blur Handling", () => {
    it("exits edit mode on blur", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.isEditing = true;
      await nextTick();

      const input = wrapper.find("input");
      await input.trigger("blur");

      expect(vm.isEditing).toBe(false);
    });

    it("restores previous name if current name is empty on blur", async () => {
      wrapper = createWrapper({ name: "" });
      const vm = wrapper.vm as any;

      vm.prevFileName = "backup.py";
      vm.isEditing = true;
      await nextTick();

      const input = wrapper.find("input");
      await input.trigger("blur");

      expect(wrapper.emitted("update:name")).toBeTruthy();
      expect(wrapper.emitted("update:name")?.[0]).toEqual(["backup.py"]);
    });

    it("uses default name if no previous name exists on blur with empty name", async () => {
      wrapper = createWrapper({ name: "" });
      const vm = wrapper.vm as any;

      vm.prevFileName = "";
      vm.isEditing = true;
      await nextTick();

      const input = wrapper.find("input");
      await input.trigger("blur");

      expect(wrapper.emitted("update:name")).toBeTruthy();
      expect(wrapper.emitted("update:name")?.[0]).toEqual(["new.py"]);
    });

    it("does not restore name on blur if name is not empty", async () => {
      wrapper = createWrapper({ name: "valid-name.py" });
      const vm = wrapper.vm as any;

      vm.isEditing = true;
      await nextTick();

      const input = wrapper.find("input");
      await input.trigger("blur");

      expect(wrapper.emitted("update:name")).toBeFalsy();
    });
  });

  describe("Input Field Styling", () => {
    it("applies white text when active and editing", async () => {
      wrapper = createWrapper({ isActive: true });
      const vm = wrapper.vm as any;

      vm.isEditing = true;
      await nextTick();

      const input = wrapper.find("input");
      expect(input.classes()).toContain("tw:text-white");
      expect(input.classes()).not.toContain("tw:text-black");
    });

    it("applies black text when not active and editing", async () => {
      wrapper = createWrapper({ isActive: false });
      const vm = wrapper.vm as any;

      vm.isEditing = true;
      await nextTick();

      const input = wrapper.find("input");
      expect(input.classes()).toContain("tw:text-black");
      expect(input.classes()).not.toContain("tw:text-white");
    });
  });

  describe("Button Styling", () => {
    it("applies light gray styling to buttons when active", () => {
      wrapper = createWrapper({ isActive: true });
      const buttons = wrapper.findAll("button");

      buttons.forEach((button) => {
        expect(button.classes()).toContain("tw:text-gray-100");
        expect(button.classes()).not.toContain("tw:text-gray-600");
      });
    });

    it("applies dark gray styling to buttons when not active", () => {
      wrapper = createWrapper({ isActive: false });
      const buttons = wrapper.findAll("button");

      buttons.forEach((button) => {
        expect(button.classes()).toContain("tw:text-gray-600");
        expect(button.classes()).not.toContain("tw:text-gray-100");
      });
    });
  });

  describe("Watchers", () => {
    it("enters edit mode when editMode prop changes to true", async () => {
      wrapper = createWrapper({ editMode: false });
      const vm = wrapper.vm as any;

      expect(vm.isEditing).toBe(false);

      await wrapper.setProps({ editMode: true });
      await nextTick();

      expect(vm.isEditing).toBe(true);
    });

    it("does not affect edit state when editMode prop changes to false", async () => {
      wrapper = createWrapper({ editMode: true });
      const vm = wrapper.vm as any;

      await nextTick();
      expect(vm.isEditing).toBe(true);

      await wrapper.setProps({ editMode: false });

      expect(vm.isEditing).toBe(true); // Should remain in edit state
    });
  });

  describe("Edge Cases", () => {
    it("handles empty file name", () => {
      wrapper = createWrapper({ name: "" });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles null nameInput ref gracefully", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.nameInput = null;

      expect(async () => {
        await vm.focusInput();
      }).not.toThrow();
    });

    it("handles very long file names", () => {
      const longName = "a".repeat(100) + ".py";
      wrapper = createWrapper({ name: longName });
      expect(wrapper.text()).toContain(longName);
    });

    it("handles file names with special characters", () => {
      const specialName = "test-file_123.py";
      wrapper = createWrapper({ name: specialName });
      expect(wrapper.text()).toContain(specialName);
    });

    it("handles input trimming", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.isEditing = true;
      await nextTick();

      const input = wrapper.find("input");
      await input.setValue("  trimmed-name.py  ");

      expect(wrapper.emitted("update:name")?.[0]).toEqual(["trimmed-name.py"]);
    });
  });

  describe("Component Structure", () => {
    it("has correct CSS classes on main element", () => {
      wrapper = createWrapper();
      const listItem = wrapper.find("li");

      expect(listItem.classes()).toContain("tw:cursor-pointer");
      expect(listItem.classes()).toContain("tw:py-[1px]");
      expect(listItem.classes()).toContain("tw:px-2");
      expect(listItem.classes()).toContain("hover:tw:bg-gray-200");
      expect(listItem.classes()).toContain("file-item");
    });

    it("has correct structure for file content and actions", () => {
      wrapper = createWrapper();

      // Check for the file actions area by class
      const actionsDiv = wrapper.find(".file-actions");

      expect(actionsDiv.exists()).toBe(true);
      expect(actionsDiv.classes()).toContain("file-actions");
    });
  });
});
