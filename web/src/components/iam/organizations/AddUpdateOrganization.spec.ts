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
// AddUpdateOrganization is migrated to OForm + Zod
// (AddUpdateOrganization.schema.ts). It is an Options-API form, so the schema +
// the edit-prefill defaults computed are returned from setup(). These tests mount
// the REAL <OForm> (only ODialog is stubbed) so the schema actually gates the
// submit. Behavior is asserted (name required + regex + service call + emits),
// not removed internals (showNameError / isValidOrgName / the disabled gate).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";

import AddUpdateOrganization from "@/components/iam/organizations/AddUpdateOrganization.vue";

// Default to cloud so the billing-group checkbox branch is reachable.
vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "true",
    isEnterprise: "false",
  },
}));

vi.mock("@/services/organizations", () => ({
  default: {
    create: vi.fn(async (data: any) => ({
      status: 200,
      data: { data: { id: "1", name: data.name, identifier: "org-1" } },
    })),
    rename_organization: vi.fn(async (_id: any, name: string) => ({
      status: 200,
      data: { data: { id: "1", name, identifier: "org-1" } },
    })),
  },
}));

const orgService = (await import("@/services/organizations")).default;

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
  toastRecords: [],
  useToast: vi.fn(),
}));
import { toast } from "@/lib/feedback/Toast/useToast";

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

