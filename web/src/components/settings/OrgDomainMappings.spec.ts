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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import i18n from "@/locales";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import type { OrgDomainMapping } from "@/services/organizations";
import OrgDomainMappings from "./OrgDomainMappings.vue";

const { mockToast, mockConfirm } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mockToast }));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme", label: "Acme" } } }),
}));
vi.mock("@/services/billings", () => ({
  default: {
    list_billing_group_members: vi
      .fn()
      .mockResolvedValue({ data: [{ member_org_id: "child", member_org_name: "Child" }] }),
  },
}));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_org_domains: vi.fn(),
      post_organization_settings: vi.fn(),
    },
  });
});

import organizations from "@/services/organizations";
const api = organizations as unknown as Record<string, ReturnType<typeof vi.fn>>;

const DialogStub = defineComponent({
  name: "OrgDomainMappingDialog",
  props: [
    "open",
    "mode",
    "mapping",
    "domainOptions",
    "orgOptions",
    "defaultOrgId",
    "takenKeys",
    "submit",
  ],
  template: "<div />",
});

const link = (domain: string, state = 1) => ({
  id: domain,
  org_id: "acme",
  domain,
  verification_token: "o2v_token",
  verification_state: state,
  verification_failure_reason: null,
  verified_at: null,
  last_checked_at: null,
  created_at: 0,
  updated_at: 0,
  meta_mapped: false,
});

const existing: OrgDomainMapping = {
  domain: "acme.com",
  org_id: "acme",
  base_role: "allowed_user",
  role_claim_name: null,
  create_missing_roles: false,
};
const childMapping: OrgDomainMapping = {
  domain: "acme.com",
  org_id: "child",
  base_role: "viewer",
  role_claim_name: "groups",
  create_missing_roles: true,
};

// Covers OTable's 50ms skeleton hold, which otherwise hides rows that already landed.
const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
  }
};

const mountList = async (mappings: OrgDomainMapping[], enforce = false) => {
  const wrapper = mount(OrgDomainMappings, {
    props: { orgId: "acme", mappings, enforceAllowedOrgsOnly: enforce },
    global: {
      plugins: [i18n, withQueryClient()],
      stubs: { OrgDomainMappingDialog: DialogStub, OTooltip: true },
    },
  });
  await settle();
  return wrapper;
};

type ListWrapper = Awaited<ReturnType<typeof mountList>>;

const dialog = (wrapper: ListWrapper) => wrapper.findComponent(DialogStub);
const submitFrom = (wrapper: ListWrapper) =>
  dialog(wrapper).props("submit") as (_m: OrgDomainMapping) => Promise<boolean>;

describe("OrgDomainMappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list_org_domains.mockResolvedValue({
      data: [link("acme.com"), link("pending.com", 0)],
    });
    api.post_organization_settings.mockResolvedValue({ data: {} });
    mockConfirm.mockResolvedValue(true);
  });

  it("offers only verified domains and this org plus its billing group", async () => {
    const wrapper = await mountList([existing]);

    expect(
      dialog(wrapper)
        .props("domainOptions")
        .map((o: any) => o.value),
    ).toEqual(["acme.com"]);
    expect(
      dialog(wrapper)
        .props("orgOptions")
        .map((o: any) => o.value),
    ).toEqual(["acme", "child"]);
  });

  it("appends a new mapping", async () => {
    const wrapper = await mountList([existing]);
    (wrapper.vm as any).openAdd();

    await expect(submitFrom(wrapper)(childMapping)).resolves.toBe(true);

    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_org_mappings: [existing, childMapping],
    });
  });

  it("allows one domain to map to several organizations", async () => {
    const wrapper = await mountList([existing, childMapping]);
    (wrapper.vm as any).openAdd();
    await flushPromises();

    expect(dialog(wrapper).props("takenKeys")).toEqual(["acme.com|acme", "acme.com|child"]);
  });

  it("saves an edited mapping in place and frees its own key", async () => {
    const wrapper = await mountList([existing, childMapping]);
    await wrapper
      .find('[data-test="settings-org-domain-mappings-edit-acme.com|child"]')
      .trigger("click");
    await flushPromises();
    expect(dialog(wrapper).props("takenKeys")).toEqual(["acme.com|acme"]);

    const edited = { ...childMapping, base_role: "admin" };
    await expect(submitFrom(wrapper)(edited)).resolves.toBe(true);

    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_org_mappings: [existing, edited],
    });
  });

  it("keeps the dialog open when saving fails", async () => {
    api.post_organization_settings.mockRejectedValue({
      response: { data: { message: "not verified" } },
    });
    const wrapper = await mountList([existing]);

    await expect(submitFrom(wrapper)(childMapping)).resolves.toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "not verified" }),
    );
  });

  it("removes only the confirmed mapping", async () => {
    const wrapper = await mountList([existing, childMapping]);

    await wrapper
      .find('[data-test="settings-org-domain-mappings-delete-acme.com|acme"]')
      .trigger("click");
    await flushPromises();

    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_org_mappings: [childMapping],
    });
  });

  it("does nothing when the removal is not confirmed", async () => {
    mockConfirm.mockResolvedValue(false);
    const wrapper = await mountList([existing]);

    await wrapper
      .find('[data-test="settings-org-domain-mappings-delete-acme.com|acme"]')
      .trigger("click");
    await flushPromises();

    expect(api.post_organization_settings).not.toHaveBeenCalled();
  });

  it("flags a mapping whose domain is no longer verified", async () => {
    const stale = { ...existing, domain: "pending.com" };
    const wrapper = await mountList([existing, stale]);

    expect(
      wrapper.find('[data-test="settings-org-domain-mappings-unverified-pending.com"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="settings-org-domain-mappings-unverified-acme.com"]').exists(),
    ).toBe(false);
  });

  it("asks before turning on removal from other organizations", async () => {
    const wrapper = await mountList([existing]);

    await wrapper.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", true);
    await flushPromises();

    expect(mockConfirm).toHaveBeenCalled();
    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      enforce_allowed_orgs_only: true,
    });
  });

  it("leaves the setting off when the confirmation is declined", async () => {
    mockConfirm.mockResolvedValue(false);
    const wrapper = await mountList([existing]);

    await wrapper.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", true);
    await flushPromises();

    expect(api.post_organization_settings).not.toHaveBeenCalled();
  });

  it("turns the setting off without asking", async () => {
    const wrapper = await mountList([existing], true);

    await wrapper.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", false);
    await flushPromises();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      enforce_allowed_orgs_only: false,
    });
  });

  it("flips the switch back when turning it on is declined", async () => {
    mockConfirm.mockResolvedValue(false);
    const wrapper = await mountList([existing]);
    const switchEl = () => wrapper.find('[role="switch"]');

    await switchEl().trigger("click");
    await flushPromises();

    expect(switchEl().attributes("aria-checked")).toBe("false");
    expect(api.post_organization_settings).not.toHaveBeenCalled();
  });
});
