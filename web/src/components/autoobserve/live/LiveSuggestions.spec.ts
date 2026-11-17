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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

// The decision route answers 404 while its switch is off; this spec pins today's routes.
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  const off = () =>
    Promise.reject(Object.assign(new Error("HTTP 404"), { response: { status: 404 } }));
  return { ...actual, default: { ...actual.default, list: vi.fn(off) } };
});
vi.mock("@/services/alert_calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/alert_calibration")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      dismissFinding: vi.fn(),
      reopenDismissal: vi.fn(),
      listDismissals: vi.fn(),
    },
  };
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/components/alert_calibration/alertEditorLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/alert_calibration/alertEditorLink")>()),
  alertFolderOf: vi.fn(),
}));
vi.mock("@/utils/alerts/alertPrefillStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/alerts/alertPrefillStorage")>()),
  writeAlertEditHandoff: vi.fn(),
}));

import config from "@/aws-exports";
import alertCalibration from "@/services/alert_calibration";
import { toast } from "@/lib/feedback/Toast/useToast";
import { queryClient } from "@/composables/query/queryClient";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import { alertCalibrationKeys } from "@/services/alert_calibration.querykeys";
import { alertFolderOf, editAlertRoute } from "@/components/alert_calibration/alertEditorLink";
import { writeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import { byTest } from "@/test/unit/helpers/draftDom";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { gt, raw } from "@/types/i18n";
import type { AutoObserveSuggestion } from "@/services/autoobserve";
import LiveSuggestions from "./LiveSuggestions.vue";
import { toRequests } from "./liveAdapter";
import type { RailSource } from "./liveModel";

const suggestion = (id: string, kind = "coverage_gap"): AutoObserveSuggestion => ({
  id,
  org: "acme",
  analyzer: "coverage",
  kind,
  subject: { kind: "service", key_dims: { service_name: id } },
  evidence: { service_name: id, severity: "medium", cells: {} },
  score: 1,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
});

const NOT_WORKING_ID = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";

const notWorking = (over: Partial<AutoObserveSuggestion> = {}): AutoObserveSuggestion => ({
  id: NOT_WORKING_ID,
  org: "default",
  analyzer: "alert_calibration",
  kind: "alert_not_working",
  subject: { kind: "alert", key_dims: { entity_id: "a2" } },
  evidence: {
    alert_name: "payments-latency",
    pattern: "field_missing",
    rule_id: "failure",
    finding_id: NOT_WORKING_ID,
    field: "duration_ms",
    evaluation_errors: 4,
    evaluations: 9,
    severity: "high",
    run_window_start: 1_762_000_000_000_000,
    run_window_end: 1_762_300_000_000_000,
  },
  score: null,
  confidence: "suggestive",
  status: "proposed",
  decided_score: null,
  on_accept: null,
  tier: "A",
  advice: "check_missing_field",
  limitations: [],
  actions: [{ type: "review_alert", alert_id: "a2", focus: "query" }],
  ...over,
});

const rail = (count: number, total: number, over: Partial<RailSource> = {}): RailSource => ({
  status: "ready",
  retry: () => undefined,
  busy: false,
  failure: null,
  detail: raw(""),
  stale: null,
  requests: toRequests(
    gt,
    { locale: "en-US", timeZone: "UTC" },
    // Odd ones are another kind, so six or more never fold into the one coverage gap card.
    Array.from({ length: count }, (_, i) =>
      suggestion(`svc${i}`, i % 2 ? "no_absence_check" : "coverage_gap"),
    ),
  ),
  total,
  ...over,
});

const mountRail = (source: RailSource, skeleton = false) =>
  mount(LiveSuggestions, {
    props: { rail: source, skeleton },
    global: { plugins: [i18n, store, router] },
  });

const cards = (wrapper: ReturnType<typeof mountRail>) =>
  wrapper.findAll('[data-test^="insight-block-"][data-test$="-headline"]');

const countChip = (wrapper: ReturnType<typeof mountRail>) => {
  const chip = wrapper.find("header > span");
  return chip.exists() ? chip.text() : null;
};

const SUBTITLE = '[data-test="autoobserve2-suggestions-subtitle"]';

describe("LiveSuggestions rail (OSS-11, OSS-9)", () => {
  it("shows the top five, the server total, 'and N more' and 'See all N'", () => {
    const wrapper = mountRail(rail(8, 12));
    expect(cards(wrapper)).toHaveLength(5);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-more"]').text()).toBe("and 7 more");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-see-all"]').text()).toBe("See all");
    expect(countChip(wrapper)).toBe("12");
  });

  it("has no footer when every suggestion fits", () => {
    const wrapper = mountRail(rail(1, 1));
    expect(cards(wrapper)).toHaveLength(1);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-more"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-see-all"]').exists()).toBe(false);
  });

  it("keeps its card with no suggestions and says so", () => {
    const wrapper = mountRail(rail(0, 0));
    expect(wrapper.find('[data-test="autoobserve2-suggestions"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-empty"]').text()).toContain(
      "No suggestions right now",
    );
  });

  it("shows a red, retryable failure instead of vanishing", () => {
    const wrapper = mountRail(rail(0, 0, { status: "error", failure: "failed" }));
    const error = wrapper.find('[data-test="autoobserve2-suggestions-error"]');
    expect(error.attributes("role")).toBe("alert");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-retry"]').exists()).toBe(true);
  });

  it("keeps the cards under a red line when a refresh fails", () => {
    const wrapper = mountRail(
      rail(3, 3, { failure: "failed", stale: { failedAt: 2_000, dataAt: 1_000 } }),
    );
    expect(cards(wrapper)).toHaveLength(3);
    const line = wrapper.find('[data-test="autoobserve2-suggestions-refresh-failed"]');
    expect(line.attributes("role")).toBe("alert");
    expect(line.text()).toContain("Refresh failed at");
  });

  it("shows the skeleton, not the cards, while it is held", () => {
    const wrapper = mountRail(rail(3, 3), true);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-skeleton"]').exists()).toBe(true);
    expect(cards(wrapper)).toHaveLength(0);
  });

  it("keeps the subtitle from loading through the hold to the cards", async () => {
    const wrapper = mountRail(rail(0, 0, { status: "loading" }), true);
    expect(wrapper.find(SUBTITLE).exists()).toBe(true);
    await wrapper.setProps({ rail: rail(3, 3), skeleton: true });
    expect(wrapper.find(SUBTITLE).exists()).toBe(true);
    await wrapper.setProps({ skeleton: false });
    expect(wrapper.find(SUBTITLE).exists()).toBe(true);
    expect(countChip(wrapper)).toBe("3");
  });

  it("gives a failed load a red icon and the raw cause behind Details", async () => {
    const wrapper = mountRail(
      rail(0, 0, { status: "error", failure: "failed", detail: raw("upstream timed out") }),
    );
    const error = wrapper.find('[data-test="autoobserve2-suggestions-error"]');
    expect(error.find(".o2-empty-state__inline-icon").classes()).toContain("bg-status-error-bg");
    const details = wrapper.find('[data-test="autoobserve2-suggestions-error-details"]');
    expect(details.exists()).toBe(true);
    expect(wrapper.text()).not.toContain("upstream timed out");
    await details.trigger("click");
    expect(wrapper.text()).toContain("upstream timed out");
  });

  it("shows the refresh failure over an empty list too", () => {
    const wrapper = mountRail(
      rail(0, 0, { failure: "failed", stale: { failedAt: 2_000, dataAt: 1_000 } }),
    );
    expect(wrapper.find('[data-test="autoobserve2-suggestions-refresh-failed"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="autoobserve2-suggestions-empty"]').exists()).toBe(true);
  });

  it("shows that a retry is running", () => {
    const failed = mountRail(rail(0, 0, { status: "error", failure: "failed", busy: true }));
    expect(
      failed.find('[data-test="autoobserve2-suggestions-retry"]').attributes("aria-busy"),
    ).toBe("true");
    const stale = mountRail(
      rail(2, 2, { failure: "failed", busy: true, stale: { failedAt: 2_000, dataAt: 1_000 } }),
    );
    expect(
      stale
        .find('[data-test="autoobserve2-suggestions-refresh-failed-retry"]')
        .attributes("aria-busy"),
    ).toBe("true");
  });

  it("announces loading while the skeleton shows and loaded once the cards land", async () => {
    const announce = (w: ReturnType<typeof mountRail>) =>
      w.find('[data-test="autoobserve2-suggestions-announce"]');
    const wrapper = mountRail(rail(0, 0, { status: "loading" }), true);
    expect(announce(wrapper).attributes("role")).toBe("status");
    expect(announce(wrapper).text()).toBe("Loading suggestions");
    await wrapper.setProps({ rail: rail(2, 2), skeleton: false });
    expect(announce(wrapper).text()).toBe("Suggestions loaded");
  });
});

