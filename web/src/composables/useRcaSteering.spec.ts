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

vi.mock("@/services/incidents", () => ({
  default: { getRcaSteering: vi.fn(), steerRca: vi.fn() },
}));

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import incidentsService, { type RcaSteerRequest, type RcaSteering } from "@/services/incidents";
import { rcaSteering, rcaSteeringLive } from "@/test/unit/fixtures/rcaThread";
import { RCA_STEERING_POLL_MS, useRcaSteering, type RcaSteerSendResult } from "./useRcaSteering";

const getRcaSteering = vi.mocked(incidentsService.getRcaSteering);
const steerRca = vi.mocked(incidentsService.steerRca);

const httpError = (status: number, data: unknown = {}) => ({
  isAxiosError: true,
  response: { status, data },
});

/** What the tests use of the composable. */
interface Api {
  steering: Ref<RcaSteering | null>;
  send: (request: RcaSteerRequest) => Promise<RcaSteerSendResult>;
}

interface Host {
  wrapper: VueWrapper;
  api: Api;
  runId: Ref<string | null>;
  live: Ref<boolean>;
}

const mountHost = (live = true, runId: string | null = "run-2"): Host => {
  const runRef = ref<string | null>(runId);
  const liveRef = ref(live);
  let api!: Api;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useRcaSteering(ref("default"), ref<string | null>("inc-1"), runRef, liveRef);
        return () => null;
      },
    }),
    { global: { plugins: [i18n, store] } },
  );
  return { wrapper, api, runId: runRef, live: liveRef };
};

