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

/**
 * Editing an ANOMALY loads its config from a different service, after
 * initializeFormData has already run. The stream is therefore unknown at the
 * point the form does its stream setup, which is what made the stream select
 * come up unselected: the form VALUE was set, but the select had no options to
 * select from and the stream's columns were never fetched.
 *
 * These tests pin the ordering — config first, then a stream load driven by
 * what the config said.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ── Route: an anomaly edit is identified by the anomaly_id route param ──────
const mockRouteParams: Record<string, string> = {};
const mockRouterPush = vi.fn();
vi.mock("vue-router", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useRouter: () => ({
      push: mockRouterPush,
      currentRoute: {
        value: { name: "editAnomalyDetection", params: mockRouteParams, query: {} },
      },
    }),
  };
});

// ── Streams: spies, because "were the streams loaded for THIS stream" is the
//    whole question here. ────────────────────────────────────────────────────
const { mockGetStreams, mockGetStream } = vi.hoisted(() => ({
  mockGetStreams: vi.fn(),
  mockGetStream: vi.fn(),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: mockGetStreams, getStream: mockGetStream }),
}));

vi.mock("@/composables/useFunctions", () => ({
  default: () => ({ getAllFunctions: vi.fn().mockResolvedValue({ functions: [] }) }),
}));
vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/composables/useParser", () => ({
  default: () => ({ sqlParser: vi.fn().mockResolvedValue({ astify: vi.fn(), sqlify: vi.fn() }) }),
}));

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mockToast }));

vi.mock("@/services/alerts", () => ({
  default: {
    get_by_alert_id: vi.fn(),
    create_by_alert_id: vi.fn(),
    update_by_alert_id: vi.fn(),
    listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })),
  },
}));

vi.mock("@/services/anomaly_detection", () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    triggerTraining: vi.fn(),
  },
}));

vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

import AddAlert from "@/components/alerts/AddAlert.vue";
import anomalyService from "@/services/anomaly_detection";

const stubs = {
  QueryConfig: true,
  AlertSettings: true,
  CompareWithPast: true,
  Deduplication: true,
  Advanced: true,
  PreviewAlert: true,
  AlertSummary: true,
  AnomalyDetectionConfig: true,
  AnomalyAlerting: true,
  AnomalySummary: true,
  QueryEditor: true,
  JsonEditor: true,
  InlineSelectFolderDropdown: true,
  OPageHeader: true,
};

/** A saved anomaly config as the service returns it. */
const anomalyConfig = (overrides: Record<string, any> = {}) => ({
  anomaly_id: "anom-1",
  name: "latency-anomaly",
  stream_name: "k8s_logs",
  stream_type: "logs",
  detection_function: "count(*)",
  histogram_interval: "5m",
  schedule_interval: "1h",
  threshold: 97,
  filters: [],
  folder_id: "team-a",
  ...overrides,
});

const mountAnomalyEdit = async () => {
  const wrapper = mount(AddAlert, {
    global: { provide: { store }, plugins: [i18n], stubs },
    props: { isUpdated: true, destinations: [] },
  });
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flushPromises();
  return wrapper;
};

let wrapper: any = null;

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.anomaly_id = "anom-1";
  mockGetStreams.mockResolvedValue({
    list: [{ name: "k8s_logs" }, { name: "app_logs" }],
  });
  mockGetStream.mockResolvedValue({
    schema: [
      { name: "code", type: "Int64" },
      { name: "message", type: "Utf8" },
    ],
  });
  vi.mocked(anomalyService.get).mockResolvedValue({ data: anomalyConfig() } as any);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  delete mockRouteParams.anomaly_id;
});

