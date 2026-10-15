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
import OrgLinkedDomains from "./OrgLinkedDomains.vue";

const { mockToast, mockConfirm } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mockToast }));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm }),
}));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_org_domains: vi.fn(),
      list_org_domain_requests: vi.fn(),
      link_org_domain: vi.fn(),
      raise_org_domain_request: vi.fn(),
      unlink_org_domain: vi.fn(),
      verify_org_domain: vi.fn(),
      post_organization_settings: vi.fn(),
    },
  });
});

import organizations from "@/services/organizations";
const api = organizations as unknown as Record<string, ReturnType<typeof vi.fn>>;

const DialogStub = defineComponent({
  name: "OrgLinkDomainDialog",
  props: ["open", "initialMethod", "submit"],
  template: "<div />",
});

const link = (domain: string, state = 1, metaMapped = false) => ({
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
  meta_mapped: metaMapped,
});

const request = (domain: string, status: number, orgId = "acme") => ({
  id: `req-${domain}`,
  org_id: orgId,
  domain,
  created_at: 0,
  updated_at: 0,
  requested_by: "a@acme.com",
  answered_by: null,
  status,
  reason: status === 2 ? "not yours" : null,
});

const mapping = (domain: string, orgId = "acme"): OrgDomainMapping => ({
  domain,
  org_id: orgId,
  base_role: "allowed_user",
  role_claim_name: null,
  create_missing_roles: false,
});

// Covers OTable's 50ms skeleton hold, which otherwise hides rows that already landed.
const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
  }
};

const mountList = async (mappings: OrgDomainMapping[] = []) => {
  const wrapper = mount(OrgLinkedDomains, {
    props: { orgId: "acme", mappings },
    global: {
      plugins: [i18n, withQueryClient()],
      stubs: { OrgLinkDomainDialog: DialogStub, OTooltip: true, OrgDomainVerification: true },
    },
  });
  await settle();
  return wrapper;
};

type ListWrapper = Awaited<ReturnType<typeof mountList>>;

const submitFrom = (wrapper: ListWrapper) =>
  wrapper.findComponent(DialogStub).props("submit") as (
    _domain: string,
    _method: "dns" | "request",
  ) => Promise<boolean>;

const exists = (wrapper: ListWrapper, dataTest: string) =>
  wrapper.find(`[data-test="${dataTest}"]`).exists();

