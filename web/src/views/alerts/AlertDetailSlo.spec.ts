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

//! The alert status page, for an SLO alert (Feature 5, Phase 3.3).
//!
//! Plain row-click still lands here — only the EDIT action diverts to the SLO
//! page — so this page has to be able to describe an alert with no stream and
//! no query. Two things were wrong before: the evaluation chart is meaningless
//! without a stream, and the configuration summary needs the SLO's NAME, which
//! the single alert GET does not carry.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";

vi.mock("@/services/alerts", () => ({
  default: {
    get_by_alert_id: vi.fn(),
    list_groups: vi.fn(),
    list_group_transitions: vi.fn(),
    getHistory: vi.fn(),
  },
}));

vi.mock("@/services/slos", () => ({
  default: { get: vi.fn() },
}));

// `toast()` returns a `dismiss` FUNCTION; keep the shape so a call site that
// dismisses its own toast does not blow up with "dismiss is not a function".
const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => {
    mockToast(...a);
    return () => {};
  },
}));

const mockRouterPush = vi.fn();
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({
      name: "alertDetail",
      path: "/alerts/detail/alert-1",
      params: { alert_id: "alert-1" },
      query: {},
      meta: {},
    }),
    useRouter: () => ({ push: mockRouterPush }),
  };
});

import AlertDetail from "@/views/alerts/AlertDetail.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import sloService from "@/services/slos";

const sloAlert = (sloCondition: Record<string, any> | null = {}) => ({
  id: "alert-1",
  name: "checkout-burn-14.4x-1h",
  stream_name: "",
  stream_type: "logs",
  query_condition: {
    type: "slo",
    slo_condition:
      sloCondition === null
        ? null
        : {
            slo_id: "slo-123",
            kind: "burn_rate",
            operator: ">",
            critical: 14.4,
            long_window_secs: 3600,
            short_window_secs: 300,
            ...sloCondition,
          },
  },
});

const plainAlert = () => ({
  id: "alert-1",
  name: "cpu-high",
  stream_name: "default",
  query_condition: { type: "sql", sql: "select 1" },
});

/** Declares `sloName` explicitly: an auto-stub would swallow a missing prop. */
const ConfigSummaryStub = {
  name: "AlertConfigSummary",
  props: ["alert", "sloName"],
  template: '<div data-test="config-summary-stub">{{ sloName }}</div>',
};

async function mountView(alert: any) {
  vi.mocked(alertsService.get_by_alert_id).mockResolvedValue({ data: alert } as any);
  vi.mocked(alertsService.list_groups).mockResolvedValue({
    data: { list: [], capped: false, group_cap: 100 },
  } as any);
  vi.mocked(alertsService.list_group_transitions).mockResolvedValue({
    data: { list: [] },
  } as any);
  vi.mocked(alertsService.getHistory).mockResolvedValue({
    data: { hits: [], total: 0 },
  } as any);

  const wrapper = mount(AlertDetail, {
    global: {
      plugins: [i18n, store],
      stubs: {
        AlertGroupChart: { name: "AlertGroupChart", props: ["alert"], template: "<div/>" },
        AlertGroupsTable: true,
        AlertConfigSummary: ConfigSummaryStub,
      },
    },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 75));
  await flushPromises();
  return wrapper;
}

const openConfigTab = async (w: VueWrapper) => {
  (w.vm as any).activeTab = "configuration";
  await flushPromises();
};

