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
import OrgDomainRequests from "./OrgDomainRequests.vue";

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mockToast }));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_org_domain_requests: vi.fn(),
      approve_org_domain_request: vi.fn(),
      reject_org_domain_request: vi.fn(),
    },
  });
});

import organizations from "@/services/organizations";
const api = organizations as unknown as Record<string, ReturnType<typeof vi.fn>>;

const DialogStub = defineComponent({
  name: "OrgDomainRequestDecisionDialog",
  props: ["open", "request", "approve", "submit"],
  template: "<div />",
});

const request = (id: string, status: number) => ({
  id,
  org_id: "acme",
  domain: `${id}.com`,
  created_at: 0,
  updated_at: 0,
  requested_by: "a@acme.com",
  answered_by: null,
  status,
  reason: null,
});

// Covers OTable's 50ms skeleton hold, which otherwise hides rows that already landed.
const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
  }
};

const mountList = async () => {
  const wrapper = mount(OrgDomainRequests, {
    props: { orgId: "_meta" },
    global: {
      plugins: [i18n, withQueryClient()],
      stubs: { OrgDomainRequestDecisionDialog: DialogStub, OTooltip: true },
    },
  });
  await settle();
  return wrapper;
};

describe("OrgDomainRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list_org_domain_requests.mockResolvedValue({
      data: [request("open", 0), request("done", 1), request("no", 2)],
    });
    api.approve_org_domain_request.mockResolvedValue({ data: {} });
    api.reject_org_domain_request.mockResolvedValue({ data: {} });
  });

  it("shows only pending requests by default", async () => {
    const wrapper = await mountList();

    expect(wrapper.find('[data-test="settings-org-domain-requests-approve-open"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).not.toContain("done.com");
    expect(wrapper.text()).not.toContain("no.com");
  });

  it("approves with the given reason", async () => {
    const wrapper = await mountList();

    await wrapper.find('[data-test="settings-org-domain-requests-approve-open"]').trigger("click");
    const dialog = wrapper.findComponent(DialogStub);
    expect(dialog.props("approve")).toBe(true);

    await expect(dialog.props("submit")("owns it")).resolves.toBe(true);
    expect(api.approve_org_domain_request).toHaveBeenCalledWith("_meta", "open", "owns it");
    expect(api.reject_org_domain_request).not.toHaveBeenCalled();
  });

  it("rejects through the reject endpoint", async () => {
    const wrapper = await mountList();

    await wrapper.find('[data-test="settings-org-domain-requests-reject-open"]').trigger("click");
    const dialog = wrapper.findComponent(DialogStub);
    expect(dialog.props("approve")).toBe(false);

    await expect(dialog.props("submit")("not theirs")).resolves.toBe(true);
    expect(api.reject_org_domain_request).toHaveBeenCalledWith("_meta", "open", "not theirs");
  });

  it("keeps the dialog open when the decision fails", async () => {
    api.approve_org_domain_request.mockRejectedValue({
      response: { data: { message: "already linked" } },
    });
    const wrapper = await mountList();

    await wrapper.find('[data-test="settings-org-domain-requests-approve-open"]').trigger("click");

    await expect(wrapper.findComponent(DialogStub).props("submit")("")).resolves.toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "already linked" }),
    );
  });
});
