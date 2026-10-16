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

vi.mock("@/services/incidents", () => ({ default: { getRcaThread: vi.fn() } }));

import incidentsService from "@/services/incidents";
import { RCA_THREAD_POLL_MS, useRcaThread } from "./useRcaThread";
import { rcaThread } from "@/test/unit/fixtures/rcaThread";

const getRcaThread = vi.mocked(incidentsService.getRcaThread);

const httpError = (status: number, data: unknown = {}) =>
  new AxiosError("failed", String(status), undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });

/** `known_version` of each request so far. */
const knownVersions = () => getRcaThread.mock.calls.map((call) => call[3]);

describe("useRcaThread (02 TH32)", () => {
  let scope: EffectScope;
  const org = ref("default");
  const incidentId = ref<string | null>("inc-1");
  const runId = ref<string | null>("run-2");
  const live = ref(true);

  const start = () => {
    scope = effectScope();
    return scope.run(() => useRcaThread(org, incidentId, runId, live))!;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    getRcaThread.mockReset();
    org.value = "default";
    incidentId.value = "inc-1";
    runId.value = "run-2";
    live.value = true;
  });

  afterEach(() => {
    scope?.stop();
    vi.useRealTimers();
  });

  it("polls every 4 s while live with known_version, then stops after one final read", async () => {
    getRcaThread
      .mockResolvedValueOnce({ data: rcaThread({ state_version: "v1" }) } as never)
      .mockResolvedValue({ data: { not_modified: true, state_version: "v1" } } as never);
    const { thread, status } = start();
    await vi.advanceTimersByTimeAsync(0);

    expect(getRcaThread).toHaveBeenCalledTimes(1);
    expect(getRcaThread).toHaveBeenLastCalledWith("default", "inc-1", "run-2", undefined);
    expect(status.value).toBe("ready");
    expect(thread.value?.steps).toHaveLength(2);

    expect(RCA_THREAD_POLL_MS).toBe(4_000);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(getRcaThread).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getRcaThread).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(getRcaThread).toHaveBeenCalledTimes(3);
    expect(knownVersions()).toEqual([undefined, "v1", "v1"]);
    // A not_modified answer keeps the thread.
    expect(thread.value?.state_version).toBe("v1");

    // The run turns completed: exactly one final read, then nothing.
    getRcaThread.mockResolvedValue({
      data: rcaThread({ state_version: "v2", active: false, report_submitted: true }),
    } as never);
    live.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(getRcaThread).toHaveBeenCalledTimes(4);
    expect(knownVersions()[3]).toBe("v1");
    expect(thread.value?.state_version).toBe("v2");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getRcaThread).toHaveBeenCalledTimes(4);
  });

  it("a saved run is read once and never polled", async () => {
    live.value = false;
    getRcaThread.mockResolvedValue({ data: rcaThread({ active: false }) } as never);
    start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getRcaThread).toHaveBeenCalledTimes(1);
  });

  it("stops on 410 and reports the transcript as expired", async () => {
    getRcaThread
      .mockResolvedValueOnce({ data: rcaThread({ state_version: "v1" }) } as never)
      .mockRejectedValue(httpError(410));
    const { thread, status } = start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RCA_THREAD_POLL_MS);

    expect(getRcaThread).toHaveBeenCalledTimes(2);
    expect(status.value).toBe("expired");
    expect(thread.value).toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getRcaThread).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["transcript_incomplete", "incomplete"],
    ["transcript_expired", "expired"],
    [undefined, "expired"],
  ])("a 410 with error_code %s halts as %s with no further reads", async (errorCode, expected) => {
    getRcaThread
      .mockResolvedValueOnce({ data: rcaThread({ state_version: "v1" }) } as never)
      .mockRejectedValue(httpError(410, errorCode ? { error_code: errorCode } : {}));
    const { thread, status, retry } = start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RCA_THREAD_POLL_MS);

    expect(status.value).toBe(expected);
    expect(thread.value).toBeNull();
    expect(getRcaThread).toHaveBeenCalledTimes(2);

    // Neither the poll, the run turning terminal, nor retry() reads again.
    live.value = false;
    await nextTick();
    await retry();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getRcaThread).toHaveBeenCalledTimes(2);
    expect(status.value).toBe(expected);
  });

  it("a first read of a saved run with 410 transcript_incomplete is incomplete", async () => {
    live.value = false;
    getRcaThread.mockRejectedValue(httpError(410, { error_code: "transcript_incomplete" }));
    const { status } = start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getRcaThread).toHaveBeenCalledTimes(1);
    expect(status.value).toBe("incomplete");
  });

  it.each([
    [403, "unsupported"],
    [404, "missing"],
  ])("stops on %i (%s)", async (code, expected) => {
    getRcaThread.mockRejectedValue(httpError(code));
    const { status } = start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getRcaThread).toHaveBeenCalledTimes(1);
    expect(status.value).toBe(expected);
  });

  it("keeps polling a live run through 503 and keeps the last good thread", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getRcaThread
      .mockResolvedValueOnce({ data: rcaThread({ state_version: "v1" }) } as never)
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue({ data: { not_modified: true, state_version: "v1" } } as never);
    const { thread, status } = start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RCA_THREAD_POLL_MS);

    expect(status.value).toBe("ready");
    expect(thread.value?.state_version).toBe("v1");
    await vi.advanceTimersByTimeAsync(RCA_THREAD_POLL_MS);
    expect(getRcaThread).toHaveBeenCalledTimes(3);
  });

  it("a first read that fails with 503 reports unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    live.value = false;
    getRcaThread.mockRejectedValue(httpError(503));
    const { status } = start();
    await vi.advanceTimersByTimeAsync(0);

    expect(status.value).toBe("unavailable");
  });

  it("retry() re-reads once from unavailable and loads the thread", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    live.value = false;
    getRcaThread
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue({ data: rcaThread({ active: false }) } as never);
    const { status, thread, retry } = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(status.value).toBe("unavailable");

    const pending = retry();
    expect(status.value).toBe("loading");
    await pending;

    expect(getRcaThread).toHaveBeenCalledTimes(2);
    expect(status.value).toBe("ready");
    expect(thread.value?.run_id).toBe("run-2");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getRcaThread).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["ready", () => getRcaThread.mockResolvedValue({ data: rcaThread() } as never)],
    ["expired", () => getRcaThread.mockRejectedValue(httpError(410))],
    ["missing", () => getRcaThread.mockRejectedValue(httpError(404))],
  ])("retry() does nothing from %s", async (expected, arrange) => {
    live.value = false;
    arrange();
    const { status, retry } = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(status.value).toBe(expected);

    await retry();

    expect(getRcaThread).toHaveBeenCalledTimes(1);
    expect(status.value).toBe(expected);
  });

  it("a new run id starts over without known_version and drops the old run's late answer", async () => {
    const oldRead = Promise.withResolvers<unknown>();
    getRcaThread.mockReturnValueOnce(oldRead.promise as never);
    getRcaThread.mockResolvedValue({
      data: rcaThread({ run_id: "run-1", state_version: "r1" }),
    } as never);
    const { thread, status } = start();
    expect(status.value).toBe("loading");

    live.value = false;
    runId.value = "run-1";
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    oldRead.resolve({ data: rcaThread({ run_id: "run-2", state_version: "late" }) });
    await vi.advanceTimersByTimeAsync(0);

    expect(getRcaThread).toHaveBeenLastCalledWith("default", "inc-1", "run-1", undefined);
    expect(thread.value?.run_id).toBe("run-1");
  });

  it("is idle without a run and stops polling when the owner goes away", async () => {
    runId.value = null;
    const { status } = start();
    expect(status.value).toBe("idle");
    expect(getRcaThread).not.toHaveBeenCalled();

    getRcaThread.mockResolvedValue({ data: rcaThread() } as never);
    runId.value = "run-2";
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(getRcaThread).toHaveBeenCalledTimes(1);

    scope.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getRcaThread).toHaveBeenCalledTimes(1);
  });
});
