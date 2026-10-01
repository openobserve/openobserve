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

//! The status-corrections half of the SLO detail page (downtimes WP11): the
//! Corrected chip and the corrections banner render only when the status
//! carries at least one correction.

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushSpy = vi.fn();

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ params: { slo_id: "slo-1" }, query: {} }),
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
}));

vi.mock("@/services/slos", () => ({
  default: {
    get: vi.fn(),
    groups: vi.fn().mockResolvedValue({ data: { list: [] } }),
    alertPreview: vi.fn().mockResolvedValue({ data: null }),
  },
}));

import SloDetail from "@/views/slos/SloDetail.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import sloService from "@/services/slos";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const slo = {
  id: "slo-1",
  name: "checkout availability",
  sli_type: "time_slice",
  config: { stream: "requests" },
  group_by: [],
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  target: 99.9,
  tags: [],
  definition_generation: 1,
  groups_reserved: 1,
};

const healthy = {
  group_key: "",
  coverage: 1,
  no_data: false,
  stale_watermark: false,
  watermark_end: 1_770_000_000,
  sli: 99.99,
  error_budget_remaining: 80,
  burn_rate: 0.2,
  time_to_exhaust_secs: null,
  good: 100,
  total: 100,
  covered_slices: 8640,
  computed_at: 1_770_000_000,
};

async function mountDetail(status: unknown) {
  vi.mocked(sloService.get).mockResolvedValue({ data: { ...slo, status } } as never);
  const wrapper = mount(SloDetail, {
    attachTo: node,
    global: {
      plugins: [i18n, store],
      stubs: {
        SloAlertPreview: true,
        SloBurndownChart: true,
        SloAlertsPanel: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const chip = (wrapper: Awaited<ReturnType<typeof mountDetail>>) =>
  wrapper.find('[data-test="slos-slodetail-corrected"]');
const banner = (wrapper: Awaited<ReturnType<typeof mountDetail>>) =>
  wrapper.find('[data-test="slos-slodetail-corrections-banner"]');

describe("SloDetail — status corrections", () => {
  beforeEach(() => {
    pushSpy.mockClear();
  });

  it("renders no chip and no banner when the status has no corrections field", async () => {
    const wrapper = await mountDetail(healthy);
    expect(chip(wrapper).exists()).toBe(false);
    expect(banner(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders no chip and no banner when corrections is empty", async () => {
    const wrapper = await mountDetail({ ...healthy, corrections: [] });
    expect(chip(wrapper).exists()).toBe(false);
    expect(banner(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders the chip and names each correction in the banner", async () => {
    const wrapper = await mountDetail({
      ...healthy,
      corrections: [
        { downtime_id: "dt-1", name: "Kafka upgrade", status: "active" },
        { downtime_id: "dt-2", name: "Nightly batch", status: "scheduled" },
      ],
    });
    expect(chip(wrapper).exists()).toBe(true);
    expect(chip(wrapper).text()).toContain("Corrected");
    expect(banner(wrapper).exists()).toBe(true);
    expect(banner(wrapper).text()).toContain("Kafka upgrade");
    expect(banner(wrapper).text()).toContain("Nightly batch");
    wrapper.unmount();
  });

  it("opens the downtime detail page from a correction name", async () => {
    const wrapper = await mountDetail({
      ...healthy,
      corrections: [{ downtime_id: "dt-1", name: "Kafka upgrade", status: "active" }],
    });
    await wrapper.get('[data-test="slos-slodetail-correction-dt-1"]').trigger("click");
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "downtimeDetail", params: { id: "dt-1" } }),
    );
    wrapper.unmount();
  });
});