describe("LiveSuggestions rail when decisions empty the first page", () => {
  it("keeps See all from the server total, and never says there are no suggestions", () => {
    const wrapper = mountRail(rail(0, 12));
    expect(cards(wrapper)).toHaveLength(0);
    const seeAll = wrapper.find('[data-test="autoobserve2-suggestions-see-all"]');
    expect(seeAll.exists()).toBe(true);
    expect(seeAll.text()).toBe("See all");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-more"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-page-empty"]').text()).toContain(
      "The top suggestions were already handled",
    );
    expect(countChip(wrapper)).toBe("12");
  });

  it("keeps See all when the page holds fewer cards than the total", () => {
    const wrapper = mountRail(rail(2, 12));
    expect(cards(wrapper)).toHaveLength(2);
    expect(wrapper.find('[data-test="autoobserve2-suggestions-more"]').text()).toBe("and 10 more");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-see-all"]').exists()).toBe(true);
  });
});

describe("LiveSuggestions rail: a monitor that notifies no one (demo bug 4)", () => {
  const silent: AutoObserveSuggestion = {
    ...suggestion("s-silent"),
    kind: "silent_coverage",
    subject: { kind: "alert", key_dims: { entity_id: "a1" } },
    evidence: {
      monitor_name: "svc-y-errors",
      classes: ["errors"],
      services: ["svc-y"],
      service_count: 1,
      undeliverable: ["ops-pager"],
      undeliverable_count: 1,
    },
  };

  it("draws the card amber and says why and what next", () => {
    const wrapper = mountRail(
      rail(0, 1, {
        requests: toRequests(gt, { locale: "en-US", timeZone: "UTC" }, [silent]),
      }),
    );
    const card = wrapper.get('[data-test="insight-block-s-silent"]');
    expect(card.find("article > span").classes()).toContain("bg-badge-amber-soft-text");
    expect(card.find("article > span").classes()).not.toContain("bg-status-error-text");
    expect(card.text()).toContain("Notifies no one");
    expect(card.text()).toContain("svc-y-errors can't reach ops-pager");
    expect(card.text()).toContain(
      "ops-pager takes tickets, not alerts. Add a webhook or email next to it; ops-pager stays.",
    );
  });
});

