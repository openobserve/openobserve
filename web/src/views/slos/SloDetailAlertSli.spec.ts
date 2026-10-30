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

//! The alert-SLI half of the SLO detail page (PR 3).
//!
//! The freeze arrives by two different doors (§2) and the copy has to name the
//! right one: a paused source stalls the WATERMARK while coverage stays high,
//! and only the post-resume case is about a coverage percentage.

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushSpy = vi.fn();

// Only the two composables are replaced: RouterLink and friends still have to
// resolve, or every OPageLayout header renders as an unknown component.
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

const SloAlertPreviewStub = {
  name: "SloAlertPreview",
  props: {
    alertId: { type: String, default: "" },
    windowSecs: { type: Number, default: 0 },
    sliceIntervalSecs: { type: Number, default: 0 },
  },
  template: '<div data-test="slos-slodetail-alert-ribbon" />',
};

const alertSlo = (over: Record<string, unknown> = {}) => ({
  id: "slo-1",
  name: "checkout alert uptime",
  sli_type: "alert",
  config: { alert_id: "alert-9" },
  group_by: [],
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  target: 99.9,
  tags: [],
  definition_generation: 1,
  groups_reserved: 1,
  ...over,
});

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

async function mountDetail(slo: Record<string, unknown>, status: unknown) {
  vi.mocked(sloService.get).mockResolvedValue({ data: { ...slo, status } } as never);
  const wrapper = mount(SloDetail, {
    attachTo: node,
    global: {
      plugins: [i18n, store],
      stubs: {
        SloAlertPreview: SloAlertPreviewStub,
        SloBurndownChart: true,
        SloAlertsPanel: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const banner = (wrapper: Awaited<ReturnType<typeof mountDetail>>) =>
  wrapper.find('[data-test="slos-slodetail-frozen-banner"]');

describe("SloDetail — alert SLI", () => {
  beforeEach(() => {
    pushSpy.mockClear();
  });

  it("links to the source alert", async () => {
    const wrapper = await mountDetail(alertSlo(), healthy);
    const link = wrapper.find('[data-test="slos-slodetail-source-alert"]');
    expect(link.exists()).toBe(true);
    await link.trigger("click");
    const target = pushSpy.mock.calls[0][0];
    expect(JSON.stringify(target)).toContain("alert-9");
  });

  it("shows no source link for a non-alert SLO", async () => {
    const wrapper = await mountDetail(
      alertSlo({ sli_type: "time_slice", config: { stream: "requests" } }),
      healthy,
    );
    expect(wrapper.find('[data-test="slos-slodetail-source-alert"]').exists()).toBe(false);
  });

  it("renders the uptime ribbon for an alert SLO", async () => {
    const wrapper = await mountDetail(alertSlo(), healthy);
    const ribbon = wrapper.findComponent(SloAlertPreviewStub);
    expect(ribbon.exists()).toBe(true);
    expect(ribbon.props("alertId")).toBe("alert-9");
    // The ribbon has to describe THIS SLO's window, or it draws a range the
    // page's own numbers were never measured over.
    expect(ribbon.props("windowSecs")).toBe(30 * 86400);
    expect(ribbon.props("sliceIntervalSecs")).toBe(300);
  });

  it("shows no banner while the SLO is measuring", async () => {
    const wrapper = await mountDetail(alertSlo(), healthy);
    expect(banner(wrapper).exists()).toBe(false);
  });

  // §2, first door: every pass emits zero slices so the watermark stops
  // advancing, while measured coverage of the pinned window stays high. The
  // coverage-floor test cannot see this at all, so the banner has to.
  it("names the stalled source when the watermark froze", async () => {
    const wrapper = await mountDetail(alertSlo(), {
      ...healthy,
      no_data: false,
      coverage: 1,
      stale_watermark: true,
      watermark_end: 1_769_000_000,
    });
    const text = banner(wrapper).text();
    expect(text).toContain("has not evaluated");
    expect(text).not.toContain("100%");
    expect(text).not.toContain("of this window was measured");
  });

  // "since when" is the whole content of the sentence — a banner that only
  // says "recently" tells the reader nothing they can act on.
  it("carries the watermark-derived timestamp", async () => {
    const stale = { ...healthy, stale_watermark: true, no_data: false };
    const early = await mountDetail(alertSlo(), { ...stale, watermark_end: 1_769_000_000 });
    const late = await mountDetail(alertSlo(), { ...stale, watermark_end: 1_769_600_000 });
    const shown = banner(early).text();
    expect(shown).toMatch(/\d{2}:\d{2}/);
    expect(shown).not.toBe(banner(late).text());
  });

  // A brand-new alert SLO has no watermark, which reads as stale — but it has
  // not "stopped evaluating", it has never started, and the copy must not say
  // otherwise.
  it("does not claim a stall for an SLO that has never measured", async () => {
    const wrapper = await mountDetail(alertSlo(), {
      ...healthy,
      no_data: true,
      coverage: 0,
      sli: null,
      covered_slices: 0,
      stale_watermark: true,
      watermark_end: null,
    });
    expect(banner(wrapper).text()).not.toContain("has not evaluated");
  });

  // §2, second door: after the source resumes the holes slide into the window
  // and coverage falls under the floor. Only here is a percentage the truth.
  it("uses the coverage phrasing when the holes are what froze it", async () => {
    const wrapper = await mountDetail(alertSlo(), {
      ...healthy,
      no_data: true,
      coverage: 0.41,
      stale_watermark: false,
      sli: null,
    });
    const text = banner(wrapper).text();
    expect(text).toContain("41%");
    expect(text).toContain("source alert");
    expect(text).not.toContain("has not evaluated");
  });

  // A stalled watermark is the more specific fact, so it wins when both hold —
  // matching `coverage::observe`'s own precedence.
  it("prefers the stalled-source copy when both doors are open", async () => {
    const wrapper = await mountDetail(alertSlo(), {
      ...healthy,
      no_data: true,
      coverage: 0.41,
      stale_watermark: true,
      sli: null,
    });
    expect(banner(wrapper).text()).toContain("has not evaluated");
  });

  // PR 4's backfill clamp: an alert-sourced SLO cannot measure back to the
  // start of its window, so a low coverage number is expected rather than a
  // symptom. Quoting the percentage sends the reader hunting for a gap that
  // does not exist.
  it("explains a clamped window instead of quoting its coverage", async () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const wrapper = await mountDetail(alertSlo(), {
      ...healthy,
      no_data: true,
      coverage: 0.1,
      sli: null,
      stale_watermark: false,
      measuring_since: nowSecs - (3 * 86400 + 3600),
    });
    const text = banner(wrapper).text();
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).toContain("3 of 30 days");
    expect(text).not.toContain("10%");
  });

  // Once the window has slid past the floor the SLO really is measuring its
  // full 30 days, and a low coverage number means what it always meant.
  it("falls back to the coverage phrasing once the window is full", async () => {
    const wrapper = await mountDetail(alertSlo(), {
      ...healthy,
      no_data: true,
      coverage: 0.41,
      sli: null,
      stale_watermark: false,
      measuring_since: null,
    });
    expect(banner(wrapper).text()).toContain("41%");
  });

  // A source that stopped evaluating is the more actionable fact, and the
  // warm-up copy would tell the reader to wait for a window that will never
  // fill.
  it("prefers the stalled-source copy over the warm-up copy", async () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const wrapper = await mountDetail(alertSlo(), {
      ...healthy,
      no_data: true,
      coverage: 0.1,
      sli: null,
      stale_watermark: true,
      watermark_end: 1_769_000_000,
      measuring_since: nowSecs - 3 * 86400,
    });
    expect(banner(wrapper).text()).toContain("has not evaluated");
  });

  // The partial window is at its MOST misleading when it is not frozen: 28 of
  // 30 days is 93% coverage, over the floor, so the page publishes an SLI
  // under a "rolling 30 days" heading that it measured over 28. The banner has
  // to survive `no_data === false` or it is absent exactly when a number is on
  // screen to mislead.
  it("still explains the partial window when the SLO is publishing figures", async () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const wrapper = await mountDetail(alertSlo(), {
      ...healthy,
      no_data: false,
      coverage: 0.93,
      sli: 99.99,
      measuring_since: nowSecs - (28 * 86400 + 3600),
    });
    expect(banner(wrapper).text()).toContain("28 of 30 days");
  });

  // And it must stay away from an SLO whose window really is full.
  it("shows no banner once the window is full and nothing is frozen", async () => {
    const wrapper = await mountDetail(alertSlo(), { ...healthy, measuring_since: null });
    expect(banner(wrapper).exists()).toBe(false);
  });

  it("leaves a non-alert SLO's frozen copy alone", async () => {
    const wrapper = await mountDetail(
      alertSlo({ sli_type: "time_slice", config: { stream: "requests" } }),
      { ...healthy, no_data: true, coverage: 0.41, stale_watermark: false, sli: null },
    );
    const text = banner(wrapper).text();
    expect(text).toContain("41%");
    expect(text).not.toContain("source alert");
  });
});
