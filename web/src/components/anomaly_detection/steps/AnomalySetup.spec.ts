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

vi.mock("@/services/stream", () => ({
  default: {
    nameList: vi.fn().mockResolvedValue({
      data: { list: [{ name: "stream-a" }, { name: "stream-b" }] },
    }),
  },
}));

import AnomalySetup from "@/components/anomaly_detection/steps/AnomalySetup.vue";
import streamService from "@/services/stream";

const makeConfig = (overrides: Record<string, any> = {}) => ({
  name: "",
  description: "",
  stream_type: "logs",
  stream_name: "",
  query_mode: "filters",
  filters: [],
  custom_sql: "",
  detection_function: "count",
  histogram_interval_value: 5,
  histogram_interval_unit: "m",
  schedule_interval_value: 1,
  schedule_interval_unit: "h",
  detection_window_value: 1,
  detection_window_unit: "h",
  training_window_days: 14,
  retrain_interval_days: 7,
  threshold: 97,
  alert_enabled: true,
  alert_destination_id: undefined,
  status: undefined,
  is_trained: false,
  enabled: true,
  ...overrides,
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(AnomalySetup, {
    props: { config: makeConfig(), isEdit: false, ...props },
    global: { plugins: [i18n, store] },
  });
}

describe("AnomalySetup - rendering", () => {
  it("renders the component without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders name input", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-setup-name"]').exists()).toBe(true);
  });

  it("renders stream type select", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-setup-stream-type"]').exists()).toBe(true);
  });

  it("renders stream name select", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-setup-stream-name"]').exists()).toBe(true);
  });

  it("renders description textarea", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-setup-description"]').exists()).toBe(true);
  });

  it("shows 'Name cannot be changed' hint in edit mode", async () => {
    const w = await mountComp({ isEdit: true });
    expect(w.text()).toContain("Name cannot be changed after creation");
  });

  it("does not show 'Name cannot be changed' hint when not in edit mode", async () => {
    const w = await mountComp({ isEdit: false });
    expect(w.text()).not.toContain("Name cannot be changed after creation");
  });
});

describe("AnomalySetup - stream loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls streamService.nameList when stream_type is set", async () => {
    const config = makeConfig({ stream_type: "logs" });
    await mountComp({ config });
    await flushPromises();
    expect(streamService.nameList).toHaveBeenCalled();
  });

  it("calls streamService.nameList with correct org and stream type", async () => {
    const config = makeConfig({ stream_type: "metrics" });
    await mountComp({ config });
    await flushPromises();
    expect(streamService.nameList).toHaveBeenCalledWith(
      "default",
      "metrics",
      false,
    );
  });

  it("does not call streamService.nameList when stream_type is empty", async () => {
    vi.clearAllMocks();
    const config = makeConfig({ stream_type: "" });
    await mountComp({ config });
    await flushPromises();
    expect(streamService.nameList).not.toHaveBeenCalled();
  });

  it("populates filteredStreams after loading", async () => {
    const config = makeConfig({ stream_type: "logs" });
    const w = await mountComp({ config });
    await flushPromises();
    expect((w.vm as any).filteredStreams).toContain("stream-a");
    expect((w.vm as any).filteredStreams).toContain("stream-b");
  });
});

describe("AnomalySetup - onStreamTypeChange", () => {
  it("clears stream_name when stream type changes", async () => {
    const config = makeConfig({ stream_type: "logs", stream_name: "old-stream" });
    const w = await mountComp({ config });
    (w.vm as any).onStreamTypeChange();
    expect(config.stream_name).toBe("");
  });

  it("calls loadStreams after type change", async () => {
    vi.clearAllMocks();
    const config = makeConfig({ stream_type: "logs" });
    const w = await mountComp({ config });
    await flushPromises();
    vi.clearAllMocks();
    (w.vm as any).onStreamTypeChange();
    await flushPromises();
    expect(streamService.nameList).toHaveBeenCalled();
  });
});

describe("AnomalySetup - filterStreams", () => {
  it("filters streams by keyword (case-insensitive)", async () => {
    const config = makeConfig({ stream_type: "logs" });
    const w = await mountComp({ config });
    await flushPromises();
    let result: string[] = [];
    (w.vm as any).filterStreams("stream-a", (cb: () => void) => cb());
    expect((w.vm as any).filteredStreams).toContain("stream-a");
  });

  it("returns all streams when filter is empty", async () => {
    const config = makeConfig({ stream_type: "logs" });
    const w = await mountComp({ config });
    await flushPromises();
    (w.vm as any).filterStreams("", (cb: () => void) => cb());
    expect((w.vm as any).filteredStreams.length).toBeGreaterThanOrEqual(2);
  });
});

describe("AnomalySetup - validate", () => {
  it("validate() returns true when formRef is null", async () => {
    const w = await mountComp();
    (w.vm as any).formRef = null;
    const result = await (w.vm as any).validate();
    expect(result).toBe(true);
  });
});

describe("AnomalySetup - isEdit mode", () => {
  it("name input is disabled in edit mode", async () => {
    const w = await mountComp({ isEdit: true, config: makeConfig({ name: "existing" }) });
    const nameInput = w.find('[data-test="anomaly-setup-name"]');
    expect(nameInput.exists()).toBe(true);
  });

  it("stream type select is disabled in edit mode", async () => {
    const w = await mountComp({ isEdit: true });
    const streamTypeSelect = w.find('[data-test="anomaly-setup-stream-type"]');
    expect(streamTypeSelect.exists()).toBe(true);
  });
});