describe("LiveSuggestions rail: one card shape for 0, 1, a few and many (test 16)", () => {
  it("shows three cards with no footer, and seven as five plus 'and 2 more · See all 7'", () => {
    const three = mountRail(rail(3, 3));
    expect(cards(three)).toHaveLength(3);
    expect(three.find('[data-test="autoobserve2-suggestions-see-all"]').exists()).toBe(false);
    const seven = mountRail(rail(7, 7));
    expect(cards(seven)).toHaveLength(5);
    expect(seven.find('[data-test="autoobserve2-suggestions-more"]').text()).toBe("and 2 more");
    expect(seven.find('[data-test="autoobserve2-suggestions-see-all"]').text()).toBe("See all");
  });

  it("folds seven coverage gaps into one card that counts them all, with no 'and N more'", () => {
    const seven = mountRail({
      ...rail(0, 7),
      requests: toRequests(
        gt,
        { locale: "en-US", timeZone: "UTC" },
        Array.from({ length: 7 }, (_, i) => suggestion(`svc${i}`)),
      ),
    });
    expect(cards(seven).map((c) => c.text())).toEqual(["Nothing watches 7 services"]);
    expect(seven.find('[data-test="autoobserve2-suggestions-more"]').exists()).toBe(false);
  });

  it("keeps the CTA bar in the skeleton, so the cards land without a shift", () => {
    const wrapper = mountRail(rail(0, 0, { status: "loading" }), true);
    const card = wrapper.get('[data-test="autoobserve2-suggestions-skeleton"] li');
    expect(card.find(".min-h-8").exists()).toBe(true);
  });
});

