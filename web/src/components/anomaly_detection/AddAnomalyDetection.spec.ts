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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

const mockPush = vi.fn();
let mockAnomalyId: string | undefined = undefined;

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockPush,
    resolve: vi.fn().mockReturnValue({ href: "/" }),
  }),
  useRoute: () => ({
    params: { anomaly_id: mockAnomalyId },
    query: {},
  }),
}));

vi.mock("@/services/anomaly_detection", () => ({
  default: {
    create: vi.fn().mockResolvedValue({ data: { anomaly_id: "new-id" } }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({
      data: {
        anomaly_id: "existing-id",
        name: "Existing Config",
        description: "desc",
        stream_name: "my-stream",
        stream_type: "logs",
        query_mode: "filters",
        filters: [],
        detection_function: "count",
        histogram_interval: "5m",
        schedule_interval: "1h",
        detection_window_seconds: 3600,
        training_window_days: 14,
        retrain_interval_days: 7,
        threshold: 97,
        alert_enabled: true,
        alert_destination_id: undefined,
        status: "active",
        is_trained: true,
        enabled: true,
        last_error: undefined,
        last_detection_run: undefined,
      },
    }),
    triggerTraining: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("@/services/stream", () => ({
  default: {
    nameList: vi.fn().mockResolvedValue({ data: { list: [] } }),
    schema: vi.fn().mockResolvedValue({ data: { schema: [] } }),
  },
}));

// Stub heavy child components
const childStub = {
  template: '<div class="stub"></div>',
  props: ["config", "isEdit", "destinations"],
  expose: ["validate"],
  setup() {
    return { validate: async () => true };
  },
};

import AddAnomalyDetection from "@/components/anomaly_detection/AddAnomalyDetection.vue";
import anomalyDetectionService from "@/services/anomaly_detection";

async function mountComp(props: Record<string, any> = {}) {
  return mount(AddAnomalyDetection, {
    props: { destinations: [], ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        AnomalySetup: childStub,
        AnomalyDetectionConfig: childStub,
        AnomalyAlerting: childStub,
      },
    },
  });
}

describe("AddAnomalyDetection - create mode rendering", () => {
  beforeEach(() => {
    mockAnomalyId = undefined;
    vi.clearAllMocks();
  });

  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("starts at step 1", async () => {
    const w = await mountComp();
    expect((w.vm as any).step).toBe(1);
  });

  it("isEdit is false when no anomaly_id in route", async () => {
    const w = await mountComp();
    expect((w.vm as any).isEdit).toBe(false);
  });

  it("does not call anomalyDetectionService.get in create mode", async () => {
    await mountComp();
    await flushPromises();
    expect(anomalyDetectionService.get).not.toHaveBeenCalled();
  });
});

describe("AddAnomalyDetection - edit mode", () => {
  beforeEach(() => {
    mockAnomalyId = "existing-id";
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockAnomalyId = undefined;
  });

  it("isEdit is true when anomaly_id is set in route", async () => {
    const w = await mountComp();
    expect((w.vm as any).isEdit).toBe(true);
  });

  it("calls anomalyDetectionService.get on mount", async () => {
    await mountComp();
    await flushPromises();
    expect(anomalyDetectionService.get).toHaveBeenCalledWith("default", "existing-id");
  });
});

describe("AddAnomalyDetection - statusColor computed", () => {
  beforeEach(() => {
    mockAnomalyId = undefined;
    vi.clearAllMocks();
  });

  it("returns 'positive' for active status", async () => {
    const w = await mountComp();
    (w.vm as any).config.status = "active";
    expect((w.vm as any).statusColor).toBe("positive");
  });

  it("returns 'info' for training status", async () => {
    const w = await mountComp();
    (w.vm as any).config.status = "training";
    expect((w.vm as any).statusColor).toBe("info");
  });

  it("returns 'negative' for failed status", async () => {
    const w = await mountComp();
    (w.vm as any).config.status = "failed";
    expect((w.vm as any).statusColor).toBe("negative");
  });

  it("returns 'grey' for unknown status", async () => {
    const w = await mountComp();
    (w.vm as any).config.status = "unknown";
    expect((w.vm as any).statusColor).toBe("grey");
  });
});

describe("AddAnomalyDetection - previewSql computed", () => {
  beforeEach(() => {
    mockAnomalyId = undefined;
    vi.clearAllMocks();
  });

  it("returns custom SQL when query_mode is custom_sql", async () => {
    const w = await mountComp();
    (w.vm as any).config.query_mode = "custom_sql";
    (w.vm as any).config.custom_sql = "SELECT * FROM stream";
    expect((w.vm as any).previewSql).toBe("SELECT * FROM stream");
  });

  it("returns placeholder when custom_sql is empty in custom_sql mode", async () => {
    const w = await mountComp();
    (w.vm as any).config.query_mode = "custom_sql";
    (w.vm as any).config.custom_sql = "";
    expect((w.vm as any).previewSql).toContain("Enter your SQL");
  });

  it("generates SQL query in filters mode", async () => {
    const w = await mountComp();
    (w.vm as any).config.query_mode = "filters";
    (w.vm as any).config.stream_name = "my-logs";
    (w.vm as any).config.detection_function = "count";
    expect((w.vm as any).previewSql).toContain("my-logs");
    expect((w.vm as any).previewSql).toContain("count(*)");
  });

  it("includes histogram interval in generated SQL", async () => {
    const w = await mountComp();
    (w.vm as any).config.query_mode = "filters";
    (w.vm as any).config.stream_name = "my-logs";
    (w.vm as any).config.histogram_interval_value = 10;
    (w.vm as any).config.histogram_interval_unit = "m";
    expect((w.vm as any).previewSql).toContain("10m");
  });

  it("uses week seasonality when training_window_days >= 7", async () => {
    const w = await mountComp();
    (w.vm as any).config.query_mode = "filters";
    (w.vm as any).config.stream_name = "stream";
    (w.vm as any).config.training_window_days = 14;
    expect((w.vm as any).previewSql).toContain("dow");
  });

  it("uses day-only seasonality when training_window_days < 7", async () => {
    const w = await mountComp();
    (w.vm as any).config.query_mode = "filters";
    (w.vm as any).config.stream_name = "stream";
    (w.vm as any).config.training_window_days = 3;
    expect((w.vm as any).previewSql).not.toContain("dow");
    expect((w.vm as any).previewSql).toContain("hour");
  });
});

describe("AddAnomalyDetection - step navigation", () => {
  beforeEach(() => {
    mockAnomalyId = undefined;
    vi.clearAllMocks();
  });

  it("goBack pushes to alertList route", async () => {
    const w = await mountComp();
    (w.vm as any).goBack();
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ name: "alertList" }),
    );
  });

  it("goNext increments step when step1 validation passes", async () => {
    const w = await mountComp();
    expect((w.vm as any).step).toBe(1);
    await (w.vm as any).goNext();
    expect((w.vm as any).step).toBe(2);
  });

  it("goNext increments step again from step 2", async () => {
    const w = await mountComp();
    (w.vm as any).step = 2;
    await (w.vm as any).goNext();
    expect((w.vm as any).step).toBe(3);
  });
});

describe("AddAnomalyDetection - save", () => {
  beforeEach(() => {
    mockAnomalyId = undefined;
    vi.clearAllMocks();
  });

  it("calls anomalyDetectionService.create in create mode", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).config.name = "My Config";
    (w.vm as any).config.stream_name = "test-stream";
    await (w.vm as any).save();
    await flushPromises();
    expect(anomalyDetectionService.create).toHaveBeenCalled();
  });

  it("sets saving to false after completion", async () => {
    const w = await mountComp();
    await flushPromises();
    await (w.vm as any).save();
    await flushPromises();
    expect((w.vm as any).saving).toBe(false);
  });
});