describe("useRcaSteering (04 §9.2, SG37)", () => {
  let host: Host | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 16, 12, 0, 0));
    getRcaSteering.mockReset().mockResolvedValue({ data: rcaSteering() } as never);
    steerRca.mockReset().mockResolvedValue({ data: { run_state: "running" } } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    host?.wrapper.unmount();
    host = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads the view of the run on mount", async () => {
    getRcaSteering.mockResolvedValue({ data: rcaSteeringLive() } as never);
    host = mountHost();
    await flushPromises();

    expect(getRcaSteering).toHaveBeenCalledWith("default", "inc-1", "run-2");
    expect(host.api.steering.value?.items).toHaveLength(2);
  });

  it("polls every 4 s while live", async () => {
    host = mountHost();
    await flushPromises();
    expect(getRcaSteering).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS - 1);
    expect(getRcaSteering).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getRcaSteering).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS);
    expect(getRcaSteering).toHaveBeenCalledTimes(3);
  });

  it("a run that is not live is read once and not polled", async () => {
    host = mountHost(false);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS * 3);

    expect(getRcaSteering).toHaveBeenCalledTimes(1);
  });

  it("when the run stops being live: one final read, then no more", async () => {
    host = mountHost();
    await flushPromises();
    host.live.value = false;
    await flushPromises();
    expect(getRcaSteering).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS * 3);
    expect(getRcaSteering).toHaveBeenCalledTimes(2);
  });

  it.each([403, 404])("a %s halts the reads and leaves no view", async (status) => {
    getRcaSteering
      .mockResolvedValueOnce({ data: rcaSteering() } as never)
      .mockRejectedValueOnce(httpError(status));
    host = mountHost();
    await flushPromises();
    expect(host.api.steering.value).not.toBeNull();

    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS);
    expect(host.api.steering.value).toBeNull();
    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS * 3);
    expect(getRcaSteering).toHaveBeenCalledTimes(2);
  });

  it("a 500 keeps the last view and the poll retries", async () => {
    getRcaSteering
      .mockResolvedValueOnce({ data: rcaSteeringLive() } as never)
      .mockRejectedValueOnce(httpError(500));
    host = mountHost();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS);

    expect(host.api.steering.value?.items).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS);
    expect(getRcaSteering).toHaveBeenCalledTimes(3);
  });

  it("a new run id clears the view and reads the new run", async () => {
    getRcaSteering.mockResolvedValue({ data: rcaSteeringLive() } as never);
    host = mountHost();
    await flushPromises();
    getRcaSteering.mockResolvedValue({ data: rcaSteering() } as never);
    host.runId.value = "run-3";
    await flushPromises();

    expect(getRcaSteering).toHaveBeenLastCalledWith("default", "inc-1", "run-3");
    expect(host.api.steering.value?.items).toEqual([]);
  });

  it("unmount stops the poll", async () => {
    host = mountHost();
    await flushPromises();
    host.wrapper.unmount();
    host = null;
    await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS * 3);

    expect(getRcaSteering).toHaveBeenCalledTimes(1);
  });

  describe("send (§9.1)", () => {
    it("POSTs the request, then re-reads the view at once", async () => {
      host = mountHost();
      await flushPromises();
      const request = { text: "Check the orders pool", kind: "message" as const };

      const result = await host.api.send(request);
      await flushPromises();

      expect(steerRca).toHaveBeenCalledWith("default", "inc-1", "run-2", request);
      expect(result).toEqual({ ok: true, runState: "running" });
      // Mount read + the refresh, before any 4 s tick.
      expect(getRcaSteering).toHaveBeenCalledTimes(2);
      expect(steerRca.mock.invocationCallOrder[0]).toBeLessThan(
        getRcaSteering.mock.invocationCallOrder[1],
      );
    });

    it("the refresh restarts the 4 s rhythm", async () => {
      host = mountHost();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS - 1_000);
      await host.api.send({ text: "x", kind: "message" });
      await flushPromises();
      expect(getRcaSteering).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS - 1);
      expect(getRcaSteering).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(getRcaSteering).toHaveBeenCalledTimes(3);
    });

    it.each([
      [
        409,
        "run_closing",
        "The answer window has closed and the run is closing as Blocked. Re-analyze with your message instead.",
      ],
      [
        409,
        "run_not_steerable",
        "This run no longer takes messages. Re-analyze to start a new version.",
      ],
      [409, "duplicate_action", "The same action is already waiting for the agent."],
      [400, "invalid_text", "A message needs 1 to 2,000 characters."],
    ])("a %s %s shows its message", async (status, code, message) => {
      steerRca.mockRejectedValue(httpError(status, { error_code: code, message: "raw" }));
      host = mountHost();
      await flushPromises();

      const result = await host.api.send({ text: "x", kind: "message" });

      expect(result).toEqual({ ok: false, code, message });
    });

    it("a 429 shows the time the user can send again", async () => {
      steerRca.mockRejectedValue(
        httpError(429, { error_code: "rate_limited", retry_after_secs: 45 }),
      );
      host = mountHost();
      await flushPromises();

      const result = await host.api.send({ text: "x", kind: "message" });

      // 12:00:00 UTC + 45 s in the store's UTC zone.
      expect(result).toEqual({
        ok: false,
        code: "rate_limited",
        message: "Too many messages. You can send again at 12:00:45.",
      });
    });

    it("a 429 without retry_after_secs shows the plain limit message", async () => {
      steerRca.mockRejectedValue(httpError(429, {}));
      host = mountHost();
      await flushPromises();

      const result = await host.api.send({ text: "x", kind: "message" });

      expect(result).toMatchObject({ ok: false, message: "Too many messages for this run." });
    });

    it("a refused send re-reads the view at once", async () => {
      steerRca.mockRejectedValue(httpError(409, { error_code: "duplicate_action" }));
      host = mountHost();
      await flushPromises();

      await host.api.send({ text: "x", kind: "message" });
      await flushPromises();

      expect(getRcaSteering).toHaveBeenCalledTimes(2);
    });

    it.each(["run_closing", "run_not_steerable"])(
      "a %s refusal is left to the 4 s poll (no read at once)",
      async (code) => {
        steerRca.mockRejectedValue(httpError(409, { error_code: code }));
        host = mountHost();
        await flushPromises();

        const result = await host.api.send({ text: "x", kind: "message" });
        await flushPromises();

        expect(result).toMatchObject({ ok: false, code });
        expect(getRcaSteering).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(RCA_STEERING_POLL_MS);
        expect(getRcaSteering).toHaveBeenCalledTimes(2);
      },
    );
  });
});