describe("OrgLinkedDomains", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list_org_domains.mockResolvedValue({
      data: [link("acme.com"), link("pending.com", 0), link("granted.com", 1, true)],
    });
    api.list_org_domain_requests.mockResolvedValue({
      data: [
        request("asked.com", 0),
        request("denied.com", 2),
        request("granted.com", 1),
        request("other.com", 0, "someone-else"),
      ],
    });
    api.link_org_domain.mockResolvedValue({ data: {} });
    api.raise_org_domain_request.mockResolvedValue({ data: {} });
    api.unlink_org_domain.mockResolvedValue({ data: {} });
    api.post_organization_settings.mockResolvedValue({ data: {} });
    mockConfirm.mockResolvedValue(true);
  });

  it("lists links and this org's open or rejected requests", async () => {
    const wrapper = await mountList();

    for (const domain of ["acme.com", "pending.com", "granted.com", "asked.com", "denied.com"]) {
      expect(exists(wrapper, `settings-org-linked-domains-state-${domain}`)).toBe(true);
    }
    expect(exists(wrapper, "settings-org-linked-domains-state-other.com")).toBe(false);
    expect(
      wrapper.findAll('[data-test="settings-org-linked-domains-state-granted.com"]'),
    ).toHaveLength(1);
  });

  it("offers verify only on DNS links that are not verified", async () => {
    const wrapper = await mountList();

    expect(exists(wrapper, "settings-org-linked-domains-verify-pending.com")).toBe(true);
    expect(exists(wrapper, "settings-org-linked-domains-verify-acme.com")).toBe(false);
    expect(exists(wrapper, "settings-org-linked-domains-verify-granted.com")).toBe(false);
    expect(exists(wrapper, "settings-org-linked-domains-remove-asked.com")).toBe(false);
  });

  it("explains a failed check and a rejection in the status tooltip, and expands only DNS rows", async () => {
    api.list_org_domains.mockResolvedValue({
      data: [
        { ...link("broken.com", 2), verification_failure_reason: 1 },
        link("pending.com", 0),
        link("granted.com", 1, true),
      ],
    });
    const wrapper = await mountList();
    const reason = (domain: string) =>
      wrapper.find(`[data-test="settings-org-linked-domains-state-reason-${domain}"]`);
    const canExpand = (domain: string) =>
      wrapper
        .findAll("tr")
        .find((tr) =>
          tr.find(`[data-test="settings-org-linked-domains-state-${domain}"]`).exists(),
        )!
        .find('[data-test="o2-table-expand-cell"] button')
        .exists();

    expect(reason("broken.com").attributes("content")).toBe(
      "TXT record found, but the value doesn't match",
    );
    expect(reason("denied.com").attributes("content")).toBe("not yours");
    expect(reason("pending.com").exists()).toBe(false);

    expect(canExpand("broken.com")).toBe(true);
    expect(canExpand("pending.com")).toBe(true);
    expect(canExpand("denied.com")).toBe(false);
    expect(canExpand("granted.com")).toBe(false);
  });

  it("keeps Remove in the same slot whether or not Verify now is shown", async () => {
    const wrapper = await mountList();
    const slotOf = (domain: string) => {
      const remove = wrapper.find(`[data-test="settings-org-linked-domains-remove-${domain}"]`);
      return [...remove.element.parentElement!.children].indexOf(remove.element);
    };

    expect(slotOf("acme.com")).toBe(slotOf("pending.com"));
    expect(slotOf("granted.com")).toBe(slotOf("pending.com"));
  });

  it("links through DNS or raises a request depending on the method", async () => {
    const wrapper = await mountList();

    await expect(submitFrom(wrapper)("new.com", "dns")).resolves.toBe(true);
    expect(api.link_org_domain).toHaveBeenCalledWith("acme", "new.com");
    expect(api.raise_org_domain_request).not.toHaveBeenCalled();

    await expect(submitFrom(wrapper)("ask.com", "request")).resolves.toBe(true);
    expect(api.raise_org_domain_request).toHaveBeenCalledWith("acme", "ask.com");
  });

  it("refuses a second DNS link for a domain this org already linked", async () => {
    const wrapper = await mountList();

    await expect(submitFrom(wrapper)("pending.com", "dns")).resolves.toBe(false);
    expect(api.link_org_domain).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("still allows a link request for a domain pending DNS verification", async () => {
    const wrapper = await mountList();

    await expect(submitFrom(wrapper)("pending.com", "request")).resolves.toBe(true);
    expect(api.raise_org_domain_request).toHaveBeenCalledWith("acme", "pending.com");
  });

  it("keeps the dialog open when linking fails", async () => {
    api.link_org_domain.mockRejectedValue({ response: { data: { message: "taken" } } });
    const wrapper = await mountList();

    await expect(submitFrom(wrapper)("new.com", "dns")).resolves.toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "taken" }),
    );
  });

  it("removes the domain's mappings before unlinking it", async () => {
    const wrapper = await mountList([
      mapping("acme.com"),
      mapping("acme.com", "child"),
      mapping("x.com"),
    ]);

    await wrapper
      .find('[data-test="settings-org-linked-domains-remove-acme.com"]')
      .trigger("click");
    await flushPromises();

    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_org_mappings: [mapping("x.com")],
    });
    expect(api.unlink_org_domain).toHaveBeenCalledWith("acme", "acme.com");
    expect(api.post_organization_settings.mock.invocationCallOrder[0]).toBeLessThan(
      api.unlink_org_domain.mock.invocationCallOrder[0],
    );
  });

  it("keeps the link when removing its mappings fails", async () => {
    api.post_organization_settings.mockRejectedValue(new Error("boom"));
    const wrapper = await mountList([mapping("acme.com")]);

    await wrapper
      .find('[data-test="settings-org-linked-domains-remove-acme.com"]')
      .trigger("click");
    await flushPromises();

    expect(api.unlink_org_domain).not.toHaveBeenCalled();
  });

  it("unlinks without touching settings when nothing is mapped", async () => {
    const wrapper = await mountList([mapping("x.com")]);

    await wrapper
      .find('[data-test="settings-org-linked-domains-remove-acme.com"]')
      .trigger("click");
    await flushPromises();

    expect(api.post_organization_settings).not.toHaveBeenCalled();
    expect(api.unlink_org_domain).toHaveBeenCalledWith("acme", "acme.com");
  });

  it("does nothing when the removal is not confirmed", async () => {
    mockConfirm.mockResolvedValue(false);
    const wrapper = await mountList([mapping("acme.com")]);

    await wrapper
      .find('[data-test="settings-org-linked-domains-remove-acme.com"]')
      .trigger("click");
    await flushPromises();

    expect(api.post_organization_settings).not.toHaveBeenCalled();
    expect(api.unlink_org_domain).not.toHaveBeenCalled();
  });
});