describe("AddAlert — editing an anomaly seeds its stream", () => {
  it("puts the anomaly's stream on the form", async () => {
    wrapper = await mountAnomalyEdit();

    expect(wrapper.vm.form.state.values.stream_name).toBe("k8s_logs");
    expect(wrapper.vm.form.state.values.stream_type).toBe("logs");
  });

  it("loads the stream list for the anomaly's stream type", async () => {
    wrapper = await mountAnomalyEdit();

    expect(mockGetStreams).toHaveBeenCalledWith("logs", false);
  });

  it("offers the anomaly's stream as a selectable option", async () => {
    wrapper = await mountAnomalyEdit();

    expect(wrapper.vm.indexOptions).toContain("k8s_logs");
  });

  it("loads the columns of the anomaly's stream", async () => {
    // Without this every downstream field picker is empty.
    wrapper = await mountAnomalyEdit();

    expect(mockGetStream).toHaveBeenCalledWith("k8s_logs", "logs", true);
  });

  it("marks the form as an anomaly edit", async () => {
    wrapper = await mountAnomalyEdit();

    expect(wrapper.vm.anomalyEditMode).toBe(true);
    expect(wrapper.vm.form.state.values.is_real_time).toBe("anomaly");
  });

  it("carries the anomaly's name and folder across", async () => {
    wrapper = await mountAnomalyEdit();

    expect(wrapper.vm.form.state.values.name).toBe("latency-anomaly");
    expect(wrapper.vm.activeFolderId).toBe("team-a");
  });

  describe("corner cases", () => {
    it("never asks for streams of an empty type when the config has no stream", async () => {
      // A partially-written config must not turn into getStreams(""). The form's
      // own default type is still loaded during init — that is expected; what
      // must not happen is a SECOND, typeless fetch driven by the config.
      vi.mocked(anomalyService.get).mockResolvedValue({
        data: anomalyConfig({ stream_type: "", stream_name: "" }),
      } as any);

      wrapper = await mountAnomalyEdit();

      for (const call of mockGetStreams.mock.calls) {
        expect(call[0]).toBeTruthy();
      }
      expect(wrapper.vm.anomalyEditMode).toBe(true);
    });

    it("still seeds the stream name when the stream list comes back empty", async () => {
      // An org with no streams of that type must not lose the saved value.
      mockGetStreams.mockResolvedValue({ list: [] });

      wrapper = await mountAnomalyEdit();

      expect(wrapper.vm.form.state.values.stream_name).toBe("k8s_logs");
      expect(wrapper.vm.indexOptions).toEqual([]);
    });

    it("survives a stream fetch that rejects", async () => {
      mockGetStreams.mockRejectedValue(new Error("500"));

      wrapper = await mountAnomalyEdit();

      // The config still loaded; only the option list is missing.
      expect(wrapper.vm.form.state.values.stream_name).toBe("k8s_logs");
      expect(wrapper.vm.anomalyEditMode).toBe(true);
    });

    it("reports a config that fails to load instead of silently emptying the form", async () => {
      vi.mocked(anomalyService.get).mockRejectedValue(new Error("404"));

      wrapper = await mountAnomalyEdit();

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      expect(wrapper.vm.anomalyEditMode).toBe(false);
    });

    it("does not touch the anomaly service when creating rather than editing", async () => {
      delete mockRouteParams.anomaly_id;

      wrapper = await mountAnomalyEdit();

      expect(anomalyService.get).not.toHaveBeenCalled();
      expect(wrapper.vm.anomalyEditMode).toBe(false);
    });

    it("keeps the stream when the config carries no folder", async () => {
      vi.mocked(anomalyService.get).mockResolvedValue({
        data: anomalyConfig({ folder_id: undefined }),
      } as any);

      wrapper = await mountAnomalyEdit();

      expect(wrapper.vm.form.state.values.stream_name).toBe("k8s_logs");
      expect(mockGetStreams).toHaveBeenCalledWith("logs", false);
    });

    // THE regression guard. A logs anomaly masked this bug: the form's default
    // stream_type is "logs", so init happened to fetch the right list by
    // coincidence. Any other stream type had its list fetched for "logs" and
    // the saved stream was therefore never among the options — nothing to
    // select. Reverting the fix fails THIS test and only this one.
    it("loads a metrics anomaly against its own stream type", async () => {
      vi.mocked(anomalyService.get).mockResolvedValue({
        data: anomalyConfig({ stream_type: "metrics", stream_name: "cpu_usage" }),
      } as any);
      mockGetStreams.mockResolvedValue({ list: [{ name: "cpu_usage" }] });

      wrapper = await mountAnomalyEdit();

      expect(mockGetStreams).toHaveBeenCalledWith("metrics", false);
      expect(mockGetStream).toHaveBeenCalledWith("cpu_usage", "metrics", true);
      expect(wrapper.vm.indexOptions).toContain("cpu_usage");
    });
  });
});
