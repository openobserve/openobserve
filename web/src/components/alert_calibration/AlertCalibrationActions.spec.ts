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
import { h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return { ...actual, default: { ...actual.default, getConfig: vi.fn(), requestRun: vi.fn() } };
});

import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import alertCalibration, { type AlertCalibrationConfig } from "@/services/alert_calibration";
import { toast } from "@/lib/feedback/Toast/useToast";
import { resetRunDenials } from "@/composables/alertCalibration/useRequestAlertCalibrationRun";
import AlertCalibrationActions from "./AlertCalibrationActions.vue";

const forbidden = () =>
  Object.assign(new Error("Request failed with status code 403"), {
    response: { status: 403, data: { code: 403, message: "Unauthorized Access" } },
  });
const config = { enabled: true } as unknown as AlertCalibrationConfig;

const mountPart = async (part: "run" | "configure", cfg: AlertCalibrationConfig | null) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => h("div") } },
      { path: "/s", name: "alertCalibrationSettings", component: { render: () => h("div") } },
    ],
  });
  await router.push("/");
  const wrapper = mount(AlertCalibrationActions, {
    props: { config: cfg, part },
    attachTo: document.body,
    global: { plugins: [store, router, withQueryClient(queryClient)] },
  });
  await flushPromises();
  return wrapper;
};

describe("AlertCalibrationActions", () => {
  beforeEach(() => {
    queryClient.clear();
    resetRunDenials();
    vi.mocked(toast).mockClear();
    vi.mocked(alertCalibration.getConfig).mockResolvedValue({ data: config } as never);
  });

  it("a_reader_without_access_is_offered_neither_run_now_nor_configure", async () => {
    vi.mocked(alertCalibration.getConfig).mockRejectedValue(forbidden());
    const run = await mountPart("run", null);
    const configure = await mountPart("configure", null);
    expect(run.find('[data-test="alert-calibration-run-now"]').exists()).toBe(false);
    expect(configure.find('[data-test="alert-calibration-configure"]').exists()).toBe(false);
    run.unmount();
    configure.unmount();
  });

  it("a_reader_the_server_says_may_not_run_is_not_offered_run_now_but_can_open_the_settings", async () => {
    const readOnly = { enabled: true, can_edit: false, can_run: false } as AlertCalibrationConfig;
    vi.mocked(alertCalibration.getConfig).mockResolvedValue({ data: readOnly } as never);
    const run = await mountPart("run", readOnly);
    const configure = await mountPart("configure", readOnly);
    expect(run.find('[data-test="alert-calibration-run-now"]').exists()).toBe(false);
    expect(configure.find('[data-test="alert-calibration-configure"]').exists()).toBe(true);
    run.unmount();
    configure.unmount();
  });

  it("a_refused_run_says_what_is_missing_once_and_then_stays_off", async () => {
    vi.mocked(alertCalibration.requestRun).mockRejectedValue(forbidden());
    const wrapper = await mountPart("run", config);
    await wrapper.get('[data-test="alert-calibration-run-now"]').trigger("click");
    await flushPromises();
    expect(toast).toHaveBeenCalledTimes(1);
    const message = String(vi.mocked(toast).mock.calls[0][0].message);
    expect(message).toBe(
      "You don't have permission to run Alert calibration. Ask an admin for edit access to it.",
    );
    expect(message).not.toContain("Unauthorized");
    expect(
      wrapper.get('[data-test="alert-calibration-run-now"]').attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });
});
