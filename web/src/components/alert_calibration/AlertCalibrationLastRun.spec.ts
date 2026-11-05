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
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import alertCalibration from "@/services/alert_calibration";
import type { AlertCalibrationLastRun as LastRun } from "@/services/alert_calibration";
import AlertCalibrationLastRun from "./AlertCalibrationLastRun.vue";

vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return { ...actual, default: { ...actual.default, getStatus: vi.fn() } };
});

const NOW = Date.now() * 1000;
const DEFERRED_NOTE = "Digest format upgraded. This run's results appear after the next run.";

const mountWith = async (lastRun: LastRun | null, onlyFailure = false) => {
  vi.mocked(alertCalibration.getStatus).mockResolvedValue({ data: { last_run: lastRun } } as never);
  const wrapper = mount(AlertCalibrationLastRun, {
    props: { onlyFailure },
    global: { plugins: [store] },
  });
  await flushPromises();
  return wrapper;
};

describe("AlertCalibrationLastRun", () => {
  beforeEach(() => queryClient.clear());

  it("says a deferred run's results come with the next run, in the status line's own place", async () => {
    const wrapper = await mountWith({
      status: "skipped",
      error: null,
      finished_at: NOW - 1_000_000,
      deferred: true,
    });
    const line = wrapper.find('[data-test="alert-calibration-last-run"]');
    expect(line.text()).toBe(DEFERRED_NOTE);
    expect(wrapper.find('[data-test="alert-calibration-last-run-failed"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("succeeded");
    wrapper.unmount();
  });

  it("keeps the success line for a run that wrote its digest", async () => {
    const wrapper = await mountWith({
      status: "succeeded",
      error: null,
      finished_at: NOW - 1_000_000,
    });
    const line = wrapper.find('[data-test="alert-calibration-last-run"]');
    expect(line.text()).toMatch(/^The last run succeeded .+ ago\.$/);
    wrapper.unmount();
  });

  it("shows a failed run, such as one stopped by a disabled ingestion token, as an error", async () => {
    const wrapper = await mountWith({
      status: "error",
      error:
        "Results were not saved because the Alert Calibration ingestion token is disabled. Enable it under Ingestion tokens to resume.",
      finished_at: NOW - 1_000_000,
    });
    const banner = wrapper.find('[data-test="alert-calibration-last-run-failed"]');
    expect(banner.text()).toContain("ingestion token is disabled");
    expect(banner.classes()).toContain("bg-banner-error-bg");
    expect(banner.classes().some((c) => c.includes("warning"))).toBe(false);
    expect(banner.attributes("role")).toBe("alert");
    wrapper.unmount();
  });

  it("shows a run whose ingestion token was not active yet as an error too", async () => {
    const wrapper = await mountWith({
      status: "error",
      error:
        "Results were not saved because the Alert Calibration ingestion token is not active yet. The next run retries.",
      finished_at: NOW - 1_000_000,
    });
    const banner = wrapper.find('[data-test="alert-calibration-last-run-failed"]');
    expect(banner.text()).toContain("ingestion token is not active yet");
    expect(banner.classes()).toContain("bg-banner-error-bg");
    expect(banner.classes().some((c) => c.includes("warning"))).toBe(false);
    expect(banner.attributes("role")).toBe("alert");
    wrapper.unmount();
  });

  // The runs and overview pages only speak up for a failure, so nothing on them moves.
  it("stays quiet about a deferred run where only failures are shown", async () => {
    const wrapper = await mountWith(
      { status: "skipped", error: null, finished_at: NOW - 1_000_000, deferred: true },
      true,
    );
    expect(wrapper.text()).toBe("");
    wrapper.unmount();
  });
});