describe("AlertDetail — SLO alerts", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    (store.state as any).zoConfig.slo_enabled = true;
    vi.mocked(sloService.get).mockResolvedValue({
      data: { id: "slo-123", name: "checkout-availability" },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    delete (store.state as any).zoConfig.slo_enabled;
  });

  // The chart plots a stream query. With no stream it renders an empty frame
  // that reads as "no data", which is a lie about an alert that is evaluating.
  it("hides the evaluation chart, which has no stream to plot", async () => {
    wrapper = await mountView(sloAlert());
    expect(wrapper.findComponent({ name: "AlertGroupChart" }).exists()).toBe(false);
  });

  it("keeps the evaluation chart for an ordinary alert", async () => {
    wrapper = await mountView(plainAlert());
    expect(wrapper.findComponent({ name: "AlertGroupChart" }).exists()).toBe(true);
  });

  // The alert GET carries slo_condition but not the SLO's name — one extra
  // fetch is what turns an opaque id into something a human recognises.
  it("fetches the SLO's name and hands it to the summary", async () => {
    wrapper = await mountView(sloAlert());
    await openConfigTab(wrapper);

    expect(sloService.get).toHaveBeenCalledWith(expect.anything(), "slo-123");
    expect(wrapper.findComponent(ConfigSummaryStub).props("sloName")).toBe("checkout-availability");
  });

  it("does not fetch an SLO for an ordinary alert", async () => {
    wrapper = await mountView(plainAlert());
    expect(sloService.get).not.toHaveBeenCalled();
  });

  // Flag-off degradation (plan §2.6): the SLO module is not served, so do not
  // call it; the summary falls back to the raw id on its own.
  it("does not fetch the SLO name when SLOs are disabled", async () => {
    (store.state as any).zoConfig.slo_enabled = false;
    wrapper = await mountView(sloAlert());

    // Anchor: the page really did load this alert, so "no fetch" is a decision
    // rather than the page never having got that far.
    expect(alertsService.get_by_alert_id).toHaveBeenCalled();
    expect(wrapper.find('[data-test="alerts-alertdetail-not-found"]').exists()).toBe(false);

    expect(sloService.get).not.toHaveBeenCalled();
    await openConfigTab(wrapper);
    expect(wrapper.findComponent(ConfigSummaryStub).props("sloName")).toBeFalsy();
  });

  // Contained, not merely "did not crash the assertion": vitest is configured
  // with dangerouslyIgnoreUnhandledErrors, so an uncaught rejection inside
  // onMounted would abort the rest of the mount chain silently. The transitions
  // fetch runs AFTER the SLO fetch, so it is the proof that the chain survived.
  it("contains a failing SLO fetch instead of aborting the page load", async () => {
    vi.mocked(sloService.get).mockRejectedValue(new Error("boom"));
    wrapper = await mountView(sloAlert());
    await openConfigTab(wrapper);

    expect(alertsService.list_group_transitions).toHaveBeenCalled();
    expect(wrapper.find('[data-test="alerts-alertdetail-not-found"]').exists()).toBe(false);
    expect(wrapper.findComponent(ConfigSummaryStub).exists()).toBe(true);
    expect(wrapper.findComponent(ConfigSummaryStub).props("sloName")).toBeFalsy();
  });

  // The OSS default is the flag being ABSENT, not false.
  it("treats an absent slo_enabled flag as off", async () => {
    delete (store.state as any).zoConfig.slo_enabled;
    wrapper = await mountView(sloAlert());

    expect(alertsService.get_by_alert_id).toHaveBeenCalled();
    expect(sloService.get).not.toHaveBeenCalled();
  });

  it("does not fetch when the alert names no SLO", async () => {
    wrapper = await mountView(sloAlert(null));

    expect(alertsService.get_by_alert_id).toHaveBeenCalled();
    expect(sloService.get).not.toHaveBeenCalled();
    // Still an SLO alert, so the chart still has no stream to plot.
    expect(wrapper.findComponent({ name: "AlertGroupChart" }).exists()).toBe(false);
  });

  // The subtitle is built from stream_name, which this family does not have —
  // it must say what the alert watches instead of rendering an empty strip.
  //
  // Asserted on the header's own prop rather than `wrapper.text()`: the page
  // renders the SLO name in more than one place (and the config-summary stub in
  // this file literally prints it), so a page-wide search proves nothing about
  // the subtitle.
  it("subtitles the page with the SLO rather than an absent stream", async () => {
    wrapper = await mountView(sloAlert());
    const layout = wrapper.findComponent({ name: "OPageLayout" });
    expect(layout.props("subtitle")).toContain("checkout-availability");
  });

  it("subtitles with the raw slo_id when the name did not resolve", async () => {
    vi.mocked(sloService.get).mockRejectedValue(new Error("boom"));
    wrapper = await mountView(sloAlert());
    const layout = wrapper.findComponent({ name: "OPageLayout" });
    expect(layout.props("subtitle")).toContain("slo-123");
  });

  // ── Edit diversion ───────────────────────────────────────────────────────
  //
  // `sloAlertEditRoute` returns null for TWO different situations, and this
  // page's edit button used to treat both as "carry on": a non-SLO alert, and
  // an SLO alert whose SLO cannot be resolved (`query_type = slo` with a NULL
  // `slo_condition` is representable in storage). Falling through on the second
  // opens the generic editor on an alert it cannot represent — saving from
  // there either fails forever or strips the SLO wiring. `AlertList` already
  // guards this with `isUnplaceableSloAlert`; this page must match.
  describe("edit diversion", () => {
    /** Only the ERROR toasts. A bare `not.toHaveBeenCalled()` proves nothing
     *  today (the page fires no toast at all) and would go red for an unrelated
     *  reason the moment it gains, say, a load-failure toast. */
    const errorToasts = () =>
      mockToast.mock.calls.map((c: any[]) => c[0]).filter((o: any) => o?.variant === "error");

    const clickEdit = async (w: VueWrapper) => {
      const btn = w.find('[data-test="alerts-alertdetail-edit"]');
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      await flushPromises();
    };

    it("diverts a resolvable SLO alert to its SLO page", async () => {
      wrapper = await mountView(sloAlert());
      await clickEdit(wrapper);

      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "sloDetail",
        params: { slo_id: "slo-123" },
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          edit_alert: "alert-1",
        },
      });
      expect(errorToasts()).toEqual([]);
    });

    it("refuses to open the generic editor for an unplaceable SLO alert", async () => {
      wrapper = await mountView(sloAlert(null));
      await clickEdit(wrapper);

      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: i18n.global.t("alerts.sloAlertUnplaceable"),
        }),
      );
    });

    // The guard must not be so wide that it swallows ordinary alerts: they
    // still belong in the generic editor.
    it("still sends an ordinary alert to the generic editor", async () => {
      wrapper = await mountView(plainAlert());
      await clickEdit(wrapper);

      expect(errorToasts()).toEqual([]);
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "alertList",
          query: expect.objectContaining({ action: "update", alert_id: "alert-1" }),
        }),
      );
    });

    // `slo_condition` present but carrying no `slo_id` is the same failure as a
    // NULL condition — the route would be `/slos/undefined`.
    it("treats a blank slo_id as unplaceable too", async () => {
      wrapper = await mountView(sloAlert({ slo_id: "" }));
      await clickEdit(wrapper);

      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: i18n.global.t("alerts.sloAlertUnplaceable"),
        }),
      );
    });
  });

  // The subtitle is shared. An SLO branch that returns early must not take the
  // stream and the group-by clause down with it.
  it("leaves an ordinary alert's subtitle alone", async () => {
    wrapper = await mountView({
      id: "alert-1",
      name: "cpu-per-host",
      stream_name: "default",
      query_condition: { type: "sql", aggregation: { group_by: ["host"] } },
    });

    const subtitle = wrapper.findComponent({ name: "OPageLayout" }).props("subtitle") as string;
    expect(subtitle).toContain("default");
    expect(subtitle).toContain("host");
  });
});
