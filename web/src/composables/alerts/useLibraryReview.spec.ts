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
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

const mocks = vi.hoisted(() => ({
  loadAlertFile: vi.fn(),
  queryRange: vi.fn(),
  listDestinations: vi.fn(),
  getSetting: vi.fn(),
  createAlert: vi.fn(),
  getFoldersListByType: vi.fn(),
  createFolderByType: vi.fn(),
  labels: vi.fn(),
  labelValues: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("vue-router");
  return { ...actual, useRouter: () => ({ push: vi.fn() }) };
});

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

vi.mock("@/services/search", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/search");
  return { ...actual, default: { ...actual.default, metrics_query_range: mocks.queryRange } };
});

vi.mock("@/services/alert_destination", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>(
    "@/services/alert_destination",
  );
  return { ...actual, default: { ...actual.default, list: mocks.listDestinations } };
});

vi.mock("@/services/settings", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/settings");
  return { ...actual, default: { ...actual.default, getSetting: mocks.getSetting } };
});

vi.mock("@/services/alerts", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/alerts");
  return { ...actual, default: { ...actual.default, create_by_alert_id: mocks.createAlert } };
});

vi.mock("@/services/metrics", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/metrics");
  return {
    ...actual,
    default: { ...actual.default, labels: mocks.labels, labelValues: mocks.labelValues },
  };
});

vi.mock("@/utils/commons", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/utils/commons");
  return {
    ...actual,
    getFoldersListByType: mocks.getFoldersListByType,
    createFolderByType: mocks.createFolderByType,
  };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mocks.toast }));

import { clearLabelChecks } from "./useLibraryLabelCheck";
import { useLibraryReview } from "./useLibraryReview";

const entry = (name: string, severity: "critical" | "warning" = "critical"): AlertLibraryEntry => ({
  id: `hadoop/${name}`,
  name,
  pack: "hadoop",
  category: "namenode",
  title: `Rule ${name}`,
  severity,
  description: "",
  stream: "up",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["up"],
  path: `packs/hadoop/${name}.json`,
  content_hash: "h1",
});

const promqlFile = (promql = "up == 0"): AlertLibraryFile => ({
  name: "rule",
  enabled: true,
  query_condition: { type: "promql", promql },
  trigger_condition: { period: 5, frequency: 5, silence: 0, threshold: 1, operator: ">=" },
});

const noisyRange = () => ({
  data: {
    status: "success",
    data: {
      resultType: "matrix",
      result: [{ metric: {}, values: Array.from({ length: 12 }, (_, i) => [i * 3600, "1"]) }],
    },
  },
});

const quietRange = () => ({ data: { status: "success", data: { result: [] } } });

const mountHost = (onAdded = vi.fn()) => {
  let api!: ReturnType<typeof useLibraryReview>;
  const Host = defineComponent({
    setup() {
      api = useLibraryReview({ onAdded });
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [i18n, store] } });
  return api;
};

