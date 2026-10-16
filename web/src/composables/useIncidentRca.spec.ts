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
import { defineComponent, ref, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/aws-exports", () => ({ default: { isCloud: "false", isEnterprise: "true" } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/services/incidents", () => ({
  default: {
    get: vi.fn(),
    getRcaRun: vi.fn(),
    triggerRca: vi.fn(),
    cancelRca: vi.fn(),
  },
}));

import incidentsService, {
  type IncidentWithAlerts,
  type RcaRun,
  type RcaRunError,
  type RcaRunItem,
  type RcaRunState,
  type RcaSummary,
} from "@/services/incidents";
import { incidentKeys } from "@/services/incidents.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { RCA_POLL_INTERVAL_MS, useIncidentRca } from "./useIncidentRca";

const service = vi.mocked(incidentsService);

const T0 = 1_760_000_000_000_000; // microseconds

function reportRun(runId: string): RcaRunItem {
  return {
    run_id: runId,
    subject_type: "incident",
    trigger: "auto_new_incident",
    mode: "fresh",
    started_by: "system",
    state: "completed",
    started_at: T0,
    ended_at: T0 + 60_000_000,
    outcome: null,
    confidence: null,
    cancelled_by: null,
    error_reason: null,
  };
}

function rca(state: RcaRunState, runId: string, report: string | null): RcaSummary {
  return {
    run_id: runId,
    state,
    stale: false,
    started_at: T0,
    updated_at: T0,
    outcome: null,
    confidence: null,
    summary: {
      stage: null,
      stage_index: null,
      stage_count: 0,
      steps: 0,
      tool_calls: 0,
      steered_by: [],
      unblocked_by: null,
      detail: null,
      deadline_at: null,
      cancelled_by: null,
      previous: null,
    },
    report_run: report ? reportRun(report) : null,
    history: report ? [reportRun(report)] : [],
  };
}

const detail = (summary: RcaSummary | null) => ({
  data: { id: "inc-1", rca: summary } as IncidentWithAlerts,
});

/** The part of the composable these tests read. */
interface IncidentRcaApi {
  live: Readonly<Ref<boolean>>;
  state: Readonly<Ref<RcaRunState | null>>;
  displayedRunId: Readonly<Ref<string | null>>;
  reportText: Readonly<Ref<string>>;
  currentError: Readonly<Ref<RcaRunError | null>>;
  trigger: (options?: { buildOnPrevious?: boolean }) => Promise<void>;
  cancel: () => Promise<void>;
  reload: () => Promise<void>;
}

interface Host {
  incident: Ref<IncidentWithAlerts | null>;
  api: IncidentRcaApi;
  wrapper: VueWrapper;
}

function mountHost(initial: RcaSummary | null): Host {
  const incident = ref({
    id: "inc-1",
    rca: initial,
  } as IncidentWithAlerts) as Ref<IncidentWithAlerts | null>;
  let api!: Host["api"];
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useIncidentRca(ref("default"), incident);
        return () => null;
      },
    }),
  );
  return { incident, api, wrapper };
}

