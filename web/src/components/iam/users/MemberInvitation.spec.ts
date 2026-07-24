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
// MemberInvitation is migrated to OForm + Zod (MemberInvitation.schema.ts). It is
// an inline (no-dialog) Options-API form: the Save button is type="submit" inside
// the OForm, the schema (+ defaults) is returned from setup(), and the row is
// cleared via form.reset() after a successful invite. These tests mount the REAL
// <OForm> and assert behavior (multi-email validation + service call + reset).

import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MemberInvitation from "@/components/iam/users/MemberInvitation.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/organizations", () => ({
  default: {
    add_members: vi.fn(),
  },
}));

vi.mock("@/services/users", () => ({
  default: {
    getRoles: vi.fn(() =>
      Promise.resolve({
        data: [{ label: "Admin", value: "admin" }],
      }),
    ),
  },
}));

vi.mock("@/services/iam", () => ({
  getRoles: vi.fn(),
}));

vi.mock("@/services/segment_analytics", () => ({
  default: { track: vi.fn() },
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

import organizationsService from "@/services/organizations";
import usersService from "@/services/users";
import segment from "@/services/segment_analytics";

function mountComp(props: Record<string, any> = {}) {
  return mount(MemberInvitation, {
    global: {
      plugins: [store, i18n],
    },
    props: {
      currentrole: "admin",
      ...props,
    },
  });
}

const getForm = (wrapper: VueWrapper<any>) => wrapper.findComponent({ name: "OForm" });

const setEmail = (wrapper: VueWrapper<any>, value: string) =>
  getForm(wrapper).vm.form.setFieldValue("email", value);

const submitForm = async (wrapper: VueWrapper<any>) => {
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
};

describe("MemberInvitation", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("rendering", () => {
    it("renders the invite form for an admin", () => {
      expect(getForm(wrapper).exists()).toBe(true);
      expect(wrapper.find("input").exists()).toBe(true);
    });

    it("does not render the invite form for a member", () => {
      const w = mountComp({ currentrole: "member" });
      expect(w.findComponent({ name: "OForm" }).exists()).toBe(false);
      w.unmount();
    });

    it("renders the invite form for a root user", () => {
      const w = mountComp({ currentrole: "root" });
      expect(w.findComponent({ name: "OForm" }).exists()).toBe(true);
      w.unmount();
    });

    it("fetches roles on mount", () => {
      // onBeforeMount → getRoles() → usersService.getRoles
      expect(usersService.getRoles).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
      );
    });

    it("handles an empty getRoles response without crashing", async () => {
      vi.mocked(usersService.getRoles).mockResolvedValueOnce({ data: [] } as any);
      const w = mountComp();
      await flushPromises();
      expect(w.findComponent({ name: "OForm" }).exists()).toBe(true);
      w.unmount();
    });

    it("returns the schema from setup() (Options-API wiring)", () => {
      expect(getForm(wrapper).props("schema")).toBeDefined();
    });

    it("seeds blank email + default admin role", () => {
      expect(getForm(wrapper).props("defaultValues")).toEqual({
        email: "",
        role: "admin",
      });
    });

    it("keeps the Save button enabled (R3 — no disabled gate)", () => {
      const btn = wrapper.findComponent({ name: "OButton" });
      expect(btn.props("disabled")).toBeFalsy();
    });
  });

  describe("schema validation (real OForm)", () => {
    it("blocks submit and does NOT call add_members when email is empty", async () => {
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.add_members).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Please enter correct email id.");
    });

    it("blocks submit when an email address is invalid", async () => {
      setEmail(wrapper, "not-an-email");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.add_members).not.toHaveBeenCalled();
    });

    it("blocks submit when one of several addresses is invalid", async () => {
      setEmail(wrapper, "good@example.com, bad-email");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.add_members).not.toHaveBeenCalled();
    });

    it("submits a single valid email (lowercased) with the role", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { message: "ok", data: { invalid_members: null } },
      } as any);

      setEmail(wrapper, "New@Example.com");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(organizationsService.add_members).toHaveBeenCalledTimes(1);
      expect(organizationsService.add_members).toHaveBeenCalledWith(
        { invites: ["new@example.com"], role: "admin" },
        store.state.selectedOrganization.identifier,
      );
    });

    it("splits and dedups multiple emails on ; and ,", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { message: "ok", data: { invalid_members: null } },
      } as any);

      setEmail(wrapper, "a@example.com; b@example.com, a@example.com");
      await submitForm(wrapper);

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        { invites: ["a@example.com", "b@example.com"], role: "admin" },
        store.state.selectedOrganization.identifier,
      );
    });

    it("trims whitespace around each email before inviting", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { message: "ok", data: { invalid_members: null } },
      } as any);

      setEmail(wrapper, "  a@example.com  ;  b@example.com  ");
      await submitForm(wrapper);

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        { invites: ["a@example.com", "b@example.com"], role: "admin" },
        store.state.selectedOrganization.identifier,
      );
    });

    it("submits with a selected non-default role", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { message: "ok", data: { invalid_members: null } },
      } as any);

      getForm(wrapper).vm.form.setFieldValue("role", "editor");
      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        { invites: ["new@example.com"], role: "editor" },
        store.state.selectedOrganization.identifier,
      );
    });
  });

  describe("invite behavior", () => {
    it("emits inviteSent and clears the email row on success", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { message: "Invited", data: { invalid_members: null } },
      } as any);

      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(wrapper.emitted("inviteSent")).toBeTruthy();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
      // Row cleared after save (reset), role preserved.
      expect(getForm(wrapper).vm.form.state.values.email).toBe("");
      expect(getForm(wrapper).vm.form.state.values.role).toBe("admin");
    });

    it("tracks the invitation via segment analytics", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { message: "Invited", data: { invalid_members: null } },
      } as any);

      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(segment.track).toHaveBeenCalledWith(
        "Button Click",
        expect.objectContaining({ button: "Invite User", page: "Users" }),
      );
    });

    it("shows an error toast when invalid_members are returned", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { message: "x", data: { invalid_members: ["bad@x.com"] } },
      } as any);

      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      expect(wrapper.emitted("inviteSent")).toBeFalsy();
    });

    it("shows an error toast when the service rejects", async () => {
      vi.mocked(organizationsService.add_members).mockRejectedValue({
        response: { data: { message: "Server error" } },
      });

      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: "Server error" }),
      );
      expect(wrapper.emitted("inviteSent")).toBeFalsy();
    });
  });
});
