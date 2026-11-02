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
import OrgDomainRestrictions from "./OrgDomainRestrictions.vue";

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
    default: { post_organization_settings: vi.fn(), list_org_domains: vi.fn() },
  });
});

import organizations from "@/services/organizations";
const api = organizations as unknown as Record<string, ReturnType<typeof vi.fn>>;

const BlocklistDialogStub = defineComponent({
  name: "OrgDomainBlocklistDialog",
  props: ["open", "blocklist", "domainOptions", "submit"],
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

const apiRule = { domain: "acme.com", allow_all_users: true, allowed_emails: [] };

const config = {
  domains: [apiRule],
  enabled: true,
  blocked_emails: ["bob@acme.com"],
  blocked_domains: ["spam.net"],
  updated_at: 0,
};

// Covers OTable's 50ms skeleton hold, which otherwise hides rows that already landed.
const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
  }
};

const mountRules = async () => {
  const wrapper = mount(OrgDomainRestrictions, {
    props: { orgId: "acme", config },
    global: {
      plugins: [i18n, withQueryClient()],
      stubs: { OrgDomainBlocklistDialog: BlocklistDialogStub, OTooltip: true },
    },
  });
  await settle();
  return wrapper;
};

type RulesWrapper = Awaited<ReturnType<typeof mountRules>>;

const dialog = (wrapper: RulesWrapper) => wrapper.findComponent(BlocklistDialogStub);

describe("OrgDomainRestrictions: blocked users table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    api.post_organization_settings.mockResolvedValue({ data: {} });
    api.list_org_domains.mockResolvedValue({
      data: [link("acme.com"), link("acme.io"), link("pending.com", 0)],
    });
  });

  it("lists one row per domain with its blocked email count", async () => {
    const wrapper = await mountRules();

    expect(
      wrapper.find('[data-test="settings-org-domain-restrictions-emails-acme.com"]').text(),
    ).toContain("1 blocked");
    expect(
      wrapper.find('[data-test="settings-org-domain-restrictions-emails-spam.net"]').exists(),
    ).toBe(false);
  });

  it("offers only verified domains that have no blocked users yet", async () => {
    const wrapper = await mountRules();

    await wrapper.find('[data-test="settings-org-domain-restrictions-add-btn"]').trigger("click");
    expect(dialog(wrapper).props("open")).toBe(true);
    expect(dialog(wrapper).props("blocklist")).toBeNull();
    expect(
      dialog(wrapper)
        .props("domainOptions")
        .map((o: { value: string }) => o.value),
    ).toEqual(["acme.io"]);
  });

  it("saves new blocked users and keeps the API-only rules", async () => {
    const wrapper = await mountRules();

    const saved = await dialog(wrapper).props("submit")({
      name: "acme.io",
      blockedEmails: ["eve@acme.io"],
    });

    expect(saved).toBe(true);
    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_management_config: expect.objectContaining({
        domains: [apiRule],
        blocked_domains: ["spam.net"],
        blocked_emails: ["bob@acme.com", "eve@acme.io"],
      }),
    });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("replaces a domain's blocked users on edit", async () => {
    const wrapper = await mountRules();

    await wrapper
      .find('[data-test="settings-org-domain-restrictions-edit-acme.com"]')
      .trigger("click");
    expect(dialog(wrapper).props("blocklist").name).toBe("acme.com");
    expect(
      dialog(wrapper)
        .props("domainOptions")
        .map((o: { value: string }) => o.value),
    ).toEqual(["acme.com"]);

    await dialog(wrapper).props("submit")({ name: "acme.com", blockedEmails: ["amy@acme.com"] });

    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_management_config: expect.objectContaining({
        domains: [apiRule],
        blocked_emails: ["amy@acme.com"],
      }),
    });
  });

  it("keeps the dialog open when the save fails", async () => {
    api.post_organization_settings.mockRejectedValue(new Error("boom"));
    const wrapper = await mountRules();

    const saved = await dialog(wrapper).props("submit")({
      name: "acme.io",
      blockedEmails: ["eve@acme.io"],
    });

    expect(saved).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("unblocks the domain's users after confirming", async () => {
    const wrapper = await mountRules();

    await wrapper
      .find('[data-test="settings-org-domain-restrictions-remove-acme.com"]')
      .trigger("click");
    await settle();

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(api.post_organization_settings).toHaveBeenCalledWith("acme", {
      domain_management_config: expect.objectContaining({
        blocked_emails: [],
        domains: [apiRule],
        blocked_domains: ["spam.net"],
      }),
    });
  });

  it("does not save when the unblock is declined", async () => {
    mockConfirm.mockResolvedValue(false);
    const wrapper = await mountRules();

    await wrapper
      .find('[data-test="settings-org-domain-restrictions-remove-acme.com"]')
      .trigger("click");
    await settle();

    expect(api.post_organization_settings).not.toHaveBeenCalled();
  });
});
