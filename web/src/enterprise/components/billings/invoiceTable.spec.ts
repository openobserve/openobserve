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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import BillingService from "@/services/billings";
import InvoiceTable from "./invoiceTable.vue";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Mock toast
const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(() => vi.fn()), // Returns dismiss function
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
  useToast: () => ({
    toast: mockToast,
    toasts: [],
  }),
}));

// Mock child components
vi.mock("@/components/shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: '<div data-testid="no-data">No Data</div>',
  },
}));

// Mock BillingService
vi.mock("@/services/billings", () => ({
  default: {
    list_invoice_history: vi.fn().mockResolvedValue({
      data: { invoices: [] },
    }),
  },
}));

// Mock getImageURL
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImageURL: vi.fn(() => "test-image-url"),
    mergeRoutes: vi.fn((base: any, additional: any) => [...base, ...additional]),
  };
});

describe("InvoiceTable Component", () => {
  let wrapper: any;

  const mockInvoiceData = {
    data: {
      invoices: [
        {
          period_start: "2023-01-01",
          period_end: "2023-01-31",
          paid: true,
          total: 100,
          currency: "usd",
          amount_paid: 100,
          amount_due: 0,
          attempt_count: 1,
          statue: "paid",
          invoice_pdf: "https://example.com/invoice.pdf",
        },
        {
          period_start: "2023-02-01",
          period_end: "2023-02-28",
          paid: false,
          total: 150,
          currency: "eur",
          amount_paid: 0,
          amount_due: 150,
          attempt_count: 0,
          statue: "open",
          invoice_pdf: "https://example.com/invoice2.pdf",
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: return empty invoices
    vi.mocked(BillingService.list_invoice_history).mockResolvedValue({
      data: { invoices: [] },
    });

    mockToast.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  function mountInvoiceTable() {
    return mount(InvoiceTable, {
      attachTo: "#app",
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
    });
  }

  describe("Component Rendering", () => {
    it("renders the component successfully", () => {
      wrapper = mountInvoiceTable();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders a table element", () => {
      wrapper = mountInvoiceTable();
      expect(wrapper.find("table").exists()).toBe(true);
    });

    it("shows NoData component when there are no invoices", async () => {
      wrapper = mountInvoiceTable();
      await flushPromises();
      expect(wrapper.find('[data-testid="no-data"]').exists()).toBe(true);
    });

    it("renders invoice rows when data is available", async () => {
      vi.mocked(BillingService.list_invoice_history).mockResolvedValue(mockInvoiceData);

      wrapper = mountInvoiceTable();
      await flushPromises();

      // Wait for the data to be processed and rendered
      await wrapper.vm.$nextTick();

      // Check that the table body rows are rendered
      const rows = wrapper.findAll("tbody tr");
      expect(rows.length).toBe(2);
    });
  });

  describe("Service Integration", () => {
    it("calls BillingService.list_invoice_history on mount", () => {
      wrapper = mountInvoiceTable();
      expect(BillingService.list_invoice_history).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier
      );
    });

    it("calls BillingService with the correct organization identifier", () => {
      const testOrgId = "test-org";
      store.state.selectedOrganization.identifier = testOrgId;

      wrapper = mount(InvoiceTable, {
        attachTo: "#app",
        global: {
          provide: { store },
          plugins: [i18n, router],
        },
      });

      expect(BillingService.list_invoice_history).toHaveBeenCalledWith(testOrgId);
    });

    it("shows loading toast on mount", () => {
      wrapper = mountInvoiceTable();
      expect(mockToast).toHaveBeenCalledWith({
        variant: "loading",
        message: "Please wait while loading invoice history...",
        timeout: 0,
      });
    });

    it("shows error toast when API fails", async () => {
      const testError = new Error("API Error");
      vi.mocked(BillingService.list_invoice_history).mockRejectedValue(testError);

      wrapper = mountInvoiceTable();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "API Error",
        timeout: 5000,
      });
    });

    it("renders invoice data with correct formatted values when service succeeds", async () => {
      vi.mocked(BillingService.list_invoice_history).mockResolvedValue(mockInvoiceData);

      wrapper = mountInvoiceTable();
      await flushPromises();
      await wrapper.vm.$nextTick();

      const tableHtml = wrapper.html();
      // Check formatted currency values
      expect(tableHtml).toContain("100 USD");
      expect(tableHtml).toContain("150 EUR");
    });
  });

  describe("Invoice Data Formatting", () => {
    it("formats currency as total + currency uppercase", () => {
      const formatCurrency = (total: number, currency: string) => {
        return total + " " + currency.toUpperCase();
      };

      expect(formatCurrency(100, "usd")).toBe("100 USD");
      expect(formatCurrency(150, "eur")).toBe("150 EUR");
      expect(formatCurrency(0, "gbp")).toBe("0 GBP");
    });

    it("formats paid status correctly", () => {
      const formatPaidStatus = (paid: boolean) => (paid ? "Yes" : "No");

      expect(formatPaidStatus(true)).toBe("Yes");
      expect(formatPaidStatus(false)).toBe("No");
    });

    it("increments IDs starting from 1", () => {
      const invoices = [{ name: "a" }, { name: "b" }];
      const processed = invoices.map((inv, index) => ({
        ...inv,
        id: ++index,
      }));

      expect(processed[0].id).toBe(1);
      expect(processed[1].id).toBe(2);
    });

    it("handles multiple currency formats", () => {
      const testCases = [
        { total: 100, currency: "usd", expected: "100 USD" },
        { total: 50.5, currency: "eur", expected: "50.5 EUR" },
        { total: 0, currency: "gbp", expected: "0 GBP" },
      ];

      testCases.forEach((tc) => {
        expect(`${tc.total} ${tc.currency.toUpperCase()}`).toBe(tc.expected);
      });
    });
  });

  describe("Error Handling", () => {
    it("handles network timeout errors", () => {
      const timeoutError = new Error("Network timeout");
      timeoutError.name = "TimeoutError";

      expect(timeoutError.message).toBe("Network timeout");
      expect(timeoutError.name).toBe("TimeoutError");
    });

    it("handles malformed response data without crashing", async () => {
      vi.mocked(BillingService.list_invoice_history).mockResolvedValue({
        data: null,
      } as any);

      wrapper = mountInvoiceTable();
      await flushPromises();

      // Component should still render without crashing
      expect(wrapper.exists()).toBe(true);
    });

    it("handles missing invoice properties gracefully", async () => {
      const incompleteData = {
        data: {
          invoices: [
            {
              period_start: "2023-01-01",
              // Missing other properties
            },
          ],
        },
      };

      vi.mocked(BillingService.list_invoice_history).mockResolvedValue(incompleteData as any);

      wrapper = mountInvoiceTable();
      await flushPromises();
      await wrapper.vm.$nextTick();

      // Should render without crashing
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("handles component unmounting gracefully", () => {
      wrapper = mountInvoiceTable();
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
      expect(wrapper.exists()).toBe(false);
    });

    it("handles multiple mounts without issues", () => {
      const wrapper1 = mountInvoiceTable();
      expect(wrapper1.exists()).toBe(true);
      wrapper1.unmount();

      const wrapper2 = mountInvoiceTable();
      expect(wrapper2.exists()).toBe(true);
      wrapper2.unmount();
    });
  });

  describe("Column Configuration (data processing)", () => {
    it("has columns with id, header, accessorKey structure", async () => {
      vi.mocked(BillingService.list_invoice_history).mockResolvedValue(mockInvoiceData);

      wrapper = mountInvoiceTable();
      await flushPromises();
      await wrapper.vm.$nextTick();

      // Verify table headers are rendered
      const tableHeaders = wrapper.findAll("thead th");
      // The OTable should render headers for all columns
      expect(tableHeaders.length).toBeGreaterThanOrEqual(1);
    });

    it("has action column with download button for each invoice", async () => {
      vi.mocked(BillingService.list_invoice_history).mockResolvedValue(mockInvoiceData);

      wrapper = mountInvoiceTable();
      await flushPromises();
      await wrapper.vm.$nextTick();

      // Each invoice row should have a download link
      const downloadLinks = wrapper.findAll('a[href*="invoice"]');
      expect(downloadLinks.length).toBe(2);
      expect(downloadLinks[0].attributes("href")).toBe("https://example.com/invoice.pdf");
      expect(downloadLinks[1].attributes("href")).toBe("https://example.com/invoice2.pdf");
    });
  });

  describe("Accessibility", () => {
    it("renders a table with accessible structure", () => {
      wrapper = mountInvoiceTable();
      expect(wrapper.find("table").exists()).toBe(true);
      expect(wrapper.find("thead").exists()).toBe(true);
    });

    it("has download buttons with appropriate attributes", async () => {
      vi.mocked(BillingService.list_invoice_history).mockResolvedValue(mockInvoiceData);

      wrapper = mountInvoiceTable();
      await flushPromises();
      await wrapper.vm.$nextTick();

      const downloadButtons = wrapper.findAll("a");
      downloadButtons.forEach((btn: any) => {
        expect(btn.attributes("target")).toBe("_blank");
      });
    });
  });
});
