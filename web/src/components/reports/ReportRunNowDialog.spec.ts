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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import { reportKeys } from "@/services/reports.querykeys";
import reports from "@/services/reports";
import { toast } from "@/lib/feedback/Toast/useToast";
import { pendingManualRuns } from "@/utils/reports/reportRun";
import ReportRunNowDialog from "./ReportRunNowDialog.vue";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push }),
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

const wrappers: ReturnType<typeof mount>[] = [];
const originalOrg = store.state.selectedOrganization.identifier;
const cachedOrganizations = new Set<string>();
const settlementKeys = (org: string) => [
  reportKeys.detail(org, RUN.report_id),
  reportKeys.list(org, { folder: "default" }),
  reportKeys.history(org, { report_id: RUN.report_id, start_time: 1, end_time: 2 }),
  reportKeys.history(org, { start_time: 1, end_time: 2 }),
];

const mountDialog = (props: Record<string, unknown> = {}) => {
  const wrapper = mount(ReportRunNowDialog, {
    props: { open: true, reportId: "r-dialog", reportName: "Exec KPI digest", ...props },
    global: {
      plugins: [i18n, store, withQueryClient(queryClient)],
      stubs: { ConfirmDialog: { template: "<div />" } },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
};

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  store.state.selectedOrganization.identifier = originalOrg;
  for (const org of cachedOrganizations)
    queryClient.removeQueries({ queryKey: reportKeys.all(org) });
  cachedOrganizations.clear();
});

describe("ReportRunNowDialog", () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(toast).mockClear();
    vi.mocked(reports.triggerReportById).mockClear();
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

  it("opens the run on a detail page that keeps the report's folder", async () => {
    vi.mocked(reports.triggerReportById).mockResolvedValue({
      data: { code: 200, message: "Report triggered", run: RUN },
    } as never);
    const w = mountDialog({ folderId: "folder-b" });
    await flushPromises();
    await (w.vm as unknown as { runNow: () => Promise<void> }).runNow();
    await flushPromises();
    const options = vi.mocked(toast).mock.calls.at(-1)![0];
    options.action?.handler?.();

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "reportDetail",
        query: expect.objectContaining({ folder: "folder-b", tab: "history" }),
      }),
    );
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

  it.each(["success", "error"])(
    "pins %s to the starting org/report and delays toast navigation safely",
    async (outcome) => {
      const orgA = `dialog-${outcome}-a`;
      const orgB = `dialog-${outcome}-b`;
      store.state.selectedOrganization.identifier = orgA;
      for (const org of [orgA, orgB]) {
        cachedOrganizations.add(org);
        for (const queryKey of settlementKeys(org))
          queryClient.setQueryData(queryKey, { last_run_status: "succeeded" });
      }
      let settle!: () => void;
      const hit = {
        ...RUN,
        timestamp: Date.now() * 1000,
        status: outcome === "error" ? "error" : "succeeded",
      };
      vi.mocked(reports.triggerReportById).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            settle = () =>
              outcome === "success"
                ? resolve({ data: { run: hit } } as any)
                : reject({ response: { status: 500, data: { message: "SMTP 550", run: hit } } });
          }),
      );
      const w = mountDialog();
      await flushPromises();
      const pending = (w.vm as any).runNow();
      await flushPromises();
      expect(reports.triggerReportById).toHaveBeenLastCalledWith(orgA, RUN.report_id);
      store.state.selectedOrganization.identifier = orgB;
      await w.setProps({ reportId: "another-report" });
      await flushPromises();
      settle();
      await pending;
      await flushPromises();
      expect(pendingManualRuns(orgA, RUN.report_id, [])).toEqual([hit]);
      expect(pendingManualRuns(orgB, undefined, [])).toEqual([]);
      expect(w.emitted("ran")).toBeUndefined();
      expect(w.emitted("update:running")).toEqual([[true], [false]]);
      for (const queryKey of settlementKeys(orgA))
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
      for (const queryKey of settlementKeys(orgB))
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
      store.state.selectedOrganization.identifier = `dialog-${outcome}-c`;
      await flushPromises();
      const action = vi.mocked(toast).mock.calls.at(-1)![0].action!;
      action.handler();
      expect(push).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: { report_id: RUN.report_id },
          query: expect.objectContaining({ org_identifier: orgA }),
        }),
      );
    },
  );

  it("does not refresh a different report in the same organization", async () => {
    let resolveRun!: (value: any) => void;
    vi.mocked(reports.triggerReportById).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    );
    const w = mountDialog();
    await flushPromises();
    const pending = (w.vm as any).runNow();
    await flushPromises();
    await w.setProps({ reportId: "another-report" });
    resolveRun({ data: { run: RUN } });
    await pending;
    expect(w.emitted("ran")).toBeUndefined();
  });

  it("ignores recipient metadata that finishes after the report changes", async () => {
    let resolveOld!: (value: any) => void;
    vi.mocked(reports.getReportById)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue({ data: { destinations: [{ email: "new@acme.io" }] } } as any);
    const w = mountDialog();
    await flushPromises();
    await w.setProps({ reportId: "new-recipient-report" });
    await flushPromises();
    resolveOld({ data: { destinations: [{ email: "old@acme.io" }] } });
    await flushPromises();
    expect((w.vm as any).message).toContain("new@acme.io");
    expect((w.vm as any).message).not.toContain("old@acme.io");
  });

  it.each(["same organization", "another organization"])(
    "visibly blocks a second confirmation in %s and allows retry after settlement",
    async (scope) => {
      const orgA = "dialog-single-pending-a";
      store.state.selectedOrganization.identifier = orgA;
      let resolveFirst!: (value: any) => void;
      vi.mocked(reports.triggerReportById).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );
      const w = mountDialog();
      await flushPromises();
      const first = (w.vm as any).runNow();
      await flushPromises();
      if (scope === "another organization")
        store.state.selectedOrganization.identifier = "dialog-single-pending-b";
      await w.setProps({ reportId: "second-report", reportName: "Second report" });
      await flushPromises();
      await (w.vm as any).runNow();
      expect(reports.triggerReportById).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast).mock.calls.at(-1)![0]).toMatchObject({
        variant: "warning",
        message: "Another report is running. Wait for it to finish, then try again.",
      });
      expect(w.emitted("update:running")).toEqual([[true]]);
      resolveFirst({ data: { run: RUN } });
      await first;
      await flushPromises();
      expect(w.emitted("update:running")).toEqual([[true], [false]]);
      vi.mocked(reports.triggerReportById).mockResolvedValueOnce({
        data: { run: { ...RUN, report_id: "second-report" } },
      } as any);
      await (w.vm as any).runNow();
      await flushPromises();
      expect(reports.triggerReportById).toHaveBeenCalledTimes(2);
      expect(reports.triggerReportById).toHaveBeenLastCalledWith(
        store.state.selectedOrganization.identifier,
        "second-report",
      );
      expect(w.emitted("update:running")).toEqual([[true], [false], [true], [false]]);
    },
  );
});
