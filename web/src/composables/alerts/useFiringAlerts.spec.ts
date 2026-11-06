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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref, type Ref } from "vue";
import { createStore } from "vuex";
import alerts from "@/services/alerts";
import { queryClient } from "@/composables/query/queryClient";
import { firingAlertsQuery } from "@/services/alerts.queries";
import type { FiringState } from "@/utils/alerts/firingAlerts";
import { useFiringAlerts } from "./useFiringAlerts";

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});

const store = createStore({
  state: { selectedOrganization: { identifier: "acme" }, userInfo: { email: "me@acme.io" } },
});

const firing = (alert_id: string, over = {}) => ({
  alert_id,
  name: alert_id,
  folder_name: "f",
  last_outcome: "firing",
  ...over,
});
const page = (list: object[], extra = {}) => ({ data: { list, ...extra } });
const listByFolderId = vi.fn();

const mountComposable = (
  state: Ref<FiringState> = ref("firing"),
  selected: Ref<string | null> = ref(null),
) => {
  let api: ReturnType<typeof useFiringAlerts> | undefined;
  mount(
    defineComponent({
      setup() {
        api = useFiringAlerts(state, selected);
        return () => null;
      },
    }),
    { global: { provide: { store } } },
  );
  return api!;
};

describe("useFiringAlerts", () => {
  beforeEach(() => {
    queryClient.clear();
    listByFolderId.mockReset();
    (alerts as any).listByFolderId = listByFolderId;
  });

  it("reads once across folders, without a page size, whichever chip is open", async () => {
    listByFolderId.mockResolvedValue(page([firing("a")]));
    const state = ref<FiringState>("firing");
    const api = mountComposable(state);
    await flushPromises();
    state.value = "acked";
    await flushPromises();
    expect(listByFolderId).toHaveBeenCalledTimes(1);
    const [, , , , , org, folder] = listByFolderId.mock.calls[0];
    expect(org).toBe("acme");
    expect(folder).toBeUndefined();
    expect(api.rows.value).toEqual([]);
  });

  it("derives the rows and counts of the open chip from that one read", async () => {
    listByFolderId.mockResolvedValue(
      page([
        firing("late", { priority: 3 }),
        firing("ok", { last_outcome: "normal" }),
        firing("early", { priority: 1 }),
        firing("acked", {
          ack: { acked_by: "p", acked_at: 1, ack_source: "ui", groups_acked: 1 },
        }),
      ]),
    );
    const state = ref<FiringState>("firing");
    const api = mountComposable(state);
    await flushPromises();
    expect(api.rows.value.map((r) => r.alert_id)).toEqual(["early", "late"]);
    expect(api.counts.value).toEqual({ firing: 2, acked: 1, muted: 0, failed: 0 });
    state.value = "acked";
    expect(api.rows.value.map((r) => r.alert_id)).toEqual(["acked"]);
  });

  it("gives no counts when the server could not read the run state", async () => {
    listByFolderId.mockResolvedValue(
      page([firing("a", { last_outcome: undefined })], {
        status_unavailable: true,
      }),
    );
    const api = mountComposable();
    await flushPromises();
    expect(api.statusUnavailable.value).toBe(true);
    expect(api.counts.value).toBeNull();
  });

  it("does not poll: only a manual refresh reads again", async () => {
    const { refetchInterval } = firingAlertsQuery("acme") as { refetchInterval?: unknown };
    expect(refetchInterval).toBeUndefined();
    listByFolderId.mockResolvedValue(page([]));
    const api = mountComposable();
    await flushPromises();
    await api.refresh();
    expect(listByFolderId).toHaveBeenCalledTimes(2);
  });

  it("finds the selected row in any view, or none", async () => {
    listByFolderId.mockResolvedValue(page([firing("a"), firing("ok", { last_outcome: "normal" })]));
    const selected = ref<string | null>("ok");
    const api = mountComposable(ref("firing"), selected);
    await flushPromises();
    expect(api.selectedRow.value?.alert_id).toBe("ok");
  });

  it("keeps the last known row once the list drops it", async () => {
    listByFolderId.mockResolvedValue(page([firing("a")]));
    const api = mountComposable(ref("firing"), ref("a"));
    await flushPromises();
    listByFolderId.mockResolvedValue(page([]));
    await api.refresh();
    await flushPromises();
    expect(api.selectedRow.value?.alert_id).toBe("a");
  });

  it("keeps the last rows and reports a failed refresh", async () => {
    listByFolderId.mockResolvedValueOnce(page([firing("1")]));
    const api = mountComposable();
    await flushPromises();
    listByFolderId.mockRejectedValue({ response: { status: 500 }, message: "timeout" });
    await api.refresh();
    await flushPromises();
    expect(api.refreshFailed.value).toBe(true);
    expect(api.rows.value.map((r) => r.alert_id)).toEqual(["1"]);
  });

  it("treats a 403 on first read as forbidden", async () => {
    listByFolderId.mockRejectedValue({ response: { status: 403 } });
    const api = mountComposable();
    await flushPromises();
    await vi.waitFor(() => expect(api.forbidden.value).toBe(true));
  });

  it("keeps the last data when a refresh is refused", async () => {
    listByFolderId.mockResolvedValue(page([firing("a")]));
    const api = mountComposable();
    await flushPromises();
    listByFolderId.mockRejectedValue({ response: { status: 403 } });
    await api.refresh();
    await flushPromises();
    expect(api.forbidden.value).toBe(false);
    expect(api.refreshFailed.value).toBe(true);
    expect(api.rows.value).toHaveLength(1);
  });
});
