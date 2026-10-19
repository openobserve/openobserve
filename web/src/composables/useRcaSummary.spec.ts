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
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { AxiosError, AxiosHeaders } from "axios";

vi.mock("@/services/incidents", () => ({ default: { getRcaSummary: vi.fn() } }));

import incidentsService from "@/services/incidents";
import { RCA_SUMMARY_POLL_MS, useRcaSummary } from "./useRcaSummary";
import { RCA_THREAD_POLL_MS } from "./useRcaThread";
import { rcaRunSummary, rcaRunSummaryLive } from "@/test/unit/fixtures/rcaThread";

const getRcaSummary = vi.mocked(incidentsService.getRcaSummary);

const httpError = (status: number) =>
  new AxiosError("failed", String(status), undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });

const notModified = (v: string) => ({
  data: { run_id: "run-2", not_modified: true, state_version: v },
});

/** `known_version` of each request so far. */
const knownVersions = () => getRcaSummary.mock.calls.map((call) => call[3]);

describe("useRcaSummary (03 §12, parity with useRcaThread)", () => {
  let scope: EffectScope;
  const org = ref("default");
  const incidentId = ref<string | null>("inc-1");
  const runId = ref<string | null>("run-2");
  const live = ref(true);

  const start = () => {
    scope = effectScope();
    return scope.run(() => useRcaSummary(org, incidentId, runId, live))!;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    getRcaSummary.mockReset();
    org.value = "default";
    incidentId.value = "inc-1";
    runId.value = "run-2";
    live.value = true;
  });

  afterEach(() => {
    scope?.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls at the thread's cadence with known_version, then stops after one final read", async () => {
    expect(RCA_SUMMARY_POLL_MS).toBe(RCA_THREAD_POLL_MS);
    getRcaSummary
      .mockResolvedValueOnce({ data: rcaRunSummaryLive({ state_version: "v1" }) } as never)
      .mockResolvedValue(notModified("v1") as never);
    const { summary, status } = start();
    await vi.advanceTimersByTimeAsync(0);

    expect(getRcaSummary).toHaveBeenCalledTimes(1);
    expect(getRcaSummary).toHaveBeenLastCalledWith("default", "inc-1", "run-2", undefined);
    expect(status.value).toBe("ready");
    expect(summary.value?.card.leading?.id).toBe("h1");

    await vi.advanceTimersByTimeAsync(3_999);
    expect(getRcaSummary).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getRcaSummary).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(getRcaSummary).toHaveBeenCalledTimes(3);
    expect(knownVersions()).toEqual([undefined, "v1", "v1"]);
    // A not_modified answer keeps the summary.
    expect(summary.value?.state_version).toBe("v1");
    expect(summary.value?.card.leading).not.toBeNull();

    // The run turns completed: exactly one final read, then nothing.
    getRcaSummary.mockResolvedValue({ data: rcaRunSummary({ state_version: "v2" }) } as never);
    live.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(getRcaSummary).toHaveBeenCalledTimes(4);
    expect(knownVersions()[3]).toBe("v1");
    expect(summary.value?.state_version).toBe("v2");
    expect(summary.value?.card.outcome).toBe("root_cause_identified");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getRcaSummary).toHaveBeenCalledTimes(4);
  });

  it("a finished run is read once and never polled", async () => {
    live.value = false;
    getRcaSummary.mockResolvedValue({ data: rcaRunSummary() } as never);
    const { status } = start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getRcaSummary).toHaveBeenCalledTimes(1);
    expect(status.value).toBe("ready");
  });

  it("stops on 410 and reports the transcript as expired", async () => {
    getRcaSummary
      .mockResolvedValueOnce({ data: rcaRunSummaryLive({ state_version: "v1" }) } as never)
      .mockRejectedValue(httpError(410));
    const { summary, status } = start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RCA_SUMMARY_POLL_MS);

    expect(getRcaSummary).toHaveBeenCalledTimes(2);
    expect(status.value).toBe("expired");
    expect(summary.value).toBeNull();

    // Neither the poll, the run turning terminal, nor retry() reads again.
    live.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getRcaSummary).toHaveBeenCalledTimes(2);
    expect(status.value).toBe("expired");
  });

  it.each([
    [403, "unsupported"],
    [404, "missing"],
  ])("stops on %i (%s)", async (code, expected) => {
    getRcaSummary.mockRejectedValue(httpError(code));
    const { status } = start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getRcaSummary).toHaveBeenCalledTimes(1);
    expect(status.value).toBe(expected);
  });

  it("keeps polling a live run through 503 and keeps the last good summary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getRcaSummary
      .mockResolvedValueOnce({ data: rcaRunSummaryLive({ state_version: "v1" }) } as never)
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue(notModified("v1") as never);
    const { summary, status } = start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RCA_SUMMARY_POLL_MS);

    expect(getRcaSummary).toHaveBeenCalledTimes(2);
    expect(status.value).toBe("ready");
    expect(summary.value?.state_version).toBe("v1");
    await vi.advanceTimersByTimeAsync(RCA_SUMMARY_POLL_MS);
    expect(getRcaSummary).toHaveBeenCalledTimes(3);
    expect(knownVersions()[2]).toBe("v1");
  });

  it.each([
    ["503", httpError(503)],
    ["a network error", new Error("Network Error")],
  ])(
    "a final read that fails with %s drops the live-shaped summary as unavailable; retry() reads the record",
    async (_case, failure) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      getRcaSummary
        .mockResolvedValueOnce({ data: rcaRunSummaryLive({ state_version: "v1" }) } as never)
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({ data: rcaRunSummary({ state_version: "v2" }) } as never);
      const { summary, status } = start();
      await vi.advanceTimersByTimeAsync(0);
      expect(summary.value?.state).toBe("running");

      live.value = false;
      await nextTick();
      await vi.advanceTimersByTimeAsync(0);

      expect(getRcaSummary).toHaveBeenCalledTimes(2);
      expect(summary.value).toBeNull();
      expect(status.value).toBe("unavailable");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getRcaSummary).toHaveBeenCalledTimes(2);
    },
  );

  it("a failed final read keeps a summary that is already finished", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getRcaSummary
      .mockResolvedValueOnce({ data: rcaRunSummary({ state: "completed" }) } as never)
      .mockRejectedValueOnce(httpError(503));
    const { summary, status } = start();
    await vi.advanceTimersByTimeAsync(0);

    live.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);

    expect(getRcaSummary).toHaveBeenCalledTimes(2);
    expect(status.value).toBe("ready");
    expect(summary.value?.card.outcome).toBe("root_cause_identified");
  });

  it("a new run id starts over without known_version and drops the old run's late answer", async () => {
    const oldRead = Promise.withResolvers<unknown>();
    getRcaSummary.mockReturnValueOnce(oldRead.promise as never);
    getRcaSummary.mockResolvedValue({
      data: rcaRunSummary({ run_id: "run-1", state_version: "r1" }),
    } as never);
    const { summary, status } = start();
    expect(status.value).toBe("loading");

    live.value = false;
    runId.value = "run-1";
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    oldRead.resolve({ data: rcaRunSummaryLive({ run_id: "run-2", state_version: "late" }) });
    await vi.advanceTimersByTimeAsync(0);

    expect(getRcaSummary).toHaveBeenLastCalledWith("default", "inc-1", "run-1", undefined);
    expect(summary.value?.run_id).toBe("run-1");
  });

  it("is idle without a run and stops polling when the owner goes away", async () => {
    runId.value = null;
    const { status } = start();
    expect(status.value).toBe("idle");
    expect(getRcaSummary).not.toHaveBeenCalled();

    getRcaSummary.mockResolvedValue({ data: rcaRunSummaryLive() } as never);
    runId.value = "run-2";
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(getRcaSummary).toHaveBeenCalledTimes(1);

    scope.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getRcaSummary).toHaveBeenCalledTimes(1);
  });
});
