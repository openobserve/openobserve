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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { MutationObserver, QueryObserver } from "@tanstack/query-core";
import { queryClient } from "@/composables/query/queryClient";
import { triggerReportMutation } from "./reports.queries";
import { reportKeys } from "./reports.querykeys";
import reports from "./reports";

vi.mock("./reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { triggerReportById: vi.fn() },
  });
});

const org = "recorded-run-original-org";
const otherOrg = "recorded-run-next-org";
const reportId = "recorded-run-report";
const run = { report_id: reportId, status: "error" };
const keys = (organization: string) => [
  reportKeys.detail(organization, reportId),
  reportKeys.list(organization, { folder: "default" }),
  reportKeys.history(organization, { report_id: reportId, start_time: 1, end_time: 2 }),
  reportKeys.history(organization, { start_time: 1, end_time: 2 }),
];

afterEach(() => {
  queryClient.removeQueries({ queryKey: reportKeys.all(org) });
  queryClient.removeQueries({ queryKey: reportKeys.all(otherOrg) });
});

describe("Run now settlement with the production mutation cache", () => {
  it.each(["cached", "active"])(
    "refreshes %s detail/list/history after a recorded 500",
    async (mode) => {
      const refreshers = keys(org).map((queryKey) => {
        queryClient.setQueryData(queryKey, "previous success");
        const queryFn = vi.fn(async () => "persisted failure");
        const observer = new QueryObserver(queryClient, { queryKey, queryFn, staleTime: Infinity });
        const unsubscribe = mode === "active" ? observer.subscribe(() => {}) : () => {};
        return { queryKey, queryFn, unsubscribe };
      });
      for (const queryKey of keys(otherOrg))
        queryClient.setQueryData(queryKey, "other organization");
      vi.mocked(reports.triggerReportById).mockRejectedValue({
        response: { status: 500, data: { run } },
      });
      const mutation = new MutationObserver(queryClient, triggerReportMutation(org));
      await mutation.mutate(reportId).catch(() => {});
      await flushPromises();
      for (const { queryKey, queryFn, unsubscribe } of refreshers) {
        if (mode === "active") {
          expect(queryFn).toHaveBeenCalledTimes(1);
          expect(queryClient.getQueryData(queryKey)).toBe("persisted failure");
        } else {
          expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
        }
        unsubscribe();
      }
      for (const queryKey of keys(otherOrg)) {
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
      }
    },
  );

  it.each([403, 500, undefined])(
    "leaves metadata fresh for an unrecorded failure (%s)",
    async (status) => {
      for (const queryKey of keys(org)) queryClient.setQueryData(queryKey, "previous success");
      vi.mocked(reports.triggerReportById).mockRejectedValue({ response: { status } });
      const mutation = new MutationObserver(queryClient, triggerReportMutation(org));
      await mutation.mutate(reportId).catch(() => {});
      for (const queryKey of keys(org)) {
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
      }
    },
  );

  it.each(["success", "error"])(
    "pins invalidation when options change during %s",
    async (outcome) => {
      for (const queryKey of [...keys(org), ...keys(otherOrg)])
        queryClient.setQueryData(queryKey, "old");
      let settle!: () => void;
      vi.mocked(reports.triggerReportById).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            settle = () =>
              outcome === "success"
                ? resolve({ data: { run } } as any)
                : reject({ response: { status: 500, data: { run } } });
          }),
      );
      const mutation = new MutationObserver(queryClient, triggerReportMutation(org));
      const pending = mutation.mutate(Object.freeze({ org, reportId })).catch(() => {});
      await flushPromises();
      mutation.setOptions(triggerReportMutation(otherOrg));
      settle();
      await pending;
      expect(reports.triggerReportById).toHaveBeenLastCalledWith(org, reportId);
      for (const queryKey of keys(org))
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
      for (const queryKey of keys(otherOrg))
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    },
  );
});
