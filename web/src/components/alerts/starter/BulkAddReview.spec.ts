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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

const createAlert = vi.hoisted(() => vi.fn());

vi.mock("@/composables/alerts/useAlertLibrary", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/composables/alerts/useAlertLibrary",
  );
  return {
    ...actual,
    useAlertLibrary: () => ({
      ...(actual.useAlertLibrary as () => Record<string, unknown>)(),
      loadAlertFile: (e: AlertLibraryEntry) =>
        Promise.resolve({
          name: e.name,
          stream_type: "metrics",
          stream_name: "kube_metrics",
          query_condition: { type: "promql", promql: "up", promql_condition: {} },
          trigger_condition: { period: 5, operator: ">=", threshold: 1, frequency: 5 },
        }),
    }),
  };
});
vi.mock("@/services/alerts", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/alerts");
  return { ...actual, default: { ...actual.default, create_by_alert_id: createAlert } };
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/alerts/useAlertTestRun", () => ({
  createAlertTestRun: () => ({
    state: ref("idle"),
    result: ref(null),
    failure: ref(null),
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("@/utils/commons", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@/utils/commons")),
  getFoldersListByType: () => Promise.resolve([]),
}));

import BulkAddReview from "./BulkAddReview.vue";

const entry = (name: string) =>
  ({
    id: `k8s/${name}`,
    name,
    pack: "k8s",
    title: name,
    stream: "kube_metrics",
    stream_type: "metrics",
    query_type: "promql",
  }) as AlertLibraryEntry;

describe("BulkAddReview", () => {
  it("keeps a partial failure open with its reason and Retry, then hands every created alert on", async () => {
    createAlert
      .mockRejectedValueOnce({ response: { data: { message: "name taken" } } })
      .mockResolvedValue({ data: {} });
    const w = mount(BulkAddReview, {
      props: { entries: [entry("a"), entry("b")], scope: { kind: "all" } },
      global: {
        plugins: [i18n, store],
        stubs: { SelectFolderDropDown: true, StarterScopeSelect: true, WhoToTell: true },
      },
    });
    await flushPromises();
    await w.find('[data-test="alerts-bulk-add-review-add"]').trigger("click");
    await flushPromises();

    const status = (id: string) =>
      w.find(`[data-test="alerts-bulk-add-review-row-k8s/${id}"]`).attributes("data-status");
    expect({
      done: w.emitted("done"),
      a: status("a"),
      b: status("b"),
      reason: w.find('[data-test="alerts-bulk-add-review-outcome-k8s/a"]').text(),
      retry: w.find('[data-test="alerts-bulk-add-review-retry"]').exists(),
    }).toEqual({ done: undefined, a: "failed", b: "installed", reason: "name taken", retry: true });

    await w.find('[data-test="alerts-bulk-add-review-retry"]').trigger("click");
    await flushPromises();
    expect([createAlert.mock.calls.length, w.emitted("done")]).toEqual([
      3,
      [[{ folderId: "default", names: ["a", "b"] }]],
    ]);
  });
});