// ODialog stub: keeps slot content queryable + exposes form-id and open state.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "size", "title", "primaryButtonLabel", "secondaryButtonLabel", "formId"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div data-test-stub="o-dialog" :data-open="open" :data-title="title" :data-form-id="formId">
      <slot />
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
  `,
  inheritAttrs: false,
};

const mountComp = (props: Record<string, any> = {}): VueWrapper<any> =>
  mount(AddUpdateOrganization, {
    global: {
      plugins: [i18n, router, store],
      stubs: { ODialog: ODialogStub },
    },
    props: { open: true, modelValue: { id: "", name: "" }, ...props },
  });

const getForm = (wrapper: VueWrapper<any>) => wrapper.findComponent({ name: "OForm" });
const getNameInput = (wrapper: VueWrapper<any>) => wrapper.find('[data-test="org-name"] input');
const submitForm = async (wrapper: VueWrapper<any>) => {
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
};

describe("AddUpdateOrganization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders create title when not updating", () => {
      const wrapper = mountComp();
      expect(wrapper.find('[data-test-stub="o-dialog"]').attributes("data-title")).toBe(
        "New organization",
      );
    });

    it("renders update title + the read-only id field when beingUpdated", () => {
      const wrapper = mountComp({ modelValue: { id: "123", name: "Acme" } });
      expect(wrapper.find('[data-test-stub="o-dialog"]').attributes("data-title")).toBe(
        "Update organization",
      );
      expect(wrapper.vm.beingUpdated).toBe(true);
    });

    it("wires the OForm to the dialog via form-id", () => {
      const wrapper = mountComp();
      expect(getForm(wrapper).exists()).toBe(true);
      expect(wrapper.find('[data-test-stub="o-dialog"]').attributes("data-form-id")).toBe(
        "add-update-organization-form",
      );
    });

    it("returns the schema + prefilled defaults from setup()", () => {
      const wrapper = mountComp({ modelValue: { id: "9", name: "Acme" } });
      expect(getForm(wrapper).props("schema")).toBeDefined();
      expect(getForm(wrapper).props("defaultValues")).toEqual({
        id: "9",
        name: "Acme",
        makeBilledMember: false,
      });
    });

    it("keeps Save enabled (R3 — no disabled gate)", () => {
      const wrapper = mountComp();
      expect(
        wrapper.find('[data-test="o-dialog-primary-btn"]').attributes("disabled"),
      ).toBeUndefined();
    });
  });

  describe("schema validation (real OForm)", () => {
    it("blocks submit and does NOT call create when name is empty", async () => {
      const wrapper = mountComp();
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(orgService.create).not.toHaveBeenCalled();
    });

    it("blocks submit for a name with invalid characters (restored regex rule)", async () => {
      const wrapper = mountComp();
      await getNameInput(wrapper).setValue("bad@name#");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(orgService.create).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Use alphanumeric characters, space and underscore only.");
    });

    it("blocks submit when the name exceeds 100 characters (max rule)", async () => {
      const wrapper = mountComp();
      // maxlength caps typing, so set the value directly to exercise the schema.
      getForm(wrapper).vm.form.setFieldValue("name", "a".repeat(101));
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(orgService.create).not.toHaveBeenCalled();
    });

    it("trims name on submit and calls create, emits updated + update:open false", async () => {
      const wrapper = mountComp();
      await getNameInput(wrapper).setValue("  My Org  ");
      await submitForm(wrapper);

      expect(orgService.create).toHaveBeenCalledWith({ name: "My Org" });
      expect(wrapper.emitted("updated")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });

  describe("create / update flows", () => {
    it("when create returns non-200, sets pro plan required flow and navigates to subscribe", async () => {
      vi.spyOn(orgService, "create").mockResolvedValueOnce({
        status: 402,
        data: {
          message: "Need Pro",
          identifier: "org-new",
          data: { identifier: "org-new" },
        },
      } as any);
      const pushSpy = vi.spyOn(router, "push");
      const wrapper = mountComp();

      await getNameInput(wrapper).setValue("Test Org");
      await submitForm(wrapper);

      expect(wrapper.vm.proPlanRequired).toBe(true);
      expect(wrapper.vm.proPlanMsg).toBe("Need Pro");
      expect(wrapper.vm.newOrgIdentifier).toBe("org-new");
      expect(pushSpy).toHaveBeenCalledWith({
        name: "organizations",
        query: expect.objectContaining({ action: "subscribe" }),
      });
    });

    it("handles create rejection and shows an error toast", async () => {
      vi.spyOn(orgService, "create").mockRejectedValueOnce({
        response: { data: { message: "Organization creation failed." } },
      });
      const wrapper = mountComp();

      await getNameInput(wrapper).setValue("Err Org");
      await submitForm(wrapper);

      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("renames the organization in update mode", async () => {
      const wrapper = mountComp({ modelValue: { id: "123", name: "Acme" } });
      await getNameInput(wrapper).setValue("Acme Renamed");
      await submitForm(wrapper);

      expect(orgService.rename_organization).toHaveBeenCalledWith("123", "Acme Renamed");
    });

    it("completeSubscriptionProcess navigates to billing plans with newOrgIdentifier", async () => {
      const wrapper = mountComp();
      wrapper.vm.newOrgIdentifier = "org-123";
      const pushSpy = vi.spyOn(router, "push");

      wrapper.vm.completeSubscriptionProcess();
      expect(pushSpy).toHaveBeenCalledWith("/billings/plans?org_identifier=org-123");
    });
  });

  describe("dialog interactions", () => {
    it("forwards drawer update:open to parent", async () => {
      const wrapper = mountComp();
      await wrapper.findComponent({ name: "ODialog" }).vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("cancel button emits update:open false", async () => {
      const wrapper = mountComp();
      await wrapper.findComponent({ name: "ODialog" }).vm.$emit("click:secondary");
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });
});

describe("AddUpdateOrganization.vue – billing group gating", () => {
  let wrapper: VueWrapper<any>;

  async function mountForBillingGroup(org = "default", allowedOrgs = "default") {
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: org,
      label: org,
      name: org,
    };
    store.state.zoConfig = {
      ...store.state.zoConfig,
      billing_group_allowed_orgs: allowedOrgs,
    };

    const w = mount(AddUpdateOrganization, {
      global: {
        plugins: [store, i18n, router],
        stubs: { ODialog: ODialogStub },
      },
      props: { open: true, modelValue: { id: "", name: "" } },
    });
    await w.vm.$nextTick();
    return w;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("canMakeBilledMember is true when the org is in billing_group_allowed_orgs", async () => {
    wrapper = await mountForBillingGroup("default", "alpha,default,beta");
    expect(wrapper.vm.canMakeBilledMember).toBe(true);
  });

  it("trims whitespace around allow-list entries", async () => {
    wrapper = await mountForBillingGroup("default", " alpha , default ");
    expect(wrapper.vm.canMakeBilledMember).toBe(true);
  });

  it("canMakeBilledMember is false when the org is not in the list", async () => {
    wrapper = await mountForBillingGroup("default", "alpha,beta");
    expect(wrapper.vm.canMakeBilledMember).toBe(false);
  });

  it("renders the billed-member checkbox only when the org is allowed", async () => {
    wrapper = await mountForBillingGroup("default", "default");
    expect(wrapper.find('[data-test="org-make-billed-member"]').exists()).toBe(true);
  });

  it("hides the billed-member checkbox when the org is not allowed", async () => {
    wrapper = await mountForBillingGroup("default", "other-org");
    expect(wrapper.find('[data-test="org-make-billed-member"]').exists()).toBe(false);
  });
});
