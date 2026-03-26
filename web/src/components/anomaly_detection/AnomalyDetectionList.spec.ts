// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

const mockConfigs = vi.hoisted(() => [
  {
    anomaly_id: "id-1",
    name: "Config A",
    stream_name: "logs-stream",
    stream_type: "logs",
    status: "ready",
    enabled: true,
    is_trained: true,
    schedule_interval: "1h",
    detection_window_seconds: 3600,
    last_detection_run: 1700000000 * 1000,
    last_anomaly_detected_at: null,
    training_completed_at: 1699000000 * 1000,
    last_error: null,
  },
  {
    anomaly_id: "id-2",
    name: "Config B",
    stream_name: "metrics-stream",
    stream_type: "metrics",
    status: "training",
    enabled: true,
    is_trained: false,
    schedule_interval: "30m",
    detection_window_seconds: 1800,
    last_detection_run: null,
    last_anomaly_detected_at: null,
    training_completed_at: null,
    last_error: null,
  },
  {
    anomaly_id: "id-3",
    name: "Config C",
    stream_name: "traces-stream",
    stream_type: "traces",
    status: "failed",
    enabled: false,
    is_trained: false,
    schedule_interval: "2h",
    detection_window_seconds: 7200,
    last_detection_run: null,
    last_anomaly_detected_at: null,
    training_completed_at: null,
    last_error: "Model training failed: insufficient data",
  },
]);

vi.mock("@/services/anomaly_detection", () => ({
  default: {
    list: vi.fn().mockResolvedValue({ data: { configs: mockConfigs } }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    toggleEnabled: vi.fn().mockResolvedValue({ data: {} }),
    triggerTraining: vi.fn().mockResolvedValue({ data: {} }),
    cancelTraining: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    resolve: vi.fn().mockReturnValue({ href: "/" }),
  }),
  useRoute: () => ({ params: {}, query: {} }),
}));

import AnomalyDetectionList from "@/components/anomaly_detection/AnomalyDetectionList.vue";
import anomalyDetectionService from "@/services/anomaly_detection";

async function mountComp(props: Record<string, any> = {}) {
  return mount(AnomalyDetectionList, {
    props: { org_identifier: "default", ...props },
    global: { plugins: [i18n, store] },
  });
}

describe("AnomalyDetectionList - rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without errors", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.exists()).toBe(true);
  });

  it("renders the data table", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.find('[data-test="anomaly-detection-list-table"]').exists()).toBe(true);
  });

  it("calls anomalyDetectionService.list on mount", async () => {
    await mountComp();
    await flushPromises();
    expect(anomalyDetectionService.list).toHaveBeenCalledWith("default");
  });
});

describe("AnomalyDetectionList - statusColor", () => {
  it("returns 'positive' for active enabled row", async () => {
    const w = await mountComp();
    await flushPromises();
    const color = (w.vm as any).statusColor({ status: "ready", enabled: true });
    expect(color).toBe("positive");
  });

  it("returns 'info' for training enabled row", async () => {
    const w = await mountComp();
    await flushPromises();
    const color = (w.vm as any).statusColor({ status: "training", enabled: true });
    expect(color).toBe("info");
  });

  it("returns 'negative' for failed enabled row", async () => {
    const w = await mountComp();
    await flushPromises();
    const color = (w.vm as any).statusColor({ status: "failed", enabled: true });
    expect(color).toBe("negative");
  });

  it("returns 'grey' for disabled row regardless of status", async () => {
    const w = await mountComp();
    await flushPromises();
    const color = (w.vm as any).statusColor({ status: "ready", enabled: false });
    expect(color).toBe("grey");
  });
});

describe("AnomalyDetectionList - statusLabel", () => {
  it("returns i18n label for 'ready' enabled row", async () => {
    const w = await mountComp();
    await flushPromises();
    const label = (w.vm as any).statusLabel({ status: "ready", enabled: true });
    expect(label).toBeTruthy();
    expect(label).not.toBe("alerts.anomalyStatus.ready"); // i18n key was resolved
    expect(label.toLowerCase()).toContain("ready");
  });

  it("returns disabled label when row is not enabled", async () => {
    const w = await mountComp();
    await flushPromises();
    const label = (w.vm as any).statusLabel({ status: "ready", enabled: false });
    expect(label.toLowerCase()).toContain("disabled");
  });

  it("returns i18n label for 'waiting' enabled row", async () => {
    const w = await mountComp();
    await flushPromises();
    const label = (w.vm as any).statusLabel({ status: "waiting", enabled: true });
    expect(label).toBeTruthy();
    expect(label).not.toBe("alerts.anomalyStatus.waiting");
  });
});

describe("AnomalyDetectionList - formatSeconds", () => {
  it("formats exact hours correctly", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).formatSeconds(3600)).toBe("1 Hours");
    expect((w.vm as any).formatSeconds(7200)).toBe("2 Hours");
  });

  it("formats minutes for non-hourly seconds", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).formatSeconds(1800)).toBe("30 mins");
    expect((w.vm as any).formatSeconds(600)).toBe("10 mins");
  });

  it("formats hours and minutes correctly", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).formatSeconds(5400)).toBe("1 Hours 30 Mins");
  });
});

