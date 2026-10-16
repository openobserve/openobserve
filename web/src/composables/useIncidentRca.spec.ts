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
    resumeRca: vi.fn(),
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
  triggering: Readonly<Ref<boolean>>;
  resuming: Readonly<Ref<boolean>>;
  resumeRunId: Readonly<Ref<string | null>>;
  trigger: (options?: { buildOnPrevious?: boolean }) => Promise<void>;
  resume: (runId: string) => Promise<void>;
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

  describe("J9: resume", () => {
    /** The latest run as `current_run`, resumable by default: failed with a session and 3 steps. */
    const stopped = (run: Partial<RcaRun> = {}, history: RcaRunItem[] = []): RcaSummary => {
      const base = rca(run.state ?? "failed", run.run_id ?? "run-2", null);
      return {
        ...base,
        history,
        current_run: {
          run_id: base.run_id,
          state: base.state,
          trigger: "manual",
          session_id: "ses-1",
          report: null,
          outcome: null,
          stats: { steps: 3 },
          error: { code: "timeout", reason: "Timed out", details: null, trigger_type: null },
          ...run,
        } as RcaRun,
      };
    };

    const historyItem = (
      runId: string,
      state: RcaRunState,
      outcome: RcaRunItem["outcome"] = null,
    ) => ({ ...reportRun(runId), state, outcome }) as RcaRunItem;

    describe("resumeRunId", () => {
      it.each(["failed", "cancelled"] as const)(
        "a %s latest run with finished steps",
        async (state) => {
          host = mountHost(stopped({ state, error: state === "cancelled" ? null : undefined }));

          expect(host.api.resumeRunId.value).toBe("run-2");
        },
      );

      it.each([
        ["completed", { state: "completed" as const }],
        ["running", { state: "running" as const }],
        ["no session", { session_id: null }],
        ["a report", { report: "# done" }],
        ["an outcome", { outcome: "inconclusive" as const }],
        ["only the open step", { stats: { steps: 1 } }],
        ["no steps", { stats: { steps: 0 } }],
      ])("null for %s", async (_label, run) => {
        host = mountHost(stopped(run));

        expect(host.api.resumeRunId.value).toBeNull();
      });

      it("two recorded steps (one finished plus the open one) are enough", () => {
        host = mountHost(stopped({ stats: { steps: 2 } }));

        expect(host.api.resumeRunId.value).toBe("run-2");
      });

      it("falls back to the summary step count without run stats", () => {
        const summary = stopped({ stats: null });
        summary.summary.steps = 4;
        host = mountHost(summary);

        expect(host.api.resumeRunId.value).toBe("run-2");
      });

      it.each([
        "turn_limit",
        "credentials",
        "agent_unavailable",
        "busy",
        "usage_denied",
        "rca_disabled",
        "agent_not_configured",
        "l0_off",
        "transcript_deleted",
        "persistence_failed",
      ])("null for the start or lost-transcript code %s", (code) => {
        host = mountHost(
          stopped({ error: { code, reason: code, details: null, trigger_type: null } }),
        );

        expect(host.api.resumeRunId.value).toBeNull();
      });

      it("null when current_run is not the latest run", () => {
        const summary = stopped();
        summary.run_id = "run-9";
        host = mountHost(summary);

        expect(host.api.resumeRunId.value).toBeNull();
      });

      describe("a transparent Resume child (never ran a turn)", () => {
        const child = (run: Partial<RcaRun>, source: RcaRunItem | null) =>
          stopped(
            {
              run_id: "run-3",
              trigger: "resume",
              session_id: null,
              stats: { steps: 0 },
              context_used: {
                resumed_from: {
                  run_id: "run-2",
                  steps: 2,
                  from_step: { index: 3, stage: "metrics", title: "Check metrics" },
                },
              },
              ...run,
            },
            [historyItem("run-3", "failed"), ...(source ? [source] : [])],
          );

        it.each(["resume_failed", "turn_limit", "credentials", "agent_unavailable", "busy"])(
          "%s resumes the source run instead",
          (code) => {
            host = mountHost(
              child(
                {
                  session_id: "ses-fork",
                  error: { code, reason: code, details: null, trigger_type: null },
                },
                historyItem("run-2", "failed"),
              ),
            );

            expect(host.api.resumeRunId.value).toBe("run-2");
          },
        );

        it("a child without a session is transparent whatever the code", () => {
          host = mountHost(child({}, historyItem("run-2", "cancelled")));

          expect(host.api.resumeRunId.value).toBe("run-2");
        });

        it("a cancelled child with no session resumes the source run (E banner)", () => {
          host = mountHost(
            child({ state: "cancelled", error: null }, historyItem("run-2", "failed")),
          );

          expect(host.api.resumeRunId.value).toBe("run-2");
        });

        it("a cancelled child with a session is not redirected to the source", () => {
          // A never-ran code means nothing on a cancel: the child is judged on its own.
          const code = { code: "busy", reason: "busy", details: null, trigger_type: null };
          host = mountHost(
            child(
              { state: "cancelled", session_id: "ses-fork", error: code, stats: { steps: 3 } },
              historyItem("run-2", "failed"),
            ),
          );
          expect(host.api.resumeRunId.value).not.toBe("run-2");
          host.wrapper.unmount();

          host = mountHost(
            child(
              { state: "cancelled", session_id: "ses-fork", error: null, stats: { steps: 1 } },
              historyItem("run-2", "failed"),
            ),
          );
          expect(host.api.resumeRunId.value).toBeNull();
        });

        it.each([
          ["completed", historyItem("run-2", "completed")],
          ["graded", historyItem("run-2", "failed", "inconclusive")],
          ["missing from the history", null],
        ])("null when the source is %s", (_label, source) => {
          host = mountHost(child({}, source));

          expect(host.api.resumeRunId.value).toBeNull();
        });

        it("a child that ran a turn (session, other code) is judged on its own", () => {
          host = mountHost(
            child({ session_id: "ses-fork", stats: { steps: 3 } }, historyItem("run-2", "failed")),
          );

          expect(host.api.resumeRunId.value).toBe("run-3");
        });
      });
    });

    const RESUMED = (steps: number) => ({
      data: {
        message: "resumed",
        run_id: "run-3",
        resumed_from: "run-2",
        reused_steps: steps,
        from_step: { index: steps + 1, stage: "metrics", title: "Check the pool" },
      },
    });

    it.each([
      [3, "Resuming from “Check the pool”. The 3 finished steps are reused."],
      [1, "Resuming from “Check the pool”. The finished step is reused."],
    ])(
      "a started resume (%i steps) toasts '%s', invalidates the list and re-reads",
      async (steps, text) => {
        service.resumeRca.mockResolvedValue(RESUMED(steps) as never);
        service.get.mockResolvedValue(detail(rca("running", "run-3", null)) as never);
        const invalidate = vi.spyOn(queryClient, "invalidateQueries");
        host = mountHost(stopped());
        await flushPromises();

        await host.api.resume("run-2");

        expect(service.resumeRca.mock.calls[0].slice(0, 3)).toEqual(["default", "inc-1", "run-2"]);
        expect(toastMock).toHaveBeenCalledWith({ variant: "success", message: text });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: incidentKeys.all("default") });
        expect(service.get).toHaveBeenCalledTimes(1);
        expect(host.api.live.value).toBe(true);
        expect(host.api.resuming.value).toBe(false);
        invalidate.mockRestore();
      },
    );

    it("a rejected resume that created a run shows the banner, not a toast (review fix)", async () => {
      service.resumeRca.mockRejectedValue({
        isAxiosError: true,
        response: { status: 500, data: { message: "The earlier steps could not be reused" } },
      });
      service.get.mockResolvedValue(
        detail(
          stopped({
            run_id: "run-3",
            trigger: "resume",
            error: {
              code: "resume_failed",
              reason: "The earlier steps could not be reused",
              details: null,
              trigger_type: null,
            },
          }),
        ) as never,
      );
      host = mountHost(stopped());
      await flushPromises();

      await host.api.resume("run-2");

      expect(service.get).toHaveBeenCalledTimes(1);
      expect(host.api.currentError.value?.reason).toBe("The earlier steps could not be reused");
      expect(toastMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        409,
        { code: "not_resumable", message: "This run cannot be resumed" },
        "This run cannot be resumed",
      ],
      [
        410,
        { code: "transcript_expired", message: "The transcript expired" },
        "The transcript expired",
      ],
      [500, {}, "Could not resume the run."],
    ])(
      "a refused resume (%i) that created no run toasts the server message",
      async (status, data, text) => {
        service.resumeRca.mockRejectedValue({ isAxiosError: true, response: { status, data } });
        service.get.mockResolvedValue(detail(stopped()) as never);
        host = mountHost(stopped());
        await flushPromises();

        await host.api.resume("run-2");

        expect(toastMock).toHaveBeenCalledWith({ variant: "error", message: text });
        expect(host.api.resuming.value).toBe(false);
      },
    );

    it("a 412 (AI not available) toasts the server message and re-reads nothing", async () => {
      service.resumeRca.mockRejectedValue({
        isAxiosError: true,
        response: { status: 412, data: { message: "AI SRE is not configured" } },
      });
      host = mountHost(stopped());
      await flushPromises();

      await host.api.resume("run-2");

      expect(toastMock).toHaveBeenCalledWith({
        variant: "error",
        message: "AI SRE is not configured",
      });
      expect(service.get).not.toHaveBeenCalled();
    });

    it("while a resume is in flight, a trigger or a second resume sends nothing", async () => {
      const request = Promise.withResolvers<unknown>();
      service.resumeRca.mockReturnValue(request.promise as never);
      service.get.mockResolvedValue(detail(rca("running", "run-3", null)) as never);
      host = mountHost(stopped());
      await flushPromises();

      const resuming = host.api.resume("run-2");
      expect(host.api.resuming.value).toBe(true);
      await host.api.trigger();
      await host.api.resume("run-2");

      expect(service.triggerRca).not.toHaveBeenCalled();
      expect(service.resumeRca).toHaveBeenCalledTimes(1);
      request.resolve(RESUMED(2));
      await resuming;
      expect(host.api.resuming.value).toBe(false);
    });

    it("while a trigger is in flight, Resume sends nothing", async () => {
      const request = Promise.withResolvers<unknown>();
      service.triggerRca.mockReturnValue(request.promise as never);
      service.get.mockResolvedValue(detail(rca("running", "run-3", null)) as never);
      host = mountHost(stopped());
      await flushPromises();

      const triggering = host.api.trigger();
      await host.api.resume("run-2");

      expect(service.resumeRca).not.toHaveBeenCalled();
      request.resolve({ data: { run_id: "run-3" } });
      await triggering;
    });

    it("an incident switch mid-resume drops the late toast and clears resuming", async () => {
      const request = Promise.withResolvers<unknown>();
      service.resumeRca.mockReturnValue(request.promise as never);
      host = mountHost(stopped());
      await flushPromises();

      const resuming = host.api.resume("run-2");
      host.incident.value = { id: "inc-2", rca: null } as IncidentWithAlerts;
      await flushPromises();
      request.resolve(RESUMED(2));
      await resuming;

      expect(toastMock).not.toHaveBeenCalled();
      expect(host.api.resuming.value).toBe(false);
      expect(service.get).not.toHaveBeenCalled();
    });
  });
});
