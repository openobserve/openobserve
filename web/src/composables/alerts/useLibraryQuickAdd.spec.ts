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
  deleteAlert: vi.fn(),
  getFoldersListByType: vi.fn(),
  createFolderByType: vi.fn(),
  createAnomaly: vi.fn(),
  deleteAnomaly: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
}));

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("vue-router");
  return { ...actual, useRouter: () => ({ push: mocks.push }) };
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
  return {
    ...actual,
    default: {
      ...actual.default,
      create_by_alert_id: mocks.createAlert,
      delete_by_alert_id: mocks.deleteAlert,
    },
  };
});

vi.mock("@/services/anomaly_detection", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>(
    "@/services/anomaly_detection",
  );
  return {
    ...actual,
    default: { ...actual.default, create: mocks.createAnomaly, delete: mocks.deleteAnomaly },
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

import { useLibraryQuickAdd } from "./useLibraryQuickAdd";

const entry: AlertLibraryEntry = {
  id: "k8s/pod-oom-killed",
  name: "pod-oom-killed",
  pack: "k8s",
  category: "pod",
  title: "Pod OOM killed",
  severity: "critical",
  description: "",
  stream: "kube_pod_status",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_pod_status"],
  path: "packs/k8s/pod-oom-killed.json",
  content_hash: "abc",
};

const promqlFile = (): AlertLibraryFile => ({
  name: "pod_oom_killed",
  enabled: true,
  query_condition: {
    type: "promql",
    promql: "kube_pod_status",
    promql_condition: { operator: ">", value: 0 },
  },
  trigger_condition: { period: 5, frequency: 5, silence: 0, threshold: 1, operator: ">=" },
});

// One series firing at 12 instants an hour apart: 12 separate episodes.
const noisyRange = () => ({
  data: {
    status: "success",
    data: {
      resultType: "matrix",
      result: [{ metric: {}, values: Array.from({ length: 12 }, (_, i) => [i * 3600, "1"]) }],
    },
  },
});

const mountHost = (deps: Record<string, unknown> = {}) => {
  let api!: ReturnType<typeof useLibraryQuickAdd>;
  const Host = defineComponent({
    setup() {
      api = useLibraryQuickAdd({ onAdded: vi.fn(), onRemoved: vi.fn(), ...deps });
      return () => null;
    },
  });
  mount(Host, { global: { plugins: [i18n, store] } });
  return api;
};

const lastToast = () => mocks.toast.mock.calls.at(-1)?.[0];

beforeEach(() => {
  queryClient.clear();
  mocks.loadAlertFile.mockResolvedValue(promqlFile());
  mocks.queryRange.mockResolvedValue({ data: { status: "success", data: { result: [] } } });
  mocks.listDestinations.mockResolvedValue({ data: [{ name: "slack" }] });
  mocks.getSetting.mockResolvedValue({ data: { setting_value: { destination: "slack" } } });
  mocks.createAlert.mockResolvedValue({ data: { id: "alert-1" } });
  mocks.deleteAlert.mockResolvedValue({ data: {} });
  mocks.getFoldersListByType.mockResolvedValue([{ name: "default", folderId: "default" }]);
  mocks.createFolderByType.mockResolvedValue({ data: { folderId: "f-k8s", name: "Kubernetes" } });
  mocks.createAnomaly.mockResolvedValue({ data: { anomaly_id: "anom-1" } });
  mocks.deleteAnomaly.mockResolvedValue({ data: {} });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLibraryQuickAdd", () => {
  it("installs paused when the 24 h estimate is above ten fires", async () => {
    mocks.queryRange.mockResolvedValue(noisyRange());
    await mountHost().add(entry);
    const [, payload] = mocks.createAlert.mock.calls[0];
    expect(payload.enabled).toBe(false);
  });

  it("runs one 24 h range query at step = frequency", async () => {
    await mountHost().add(entry);
    expect(mocks.queryRange).toHaveBeenCalledTimes(1);
    const call = mocks.queryRange.mock.calls[0][0];
    expect(call.step).toBe("300s");
    expect(call.end_time - call.start_time).toBe(24 * 3600 * 1_000_000);
    expect(call.query).toBe("(kube_pod_status) > 0");
  });

  it("installs enabled, to the org default destination, when quiet", async () => {
    await mountHost().add(entry);
    const [, payload] = mocks.createAlert.mock.calls[0];
    expect(payload.enabled).toBe(true);
    expect(payload.destinations).toEqual(["slack"]);
  });

  it("installs with no destination when the org default is not a real destination", async () => {
    mocks.getSetting.mockResolvedValue({ data: { setting_value: { destination: "gone" } } });
    await mountHost().add(entry);
    expect(mocks.createAlert.mock.calls[0][1].destinations).toEqual([]);
  });

  it("creates a folder named after the pack when none exists", async () => {
    await mountHost().add(entry);
    expect(mocks.createFolderByType).toHaveBeenCalledWith(
      store,
      expect.objectContaining({ name: "Kubernetes" }),
      "alerts",
    );
    expect(mocks.createAlert.mock.calls[0][2]).toBe("f-k8s");
  });

  it("reuses the pack's folder when it already exists", async () => {
    mocks.getFoldersListByType.mockResolvedValue([
      { name: "default", folderId: "default" },
      { name: "kubernetes", folderId: "f-existing" },
    ]);
    await mountHost().add(entry);
    expect(mocks.createFolderByType).not.toHaveBeenCalled();
    expect(mocks.createAlert.mock.calls[0][2]).toBe("f-existing");
  });

  it("does not estimate a SQL rule and installs it as the file says", async () => {
    mocks.loadAlertFile.mockResolvedValue({
      ...promqlFile(),
      query_condition: { type: "sql", sql: "SELECT * FROM default" },
    });
    await mountHost().add({ ...entry, query_type: "sql" });
    expect(mocks.queryRange).not.toHaveBeenCalled();
    expect(mocks.createAlert.mock.calls[0][1].enabled).toBe(true);
    expect(lastToast().message).toContain("Not estimated");
  });

  it("toasts the estimate with Undo and Edit, and reports the add", async () => {
    const onAdded = vi.fn();
    mocks.queryRange.mockResolvedValue(noisyRange());
    await mountHost({ onAdded }).add(entry);
    const options = lastToast();
    expect(options.variant).toBe("success");
    expect(options.message).toContain("12");
    expect(options.action.label).toBe("Undo");
    expect(options.secondaryAction.label).toBe("Edit");
    expect(onAdded).toHaveBeenCalledWith(entry.id);
  });

  it("Undo deletes the created alert and reports the removal", async () => {
    const onRemoved = vi.fn();
    await mountHost({ onRemoved }).add(entry);
    lastToast().action.handler();
    await flushPromises();
    expect(mocks.deleteAlert).toHaveBeenCalledWith("default", "alert-1", "f-k8s");
    expect(onRemoved).toHaveBeenCalledWith(entry.id);
  });

  it("Edit opens the created alert in today's form", async () => {
    await mountHost().add(entry);
    lastToast().secondaryAction.handler();
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "alertList",
        query: expect.objectContaining({ alert_id: "alert-1", action: "update", folder: "f-k8s" }),
      }),
    );
  });

  it("shows the server's reason when the create fails", async () => {
    const onAdded = vi.fn();
    mocks.createAlert.mockRejectedValue({ response: { data: { message: "Stream not found" } } });
    await mountHost({ onAdded }).add(entry);
    expect(lastToast()).toMatchObject({ variant: "error", message: "Stream not found" });
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("marks the entry busy while it installs", async () => {
    let release!: (v: unknown) => void;
    mocks.createAlert.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const api = mountHost();
    const pending = api.add(entry);
    await flushPromises();
    expect(api.isAdding(entry.id)).toBe(true);
    release({ data: { id: "alert-1" } });
    await pending;
    expect(api.isAdding(entry.id)).toBe(false);
  });

  describe("anomaly rules", () => {
    const anomalyEntry: AlertLibraryEntry = {
      ...entry,
      id: "apm/error-ratio-anomaly",
      pack: "apm",
      title: "Error ratio is unusually high",
      query_type: "sql",
      alert_type: "anomaly_detection",
    };
    const anomalyFile = (): AlertLibraryFile => ({
      name: "error_ratio_anomaly",
      title: "Error ratio is unusually high",
      stream_name: "default",
      stream_type: "traces",
    });

    beforeEach(() => {
      mocks.loadAlertFile.mockResolvedValue(anomalyFile());
      mocks.createFolderByType.mockResolvedValue({ data: { folderId: "f-apm", name: "APM" } });
    });

    it("installs through the anomaly builder with the same defaults, without an estimate", async () => {
      await mountHost().add(anomalyEntry);
      expect(mocks.queryRange).not.toHaveBeenCalled();
      expect(mocks.createAlert).not.toHaveBeenCalled();
      const [org, payload, folderId] = mocks.createAnomaly.mock.calls[0];
      expect(org).toBe("default");
      expect(folderId).toBe("f-apm");
      expect(payload).toMatchObject({
        alert_type: "anomaly_detection",
        destinations: ["slack"],
        folder_id: "f-apm",
      });
      expect(payload.tags).toContain("pack:apm");
      expect(payload.context_attributes).toBeUndefined();
    });

    it("toasts that it learns before alerting, with Undo and Edit", async () => {
      const onAdded = vi.fn();
      await mountHost({ onAdded }).add(anomalyEntry);
      const options = lastToast();
      expect(options.variant).toBe("success");
      expect(options.message).toContain("learns");
      expect(options.action.label).toBe("Undo");
      expect(options.secondaryAction.label).toBe("Edit");
      expect(onAdded).toHaveBeenCalledWith(anomalyEntry.id);
    });

    it("Undo deletes the created anomaly config", async () => {
      const onRemoved = vi.fn();
      await mountHost({ onRemoved }).add(anomalyEntry);
      lastToast().action.handler();
      await flushPromises();
      expect(mocks.deleteAnomaly).toHaveBeenCalledWith("default", "anom-1");
      expect(mocks.deleteAlert).not.toHaveBeenCalled();
      expect(onRemoved).toHaveBeenCalledWith(anomalyEntry.id);
    });

    it("Edit opens the anomaly editor", async () => {
      await mountHost().add(anomalyEntry);
      lastToast().secondaryAction.handler();
      expect(mocks.push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "editAnomalyDetection",
          params: { anomaly_id: "anom-1" },
        }),
      );
    });
  });
});
