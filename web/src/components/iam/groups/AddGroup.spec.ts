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
// AddGroup is migrated to OForm + Zod (AddGroup.schema.ts). These tests mount
// the REAL <OForm> (only ODialog is stubbed) so the schema actually gates the
// submit — an unwired :schema would be caught here. They assert behavior
// (validation + service call + emits), not removed internals (showNameError /
// isValidGroupName / nameErrorMessage / the disabled gate are all gone).

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddGroup from "@/components/iam/groups/AddGroup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/iam", () => ({
  createGroup: vi.fn(),
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

// Lightweight ODialog stub: renders the default (body) slot so the REAL OForm
// inside mounts, and exposes the footer primary/secondary buttons. The footer
// Save submits via `form-id` in the real app; tests drive the form's own submit
// (form.handleSubmit) so the schema runs deterministically.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "formId",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div data-test-stub="o-dialog" :data-open="open" :data-title="title" :data-form-id="formId">
      <div data-test-stub="o-dialog-body"><slot /></div>
      <div data-test-stub="o-dialog-footer">
        <slot name="footer" />
        <button
          v-if="secondaryButtonLabel"
          data-test="o-dialog-secondary-btn"
          @click="$emit('click:secondary')"
        >{{ secondaryButtonLabel }}</button>
        <button
          v-if="primaryButtonLabel"
          data-test="o-dialog-primary-btn"
          @click="$emit('click:primary')"
        >{{ primaryButtonLabel }}</button>
      </div>
    </div>
  `,
  inheritAttrs: false,
};

function mountComp(props: Record<string, any> = {}) {
  return mount(AddGroup, {
    global: {
      plugins: [store, i18n],
      stubs: { ODialog: ODialogStub },
    },
    props: {
      open: true,
      group: null,
      org_identifier: "test-org",
      ...props,
    },
  });
}

const getForm = (wrapper: any) => wrapper.findComponent({ name: "OForm" });
const getNameInput = (wrapper: any) =>
  wrapper.find('[data-test="add-group-groupname-input-btn"] input');

const submitForm = async (wrapper: any) => {
  // Drive the form's own submit so the schema runs + the handler is awaited
  // deterministically (a fire-and-forget native submit wouldn't be).
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
};

describe("AddGroup", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mountComp();
  });

  afterEach(() => {
    try {
      wrapper?.unmount();
    } catch {
      // teleported components can throw during unmount in jsdom
    }
  });

  describe("rendering", () => {
    it("renders the dialog and group name input", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="add-group-section"]').exists()).toBe(true);
      expect(getNameInput(wrapper).exists()).toBe(true);
    });

    it("wires the OForm to the dialog via form-id", () => {
      expect(getForm(wrapper).exists()).toBe(true);
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-form-id"),
      ).toBe("add-group-form");
    });

    it("passes a Zod schema to OForm (no per-field validators / disabled gate)", () => {
      expect(getForm(wrapper).props("schema")).toBeDefined();
    });

    it("seeds blank default-values in create mode", () => {
      expect(getForm(wrapper).props("defaultValues")).toEqual({ name: "" });
    });

    it("seeds the group name when a group prop is provided", () => {
      const w = mountComp({ group: { name: "existing_group" } });
      expect(getForm(w).props("defaultValues")).toEqual({ name: "existing_group" });
      w.unmount();
    });

    it("preserves the maxlength attribute on the input", () => {
      expect(getNameInput(wrapper).attributes("maxlength")).toBe("100");
    });

    it("keeps Save enabled (R3 — no disabled gate)", () => {
      const saveBtn = wrapper.find('[data-test="o-dialog-primary-btn"]');
      expect(saveBtn.attributes("disabled")).toBeUndefined();
    });
  });

  describe("schema validation (real OForm)", () => {
    it("does not validate before the first submit", async () => {
      await getNameInput(wrapper).setValue("invalid name");
      await flushPromises();
      // R3: nothing validates until the first submit.
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it("blocks submit and does NOT call createGroup when name is empty", async () => {
      const { createGroup } = await import("@/services/iam");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(createGroup).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Group name is required.");
    });

    it("blocks submit for a name with invalid characters (restored regex rule)", async () => {
      const { createGroup } = await import("@/services/iam");
      await getNameInput(wrapper).setValue("invalid name!");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(createGroup).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain(
        "Use letters, numbers and underscores only, without spaces.",
      );
    });

    it("blocks submit when the name exceeds 100 characters (max rule)", async () => {
      const { createGroup } = await import("@/services/iam");
      // maxlength caps typing, so set the value directly to exercise the schema.
      getForm(wrapper).vm.form.setFieldValue("name", "a".repeat(101));
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(createGroup).not.toHaveBeenCalled();
    });

    it("submits and calls createGroup once when the name is valid", async () => {
      const { createGroup } = await import("@/services/iam");
      vi.mocked(createGroup).mockResolvedValue({
        data: { name: "test_group" },
      } as any);

      await getNameInput(wrapper).setValue("test_group");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(createGroup).toHaveBeenCalledTimes(1);
      expect(createGroup).toHaveBeenCalledWith(
        "test_group",
        store.state.selectedOrganization.identifier,
      );
      // Emit contract consumed by AppGroups.onGroupAdded (routes to editGroup).
      expect(wrapper.emitted("added:group")?.[0]).toEqual([
        { group_name: "test_group", data: { name: "test_group" } },
      ]);
    });

    it("trims the submitted name via the schema", async () => {
      const { createGroup } = await import("@/services/iam");
      vi.mocked(createGroup).mockResolvedValue({ data: {} } as any);

      await getNameInput(wrapper).setValue("  test_group  ");
      await submitForm(wrapper);

      expect(createGroup).toHaveBeenCalledWith(
        "test_group",
        store.state.selectedOrganization.identifier,
      );
    });
  });

  describe("group creation behavior", () => {
    it("emits added:group + update:open(false) and shows success toast on success", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockResponse = { data: { name: "test_group" } };
      vi.mocked(createGroup).mockResolvedValue(mockResponse as any);

      await getNameInput(wrapper).setValue("test_group");
      await submitForm(wrapper);

      expect(wrapper.emitted("added:group")?.[0]).toEqual([
        { group_name: "test_group", data: mockResponse.data },
      ]);
      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen[updateOpen.length - 1]).toEqual([false]);
      expect(mockToast).toHaveBeenCalledWith({
        message: 'User Group "test_group" Created Successfully!',
        variant: "success",
      });
    });

    it("shows an error toast on a non-403 failure and does not emit added:group", async () => {
      const { createGroup } = await import("@/services/iam");
      vi.mocked(createGroup).mockRejectedValue({ response: { status: 400 } });

      await getNameInput(wrapper).setValue("test_group");
      await submitForm(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: "Error while creating group",
        variant: "error",
      });
      expect(wrapper.emitted("added:group")).toBeFalsy();
    });

    it("does not show an error toast for a 403 failure", async () => {
      const { createGroup } = await import("@/services/iam");
      vi.mocked(createGroup).mockRejectedValue({ response: { status: 403 } });

      await getNameInput(wrapper).setValue("test_group");
      await submitForm(wrapper);

      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe("dialog interactions", () => {
    it("emits update:open(false) when cancel is clicked", async () => {
      await wrapper.find('[data-test="o-dialog-secondary-btn"]').trigger("click");
      const emitted = wrapper.emitted("update:open");
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });

    it("re-emits update:open from the dialog's update:open event", async () => {
      await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);
      const emitted = wrapper.emitted("update:open");
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });

    it("uses the provided org_identifier prop", () => {
      expect(wrapper.props("org_identifier")).toBe("test-org");
    });
  });
});
