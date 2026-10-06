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
import { queryClient } from "@/composables/query/queryClient";
import OrgDomainMappings from "./OrgDomainMappings.vue";
import type { OrgDomainMapping } from "./OrgDomainMapping.schema";

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
  default: { list_billing_group_members: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_org_domains: vi.fn(),
      link_org_domain: vi.fn(),
      unlink_org_domain: vi.fn(),
      verify_org_domain: vi.fn(),
      post_organization_settings: vi.fn(),
    },
  });
});

import organizations from "@/services/organizations";
const api = organizations as unknown as Record<string, ReturnType<typeof vi.fn>>;

const DialogStub = defineComponent({
  name: "OrgDomainMappingDialog",
  props: ["open", "mode", "mapping", "orgOptions", "defaultOrgId", "takenDomains", "submit"],
  template: "<div />",
});

const link = (domain: string, state = 0) => ({
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
});

const mountList = async (mappings: OrgDomainMapping[]) => {
  const wrapper = mount(OrgDomainMappings, {
    props: { orgId: "acme", mappings },
    global: {
      plugins: [i18n],
      stubs: { OrgDomainMappingDialog: DialogStub, OTooltip: true, OrgDomainVerification: true },
    },
  });
  await flushPromises();
  return wrapper;
};

const submitFrom = (wrapper: Awaited<ReturnType<typeof mountList>>) =>
  wrapper.findComponent(DialogStub).props("submit") as (_m: OrgDomainMapping) => Promise<boolean>;

const newMapping: OrgDomainMapping = { domain: "new.com", org_id: "acme", role_name: "viewer" };
const existing: OrgDomainMapping = { domain: "old.com", org_id: "acme", role_name: "user" };

describe("OrgDomainMappings", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    api.list_org_domains.mockResolvedValue({ data: [link("old.com", 1)] });
    api.link_org_domain.mockResolvedValue({ data: {} });
    api.unlink_org_domain.mockResolvedValue({ data: {} });
    api.post_organization_settings.mockResolvedValue({ data: {} });
    mockConfirm.mockResolvedValue(true);
  });

  it("links a new domain before saving the mapping", async () => {
    const wrapper = await mountList([existing]);

    await expect(submitFrom(wrapper)(newMapping)).resolves.toBe(true);

    expect(api.link_org_domain).toHaveBeenCalledWith("acme", "new.com");
    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_org_mappings: [existing, newMapping],
    });
    expect(api.link_org_domain.mock.invocationCallOrder[0]).toBeLessThan(
      api.post_organization_settings.mock.invocationCallOrder[0],
    );
  });

  it("does not save the mapping when linking fails", async () => {
    api.link_org_domain.mockRejectedValue({ response: { data: { message: "claimed" } } });
    const wrapper = await mountList([existing]);

    await expect(submitFrom(wrapper)(newMapping)).resolves.toBe(false);

    expect(api.post_organization_settings).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "claimed" }),
    );
  });

  it("releases the new link when saving the mapping fails", async () => {
    api.post_organization_settings.mockRejectedValue(new Error("boom"));
    const wrapper = await mountList([existing]);

    await expect(submitFrom(wrapper)(newMapping)).resolves.toBe(false);

    expect(api.unlink_org_domain).toHaveBeenCalledWith("acme", "new.com");
  });

  it("skips linking a domain this org already holds", async () => {
    api.list_org_domains.mockResolvedValue({ data: [link("old.com", 1), link("new.com")] });
    const wrapper = await mountList([existing]);

    await expect(submitFrom(wrapper)(newMapping)).resolves.toBe(true);

    expect(api.link_org_domain).not.toHaveBeenCalled();
    expect(api.post_organization_settings).toHaveBeenCalled();
  });

  it("saves an edited mapping in place without linking", async () => {
    const wrapper = await mountList([existing]);
    await wrapper.find('[data-test="settings-org-domain-mappings-edit-old.com"]').trigger("click");
    const edited = { ...existing, role_name: "admin" };

    await expect(submitFrom(wrapper)(edited)).resolves.toBe(true);

    expect(api.link_org_domain).not.toHaveBeenCalled();
    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_org_mappings: [edited],
    });
  });

  it("unlinks the domain before removing its mapping", async () => {
    const wrapper = await mountList([existing]);

    await wrapper
      .find('[data-test="settings-org-domain-mappings-delete-old.com"]')
      .trigger("click");
    await flushPromises();

    expect(api.unlink_org_domain).toHaveBeenCalledWith("acme", "old.com");
    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_org_mappings: [],
    });
    expect(api.unlink_org_domain.mock.invocationCallOrder[0]).toBeLessThan(
      api.post_organization_settings.mock.invocationCallOrder[0],
    );
  });

  it("keeps the mapping when unlinking fails", async () => {
    api.unlink_org_domain.mockRejectedValue(new Error("nope"));
    const wrapper = await mountList([existing]);

    await wrapper
      .find('[data-test="settings-org-domain-mappings-delete-old.com"]')
      .trigger("click");
    await flushPromises();

    expect(api.post_organization_settings).not.toHaveBeenCalled();
  });

  it("does nothing when the removal is not confirmed", async () => {
    mockConfirm.mockResolvedValue(false);
    const wrapper = await mountList([existing]);

    await wrapper
      .find('[data-test="settings-org-domain-mappings-delete-old.com"]')
      .trigger("click");
    await flushPromises();

    expect(api.unlink_org_domain).not.toHaveBeenCalled();
    expect(api.post_organization_settings).not.toHaveBeenCalled();
  });

  it("lists a linked domain that has no mapping", async () => {
    api.list_org_domains.mockResolvedValue({ data: [link("old.com", 1), link("orphan.com")] });
    const wrapper = await mountList([existing]);

    expect(wrapper.find('[data-test="settings-org-domain-mappings-row-orphan.com"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="settings-org-domain-mappings-map-orphan.com"]').exists()).toBe(
      true,
    );
  });
});
