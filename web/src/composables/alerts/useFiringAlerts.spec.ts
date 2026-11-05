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
import { defineComponent, ref, type Ref } from "vue";
import { focusManager } from "@tanstack/vue-query";
import { createStore } from "vuex";
import alerts from "@/services/alerts";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { FiringState } from "@/utils/alerts/firingAlerts";
import { FIRING_POLL_MS, useFiringAlerts } from "./useFiringAlerts";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const store = createStore({
  state: { selectedOrganization: { identifier: "acme" }, userInfo: { email: "me@acme.io" } },
});

const counts = { firing: 0, acked: 0, muted: 0, failed: 0, recovered: 0 };
const page = (list: { alert_id: string; name: string }[]) => ({
  data: { list, counts: { ...counts, firing: list.length }, total: list.length },
});
const listByState = vi.fn();

const mountComposable = (state: Ref<FiringState> = ref("firing")) => {
  let api: ReturnType<typeof useFiringAlerts> | undefined;
  mount(
    defineComponent({
      setup() {
        api = useFiringAlerts(state);
        return () => null;
      },
    }),
    { global: { provide: { store } } },
  );
  return api!;
};

const tick = async () => {
  await vi.advanceTimersByTimeAsync(FIRING_POLL_MS);
  await flushPromises();
};

describe("useFiringAlerts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    listByState.mockReset();
    vi.mocked(toast).mockClear();
    (alerts as any).listByState = listByState;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps polling while the browser tab is hidden", async () => {
    listByState.mockResolvedValue(page([]));
    const state = ref<FiringState>("acked");
    mountComposable(state);
    await flushPromises();
    focusManager.setFocused(false);
    const before = listByState.mock.calls.length;
    await tick();
    focusManager.setFocused(undefined);
    expect(listByState.mock.calls.length).toBeGreaterThan(before);
  });

  it("keeps polling every 30s even with nothing firing", async () => {
    listByState.mockResolvedValue(page([]));
    mountComposable();
    await flushPromises();
    expect(listByState).toHaveBeenCalledTimes(1);
    await tick();
    await tick();
    expect(listByState).toHaveBeenCalledTimes(3);
  });

  it("polls Firing and the open chip, so a recovery is seen from any chip", async () => {
    listByState.mockResolvedValue(page([]));
    mountComposable(ref<FiringState>("acked"));
    await flushPromises();
    const states = () => listByState.mock.calls.map((call) => call[1]);
    expect(states().sort()).toEqual(["acked", "firing"]);
    await tick();
    expect(states().filter((s) => s === "acked")).toHaveLength(2);
    expect(states().filter((s) => s === "firing")).toHaveLength(2);
  });

  it("keeps the last rows and reports a failed refresh", async () => {
    listByState.mockResolvedValueOnce(page([{ alert_id: "1", name: "disk" }]));
    const api = mountComposable();
    await flushPromises();
    listByState.mockRejectedValue({ response: { status: 500 }, message: "timeout" });
    await vi.advanceTimersByTimeAsync(FIRING_POLL_MS + 10_000);
    await flushPromises();
    expect(api.refreshFailed.value).toBe(true);
    expect(api.rows.value.map((r) => r.alert_id)).toEqual(["1"]);
  });

  it("toasts a row that left Firing and is recovered", async () => {
    listByState.mockImplementation(async (_org: string, state: string) =>
      state === "recovered"
        ? page([{ alert_id: "1", name: "disk" }])
        : listByState.mock.calls.length === 1
          ? page([
              { alert_id: "1", name: "disk" },
              { alert_id: "2", name: "cert" },
            ])
          : page([{ alert_id: "2", name: "cert" }]),
    );
    mountComposable();
    await flushPromises();
    await tick();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0][0]).toMatchObject({
      variant: "success",
      message: "disk recovered",
    });
  });

  it("stays quiet for a row that left Firing by being acknowledged", async () => {
    listByState.mockImplementation(async (_org: string, state: string) =>
      state === "recovered"
        ? page([])
        : listByState.mock.calls.length === 1
          ? page([{ alert_id: "1", name: "disk" }])
          : page([]),
    );
    mountComposable();
    await flushPromises();
    await tick();
    expect(toast).not.toHaveBeenCalled();
  });

  it("treats a 403 on first read as forbidden", async () => {
    listByState.mockRejectedValue({ response: { status: 403 } });
    const api = mountComposable();
    await tick();
    expect(api.forbidden.value).toBe(true);
  });

  it("keeps the last data when a refresh is refused", async () => {
    listByState.mockResolvedValue(page([{ alert_id: "a", name: "a" }]));
    const api = mountComposable();
    await flushPromises();
    listByState.mockRejectedValue({ response: { status: 403 } });
    await api.refresh();
    await flushPromises();
    expect(api.forbidden.value).toBe(false);
    expect(api.refreshFailed.value).toBe(true);
    expect(api.rows.value).toHaveLength(1);
  });
});
