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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import reports from "@/services/reports";
import { toast } from "@/lib/feedback/Toast/useToast";
import { pendingManualRuns } from "@/utils/reports/reportRun";
import ReportRunNowDialog from "./ReportRunNowDialog.vue";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getReportById: vi.fn(), triggerReportById: vi.fn() },
  });
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
  toastRecords: [],
  useToast: () => ({ toast: vi.fn(() => vi.fn()), toasts: [] }),
}));

const RUN = {
  timestamp: 99,
  report_id: "r-dialog",
  report_name: "Exec KPI digest",
  status: "succeeded",
  is_cached: false,
  recipient_count: 2,
  retries: 0,
};

const mountDialog = (props: Record<string, unknown> = {}) =>
  mount(ReportRunNowDialog, {
    props: { open: true, reportId: "r-dialog", reportName: "Exec KPI digest", ...props },
    global: {
      plugins: [i18n, store, withQueryClient()],
      stubs: { ConfirmDialog: { template: "<div />" } },
    },
  });

describe("ReportRunNowDialog", () => {
  beforeEach(() => {
    vi.mocked(reports.getReportById).mockResolvedValue({
      data: { destinations: [{ email: "lin@acme.io" }, { email: "cfo@acme.io" }] },
    } as any);
  });

  it("names the recipients and warns a retry can deliver twice", async () => {
    const w = mountDialog();
    await flushPromises();
    const vm = w.vm as any;
    expect(vm.title).toBe('Send "Exec KPI digest" now?');
    expect(vm.message).toContain("lin@acme.io, cfo@acme.io");
    expect(vm.message).toContain("2 recipients");
    expect(vm.message).toContain("deliver the same email twice");
  });

  it("shows the last error above the recipients when the last run failed", async () => {
    const w = mountDialog({ lastRunStatus: "error", lastRunError: "SMTP 550" });
    await flushPromises();
    expect((w.vm as any).warning).toContain("SMTP 550");
  });

  it("says a cache-only run sends no email", async () => {
    vi.mocked(reports.getReportById).mockResolvedValue({ data: { destinations: [] } } as any);
    const w = mountDialog();
    await flushPromises();
    expect((w.vm as any).message).toContain("sends no email");
  });

  it("never claims a cache-only run when the recipients could not be loaded", async () => {
    vi.mocked(reports.getReportById).mockRejectedValue({ response: { status: 500 } });
    const w = mountDialog();
    await flushPromises();
    const vm = w.vm as any;
    expect(vm.title).toBe('Send "Exec KPI digest" now?');
    expect(vm.message).toContain("could not be loaded");
    expect(vm.message).not.toContain("sends no email");
  });

  it("hands back the run row and keeps it visible until the stream has it", async () => {
    vi.mocked(reports.triggerReportById).mockResolvedValue({
      data: { code: 200, message: "Report triggered", run: RUN },
    } as any);
    const w = mountDialog();
    await flushPromises();
    await (w.vm as any).runNow();
    await flushPromises();
    expect(w.emitted("ran")?.[0]).toEqual([RUN]);
    expect(
      pendingManualRuns(store.state.selectedOrganization.identifier, "r-dialog", []),
    ).toHaveLength(1);
    expect(vi.mocked(toast).mock.calls.at(-1)![0]).toMatchObject({
      variant: "success",
      message: "Report sent to 2 recipients.",
    });
  });

  it("still returns the run row when the send failed", async () => {
    vi.mocked(reports.triggerReportById).mockRejectedValue({
      response: {
        status: 500,
        data: { code: 500, message: "SMTP 550", run: { ...RUN, timestamp: 100, status: "error" } },
      },
    });
    const w = mountDialog();
    await flushPromises();
    await (w.vm as any).runNow();
    await flushPromises();
    expect(w.emitted("ran")).toHaveLength(1);
    expect(vi.mocked(toast).mock.calls.at(-1)![0]).toMatchObject({
      variant: "error",
      message: "SMTP 550",
    });
  });
});
