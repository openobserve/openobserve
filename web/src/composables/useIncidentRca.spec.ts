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
import type * as ConsentModule from "@/composables/usePaidOverageConsent";

const { toastMock, awsConfig, promptForConsent } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  awsConfig: { isCloud: "false", isEnterprise: "true" },
  promptForConsent: vi.fn(),
}));

vi.mock("@/aws-exports", () => ({ default: awsConfig }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/composables/usePaidOverageConsent", async (importOriginal) => ({
  ...(await importOriginal<typeof ConsentModule>()),
  usePaidOverageConsent: () => ({ promptForConsent }),
}));
vi.mock("@/services/incidents", () => ({
  default: {
    get: vi.fn(),
    getRcaRun: vi.fn(),
    triggerRca: vi.fn(),
    resumeRca: vi.fn(),
    cancelRca: vi.fn(),
    openRcaLiveStream: vi.fn(),
  },
}));

import incidentsService, {
  type IncidentWithAlerts,
  type RcaLiveEvent,
  type RcaRun,
  type RcaRunError,
  type RcaRunItem,
  type RcaRunState,
  type RcaRunSummary,
  type RcaSteering,
  type RcaSummary,
  type RcaThread,
  type RcaVerdictDetails,
} from "@/services/incidents";
import { incidentKeys } from "@/services/incidents.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { useIncidentRca, type RcaReadStatus, type RcaRefusal } from "./useIncidentRca";
import {
  rcaRunSummary,
  rcaRunSummaryLive,
  rcaSteering,
  rcaThread,
  rcaV1RunItem,
  rcaV1Summary,
} from "@/test/unit/fixtures/rcaThread";

const service = vi.mocked(incidentsService);

/** One live stream the composable opened; the test drives it. */
interface Connection {
  org: string;
  incidentId: string;
  runId: string | null;
  signal: AbortSignal;
  emit: (event: RcaLiveEvent) => void;
  /** The server sends `end` and closes. */
  end: () => void;
  /** The connection closes without `end`. */
  drop: () => void;
  /** The stream does not open: `status` 0 is a network error. */
  fail: (status: number) => void;
}

const connections: Connection[] = [];

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
    report_format: "v2",
    has_record: true,
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
    report_format: "v2",
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
  threadRunId: Readonly<Ref<string | null>>;
  reportText: Readonly<Ref<string>>;
  reportVerdict: Readonly<Ref<RcaVerdictDetails | null>>;
  currentError: Readonly<Ref<RcaRunError | null>>;
  triggering: Readonly<Ref<boolean>>;
  resuming: Readonly<Ref<boolean>>;
  resumeRunId: Readonly<Ref<string | null>>;
  thread: Readonly<Ref<RcaThread | null>>;
  threadStatus: Readonly<Ref<RcaReadStatus>>;
  runSummary: Readonly<Ref<RcaRunSummary | null>>;
  runSummaryStatus: Readonly<Ref<RcaReadStatus>>;
  steering: Readonly<Ref<RcaSteering | null>>;
  steeringStatus: Readonly<Ref<RcaReadStatus>>;
  trigger: (options?: { buildOnPrevious?: boolean; guidance?: string }) => Promise<void>;
  refusal: Readonly<Ref<RcaRefusal | null>>;
  resume: (runId: string) => Promise<void>;
  cancel: () => Promise<void>;
  reload: () => Promise<void>;
  viewRun: (runId: string | null) => void;
  retryLive: () => void;
}

interface Host {
  incident: Ref<IncidentWithAlerts | null>;
  analysisOpen: Ref<boolean>;
  api: IncidentRcaApi;
  wrapper: VueWrapper;
}

function mountHost(initial: RcaSummary | null): Host {
  const incident = ref({
    id: "inc-1",
    rca: initial,
  } as IncidentWithAlerts) as Ref<IncidentWithAlerts | null>;
  const analysisOpen = ref(false);
  let api!: Host["api"];
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useIncidentRca(ref("default"), incident, analysisOpen);
        return () => null;
      },
    }),
  );
  return { incident, analysisOpen, api, wrapper };
}

