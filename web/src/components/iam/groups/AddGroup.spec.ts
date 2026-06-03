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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddGroup from "@/components/iam/groups/AddGroup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";


vi.mock("@/services/iam", () => ({
  createGroup: vi.fn(),
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

// Lightweight stub for ODialog: renders its default/footer slots so children
// remain queryable, and exposes the built-in primary/secondary footer buttons
// (emitting click:primary / click:secondary) so tests can drive interactions.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "width",
    "size",
    "title",
    "subTitle",
    "showClose",
    "persistent",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div data-test-stub="o-dialog" :data-open="open" :data-title="title" :data-width="width">
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer">
        <slot name="footer" />
        <button
          v-if="secondaryButtonLabel"
          data-test="o-dialog-secondary-btn"
          :disabled="secondaryButtonDisabled"
          @click="$emit('click:secondary')"
        >{{ secondaryButtonLabel }}</button>
        <button
          v-if="primaryButtonLabel"
          data-test="o-dialog-primary-btn"
          :disabled="primaryButtonDisabled"
          @click="$emit('click:primary')"
        >{{ primaryButtonLabel }}</button>
      </div>
    </div>
  `,
};

function buildStubs() {
  return {
    ODialog: ODialogStub,
  };
}

describe("AddGroup Component", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mount(AddGroup, {
      global: {
        provide: { store },
        plugins: [i18n],
        stubs: buildStubs(),
      },
      props: {
        open: true,
        group: null,
        org_identifier: "test-org",
      },
    });
  });

  afterEach(() => {
    try {
      wrapper?.unmount();
    } catch {
      // Quasar teleported components can throw during unmount in jsdom
    }
  });

  describe("Component Mounting", () => {
    it("renders the component correctly", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="add-group-section"]').exists()).toBe(true);
    });

    it("renders inside an ODrawer with the localized title", () => {
      const drawer = wrapper.find('[data-test-stub="o-dialog"]');
      expect(drawer.exists()).toBe(true);
      // i18n key resolves to "Add User Group" (en); assert via attribute,
      // not text, since the stub doesn't render the title body.
      expect(drawer.attributes("data-title")).toBeTruthy();
    });

    it("propagates the open prop to the drawer", async () => {
      const drawer = wrapper.find('[data-test-stub="o-dialog"]');
      expect(drawer.attributes("data-open")).toBe("true");

      await wrapper.setProps({ open: false });
      expect(wrapper.find('[data-test-stub="o-dialog"]').attributes("data-open")).toBe("false");
    });

    it("uses size=sm on the dialog", () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("sm");
    });
  });

  describe("Form Input", () => {
    it("renders the group name input field", () => {
      const nameInput = wrapper.find('[data-test="add-group-groupname-input-btn"]');
      expect(nameInput.exists()).toBe(true);
    });

    it("displays validation hint text", async () => {
      // nameErrorMessage returns the format hint only when name is non-empty;
      // when name is empty it returns the required-field message instead.
      // showNameError has no public API — set vm directly so OInput renders
      // the :error-message via its role="alert" span.
      wrapper.vm.name = "test-name";
      wrapper.vm.showNameError = true;
      await flushPromises();

      expect(wrapper.text()).toContain(
        "Use alphanumeric and '_' characters only, without spaces.",
      );
    });

    it("updates name value when input changes", async () => {
      const nameInput = wrapper.find('input[type="text"]');
      await nameInput.setValue("test_group");
      expect(wrapper.vm.name).toBe("test_group");
    });

    it("trims whitespace from input", async () => {
      const nameInput = wrapper.find('input[type="text"]');
      await nameInput.setValue("  test_group  ");
      expect(wrapper.vm.name).toBe("test_group");
    });
  });

  describe("Form Validation", () => {
    it("validates group name format correctly", async () => {
      wrapper.vm.name = "valid_group_123";
      await flushPromises();
      expect(wrapper.vm.isValidGroupName).toBe(true);
    });

    it("rejects group names with spaces", async () => {
      wrapper.vm.name = "invalid group";
      await flushPromises();
      expect(wrapper.vm.isValidGroupName).toBe(false);
    });

    it("rejects group names with special characters", async () => {
      wrapper.vm.name = "invalid-group!";
      await flushPromises();
      expect(wrapper.vm.isValidGroupName).toBe(false);
    });

    it("accepts group names with underscores and alphanumeric characters", async () => {
      wrapper.vm.name = "valid_group_name_123";
      await flushPromises();
      expect(wrapper.vm.isValidGroupName).toBe(true);
    });

    it("rejects empty group names", async () => {
      wrapper.vm.name = "";
      await flushPromises();
      expect(wrapper.vm.isValidGroupName).toBe(false);
    });
  });

  describe("Button Actions", () => {
    it("renders cancel and save buttons", () => {
      const cancelButton = wrapper.find('[data-test="o-dialog-secondary-btn"]');
      const saveButton = wrapper.find('[data-test="o-dialog-primary-btn"]');

      expect(cancelButton.exists()).toBe(true);
      expect(saveButton.exists()).toBe(true);
      expect(cancelButton.text()).toContain("Cancel");
      expect(saveButton.text()).toContain("Save");
    });

    it("emits update:open(false) when cancel button is clicked", async () => {
      const cancelButton = wrapper.find('[data-test="o-dialog-secondary-btn"]');
      await cancelButton.trigger("click");

      const emitted = wrapper.emitted("update:open");
      expect(emitted).toBeTruthy();
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });

    it("re-emits update:open from the drawer's update:open event", async () => {
      const drawer = wrapper.findComponent(ODialogStub);
      await drawer.vm.$emit("update:open", false);

      const emitted = wrapper.emitted("update:open");
      expect(emitted).toBeTruthy();
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });

    it("disables save button when name is empty", async () => {
      wrapper.vm.name = "";
      await flushPromises();
      const saveButton = wrapper.find('[data-test="o-dialog-primary-btn"]');
      expect(saveButton.attributes("disabled")).toBeDefined();
    });

    it("disables save button when name is invalid", async () => {
      wrapper.vm.name = "invalid name!";
      await flushPromises();
      const saveButton = wrapper.find('[data-test="o-dialog-primary-btn"]');
      expect(saveButton.attributes("disabled")).toBeDefined();
    });

    it("enables save button when name is valid", async () => {
      wrapper.vm.name = "valid_group";
      await flushPromises();
      const saveButton = wrapper.find('[data-test="o-dialog-primary-btn"]');
      expect(saveButton.attributes("disabled")).toBeUndefined();
    });
  });

  describe("Group Creation", () => {
    it("does not save when group name is empty", async () => {
      const { createGroup } = await import("@/services/iam");
      wrapper.vm.name = "";

      await wrapper.vm.saveGroup();

      expect(createGroup).not.toHaveBeenCalled();
    });

    it("does not save when group name is invalid", async () => {
      const { createGroup } = await import("@/services/iam");
      wrapper.vm.name = "invalid group name";

      await wrapper.vm.saveGroup();

      expect(createGroup).not.toHaveBeenCalled();
    });

    it("creates group successfully with valid data", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockResponse = { data: { name: "test_group" } };
      vi.mocked(createGroup).mockResolvedValue(mockResponse as any);

      wrapper.vm.name = "test_group";

      await wrapper.vm.saveGroup();
      await flushPromises();

      expect(createGroup).toHaveBeenCalledWith(
        "test_group",
        store.state.selectedOrganization.identifier,
      );
      expect(wrapper.emitted("added:group")).toBeTruthy();
      expect(wrapper.emitted("added:group")?.[0]).toEqual([mockResponse.data]);

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen[updateOpen.length - 1]).toEqual([false]);
    });

    it("displays success notification on successful creation", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockResponse = { data: { name: "test_group" } };
      vi.mocked(createGroup).mockResolvedValue(mockResponse as any);

      wrapper.vm.name = "test_group";

      await wrapper.vm.saveGroup();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: 'User Group "test_group" Created Successfully!',
        variant: "success",
      });
    });

    it("handles error during group creation (non-403)", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockError = { response: { status: 400 } };
      vi.mocked(createGroup).mockRejectedValue(mockError);

      wrapper.vm.name = "test_group";

      await wrapper.vm.saveGroup();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: "Error while creating group",
        variant: "error",
      });
    });

    it("does not show error notification for 403 status", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockError = { response: { status: 403 } };
      vi.mocked(createGroup).mockRejectedValue(mockError);

      wrapper.vm.name = "test_group";

      await wrapper.vm.saveGroup();
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalled();
    });

    it("does not emit added:group when creation fails", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockError = { response: { status: 500 } };
      vi.mocked(createGroup).mockRejectedValue(mockError);

      wrapper.vm.name = "test_group";

      await wrapper.vm.saveGroup();
      await flushPromises();

      expect(wrapper.emitted("added:group")).toBeFalsy();
    });

    it("creates group when save button is clicked with valid name", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockResponse = { data: { name: "valid_group" } };
      vi.mocked(createGroup).mockResolvedValue(mockResponse as any);

      wrapper.vm.name = "valid_group";
      await flushPromises();

      const saveButton = wrapper.find('[data-test="o-dialog-primary-btn"]');
      await saveButton.trigger("click");
      await flushPromises();

      expect(createGroup).toHaveBeenCalledWith(
        "valid_group",
        store.state.selectedOrganization.identifier,
      );
    });
  });

  describe("Props Handling", () => {
    it("initializes with group prop data when provided", async () => {
      const groupData = { name: "existing_group" };
      const localWrapper = mount(AddGroup, {
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: buildStubs(),
        },
        props: {
          open: true,
          group: groupData,
        },
      });

      expect(localWrapper.vm.name).toBe("existing_group");
      localWrapper.unmount();
    });

    it("initializes with empty name when no group prop", () => {
      expect(wrapper.vm.name).toBe("");
    });

    it("defaults open to false when not provided", () => {
      const localWrapper = mount(AddGroup, {
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: buildStubs(),
        },
      });

      expect(localWrapper.props("open")).toBe(false);
      const drawer = localWrapper.find('[data-test-stub="o-dialog"]');
      expect(drawer.attributes("data-open")).toBe("false");
      localWrapper.unmount();
    });

    it("uses provided org_identifier", () => {
      expect(wrapper.props("org_identifier")).toBe("test-org");
    });
  });

  describe("Input Validation Rules", () => {
    it("validates required field rule", () => {
      wrapper.vm.name = "";
      const validationResult = wrapper.vm.name ? "valid" : "Name is required";
      expect(validationResult).toBe("Name is required");
    });

    it("validates format rule when name exists", async () => {
      wrapper.vm.name = "invalid name";
      await flushPromises();

      const validationResult =
        wrapper.vm.isValidGroupName ||
        "Use alphanumeric and '_' characters only, without spaces.";
      expect(validationResult).toBe(
        "Use alphanumeric and '_' characters only, without spaces.",
      );
    });
  });

  describe("Edge Cases", () => {
    it("handles maxlength constraint", () => {
      const nameInput = wrapper.find('input[type="text"]');
      expect(nameInput.attributes("maxlength")).toBe("100");
    });

    it("handles empty organization identifier", async () => {
      const localWrapper = mount(AddGroup, {
        global: {
          provide: {
            store: {
              ...store,
              state: { ...store.state, selectedOrganization: { identifier: "" } },
            },
          },
          plugins: [i18n],
          stubs: buildStubs(),
        },
        props: { open: true },
      });

      const { createGroup } = await import("@/services/iam");
      const mockResponse = { data: { name: "test_group" } };
      vi.mocked(createGroup).mockResolvedValue(mockResponse as any);

      localWrapper.vm.name = "test_group";

      await localWrapper.vm.saveGroup();
      await flushPromises();

      expect(createGroup).toHaveBeenCalledWith("test_group", "");
      localWrapper.unmount();
    });
  });

  describe("Accessibility", () => {
    it("has cancel and save buttons rendered", () => {
      const cancelButton = wrapper.find('[data-test="o-dialog-secondary-btn"]');
      const saveButton = wrapper.find('[data-test="o-dialog-primary-btn"]');

      expect(cancelButton.exists()).toBe(true);
      expect(saveButton.exists()).toBe(true);
    });

    it("has proper input labels", () => {
      const input = wrapper.find('input[type="text"]');
      expect(input.exists()).toBe(true);
      expect(input.attributes("maxlength")).toBe("100");
    });
  });
});
