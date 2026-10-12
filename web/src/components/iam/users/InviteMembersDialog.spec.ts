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

import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import InviteMembersDialog from "@/components/iam/users/InviteMembersDialog.vue";
import {
  makeMemberInvitationSchema,
  memberInvitationDefaults,
  pickDefaultInviteRole,
  splitInviteEmails,
} from "@/components/iam/users/MemberInvitation.schema";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      add_members: vi.fn(),
    },
  });
});

vi.mock("@/services/users", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getRoles: vi.fn(),
    },
  });
});

vi.mock("@/services/product_analytics", () => ({
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
import analytics from "@/services/product_analytics";

const ROLES = [
  { label: "Admin", value: "admin" },
  { label: "Editor", value: "editor" },
  { label: "Viewer", value: "viewer" },
];

const t = (key: string) => i18n.global.t(key) as string;
const ORG = store.state.selectedOrganization.identifier;

async function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(InviteMembersDialog, {
    global: { plugins: [store, i18n] },
    props: { open: true, ...props },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const getForm = (wrapper: VueWrapper<any>) => wrapper.findComponent({ name: "OForm" });

const setEmail = (wrapper: VueWrapper<any>, value: string) =>
  getForm(wrapper).vm.form.setFieldValue("email", value);

const submitForm = async (wrapper: VueWrapper<any>) => {
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
};

const okResponse = (message = "Invited") =>
  ({ data: { message, data: { invalid_members: null } } }) as any;

describe("MemberInvitation.schema", () => {
  it("splits on ; and , and drops blanks", () => {
    expect(splitInviteEmails(" a@x.com; b@x.com,,c@x.com ; ")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("defaults the role to editor when the org offers it", () => {
    expect(pickDefaultInviteRole(ROLES)).toBe("editor");
  });

  it("falls back to the first option when editor is not offered", () => {
    expect(
      pickDefaultInviteRole([
        { label: "Viewer", value: "viewer" },
        { label: "Admin", value: "admin" },
      ]),
    ).toBe("viewer");
  });

  it("returns an empty role when there are no options", () => {
    expect(pickDefaultInviteRole([])).toBe("");
    expect(pickDefaultInviteRole(undefined)).toBe("");
  });

  it("never defaults the role to admin on its own", () => {
    expect(memberInvitationDefaults()).toEqual({ email: "", role: "" });
    const parsed = makeMemberInvitationSchema(t).safeParse({ email: "a@x.com", role: "" });
    expect(parsed.success).toBe(false);
  });
});

describe("InviteMembersDialog", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usersService.getRoles).mockResolvedValue({ data: ROLES } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
  });

  describe("rendering", () => {
    it("renders the labelled email and role fields", async () => {
      wrapper = await mountDialog();
      expect(
        document.querySelector('[data-test="invite-members-dialog-emails-input"]'),
      ).not.toBeNull();
      expect(
        document.querySelector('[data-test="invite-members-dialog-role-select"]'),
      ).not.toBeNull();
      expect(document.body.textContent).toContain("Email addresses");
      expect(document.body.textContent).toContain("Separate addresses with commas or semicolons.");
      expect(document.body.textContent).toContain("Send invites");
    });

    it("fetches the role options for the current org", async () => {
      wrapper = await mountDialog();
      expect(usersService.getRoles).toHaveBeenCalledWith(ORG);
    });

    it("seeds a blank email and the editor role", async () => {
      wrapper = await mountDialog();
      expect(getForm(wrapper).vm.form.state.values).toEqual({ email: "", role: "editor" });
    });

    it("seeds the first role when editor is not offered", async () => {
      vi.mocked(usersService.getRoles).mockResolvedValue({
        data: [
          { label: "Viewer", value: "viewer" },
          { label: "Admin", value: "admin" },
        ],
      } as any);
      wrapper = await mountDialog();
      expect(getForm(wrapper).vm.form.state.values.role).toBe("viewer");
    });

    it("prefills the email from initialEmail", async () => {
      wrapper = await mountDialog({ initialEmail: "new@example.com" });
      expect(getForm(wrapper).vm.form.state.values.email).toBe("new@example.com");
    });

    it("still renders the form when the role list fails to load", async () => {
      vi.mocked(usersService.getRoles).mockRejectedValue(new Error("boom"));
      wrapper = await mountDialog();
      expect(getForm(wrapper).exists()).toBe(true);
      expect(getForm(wrapper).vm.form.state.values.role).toBe("");
    });
  });

  describe("schema validation (real OForm)", () => {
    it("blocks submit and does NOT call add_members when email is empty", async () => {
      wrapper = await mountDialog();
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.add_members).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Please enter correct email id.");
    });

    it("blocks submit when an email address is invalid", async () => {
      wrapper = await mountDialog();
      setEmail(wrapper, "not-an-email");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.add_members).not.toHaveBeenCalled();
    });

    it("blocks submit when one of several addresses is invalid", async () => {
      wrapper = await mountDialog();
      setEmail(wrapper, "good@example.com, bad-email");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.add_members).not.toHaveBeenCalled();
    });

    it("blocks submit when no role is chosen", async () => {
      vi.mocked(usersService.getRoles).mockResolvedValue({ data: [] } as any);
      wrapper = await mountDialog();
      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(organizationsService.add_members).not.toHaveBeenCalled();
    });
  });

  describe("submit payload", () => {
    beforeEach(() => {
      vi.mocked(organizationsService.add_members).mockResolvedValue(okResponse());
    });

    it("submits a single valid email (lowercased) with the default role", async () => {
      wrapper = await mountDialog();
      setEmail(wrapper, "New@Example.com");
      await submitForm(wrapper);

      expect(organizationsService.add_members).toHaveBeenCalledTimes(1);
      expect(organizationsService.add_members).toHaveBeenCalledWith(
        { invites: ["new@example.com"], role: "editor" },
        ORG,
      );
    });

    it("splits on ; and , lowercases and dedupes", async () => {
      wrapper = await mountDialog();
      setEmail(wrapper, "a@example.com; B@example.com, A@Example.com");
      await submitForm(wrapper);

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        { invites: ["a@example.com", "b@example.com"], role: "editor" },
        ORG,
      );
    });

    it("trims whitespace around each email before inviting", async () => {
      wrapper = await mountDialog();
      setEmail(wrapper, "  a@example.com  ;  b@example.com  ");
      await submitForm(wrapper);

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        { invites: ["a@example.com", "b@example.com"], role: "editor" },
        ORG,
      );
    });

    it("submits with a selected non-default role", async () => {
      wrapper = await mountDialog();
      getForm(wrapper).vm.form.setFieldValue("role", "admin");
      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        { invites: ["new@example.com"], role: "admin" },
        ORG,
      );
    });
  });

  describe("invite behavior", () => {
    it("emits inviteSent and closes on success", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue(okResponse("Invited"));
      wrapper = await mountDialog();
      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(wrapper.emitted("inviteSent")).toBeTruthy();
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success", message: "Invited" }),
      );
    });

    it("tracks the invitation via product analytics", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue(okResponse());
      wrapper = await mountDialog();
      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(analytics.track).toHaveBeenCalledWith(
        "Button Click",
        expect.objectContaining({ button: "Invite User", user_org: ORG, page: "Users" }),
      );
    });

    it("shows an error toast and stays open when invalid_members are returned", async () => {
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { message: "x", data: { invalid_members: ["bad@x.com"] } },
      } as any);
      wrapper = await mountDialog();
      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Error while member invitation: bad@x.com",
        }),
      );
      expect(wrapper.emitted("inviteSent")).toBeFalsy();
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });

    it("shows an error toast when the service rejects", async () => {
      vi.mocked(organizationsService.add_members).mockRejectedValue({
        response: { data: { message: "Server error" } },
      });
      wrapper = await mountDialog();
      setEmail(wrapper, "new@example.com");
      await submitForm(wrapper);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: "Server error" }),
      );
      expect(wrapper.emitted("inviteSent")).toBeFalsy();
      expect(analytics.track).toHaveBeenCalled();
    });

    it("closes from the cancel button", async () => {
      wrapper = await mountDialog();
      wrapper.findComponent({ name: "ODialog" }).vm.$emit("click:secondary");
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });
  });
});