describe("useIncidentRca (RR-35)", () => {
  let host: Host | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    awsConfig.isCloud = "false";
    vi.useFakeTimers();
    connections.length = 0;
    service.getRcaRun.mockImplementation((_org, _id, runId) =>
      Promise.resolve({ data: { run_id: runId, report: `report of ${runId}` } } as never),
    );
    service.openRcaLiveStream.mockImplementation((org, incidentId, runId, { onEvent, signal }) => {
      const { promise, resolve, reject } = Promise.withResolvers<{ ended: boolean }>();
      connections.push({
        org,
        incidentId,
        runId,
        signal: signal!,
        emit: onEvent,
        end: () => {
          onEvent({ event: "end", data: { state: "completed" } });
          resolve({ ended: true });
        },
        drop: () => resolve({ ended: false }),
        fail: (status) =>
          reject(
            status === 0
              ? new TypeError("Failed to fetch")
              : Object.assign(new Error("refused"), { name: "RcaLiveStreamRefused", status }),
          ),
      });
      return promise;
    });
  });

  afterEach(() => {
    host?.wrapper.unmount();
    host = undefined;
    vi.useRealTimers();
  });

  describe("live stream (05 LU15–LU17, LU19)", () => {
    it("LU15: a live run opens one stream; the Analysis tab adds its run and closing drops it", async () => {
      host = mountHost(rca("running", "run-1", null));
      await flushPromises();
      expect(connections.map((c) => c.runId)).toEqual([null]);
      expect(connections[0].org).toBe("default");
      expect(connections[0].incidentId).toBe("inc-1");

      host.analysisOpen.value = true;
      await flushPromises();
      expect(connections.map((c) => c.runId)).toEqual([null, "run-1"]);
      expect(connections[0].signal.aborted).toBe(true);
      expect(host.api.threadStatus.value).toBe("loading");

      host.analysisOpen.value = false;
      await flushPromises();
      expect(connections.map((c) => c.runId)).toEqual([null, "run-1", null]);
      expect(connections[1].signal.aborted).toBe(true);
    });

    it("LU15: a finished incident streams only while the tab is open, for the shown run", async () => {
      const finished = rca("completed", "run-2", "run-2");
      finished.history = [reportRun("run-2"), reportRun("run-1")];
      host = mountHost(finished);
      await flushPromises();
      expect(connections).toHaveLength(0);

      host.analysisOpen.value = true;
      await flushPromises();
      host.api.viewRun("run-1");
      await flushPromises();
      expect(connections.map((c) => c.runId)).toEqual(["run-2", "run-1"]);
    });

    it("a cancelled run with a stored record can be reopened; one with nothing to show cannot", async () => {
      const resumed = rca("completed", "run-3", "run-3");
      resumed.history = [
        reportRun("run-3"),
        { ...reportRun("run-2"), state: "cancelled", has_record: true },
        { ...reportRun("run-1"), state: "failed", has_record: false },
      ];
      host = mountHost(resumed);
      host.analysisOpen.value = true;
      await flushPromises();

      host.api.viewRun("run-1");
      await flushPromises();
      expect(host.api.threadRunId.value).toBe("run-3");

      host.api.viewRun("run-2");
      await flushPromises();
      expect(host.api.threadRunId.value).toBe("run-2");
      expect(connections.at(-1)?.runId).toBe("run-2");
    });

    it("LU15: a v1 run streams without a run", async () => {
      host = mountHost(rcaV1Summary([rcaV1RunItem()]));
      host.analysisOpen.value = true;
      await flushPromises();

      expect(connections.map((c) => c.runId)).toEqual([null]);
      expect(host.api.threadStatus.value).toBe("idle");
    });

    it("LU17: events replace the parts; the run ending loads its report and refreshes the list", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      host = mountHost(rca("running", "run-2", "run-1"));
      host.analysisOpen.value = true;
      await flushPromises();
      const stream = connections.at(-1)!;

      stream.emit({ event: "thread", data: rcaThread({ run_id: "run-2" }) });
      stream.emit({ event: "summary", data: rcaRunSummaryLive({ run_id: "run-2" }) });
      stream.emit({ event: "steering", data: rcaSteering() });
      expect(host.api.thread.value?.run_id).toBe("run-2");
      expect(host.api.threadStatus.value).toBe("ready");
      expect(host.api.runSummary.value?.state).toBe("running");
      expect(host.api.runSummaryStatus.value).toBe("ready");
      expect(host.api.steering.value?.can_steer).toBe(true);

      stream.emit({ event: "rca", data: rca("completed", "run-2", "run-2") });
      stream.end();
      await flushPromises();
      expect(host.api.state.value).toBe("completed");
      expect(host.api.reportText.value).toBe("report of run-2");
      expect(invalidate).toHaveBeenCalledWith({ queryKey: incidentKeys.all("default") });
      expect(service.get).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(connections.map((c) => c.runId)).toEqual([null, "run-2"]);
    });

    it("LU19: a live run is never re-read by polling", async () => {
      host = mountHost(rca("running", "run-1", null));
      host.analysisOpen.value = true;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(service.get).not.toHaveBeenCalled();
      expect(connections).toHaveLength(2);
    });

    it("LU16: a dropped stream reconnects after 1, 2, 4 s; an event resets the delay", async () => {
      host = mountHost(rca("running", "run-1", null));
      await flushPromises();

      connections.at(-1)!.drop();
      await vi.advanceTimersByTimeAsync(999);
      expect(connections).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(connections).toHaveLength(2);

      connections.at(-1)!.fail(503);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(connections).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(connections).toHaveLength(3);

      connections.at(-1)!.fail(0);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(connections).toHaveLength(4);

      connections.at(-1)!.emit({ event: "rca", data: rca("running", "run-1", null) });
      connections.at(-1)!.drop();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(connections).toHaveLength(5);
    });

    it.each([
      [403, "unsupported"],
      [404, "missing"],
    ] as const)("LU16: a %i stops the stream and marks every part %s", async (status, expected) => {
      host = mountHost(rca("running", "run-1", null));
      host.analysisOpen.value = true;
      await flushPromises();

      connections.at(-1)!.fail(status);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(connections).toHaveLength(2);
      expect(host.api.threadStatus.value).toBe(expected);
      expect(host.api.runSummaryStatus.value).toBe(expected);
      expect(host.api.steeringStatus.value).toBe(expected);
    });

    it("LU17: transcript and steering errors map to the read states", async () => {
      host = mountHost(rca("running", "run-1", null));
      host.analysisOpen.value = true;
      await flushPromises();
      const stream = connections.at(-1)!;
      const error = (part: string, status: number, error_code: string | null) =>
        stream.emit({ event: "error", data: { part, status, error_code, message: "m" } } as never);

      // 503 with no data yet: unavailable.
      error("transcript", 503, "history_unavailable");
      expect(host.api.threadStatus.value).toBe("unavailable");
      expect(host.api.runSummaryStatus.value).toBe("unavailable");

      // 503 with data while the run is live: the data stays.
      stream.emit({ event: "thread", data: rcaThread({ run_id: "run-1" }) });
      stream.emit({ event: "summary", data: rcaRunSummaryLive({ run_id: "run-1" }) });
      error("transcript", 503, "history_unavailable");
      expect(host.api.threadStatus.value).toBe("ready");
      expect(host.api.runSummary.value).not.toBeNull();

      stream.emit({ event: "steering", data: rcaSteering() });
      error("steering", 500, null);
      expect(host.api.steeringStatus.value).toBe("unavailable");
      expect(host.api.steering.value).not.toBeNull();

      error("transcript", 410, "transcript_incomplete");
      expect(host.api.thread.value).toBeNull();
      expect(host.api.threadStatus.value).toBe("incomplete");
      expect(host.api.runSummary.value).toBeNull();
      expect(host.api.runSummaryStatus.value).toBe("expired");
    });

    it("a failed final read after the run ends drops the live snapshot so the thread offers Retry", async () => {
      host = mountHost(rca("running", "run-1", null));
      host.analysisOpen.value = true;
      await flushPromises();
      const stream = connections.at(-1)!;
      stream.emit({ event: "thread", data: rcaThread({ run_id: "run-1", active: true }) });
      stream.emit({ event: "summary", data: rcaRunSummaryLive({ run_id: "run-1" }) });

      stream.emit({ event: "rca", data: rca("completed", "run-1", "run-1") });
      await flushPromises();
      stream.emit({
        event: "error",
        data: { part: "transcript", status: 503, error_code: "history_unavailable", message: "m" },
      });

      expect(host.api.thread.value).toBeNull();
      expect(host.api.threadStatus.value).toBe("unavailable");
      expect(host.api.runSummary.value).toBeNull();
    });

    it("a server fault on a part is logged; a 404 or 410 answer is not", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      host = mountHost(rca("running", "run-1", null));
      host.analysisOpen.value = true;
      await flushPromises();
      const stream = connections.at(-1)!;

      stream.emit({
        event: "error",
        data: { part: "transcript", status: 410, error_code: "transcript_expired", message: "m" },
      });
      expect(log).not.toHaveBeenCalled();
      stream.emit({
        event: "error",
        data: { part: "steering", status: 500, error_code: null, message: "m" },
      } as never);
      expect(log).toHaveBeenCalledTimes(1);
      log.mockRestore();
    });

    it("LU17: a stored summary survives a transcript that cannot be read", async () => {
      host = mountHost(rca("completed", "run-1", "run-1"));
      host.analysisOpen.value = true;
      await flushPromises();
      const stream = connections.at(-1)!;

      stream.emit({ event: "summary", data: rcaRunSummary({ run_id: "run-1" }) });
      stream.emit({
        event: "error",
        data: { part: "transcript", status: 410, error_code: "transcript_expired", message: "m" },
      });
      expect(host.api.threadStatus.value).toBe("expired");
      expect(host.api.runSummary.value?.state).toBe("completed");
      expect(host.api.runSummaryStatus.value).toBe("ready");
    });

    it("LU17: an rca event wins over a detail read still in flight", async () => {
      const read = Promise.withResolvers<unknown>();
      service.get.mockReturnValueOnce(read.promise as never);
      host = mountHost(rca("running", "run-1", null));
      await flushPromises();

      const reload = host.api.reload();
      connections.at(-1)!.emit({ event: "rca", data: rca("completed", "run-1", "run-1") });
      read.resolve(detail(rca("running", "run-1", null)));
      await reload;

      expect(host.api.state.value).toBe("completed");
    });

    it("LU17: retry() reconnects at once", async () => {
      host = mountHost(rca("running", "run-1", null));
      await flushPromises();
      connections.at(-1)!.drop();
      await flushPromises();

      host.api.retryLive();
      await flushPromises();
      expect(connections).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(connections).toHaveLength(2);
    });
  });

  it("trigger sends the selected mode and reloads the committed run", async () => {
    service.triggerRca.mockResolvedValue({ data: { run_id: "run-2" } } as never);
    service.get.mockResolvedValue(detail(rca("running", "run-2", "run-1")) as never);
    host = mountHost(rca("completed", "run-1", "run-1"));
    await flushPromises();

    await host.api.trigger({ buildOnPrevious: true });

    expect(service.triggerRca).toHaveBeenCalledTimes(1);
    expect(service.triggerRca.mock.calls[0].slice(0, 3)).toEqual([
      "default",
      "inc-1",
      { build_on_previous: true },
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

  describe("a refused trigger (AI credits, paid usage declined)", () => {
    const exhausted = (remedy: string) => ({
      isAxiosError: true,
      response: { status: 402, data: { error_type: "ai_credits_exhausted", remedy } },
    });

    it("a 402 sets the refusal with the page that unblocks it and the options to resend", async () => {
      service.triggerRca.mockRejectedValue(exhausted("subscribe"));
      host = mountHost(rca("completed", "run-1", "run-1"));
      await flushPromises();

      await host.api.trigger({ buildOnPrevious: true, guidance: "Check the pool" });

      expect(host.api.refusal.value).toMatchObject({
        remedy: "plans",
        retry: { buildOnPrevious: true, guidance: "Check the pool" },
      });
      expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      expect(host.api.triggering.value).toBe(false);
    });

    it("a contract org's 402 points to Contact", async () => {
      service.triggerRca.mockRejectedValue(exhausted("contact_account_manager"));
      host = mountHost(null);

      await host.api.trigger();

      expect(host.api.refusal.value?.remedy).toBe("contact");
    });

    it("declining paid usage sets the refusal with Plans and sends nothing more", async () => {
      awsConfig.isCloud = "true";
      service.triggerRca.mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 412,
          data: { error_type: "paid_overage_consent_required", consent: { feature: "ai_credits" } },
        },
      });
      promptForConsent.mockResolvedValue(false);
      host = mountHost(null);

      await host.api.trigger();

      expect(host.api.refusal.value).toEqual({
        reason: "Paid AI usage is off, so this request wasn't sent.",
        remedy: "plans",
        retry: { buildOnPrevious: false },
      });
      expect(service.triggerRca).toHaveBeenCalledTimes(1);
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("a refused resume keeps no trigger options, so Retry resumes again", async () => {
      service.resumeRca.mockRejectedValue(exhausted("subscribe"));
      host = mountHost(rca("failed", "run-2", "run-1"));

      await host.api.resume("run-2");

      expect(host.api.refusal.value).toMatchObject({ remedy: "plans", retry: null });
    });

    it("clears on the next attempt", async () => {
      service.triggerRca.mockRejectedValueOnce(exhausted("subscribe"));
      host = mountHost(null);
      await host.api.trigger();
      expect(host.api.refusal.value).not.toBeNull();

      const pending = Promise.withResolvers<never>();
      service.triggerRca.mockReturnValueOnce(pending.promise);
      service.get.mockResolvedValue(detail(null) as never);
      const attempt = host.api.trigger();

      expect(host.api.refusal.value).toBeNull();
      pending.reject(new Error("later"));
      await attempt;
    });

    it("clears when a run starts", async () => {
      service.triggerRca.mockRejectedValue(exhausted("subscribe"));
      host = mountHost(rca("completed", "run-1", "run-1"));
      await host.api.trigger();
      expect(host.api.refusal.value).not.toBeNull();

      host.incident.value!.rca = rca("running", "run-2", "run-1");
      await flushPromises();

      expect(host.api.refusal.value).toBeNull();
    });

    it("clears when another incident opens", async () => {
      service.triggerRca.mockRejectedValue(exhausted("subscribe"));
      host = mountHost(null);
      await host.api.trigger();
      expect(host.api.refusal.value).not.toBeNull();

      host.incident.value = { id: "inc-2", rca: null } as IncidentWithAlerts;
      await flushPromises();

      expect(host.api.refusal.value).toBeNull();
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

  it("the shown report's stored verdict gives the card its services and actions", async () => {
    service.getRcaRun.mockResolvedValueOnce({
      data: {
        run_id: "run-2",
        report: "report of run-2",
        result: {
          verdict: {
            impacted_services: ["service=checkout-api"],
            proposed_actions: [{ title: "Roll back", kind: "rollback", detail: "Revert." }],
          },
        },
      },
    } as never);
    host = mountHost(rca("completed", "run-2", "run-2"));
    await flushPromises();

    expect(host.api.reportVerdict.value).toEqual({
      impactedServices: ["service=checkout-api"],
      proposedActions: [{ title: "Roll back", kind: "rollback", detail: "Revert." }],
    });
  });

  describe("v1: pre-upgrade reports", () => {
    const V1_ITEMS = [rcaV1RunItem(), rcaV1RunItem({ run_id: "v1-1" })];

    it("a v1-only incident shows the newest v1 report, read through getRcaRun", async () => {
      host = mountHost(rcaV1Summary(V1_ITEMS));
      await flushPromises();

      expect(host.api.displayedRunId.value).toBe("v1-0");
      expect(host.api.threadRunId.value).toBe("v1-0");
      expect(service.getRcaRun).toHaveBeenCalledWith("default", "inc-1", "v1-0");
      expect(host.api.reportText.value).toBe("report of v1-0");
    });

    it("picking an older v1 report pins it and loads its report", async () => {
      host = mountHost(rcaV1Summary(V1_ITEMS));
      await flushPromises();

      host.api.viewRun("v1-1");
      await flushPromises();

      expect(host.api.displayedRunId.value).toBe("v1-1");
      expect(host.api.threadRunId.value).toBe("v1-1");
      expect(service.getRcaRun).toHaveBeenCalledWith("default", "inc-1", "v1-1");
      expect(host.api.reportText.value).toBe("report of v1-1");
    });

    it("a failed v2 latest run keeps the v1 report as the shown report", async () => {
      const failed: RcaSummary = {
        ...rca("failed", "run-1", null),
        report_run: V1_ITEMS[0],
        history: [{ ...reportRun("run-1"), state: "failed" }, ...V1_ITEMS],
      };
      host = mountHost(failed);
      await flushPromises();

      expect(host.api.threadRunId.value).toBe("run-1");
      expect(host.api.displayedRunId.value).toBe("v1-0");
      expect(host.api.reportText.value).toBe("report of v1-0");
    });
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
