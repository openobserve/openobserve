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
import { defineComponent, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

vi.mock("@/services/incidents", () => ({
  default: { steerRca: vi.fn() },
}));

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import incidentsService, { type RcaSteerRequest } from "@/services/incidents";
import { useRcaSteering, type RcaSteerSendResult } from "./useRcaSteering";

const steerRca = vi.mocked(incidentsService.steerRca);

const httpError = (status: number, data: unknown = {}) => ({
  isAxiosError: true,
  response: { status, data },
});

/** What the tests use of the composable. */
interface Api {
  send: (request: RcaSteerRequest) => Promise<RcaSteerSendResult>;
}

interface Host {
  wrapper: VueWrapper;
  api: Api;
}

const mountHost = (): Host => {
  let api!: Api;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useRcaSteering(ref("default"), ref<string | null>("inc-1"), ref("run-2"));
        return () => null;
      },
    }),
    { global: { plugins: [i18n, store] } },
  );
  return { wrapper, api };
};

describe("useRcaSteering send (04 §9.1)", () => {
  let host: Host | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 16, 12, 0, 0));
    steerRca.mockReset().mockResolvedValue({ data: { run_state: "running" } } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    host?.wrapper.unmount();
    host = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("send", () => {
    it("POSTs the request", async () => {
      host = mountHost();
      await flushPromises();
      const request = { text: "Check the orders pool", kind: "message" as const };

      const result = await host.api.send(request);

      expect(steerRca).toHaveBeenCalledWith("default", "inc-1", "run-2", request);
      expect(result).toEqual({ ok: true });
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
  });
});
