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
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import alertCalibration from "@/services/alert_calibration";
import AlertCalibrationSettings from "./AlertCalibrationSettings.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});

vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      getConfig: vi.fn(),
      updateConfig: vi.fn(),
      getStatus: vi.fn(),
      requestRun: vi.fn(),
    },
  };
});

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

const serverError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

const mountSettings = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/alert-calibration/settings",
        name: "alertCalibrationSettings",
        component: AlertCalibrationSettings,
      },
      { path: "/alert-calibration", name: "alertCalibration", component: { template: "<div />" } },
      { path: "/alerts", name: "alertList", component: { template: "<div />" } },
    ],
  });
  await router.push({ name: "alertCalibrationSettings", query: { org_identifier: "default" } });
  await router.isReady();
  const wrapper = mount(AlertCalibrationSettings, {
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

describe("AlertCalibrationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    queryClient.setQueryDefaults(["org"], { retry: false });
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
    vi.mocked(alertCalibration.getStatus).mockResolvedValue({ data: { last_run: null } } as never);
  });

  it("a failed settings read shows the plain error copy, never the server's words", async () => {
    vi.mocked(alertCalibration.getConfig).mockRejectedValue(serverError(500, "internal"));
    const wrapper = await mountSettings();
    const banner = wrapper.find('[data-test="alert-calibration-settings-load-error"]');
    expect(banner.text()).toContain(
      "Alert calibration settings couldn't be loaded. Try again in a moment.",
    );
    expect(banner.text()).toContain("Retry");
    expect(wrapper.text()).not.toContain("internal");
    wrapper.unmount();
  });

  it("a refused save still names the field the server rejected", async () => {
    vi.mocked(alertCalibration.getConfig).mockResolvedValue({
      data: {
        id: "c1",
        org: "default",
        enabled: false,
        frequency_minutes: 1440,
        window_minutes: 43_200,
        created_at: 1,
        updated_at: 1,
      },
    } as never);
    vi.mocked(alertCalibration.updateConfig).mockRejectedValue(
      serverError(400, { message: "window_minutes must be at least 60" }),
    );
    const wrapper = await mountSettings();
    await wrapper.find('[data-test="alert-calibration-settings-enabled-btn"]').trigger("click");
    await wrapper.find('[data-test="alert-calibration-settings-save"]').trigger("click");
    // The form validates on submit before it calls save, past one microtask flush.
    await vi.waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(alertCalibration.updateConfig).toHaveBeenCalledWith("default", { enabled: true });
    expect(mockToast).toHaveBeenCalledWith({
      message: "The settings could not be saved: window_minutes must be at least 60",
      variant: "error",
    });
    wrapper.unmount();
  });
});