describe("LiveSuggestions rail: a Not working alert acts (tests 10-14)", () => {
  const block = (part: string) => `[data-test="insight-block-${NOT_WORKING_ID}-${part}"]`;
  const VIEW = {
    id: "d1",
    rule_id: "failure",
    pattern: "field_missing",
    scope_kind: "alert",
    scope_key: "a2",
    state: "active",
    revision: 3,
    reason: "known_issue",
    note: null,
    has_note: false,
    actor: "u-ops@example.com",
    dismissed_at: 1,
    duration_days: 30,
    expires_at: new Date(2026, 11, 6).getTime() * 1000,
    reopened_at: null,
    reopened_by: null,
    updated_at: 1,
    alert_name: "payments-latency",
  };
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPromises();
    }
  };
  const click = async (selector: string) => {
    const el = document.body.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`missing ${selector}`);
    el.click();
    await settle();
  };
  let enterprise: string;
  let wrapper: ReturnType<typeof mountRail> | null = null;
  const mountItems = (items: AutoObserveSuggestion[]) => {
    wrapper = mount(LiveSuggestions, {
      props: {
        rail: rail(0, items.length, {
          requests: toRequests(gt, { locale: "en-US", timeZone: "UTC" }, items),
        }),
        skeleton: false,
      },
      attachTo: document.body,
      global: { plugins: [i18n, store, router] },
    });
    return wrapper;
  };
  const dismissFromRail = async () => {
    const rail = mountItems([notWorking()]);
    await rail.get(block("details-toggle")).trigger("click");
    await rail.get(block("dismiss")).trigger("click");
    await settle();
    expect(byTest("alert-calibration-dismiss-dialog")?.textContent).toContain("payments-latency");
    await click('[data-test="alert-calibration-dismiss-reason-known_issue"]');
    await click('[data-test="alert-calibration-dismiss-duration-option"][data-test-value="30"]');
    await click('[data-test="alert-calibration-dismiss-submit"]');
    return rail;
  };

  beforeEach(() => {
    enterprise = config.isEnterprise;
    config.isEnterprise = "true";
    queryClient.clear();
    vi.mocked(toast).mockReset();
    vi.mocked(alertFolderOf).mockReset();
    vi.mocked(writeAlertEditHandoff).mockReset();
    vi.mocked(alertCalibration.dismissFinding).mockReset();
    vi.mocked(alertCalibration.reopenDismissal).mockReset();
    vi.mocked(alertCalibration.listDismissals).mockResolvedValue({
      data: { items: [], next_cursor: null, total: 0 },
    } as never);
  });

  afterEach(() => {
    config.isEnterprise = enterprise;
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  it("draws Not working red with its why, and keeps Details closed at first paint", () => {
    const card = mountItems([notWorking()]);
    expect(card.get(block("chip")).text()).toBe("Not working");
    expect(card.find("article > span").classes()).toContain("bg-status-error-text");
    expect(card.get(block("why")).text()).toBe(
      "4 of 9 runs failed in the last calibration window.",
    );
    expect(card.find(block("details")).exists()).toBe(false);
    expect(card.text()).not.toContain("High");
  });

  it("Review query reads the folder first, then opens the editor at the query (test 10, M-F)", async () => {
    let answer: (folder: string | undefined) => void = () => undefined;
    vi.mocked(alertFolderOf).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    const card = mountItems([notWorking()]);
    const cta = card.get(block("cta"));
    expect(cta.text()).toBe("Review alert");
    await cta.trigger("click");
    expect(alertFolderOf).toHaveBeenCalledWith("default", "a2", "payments-latency");
    expect(cta.attributes("aria-busy")).toBe("true");
    expect(writeAlertEditHandoff).not.toHaveBeenCalled();
    answer("ops");
    await flushPromises();
    expect(writeAlertEditHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "calibration",
        target: { alertId: "a2", findingId: NOT_WORKING_ID },
        focus: "query",
      }),
    );
    expect(push).toHaveBeenCalledWith(editAlertRoute("default", "a2", "ops"));
    expect(cta.attributes("aria-busy")).not.toBe("true");
  });

  it("dismisses from Details once, refreshes the rail and toasts with Undo (test 11, M-I)", async () => {
    vi.mocked(alertCalibration.dismissFinding).mockResolvedValue({ data: VIEW } as never);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await dismissFromRail();
    expect(alertCalibration.dismissFinding).toHaveBeenCalledTimes(1);
    expect(vi.mocked(alertCalibration.dismissFinding).mock.calls[0]).toEqual([
      "default",
      NOT_WORKING_ID,
      {
        rule_id: "failure",
        pattern: "field_missing",
        scope_kind: "alert",
        scope_key: "a2",
        reason: "known_issue",
        duration_days: 30,
      },
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: autoobserveKeys.suggestions("default") });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: alertCalibrationKeys.dismissals("default"),
    });
    expect(toast).toHaveBeenCalledWith({
      message: "Dismissed until Dec 6, 2026: payments-latency.",
      variant: "success",
      action: { label: "Undo", handler: expect.any(Function) },
    });
  });

  it("Undo reopens the dismissal it made and refreshes both surfaces (test 12, M-R)", async () => {
    vi.mocked(alertCalibration.dismissFinding).mockResolvedValue({ data: VIEW } as never);
    vi.mocked(alertCalibration.reopenDismissal).mockResolvedValue({
      data: { ...VIEW, state: "reopened", revision: 4 },
    } as never);
    await dismissFromRail();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const [{ action }] = vi.mocked(toast).mock.calls[0] as unknown as [
      { action: { handler: () => void } },
    ];
    action.handler();
    await settle();
    expect(alertCalibration.reopenDismissal).toHaveBeenCalledWith("default", "d1", 3);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: autoobserveKeys.suggestions("default") });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: alertCalibrationKeys.dismissals("default"),
    });
  });

  it("shows a refused dismissal in red in the dialog and keeps the card (test 13)", async () => {
    vi.mocked(alertCalibration.dismissFinding).mockRejectedValue(
      Object.assign(new Error("HTTP 403"), { response: { status: 403, data: {} } }),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const card = await dismissFromRail();
    const notice = byTest("alert-calibration-dismiss-notice");
    expect(notice?.getAttribute("data-severity")).toBe("error");
    expect(notice?.textContent).toContain("You don't have permission to dismiss findings.");
    expect(toast).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: autoobserveKeys.suggestions("default"),
    });
    expect(card.find(block("cta")).exists()).toBe(true);
  });

  it("gives an AutoObserve alert row the CTA and no Dismiss… (test 14, M-D)", async () => {
    const card = mountItems([
      {
        ...suggestion("blind-a7"),
        kind: "blind_guardrail",
        subject: { kind: "alert", key_dims: { entity_id: "a7" } },
        evidence: {
          monitor_name: "checkout-errors",
          reason: { stream_missing: null },
          detail: "logs/checkout",
        },
        actions: [{ type: "review_alert", alert_id: "a7", focus: "query" }],
      },
    ]);
    expect(card.get('[data-test="insight-block-blind-a7-cta"]').text()).toBe("Review alert");
    await card.get('[data-test="insight-block-blind-a7-details-toggle"]').trigger("click");
    expect(card.find('[data-test="insight-block-blind-a7-dismiss"]').exists()).toBe(false);
  });

  it("offers no button in the open-source build", () => {
    config.isEnterprise = "false";
    const card = mountItems([notWorking()]);
    expect(card.find(block("cta")).exists()).toBe(false);
    expect(card.get(block("why")).text()).toContain("4 of 9 runs failed");
  });
});
