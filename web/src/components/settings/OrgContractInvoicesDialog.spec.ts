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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import enLocaleFull from "@/locales/languages/en-US.json";
import store from "../../test/unit/helpers/store";
import OrgContractInvoicesDialog from "./OrgContractInvoicesDialog.vue";

const mockToastFn = vi.fn().mockReturnValue(vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToastFn(...args),
}));

vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_contract_invoices: vi.fn(),
      resend_contract_invoice: vi.fn(),
    },
  });
});

vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn(() => "2026-11-01 00:00"),
}));

const i18n = createI18n({
  locale: "en",
  fallbackLocale: "en",
  legacy: false,
  globalInjection: true,
  messages: { en: enLocaleFull },
});

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "subTitle", "size"],
  emits: ["update:open"],
  template: `<div v-if="open"><slot /></div>`,
};

const invoice = (over: Record<string, any> = {}) => ({
  invoice_id: "CO-c1-20261101T0000-day",
  contract_id: "c1",
  org_id: "acme",
  window_kind: "day",
  window_start: 1793491200000000,
  window_end: 1793577600000000,
  total: "42.97",
  recipients: ["admin@acme.example"],
  status: "sent",
  sent_at: 1793581000000000,
  updated_at: 1793581000000000,
  ...over,
});

describe("OrgContractInvoicesDialog.vue", () => {
  let listInvoices: any;
  let resendInvoice: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: service } = await import("@/services/organizations");
    listInvoices = (service as any).list_contract_invoices;
    resendInvoice = (service as any).resend_contract_invoice;
    store.state.selectedOrganization = { identifier: "_meta" } as any;
  });

  const mountDialog = async (open = true) => {
    const wrapper = mount(OrgContractInvoicesDialog, {
      props: { open, orgId: "acme", orgName: "Acme" },
      global: { plugins: [i18n, store], stubs: { ODialog: ODialogStub } },
    });
    await flushPromises();
    return wrapper;
  };

  it("loads the org's invoices when opened and shows window, total and status", async () => {
    listInvoices.mockResolvedValue({
      data: [
        invoice(),
        invoice({ invoice_id: "CO-c1-20261102T0000-day", status: "failed", sent_at: null }),
      ],
    });
    const wrapper = await mountDialog();
    expect(listInvoices).toHaveBeenCalledWith("_meta", "acme");
    expect(wrapper.findComponent({ name: "ODialog" }).props("title")).toBe(
      "Overage invoices for Acme",
    );
    const first = wrapper.find('[data-test="org-contract-invoice-CO-c1-20261101T0000-day"]');
    expect(first.text()).toContain("2026-11-01 00:00 UTC to 2026-11-01 00:00 UTC");
    expect(first.find('[data-test="org-contract-invoice-total"]').text()).toBe("$42.97");
    expect(first.find('[data-test="org-contract-invoice-status"]').text()).toBe("Sent");
    const second = wrapper.find('[data-test="org-contract-invoice-CO-c1-20261102T0000-day"]');
    expect(second.find('[data-test="org-contract-invoice-status"]').text()).toBe("Failed");
    expect(second.text()).toContain("Not sent yet");
  });

  it("doesn't load while closed", async () => {
    await mountDialog(false);
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it("says so when the org has no invoices", async () => {
    listInvoices.mockResolvedValue({ data: [] });
    const wrapper = await mountDialog();
    expect(wrapper.find('[data-test="org-contract-invoices-empty"]').text()).toBe(
      "No overage invoices for this organization.",
    );
  });

  it("shows the server's error when the list can't be read", async () => {
    listInvoices.mockRejectedValue({ response: { data: { message: "contract sync is off" } } });
    const wrapper = await mountDialog();
    expect(wrapper.find('[data-test="org-contract-invoices-error"]').text()).toBe(
      "contract sync is off",
    );
  });

  it("resends an invoice and shows its new state", async () => {
    listInvoices.mockResolvedValue({ data: [invoice({ status: "failed", sent_at: null })] });
    resendInvoice.mockResolvedValue({ data: invoice({ status: "sent" }) });
    const wrapper = await mountDialog();
    await wrapper.find('[data-test="org-contract-invoice-resend-btn"]').trigger("click");
    await flushPromises();
    expect(resendInvoice).toHaveBeenCalledWith("_meta", "acme", "CO-c1-20261101T0000-day");
    expect(wrapper.find('[data-test="org-contract-invoice-status"]').text()).toBe("Sent");
    expect(mockToastFn).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        message: "Invoice CO-c1-20261101T0000-day sent again.",
      }),
    );
  });

  it("reports a failed resend and keeps the invoice as it was", async () => {
    listInvoices.mockResolvedValue({ data: [invoice({ status: "failed", sent_at: null })] });
    resendInvoice.mockRejectedValue({ response: { data: { message: "smtp is down" } } });
    const wrapper = await mountDialog();
    await wrapper.find('[data-test="org-contract-invoice-resend-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="org-contract-invoice-status"]').text()).toBe("Failed");
    expect(mockToastFn).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "smtp is down" }),
    );
  });
});
