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
// UpdateRole is migrated to OForm + Zod (UpdateRole.schema.ts). It is an
// Options-API form, so the schema + the edit-prefill defaults computed are
// returned from setup(). These tests mount the REAL <OForm> (only ODialog is
// stubbed) so the schema actually gates the submit — an unreturned :schema would
// be caught here. Behavior is asserted (role-required + service call + emits),
// not removed internals (roleError / the manual validate guard are gone).

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import UpdateRole from "@/components/iam/users/UpdateRole.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/organizations", () => ({
  default: {
    update_member_role: vi.fn(),
  },
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

import organizationsService from "@/services/organizations";

// ODialog stub: renders the default slot so the REAL OForm mounts.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "size", "title", "persistent"],
  emits: ["update:open"],
  template: `<div data-test-stub="o-dialog" :data-open="open" :data-title="title"><slot /></div>`,
  inheritAttrs: false,
};

function mountComp(props: Record<string, any> = {}) {
  return mount(UpdateRole, {
    global: {
      plugins: [store, i18n],
      stubs: { ODialog: ODialogStub },
    },
    props: {
      open: true,
      modelValue: {
        org_member_id: "42",
        role: "",
        first_name: "Jane Doe",
        email: "jane@example.com",
      },
      ...props,
    },
  });
}

const getForm = (wrapper: any) => wrapper.findComponent({ name: "OForm" });

const submitForm = async (wrapper: any) => {
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
};

describe("UpdateRole", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      wrapper?.unmount();
    } catch {
      // teleported components can throw during unmount in jsdom
    }
  });

  describe("rendering", () => {
    it("renders the dialog, role select and readonly name input", () => {
      wrapper = mountComp();
      expect(wrapper.exists()).toBe(true);
      expect(getForm(wrapper).exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-update-role-select"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-update-role-save-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-update-role-cancel-btn"]').exists()).toBe(true);
    });

    it("returns the schema from setup() (Options-API wiring)", () => {
      wrapper = mountComp();
      expect(getForm(wrapper).props("schema")).toBeDefined();
    });

    it("prefills role + first_name from modelValue via the defaults computed", () => {
      wrapper = mountComp({
        modelValue: {
          org_member_id: "7",
          role: "admin",
          first_name: "John",
          email: "john@example.com",
        },
      });
      expect(getForm(wrapper).props("defaultValues")).toEqual({
        role: "admin",
        first_name: "John",
      });
    });

    it("exposes the admin role option", () => {
      wrapper = mountComp();
      expect(wrapper.vm.roleOptions).toEqual(["admin"]);
    });

    it("reflects the open prop on the dialog", async () => {
      wrapper = mountComp();
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-open"),
      ).toBe("true");
      await wrapper.setProps({ open: false });
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-open"),
      ).toBe("false");
    });
  });

  describe("schema validation (real OForm)", () => {
    it("blocks submit and does NOT call the service when role is empty", async () => {
      wrapper = mountComp();
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.update_member_role).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Role is required");
    });

    it("submits and calls the service once when role is set", async () => {
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: {},
      } as any);
      wrapper = mountComp({
        modelValue: {
          org_member_id: "42",
          role: "admin",
          first_name: "Jane",
          email: "jane@example.com",
        },
      });

      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(organizationsService.update_member_role).toHaveBeenCalledTimes(1);
      expect(organizationsService.update_member_role).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, role: "admin" }),
        store.state.selectedOrganization.identifier,
      );
    });

    it("formats org_member_id + organization_id as numbers in the API call", async () => {
      store.state.selectedOrganization = {
        ...store.state.selectedOrganization,
        id: "5",
      };
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: {},
      } as any);
      wrapper = mountComp({
        modelValue: {
          org_member_id: "42",
          role: "admin",
          first_name: "Jane",
          email: "jane@example.com",
        },
      });

      await submitForm(wrapper);

      expect(organizationsService.update_member_role).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, organization_id: 5 }),
        store.state.selectedOrganization.identifier,
      );
    });
  });

  describe("update behavior", () => {
    it("emits updated + update:open(false) and shows success toast on success", async () => {
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: {},
      } as any);
      wrapper = mountComp({
        modelValue: {
          org_member_id: "42",
          role: "admin",
          first_name: "Jane",
          email: "jane@example.com",
        },
      });

      await submitForm(wrapper);

      expect(wrapper.emitted("updated")).toBeTruthy();
      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen[updateOpen.length - 1]).toEqual([false]);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success" }),
      );
    });

    it("shows an error toast when the service reports error_members", async () => {
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { error_members: ["x"] },
      } as any);
      wrapper = mountComp({
        modelValue: {
          org_member_id: "42",
          role: "admin",
          first_name: "Jane",
          email: "jane@example.com",
        },
      });

      await submitForm(wrapper);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });

    it("does not emit updated when the service rejects", async () => {
      vi.mocked(organizationsService.update_member_role).mockRejectedValue({
        response: { data: { message: "boom" } },
      });
      wrapper = mountComp({
        modelValue: {
          org_member_id: "42",
          role: "admin",
          first_name: "Jane",
          email: "jane@example.com",
        },
      });

      await submitForm(wrapper);

      expect(wrapper.emitted("updated")).toBeFalsy();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });

    it("handles an empty/malformed response without crashing (success path)", async () => {
      // No `data.error_members` → treated as success: emits + closes, no throw.
      vi.mocked(organizationsService.update_member_role).mockResolvedValue(
        {} as any,
      );
      wrapper = mountComp({
        modelValue: {
          org_member_id: "42",
          role: "admin",
          first_name: "Jane",
          email: "jane@example.com",
        },
      });

      await submitForm(wrapper);

      expect(wrapper.emitted("updated")).toBeTruthy();
      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen[updateOpen.length - 1]).toEqual([false]);
    });

    it("retains the role after a failed submit", async () => {
      vi.mocked(organizationsService.update_member_role).mockRejectedValue({
        response: { data: { message: "boom" } },
      });
      wrapper = mountComp({
        modelValue: {
          org_member_id: "42",
          role: "admin",
          first_name: "Jane",
          email: "jane@example.com",
        },
      });

      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.values.role).toBe("admin");
    });
  });

  describe("dialog interactions", () => {
    it("emits update:open(false) when cancel is clicked", async () => {
      wrapper = mountComp();
      await wrapper.find('[data-test="iam-update-role-cancel-btn"]').trigger("click");
      const emitted = wrapper.emitted("update:open");
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });

    it("forwards update:open from the dialog", async () => {
      wrapper = mountComp();
      await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);
      const emitted = wrapper.emitted("update:open");
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });
  });
});