const deferred = () => {
  let resolve!: (value: AlertLibraryFile) => void;
  const promise = new Promise<AlertLibraryFile>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  queryClient.clear();
  clearLabelChecks();
  mocks.loadAlertFile.mockImplementation(async () => promqlFile());
  mocks.queryRange.mockImplementation(async () => quietRange());
  mocks.listDestinations.mockResolvedValue({
    data: [
      { name: "slack", type: "http" },
      { name: "my-email", type: "email", emails: ["example@gmail.com"] },
    ],
  });
  mocks.getSetting.mockResolvedValue({ data: { setting_value: { destination: "slack" } } });
  mocks.createAlert.mockResolvedValue({ data: { id: "alert-1" } });
  mocks.getFoldersListByType.mockResolvedValue([{ name: "Hadoop", folderId: "f-hadoop" }]);
  mocks.createFolderByType.mockResolvedValue({ data: { folderId: "f-new" } });
  mocks.labels.mockResolvedValue({ data: { status: "success", data: ["job"] } });
  mocks.labelValues.mockResolvedValue({ data: { status: "success", data: ["otel"] } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLibraryReview", () => {
  it("fetches no library file until a pack is reviewed", async () => {
    mountHost();
    await flushPromises();
    expect(mocks.loadAlertFile).not.toHaveBeenCalled();
  });

  it("fetches the pack's files with at most four in flight", async () => {
    const pending: Array<ReturnType<typeof deferred>> = [];
    let inFlight = 0;
    let peak = 0;
    mocks.loadAlertFile.mockImplementation(() => {
      const next = deferred();
      pending.push(next);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return next.promise.finally(() => {
        inFlight -= 1;
      });
    });
    const api = mountHost();
    const loading = api.load(Array.from({ length: 9 }, (_, i) => entry(`r${i}`)));
    for (let round = 0; round < 20 && pending.length < 9; round += 1) {
      await flushPromises();
      pending.forEach((item) => item.resolve(promqlFile()));
    }
    await flushPromises();
    pending.forEach((item) => item.resolve(promqlFile()));
    await loading;
    expect(mocks.loadAlertFile).toHaveBeenCalledTimes(9);
    expect(peak).toBe(4);
  });

  it("gives each rule its threshold, label check and yesterday's estimate", async () => {
    mocks.loadAlertFile.mockImplementation(async (item: AlertLibraryEntry) =>
      item.name === "nn" ? promqlFile('up{job="hadoop-namenode"} == 0') : promqlFile(),
    );
    mocks.queryRange.mockImplementation(async () => noisyRange());
    const api = mountHost();
    await api.load([entry("nn"), entry("plain")]);
    const [nn, plain] = api.rows.value;
    expect(nn.state).toBe("needsData");
    expect(nn.needsData).toBe("job hadoop-namenode");
    expect(plain.state).toBe("ready");
    expect(plain.fires).toBe(12);
    expect(plain.threshold).toBe(">= 1");
  });

  it("states what each rule needs: its streams and the label values it selects", async () => {
    mocks.loadAlertFile.mockImplementation(async () =>
      promqlFile('up{job="hadoop-namenode", env="prod"} == 0'),
    );
    const api = mountHost();
    await api.load([entry("nn")]);
    expect(api.rows.value[0].requires).toBe('up · job="hadoop-namenode" · env="prod"');
  });

  it("pre-selects only the rules whose data arrives", async () => {
    mocks.loadAlertFile.mockImplementation(async (item: AlertLibraryEntry) =>
      item.name === "nn" ? promqlFile('up{job="hadoop-namenode"} == 0') : promqlFile(),
    );
    const api = mountHost();
    await api.load([entry("nn"), entry("plain")]);
    expect(api.selectedIds.value).toEqual(["hadoop/plain"]);
  });

  it("marks a rule whose label check failed as unchecked, never as ready, and keeps it ticked", async () => {
    mocks.loadAlertFile.mockImplementation(async () =>
      promqlFile('up{job="hadoop-namenode"} == 0'),
    );
    mocks.labels.mockRejectedValue(new Error("down"));
    const api = mountHost();
    await api.load([entry("nn")]);
    expect(api.rows.value[0].state).toBe("unknown");
    expect(api.selectedIds.value).toEqual(["hadoop/nn"]);
  });

  it("installs one rule at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    mocks.createAlert.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { data: { id: "a" } };
    });
    const api = mountHost();
    await api.load([entry("a"), entry("b"), entry("c")]);
    await api.enable();
    expect(mocks.createAlert).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it("installs a rule paused when it would have fired more than ten times yesterday", async () => {
    mocks.queryRange.mockImplementation(async () => noisyRange());
    const api = mountHost();
    await api.load([entry("a")]);
    await api.enable();
    expect(mocks.createAlert.mock.calls[0][1].enabled).toBe(false);
    expect(api.rows.value[0].result).toBe("paused");
  });

  it("installs a quiet rule enabled", async () => {
    const api = mountHost();
    await api.load([entry("a")]);
    await api.enable();
    expect(mocks.createAlert.mock.calls[0][1].enabled).toBe(true);
    expect(api.rows.value[0].result).toBe("added");
  });

  it("routes criticals to the org default and warnings to the user's email destination", async () => {
    const api = mountHost();
    await api.load([entry("crit", "critical"), entry("warn", "warning")]);
    await api.enable();
    const byName = Object.fromEntries(
      mocks.createAlert.mock.calls.map(([, payload]) => [
        payload.context_attributes.library_id,
        payload,
      ]),
    );
    expect(byName["hadoop/crit"].destinations).toEqual(["slack"]);
    expect(byName["hadoop/warn"].destinations).toEqual(["my-email"]);
  });

  it("sends a warning nowhere when the user has no email destination", async () => {
    mocks.listDestinations.mockResolvedValue({ data: [{ name: "slack", type: "http" }] });
    const api = mountHost();
    await api.load([entry("warn", "warning")]);
    await api.enable();
    expect(mocks.createAlert.mock.calls[0][1].destinations).toEqual([]);
  });

  it("skips a rule left unticked and marks what it added", async () => {
    const onAdded = vi.fn();
    const api = mountHost(onAdded);
    await api.load([entry("a"), entry("b")]);
    api.selectedIds.value = ["hadoop/b"];
    await api.enable();
    expect(mocks.createAlert).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledWith("hadoop/b");
    expect(api.selectedIds.value).toEqual([]);
  });

  it("keeps going after a failed install and leaves that rule ticked for another try", async () => {
    mocks.createAlert
      .mockRejectedValueOnce({ response: { data: { message: "nope" } } })
      .mockResolvedValue({ data: { id: "b" } });
    const api = mountHost();
    await api.load([entry("a"), entry("b")]);
    await api.enable();
    expect(api.rows.value[0].result).toBe("failed");
    expect(api.rows.value[0].error).toBe("nope");
    expect(api.rows.value[1].result).toBe("added");
    expect(api.selectedIds.value).toEqual(["hadoop/a"]);
  });
});
