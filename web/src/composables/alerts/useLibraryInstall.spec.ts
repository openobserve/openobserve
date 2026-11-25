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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

const mocks = vi.hoisted(() => ({
  loadAlertFile: vi.fn(),
  createAlert: vi.fn(),
}));

vi.mock("@/composables/alerts/useAlertLibrary", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/composables/alerts/useAlertLibrary",
  );
  return {
    ...actual,
    useAlertLibrary: () => ({
      ...(actual.useAlertLibrary as () => Record<string, unknown>)(),
      loadAlertFile: mocks.loadAlertFile,
    }),
  };
});

vi.mock("@/services/alerts", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/alerts");
  return { ...actual, default: { ...actual.default, create_by_alert_id: mocks.createAlert } };
});

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

import { useLibraryInstall, type InstallBatch } from "./useLibraryInstall";

const entry = (name: string): AlertLibraryEntry => ({
  id: `k8s/${name}`,
  name,
  pack: "k8s",
  category: "pod",
  title: name,
  severity: "warning",
  description: "",
  stream: "kube_metrics",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_metrics"],
  path: `packs/k8s/${name}.json`,
  content_hash: "hash",
});

const file = (name: string): AlertLibraryFile => ({
  name,
  stream_type: "metrics",
  stream_name: "kube_metrics",
  destinations: ["author_channel"],
  query_condition: { type: "promql", promql: "up", promql_condition: { operator: ">", value: 0 } },
  trigger_condition: { period: 5, operator: ">=", threshold: 1, frequency: 5, silence: 30 },
});

const roster = [entry("a"), entry("b")];

const mountInstall = () => {
  let api!: ReturnType<typeof useLibraryInstall>;
  mount(
    defineComponent({
      setup() {
        api = useLibraryInstall();
        return () => null;
      },
    }),
    { global: { plugins: [i18n, store] } },
  );
  return api;
};

const posted = () => mocks.createAlert.mock.calls.map((call) => call[1] as Record<string, any>);

describe("useLibraryInstall", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.loadAlertFile.mockImplementation((e: AlertLibraryEntry) => Promise.resolve(file(e.name)));
    mocks.createAlert.mockResolvedValue({ data: {} });
  });

  it.each<{ name: string; batch: InstallBatch; check: (p: Record<string, any>) => void }>([
    {
      name: "gives every alert the batch's shared destinations",
      batch: { folderId: "default", destinations: ["oncall", "sre-mail"] },
      check: (p) => expect(p.destinations).toEqual(["oncall", "sre-mail"]),
    },
    {
      name: "keeps the author's destinations out when the batch names none",
      batch: { folderId: "default" },
      check: (p) => expect(p.destinations).toEqual([]),
    },
    {
      name: "puts every alert in the batch's folder at its check interval",
      batch: { folderId: "ops", overrides: { frequency: 15 } },
      check: (p) => {
        expect(p.folder_id).toBe("ops");
        expect(p.trigger_condition.frequency).toBe(15);
      },
    },
    {
      name: "narrows every alert's query to the batch's service",
      batch: {
        folderId: "default",
        scope: { kind: "service", service: "checkout", dimensions: { svc: "checkout" } },
      },
      check: (p) => expect(p.query_condition.promql).toContain('svc="checkout"'),
    },
  ])("$name", async ({ batch, check }) => {
    const api = mountInstall();
    await api.install(roster, ["k8s/a", "k8s/b"], batch);

    expect(posted()).toHaveLength(2);
    posted().forEach(check);
  });

  it("retries only the failed alerts, with the same batch settings, and names what it created", async () => {
    mocks.createAlert
      .mockRejectedValueOnce({ response: { data: { message: "boom" } } })
      .mockResolvedValueOnce({ data: {} });
    const api = mountInstall();
    const batch: InstallBatch = { folderId: "ops", destinations: ["oncall"] };
    await api.install(roster, ["k8s/a", "k8s/b"], batch);
    expect(api.failedIds.value).toEqual(["k8s/a"]);

    mocks.createAlert.mockClear();
    const run = await api.install(roster, api.failedIds.value, batch);
    await flushPromises();

    expect(posted().map((p) => p.name)).toEqual(["a"]);
    expect(posted()[0].destinations).toEqual(["oncall"]);
    expect(run?.installedIds).toEqual(["k8s/a"]);
    // Each result names the alert it created, so the list can mark both passes' alerts.
    expect(api.results.value.map((r) => [r.status, r.name])).toEqual([
      ["installed", "a"],
      ["installed", "b"],
    ]);
  });
});
