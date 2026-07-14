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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import BillingService from "@/services/billings";
import BillingGroup from "./BillingGroup.vue";

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/services/billings", () => ({
  default: {
    get_billing_group_membership: vi.fn(),
    list_billing_group_members: vi.fn(),
    list_billing_group_invites: vi.fn(),
    send_billing_group_invite: vi.fn(),
    accept_billing_group_invite: vi.fn(),
    reject_billing_group_invite: vi.fn(),
  },
}));

const billing = BillingService as unknown as {
  get_billing_group_membership: ReturnType<typeof vi.fn>;
  list_billing_group_members: ReturnType<typeof vi.fn>;
  list_billing_group_invites: ReturnType<typeof vi.fn>;
  send_billing_group_invite: ReturnType<typeof vi.fn>;
  accept_billing_group_invite: ReturnType<typeof vi.fn>;
  reject_billing_group_invite: ReturnType<typeof vi.fn>;
};

interface MountOptions {
  membership?: any;
  members?: any[];
  invites?: any[];
  allowedOrgs?: string;
  org?: string;
  // When true, render the ODrawer body slot inline (a real <OForm> + fields)
  // instead of fully stubbing the drawer — needed for the invite-form tests.
  renderDrawer?: boolean;
}

// Slot-rendering ODrawer stub so the real OForm in the body is mounted.
const ODrawerSlotStub = {
  name: "ODrawer",
  template: "<div class='o-drawer'><slot /></div>",
  props: [
    "open",
    "title",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "formId",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
};

async function mountBillingGroup(opts: MountOptions = {}) {
  const {
    membership = null,
    members = [],
    invites = [],
    allowedOrgs = "default",
    org = "default",
    renderDrawer = false,
  } = opts;

  billing.get_billing_group_membership.mockResolvedValue({
    data: { membership },
  });
  billing.list_billing_group_members.mockResolvedValue({ data: members });
  billing.list_billing_group_invites.mockResolvedValue({ data: invites });

  store.state.selectedOrganization = {
    ...store.state.selectedOrganization,
    identifier: org,
    label: org,
  };
  store.state.zoConfig = {
    ...store.state.zoConfig,
    billing_group_allowed_orgs: allowedOrgs,
  };

  const orgGroupInvite = reactive({ trigger: 0, canInvite: false });

  const wrapper = mount(BillingGroup, {
    global: {
      plugins: [store, i18n],
      provide: { orgGroupInvite },
      stubs: {
        OButton: true,
        AppTabs: true,
        OTable: true,
        ODrawer: renderDrawer ? ODrawerSlotStub : true,
      },
    },
  });

  await flushPromises();
  return { wrapper, orgGroupInvite };
}

describe("BillingGroup.vue", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("role detection", () => {
    it("resolves to 'standalone' when there is no membership and no members", async () => {
      ({ wrapper } = await mountBillingGroup());
      expect(wrapper.vm.role).toBe("standalone");
    });

    it("resolves to 'super' when the org has members", async () => {
      ({ wrapper } = await mountBillingGroup({
        members: [
          {
            id: 1,
            payer_org_id: "default",
            member_org_id: "child-1",
            member_org_name: "Child One",
            created_at: 1,
            created_by: "a@b.com",
            accepted_by: null,
          },
        ],
      }));
      expect(wrapper.vm.role).toBe("super");
    });

    it("resolves to 'super' when the org has sent invites but has no members yet", async () => {
      ({ wrapper } = await mountBillingGroup({
        org: "default",
        members: [],
        invites: [
          {
            token: "sent-1",
            inviter_org_id: "default",
            invitee_org_id: "target-org",
            inviter_id: "me@default.com",
            status: "Pending",
            created_at: 1,
            expires_at: 2,
          },
        ],
      }));
      expect(wrapper.vm.role).toBe("super");
    });

    it("resolves to 'child' when the org has a membership (membership dominates)", async () => {
      ({ wrapper } = await mountBillingGroup({
        membership: {
          id: 1,
          payer_org_id: "payer-org",
          payer_org_name: "Payer Org",
          member_org_id: "default",
          created_at: 1,
          created_by: "root@example.com",
          accepted_by: "root@example.com",
        },
        // members present too — membership should still win
        members: [{ id: 2, member_org_id: "child-1" }],
      }));
      expect(wrapper.vm.role).toBe("child");
    });
  });

  describe("billing_group_allowed_orgs gating", () => {
    it("allows billing group when the current org is in the comma-separated list", async () => {
      ({ wrapper } = await mountBillingGroup({
        allowedOrgs: "alpha,default,beta",
        org: "default",
      }));
      expect(wrapper.vm.allowedForBillingGroup).toBe(true);
    });

    it("trims whitespace around entries when matching", async () => {
      ({ wrapper } = await mountBillingGroup({
        allowedOrgs: " alpha , default , beta ",
        org: "default",
      }));
      expect(wrapper.vm.allowedForBillingGroup).toBe(true);
    });

    it("disallows billing group when the org is not in the list", async () => {
      ({ wrapper } = await mountBillingGroup({
        allowedOrgs: "alpha,beta",
        org: "default",
      }));
      expect(wrapper.vm.allowedForBillingGroup).toBe(false);
    });

    it("treats an empty allow-list as no org allowed", async () => {
      ({ wrapper } = await mountBillingGroup({
        allowedOrgs: "",
        org: "default",
      }));
      expect(wrapper.vm.allowedForBillingGroup).toBe(false);
    });
  });

  describe("header canInvite sync (provide/inject)", () => {
    it("enables invite for a standalone org that is allowed", async () => {
      let orgGroupInvite: any;
      ({ wrapper, orgGroupInvite } = await mountBillingGroup({
        allowedOrgs: "default",
        org: "default",
      }));
      expect(orgGroupInvite.canInvite).toBe(true);
    });

    it("disables invite when the org is not in the allow-list", async () => {
      let orgGroupInvite: any;
      ({ wrapper, orgGroupInvite } = await mountBillingGroup({
        allowedOrgs: "other",
        org: "default",
      }));
      expect(orgGroupInvite.canInvite).toBe(false);
    });

    it("disables invite for a child org even when allowed", async () => {
      let orgGroupInvite: any;
      ({ wrapper, orgGroupInvite } = await mountBillingGroup({
        allowedOrgs: "default",
        org: "default",
        membership: {
          id: 1,
          payer_org_id: "payer-org",
          payer_org_name: "Payer Org",
          member_org_id: "default",
          created_at: 1,
          created_by: "root@example.com",
          accepted_by: null,
        },
      }));
      expect(orgGroupInvite.canInvite).toBe(false);
    });

    it("opens the invite dialog when the header bumps the trigger", async () => {
      let orgGroupInvite: any;
      ({ wrapper, orgGroupInvite } = await mountBillingGroup());
      expect(wrapper.vm.showInviteDialog).toBe(false);
      orgGroupInvite.trigger++;
      await flushPromises();
      expect(wrapper.vm.showInviteDialog).toBe(true);
    });
  });

  describe("payerName (child headline)", () => {
    it("returns the full payer name (display truncation is handled by CSS)", async () => {
      ({ wrapper } = await mountBillingGroup({
        org: "default",
        membership: {
          id: 1,
          payer_org_id: "payer-identifier-long",
          payer_org_name: "Very Long Organization Name",
          member_org_id: "default",
          created_at: 1,
          created_by: "root@example.com",
          accepted_by: null,
        },
      }));
      expect(wrapper.vm.payerName).toBe("Very Long Organization Name");
    });

    it("shows the full name when it is 10 chars or fewer", async () => {
      ({ wrapper } = await mountBillingGroup({
        membership: {
          id: 1,
          payer_org_id: "payer-id",
          payer_org_name: "Acme",
          member_org_id: "default",
          created_at: 1,
          created_by: "root@example.com",
          accepted_by: null,
        },
      }));
      expect(wrapper.vm.payerName).toBe("Acme");
    });

    it("falls back to the payer identifier when no name is returned", async () => {
      ({ wrapper } = await mountBillingGroup({
        membership: {
          id: 1,
          payer_org_id: "payer-id",
          member_org_id: "default",
          created_at: 1,
          created_by: "root@example.com",
          accepted_by: null,
        },
      }));
      expect(wrapper.vm.payerName).toBe("payer-id");
    });
  });

  describe("received invites", () => {
    it("includes only pending invites addressed to the current org", async () => {
      ({ wrapper } = await mountBillingGroup({
        org: "default",
        invites: [
          {
            token: "t1",
            inviter_org_id: "acme",
            invitee_org_id: "default",
            inviter_id: "owner@acme.com",
            status: "Pending",
            created_at: 1,
            expires_at: 2,
          },
          {
            token: "t2",
            inviter_org_id: "globex",
            invitee_org_id: "default",
            inviter_id: "admin@globex.com",
            status: "Rejected",
            created_at: 1,
            expires_at: 2,
          },
          {
            token: "t3",
            inviter_org_id: "default",
            invitee_org_id: "someone-else",
            inviter_id: "me@default.com",
            status: "Pending",
            created_at: 1,
            expires_at: 2,
          },
        ],
      }));
      expect(wrapper.vm.receivedInvites.map((i: any) => i.token)).toEqual([
        "t1",
      ]);
    });
  });

  describe("invite columns", () => {
    it("exposes the expected invite table columns", async () => {
      ({ wrapper } = await mountBillingGroup());
      const ids = wrapper.vm.inviteColumns.map((c: any) => c.id);
      expect(ids).toEqual([
        "index",
        "org_name",
        "org_id",
        "inviter_id",
        "date",
        "actions",
      ]);
    });
  });

  describe("super-org stats and table (no rejected)", () => {
    const members = [
      {
        id: 1,
        payer_org_id: "default",
        member_org_id: "child-1",
        member_org_name: "Child One",
        created_at: 1,
        created_by: "a@b.com",
        accepted_by: null,
      },
    ];
    const sentPending = {
      token: "sent-1",
      inviter_org_id: "default",
      invitee_org_id: "target-org",
      invitee_org_name: "Target Org",
      inviter_id: "me@default.com",
      status: "Pending",
      created_at: 2,
      expires_at: 3,
    };

    it("counts only active members and pending sent invites (total = active + pending)", async () => {
      ({ wrapper } = await mountBillingGroup({
        org: "default",
        members,
        invites: [sentPending],
      }));
      expect(wrapper.vm.activeCount).toBe(1);
      expect(wrapper.vm.pendingCount).toBe(1);
      expect(wrapper.vm.totalCount).toBe(2);
      // rejectedCount no longer exists on the component
      expect(wrapper.vm.rejectedCount).toBeUndefined();
    });

    it("offers only All / Active / Pending filter tabs", async () => {
      ({ wrapper } = await mountBillingGroup({ org: "default", members }));
      const values = wrapper.vm.superFilterTabs.map((t: any) => t.value);
      expect(values).toEqual(["all", "Active", "Pending"]);
    });

    it("super table rows carry both org identifier and org name", async () => {
      ({ wrapper } = await mountBillingGroup({
        org: "default",
        members,
        invites: [sentPending],
      }));
      const rows = wrapper.vm.filteredSuperRows;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        org_id: "child-1",
        org_name: "Child One",
        status: "Active",
      });
      expect(rows[1]).toMatchObject({
        org_id: "target-org",
        org_name: "Target Org",
        status: "Pending",
      });
    });
  });

  describe("invite actions", () => {
    it("accepts an invite by token and refreshes data", async () => {
      billing.accept_billing_group_invite.mockResolvedValue({ data: "ok" });
      ({ wrapper } = await mountBillingGroup({ org: "default" }));

      await wrapper.vm.acceptInvite("token-1");
      await flushPromises();

      expect(billing.accept_billing_group_invite).toHaveBeenCalledWith(
        "default",
        "token-1"
      );
    });

    it("rejects an invite by token", async () => {
      billing.reject_billing_group_invite.mockResolvedValue({ data: "ok" });
      ({ wrapper } = await mountBillingGroup({ org: "default" }));

      await wrapper.vm.rejectInvite("token-2");
      await flushPromises();

      expect(billing.reject_billing_group_invite).toHaveBeenCalledWith(
        "default",
        "token-2"
      );
    });

    // The invite form is migrated to OForm + Zod: the schema (not a disabled
    // button) gates an empty / same-org submit. Drive the REAL <OForm>.
    const getInviteForm = (w: VueWrapper<any>) =>
      (w.findComponent({ name: "OForm" }).vm as any).form;

    it("blocks submit + does NOT send when inviting the current org itself", async () => {
      ({ wrapper } = await mountBillingGroup({
        org: "default",
        renderDrawer: true,
      }));

      const form = getInviteForm(wrapper);
      form.setFieldValue("inviteOrgId", "default");
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(billing.send_billing_group_invite).not.toHaveBeenCalled();
    });

    it("blocks submit + does NOT send when the org id is empty", async () => {
      ({ wrapper } = await mountBillingGroup({
        org: "default",
        renderDrawer: true,
      }));

      const form = getInviteForm(wrapper);
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(billing.send_billing_group_invite).not.toHaveBeenCalled();
    });

    it("sends an invite to a different org", async () => {
      billing.send_billing_group_invite.mockResolvedValue({ data: "ok" });
      ({ wrapper } = await mountBillingGroup({
        org: "default",
        renderDrawer: true,
      }));

      const form = getInviteForm(wrapper);
      form.setFieldValue("inviteOrgId", "target-org");
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(true);
      expect(billing.send_billing_group_invite).toHaveBeenCalledWith(
        "default",
        "target-org"
      );
    });
  });
});