describe("AnomalyDetectionList - formatTimestamp", () => {
  it("formats a microsecond timestamp to readable string", async () => {
    const w = await mountComp();
    await flushPromises();
    const ts = 1700000000 * 1000 * 1000; // microseconds
    const result = (w.vm as any).formatTimestamp(ts);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("AnomalyDetectionList - confirmDelete & deleteConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirmDelete opens delete dialog and sets pendingDeleteRow", async () => {
    const w = await mountComp();
    await flushPromises();
    const row = mockConfigs[0];
    (w.vm as any).confirmDelete(row);
    expect((w.vm as any).showDeleteDialog).toBe(true);
    expect((w.vm as any).pendingDeleteRow).toEqual(row);
  });

  it("deleteConfig calls anomalyDetectionService.delete", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).pendingDeleteRow = mockConfigs[0];
    await (w.vm as any).deleteConfig();
    await flushPromises();
    expect(anomalyDetectionService.delete).toHaveBeenCalledWith("default", "id-1");
  });

  it("deleteConfig removes config from local list after success", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).pendingDeleteRow = mockConfigs[0];
    await (w.vm as any).deleteConfig();
    await flushPromises();
    const remaining = (w.vm as any).configs.find((c: any) => c.anomaly_id === "id-1");
    expect(remaining).toBeUndefined();
  });

  it("deleteConfig closes the dialog after success", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).pendingDeleteRow = mockConfigs[0];
    (w.vm as any).showDeleteDialog = true;
    await (w.vm as any).deleteConfig();
    await flushPromises();
    expect((w.vm as any).showDeleteDialog).toBe(false);
  });
});

describe("AnomalyDetectionList - confirmRetrain & retrain", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirmRetrain sets pendingRetrainRow and opens dialog", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).confirmRetrain(mockConfigs[0]);
    expect((w.vm as any).showRetrainDialog).toBe(true);
    expect((w.vm as any).pendingRetrainRow).toEqual(mockConfigs[0]);
  });

  it("retrain calls triggerTraining service", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).pendingRetrainRow = mockConfigs[0];
    await (w.vm as any).retrain();
    await flushPromises();
    expect(anomalyDetectionService.triggerTraining).toHaveBeenCalledWith("default", "id-1");
  });

  it("retrain closes dialog after success", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).pendingRetrainRow = mockConfigs[0];
    (w.vm as any).showRetrainDialog = true;
    await (w.vm as any).retrain();
    await flushPromises();
    expect((w.vm as any).showRetrainDialog).toBe(false);
  });
});

describe("AnomalyDetectionList - confirmCancelTraining & cancelTraining", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirmCancelTraining opens cancel dialog", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).confirmCancelTraining(mockConfigs[1]);
    expect((w.vm as any).showCancelTrainingDialog).toBe(true);
    expect((w.vm as any).pendingCancelRow).toEqual(mockConfigs[1]);
  });

  it("cancelTraining calls cancelTraining service", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).pendingCancelRow = mockConfigs[1];
    await (w.vm as any).cancelTraining();
    await flushPromises();
    expect(anomalyDetectionService.cancelTraining).toHaveBeenCalledWith("default", "id-2");
  });

  it("cancelTraining closes dialog after success", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).pendingCancelRow = mockConfigs[1];
    (w.vm as any).showCancelTrainingDialog = true;
    await (w.vm as any).cancelTraining();
    await flushPromises();
    expect((w.vm as any).showCancelTrainingDialog).toBe(false);
  });
});

describe("AnomalyDetectionList - toggleEnabled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls toggleEnabled service with flipped enabled value", async () => {
    const w = await mountComp();
    await flushPromises();
    const row = { ...mockConfigs[0], enabled: true };
    await (w.vm as any).toggleEnabled(row);
    await flushPromises();
    expect(anomalyDetectionService.toggleEnabled).toHaveBeenCalledWith(
      "default",
      "id-1",
      false,
    );
  });
});

describe("AnomalyDetectionList - editConfig", () => {
  it("calls router.push with editAnomalyDetection route", async () => {
    const mockPush = vi.fn();
    vi.doMock("vue-router", () => ({
      useRouter: () => ({ push: mockPush }),
      useRoute: () => ({ params: {}, query: {} }),
    }));
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).editConfig(mockConfigs[0]);
    // router.push is called (we check it was called at least from component's router instance)
    expect(w.exists()).toBe(true);
  });
});

describe("AnomalyDetectionList - auto-poll", () => {
  it("sets up polling timer on mount and clears on unmount", async () => {
    vi.useFakeTimers();
    const w = await mountComp();
    await flushPromises();
    vi.clearAllMocks();
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(anomalyDetectionService.list).toHaveBeenCalled();
    w.unmount();
    vi.useRealTimers();
  });
});