describe("useIncidentRca (RR-35)", () => {
  let host: Host | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service.getRcaRun.mockImplementation((_org, _id, runId) =>
      Promise.resolve({ data: { run_id: runId, report: `report of ${runId}` } } as never),
    );
  });

  afterEach(() => {
    host?.wrapper.unmount();
    host = undefined;
    vi.useRealTimers();
  });

  it("polls the detail while live and stops after terminal + one final read", async () => {
    service.get
      .mockResolvedValueOnce(detail(rca("running", "run-1", null)) as never)
      .mockResolvedValueOnce(detail(rca("completed", "run-1", "run-1")) as never);
    host = mountHost(rca("running", "run-1", null));
    await flushPromises();
    expect(service.get).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RCA_POLL_INTERVAL_MS);
    expect(service.get).toHaveBeenCalledTimes(1);
    expect(service.get).toHaveBeenCalledWith("default", "inc-1");
    expect(host.api.live.value).toBe(true);

    await vi.advanceTimersByTimeAsync(RCA_POLL_INTERVAL_MS);
    expect(service.get).toHaveBeenCalledTimes(2);
    expect(host.api.state.value).toBe("completed");
    expect(host.api.live.value).toBe(false);

    await vi.advanceTimersByTimeAsync(RCA_POLL_INTERVAL_MS * 5);
    expect(service.get).toHaveBeenCalledTimes(2);
    // The run that finished elsewhere shows its report without a reload.
    expect(service.getRcaRun).toHaveBeenCalledWith("default", "inc-1", "run-1");
    expect(host.api.reportText.value).toBe("report of run-1");
  });

  it("a finished incident does not poll", async () => {
    host = mountHost(rca("completed", "run-1", "run-1"));

    await vi.advanceTimersByTimeAsync(RCA_POLL_INTERVAL_MS * 3);

    expect(service.get).not.toHaveBeenCalled();
  });

  it("a report_run.run_id change loads getRcaRun and shows the new report", async () => {
    // A re-run is live; the earlier report shows meanwhile.
    const rerun = { ...rca("running", "run-2", "run-1") };
    service.get.mockResolvedValueOnce(detail(rca("completed", "run-2", "run-2")) as never);
    host = mountHost(rerun);
    await flushPromises();
    expect(service.getRcaRun).toHaveBeenCalledWith("default", "inc-1", "run-1");
    expect(host.api.reportText.value).toBe("report of run-1");

    await vi.advanceTimersByTimeAsync(RCA_POLL_INTERVAL_MS);
    await flushPromises();

    expect(service.getRcaRun).toHaveBeenCalledWith("default", "inc-1", "run-2");
    expect(host.api.displayedRunId.value).toBe("run-2");
    expect(host.api.reportText.value).toBe("report of run-2");
  });

  it("trigger sends reanalysis=true with the chosen mode and re-reads the detail", async () => {
    service.triggerRca.mockResolvedValue({ data: { run_id: "run-2" } } as never);
    service.get.mockResolvedValue(detail(rca("running", "run-2", "run-1")) as never);
    host = mountHost(rca("completed", "run-1", "run-1"));
    await flushPromises();

    await host.api.trigger({ buildOnPrevious: true });

    expect(service.triggerRca).toHaveBeenCalledTimes(1);
    expect(service.triggerRca.mock.calls[0].slice(0, 3)).toEqual([
      "default",
      "inc-1",
      { reanalysis: true, build_on_previous: true },
    ]);
    expect(service.get).toHaveBeenCalledTimes(1);
    expect(host.api.live.value).toBe(true);
  });

  it("SG33: trigger passes the trimmed guidance with the mode", async () => {
    service.triggerRca.mockResolvedValue({ data: { run_id: "run-2" } } as never);
    service.get.mockResolvedValue(detail(rca("running", "run-2", "run-1")) as never);
    host = mountHost(rca("completed", "run-1", "run-1"));
    await flushPromises();

    await host.api.trigger({ buildOnPrevious: false, guidance: "  Check the pool  " });

    expect(service.triggerRca.mock.calls[0][2]).toEqual({
      reanalysis: true,
      build_on_previous: false,
      guidance: "Check the pool",
    });
  });

  it("RR-34: a started run invalidates the incidents list", async () => {
    service.triggerRca.mockResolvedValue({ data: { run_id: "run-2" } } as never);
    service.get.mockResolvedValue(detail(rca("running", "run-2", "run-1")) as never);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    host = mountHost(rca("completed", "run-1", "run-1"));
    await flushPromises();
    invalidate.mockClear();

    await host.api.trigger();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: incidentKeys.all("default") });
    invalidate.mockRestore();
  });

  describe("RR-47: a rejected trigger", () => {
    const withCurrentRun = (summary: RcaSummary, run: Partial<RcaRun>): RcaSummary => ({
      ...summary,
      current_run: { run_id: summary.run_id, state: summary.state, error: null, ...run } as RcaRun,
    });

    it("that committed a run shows the failure banner and no toast", async () => {
      service.triggerRca.mockRejectedValue({
        isAxiosError: true,
        response: { status: 503, data: { message: "Agent unavailable" } },
      });
      const failed = withCurrentRun(rca("failed", "run-2", "run-1"), {
        error: {
          code: "agent_unavailable",
          reason: "Agent unavailable",
          details: null,
          trigger_type: null,
        },
      });
      service.get.mockResolvedValue(detail(failed) as never);
      host = mountHost(withCurrentRun(rca("completed", "run-1", "run-1"), {}));
      await flushPromises();

      await host.api.trigger();

      expect(service.get).toHaveBeenCalledTimes(1);
      expect(host.api.currentError.value?.reason).toBe("Agent unavailable");
      expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("that created no run (400 in progress) still toasts", async () => {
      service.triggerRca.mockRejectedValue({
        isAxiosError: true,
        response: { status: 400, data: { message: "An analysis is already in progress" } },
      });
      const unchanged = withCurrentRun(rca("completed", "run-1", "run-1"), {});
      service.get.mockResolvedValue(detail(unchanged) as never);
      host = mountHost(unchanged);
      await flushPromises();

      await host.api.trigger();

      expect(toastMock).toHaveBeenCalledWith({
        variant: "error",
        message: "An analysis is already in progress",
      });
      expect(host.api.currentError.value).toBeNull();
    });
  });

  it("RR-35: an older reload response does not overwrite a newer one", async () => {
    const olderRead = Promise.withResolvers<unknown>();
    const newerRead = Promise.withResolvers<unknown>();
    service.get
      .mockReturnValueOnce(olderRead.promise as never)
      .mockReturnValueOnce(newerRead.promise as never);
    host = mountHost(rca("running", "run-1", null));

    const older = host.api.reload();
    const newer = host.api.reload();
    newerRead.resolve(detail(rca("completed", "run-1", "run-1")));
    await newer;
    olderRead.resolve(detail(rca("running", "run-1", null)));
    await older;

    expect(host.api.state.value).toBe("completed");
  });

  it("cancel sends DELETE and re-reads the detail", async () => {
    service.cancelRca.mockResolvedValue({ data: { run_id: "run-1" } } as never);
    service.get.mockResolvedValue(detail(rca("cancelled", "run-1", null)) as never);
    host = mountHost(rca("running", "run-1", null));

    await host.api.cancel();

    expect(service.cancelRca).toHaveBeenCalledWith("default", "inc-1");
    expect(host.api.state.value).toBe("cancelled");
    expect(host.api.live.value).toBe(false);
  });
});
