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
import { createStore } from "vuex";
import type * as AutoResolveModule from "@/services/autoresolve";

// The real store module needs the app shell; the service only reads its API endpoint.
vi.mock("@/stores", () => ({ default: { state: {} } }));
vi.mock("@/services/autoresolve", async (importOriginal) => ({
  ...(await importOriginal<typeof AutoResolveModule>()),
  default: { getRun: vi.fn(), openAutoResolveLiveStream: vi.fn() },
}));

import autoresolve, {
  AutoResolveLiveStreamRefused,
  type AutoResolveLiveEvent,
  type AutoResolveRun,
  type AutoResolveRunState,
} from "@/services/autoresolve";
import { useAutoResolveRun } from "./useAutoResolveRun";

const service = vi.mocked(autoresolve);

/** One live stream the composable opened; the test drives it. */
interface Connection {
  emit: (event: AutoResolveLiveEvent) => void;
  drop: () => void;
  fail: (status: number) => void;
}

const connections: Connection[] = [];

const runIn = (state: AutoResolveRunState) => ({ id: "run-1", state }) as AutoResolveRun;

function mountHost() {
  let api!: ReturnType<typeof useAutoResolveRun>;
  const wrapper: VueWrapper = mount(
    defineComponent({
      setup() {
        api = useAutoResolveRun(ref("run-1"));
        return () => null;
      },
    }),
    {
      global: {
        plugins: [
          createStore({ state: () => ({ selectedOrganization: { identifier: "default" } }) }),
        ],
      },
    },
  );
  return { api, wrapper };
}

describe("useAutoResolveRun", () => {
  let host: ReturnType<typeof mountHost> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connections.length = 0;
    service.openAutoResolveLiveStream.mockImplementation((_org, _id, { onEvent }) => {
      const { promise, resolve, reject } = Promise.withResolvers<{ ended: boolean }>();
      connections.push({
        emit: onEvent,
        drop: () => resolve({ ended: false }),
        fail: (status) =>
          reject(
            status === 0
              ? new TypeError("Failed to fetch")
              : new AutoResolveLiveStreamRefused(status),
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

  it.each([
    ["404", (c: Connection) => c.fail(404), null, true],
    [
      "a terminal run state",
      (c: Connection) => {
        c.emit({ event: "snapshot", data: runIn("worked") });
        c.drop();
      },
      "worked",
      false,
    ],
  ])("stops reconnecting on %s", async (_cause, stop, state, failed) => {
    host = mountHost();
    await flushPromises();
    expect(connections).toHaveLength(1);

    stop(connections[0]);
    await flushPromises();
    expect(host.api.live.value).toBe(false);
    expect(host.api.reconnecting.value).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(connections).toHaveLength(1);
    expect(host.api.run.value?.state ?? null).toBe(state);
    expect(host.api.error.value !== null).toBe(failed);
  });

  it("reconnects quietly after the server closes the stream, with backoff after a failure, keeping the last snapshot", async () => {
    host = mountHost();
    await flushPromises();
    connections[0].emit({ event: "snapshot", data: runIn("waiting_approval") });

    // The server closes every stream after 300 s; that is not a failure to show.
    connections[0].drop();
    await flushPromises();
    expect(host.api.reconnecting.value).toBe(false);
    expect(host.api.run.value?.state).toBe("waiting_approval");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connections).toHaveLength(2);

    connections[1].fail(503);
    await flushPromises();
    expect(host.api.reconnecting.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(3);
    expect(host.api.run.value?.state).toBe("waiting_approval");
    expect(host.api.error.value).toBeNull();

    connections[2].emit({ event: "snapshot", data: runIn("proceeding") });
    expect(host.api.reconnecting.value).toBe(false);
    expect(host.api.live.value).toBe(true);
    expect(host.api.run.value?.state).toBe("proceeding");
  });

  it("refresh reopens the stream when a finished run becomes live again", async () => {
    host = mountHost();
    await flushPromises();
    connections[0].emit({ event: "snapshot", data: runIn("worse") });
    connections[0].drop();
    await flushPromises();
    expect(host.api.live.value).toBe(false);

    service.getRun.mockResolvedValueOnce({ data: runIn("investigating") } as never);
    await host.api.refresh();
    await flushPromises();

    expect(connections).toHaveLength(2);
    expect(host.api.live.value).toBe(true);
    connections[1].emit({ event: "snapshot", data: runIn("waiting_approval") });
    expect(host.api.run.value?.state).toBe("waiting_approval");
  });
});
