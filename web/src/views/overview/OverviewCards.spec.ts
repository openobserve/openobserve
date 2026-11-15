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
import { mount } from "@vue/test-utils";
import config from "@/aws-exports";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import OverviewLimitCard from "./OverviewLimitCard.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import OverviewSignalCards from "./OverviewSignalCards.vue";
import OverviewTopStreamsCard from "./OverviewTopStreamsCard.vue";
import { buildOverview } from "./overviewFixtures";
import type {
  OverviewLimitsData,
  OverviewSection,
  OverviewStreamsData,
} from "@/ts/interfaces/overview";

const global = { plugins: [i18n, store] };
const base = { pending: false, failed: false };
const o = buildOverview();
const NOW_MS = Math.floor(o.generated_at / 1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

const okSection = <T>(data: T): OverviewSection<T> => ({ status: "ok", data });
const streamsWith = (over: Partial<OverviewStreamsData>) =>
  okSection({ ...o.streams.data!, ...over });
const limitsWith = (over: Partial<OverviewLimitsData>) => okSection({ ...o.limits.data!, ...over });

const stateSections: Array<[string, OverviewSection<never>, string]> = [
  ["error", { status: "error", error: "secret internal failure" }, "error"],
  ["forbidden", { status: "forbidden", reason: "secret internal reason" }, "forbidden"],
  ["locked", { status: "locked", reason: "secret internal reason" }, "locked"],
];

describe("OverviewSectionCard", () => {
  it("sits on the page surface with a 14 px heading and its subtitle on one line", () => {
    const w = mount(OverviewSectionCard, {
      props: {
        section: "x",
        title: raw("X"),
        subtitle: raw("Sub"),
        view: "ok",
        linkLabel: raw("Open"),
      },
      global,
    });
    const classes = w.get('[data-test="overview-x-card"]').classes();
    for (const box of ["border", "rounded-surface", "bg-surface-panel"])
      expect(classes).not.toContain(box);
    const title = w.get("h2");
    expect(title.text()).toBe("X");
    expect(title.classes()).toEqual(expect.arrayContaining(["text-sm", "font-semibold"]));
    const sub = w.get('[data-test="overview-x-subtitle"]');
    expect(sub.text()).toBe("Sub");
    expect(sub.classes()).toContain("text-text-secondary");
  });

  it("shows the empty message under the heading and keeps the header action", () => {
    const w = mount(OverviewSectionCard, {
      props: { section: "x", title: raw("X"), view: "empty", linkLabel: raw("Add") },
      slots: { empty: '<p data-test="empty-slot">none</p>' },
      global,
    });
    expect(w.get('[data-test="empty-slot"]').text()).toBe("none");
    expect(w.get('[data-test="overview-x-view-all"]').text()).toBe("Add");
    expect(w.find('[data-test="overview-x-subtitle"]').exists()).toBe(false);
  });

  it("hides the header action while loading or failed", () => {
    for (const view of ["loading", "error"] as const) {
      const w = mount(OverviewSectionCard, {
        props: { section: "x", title: raw("X"), view, linkLabel: raw("Add") },
        global,
      });
      expect(w.find('[data-test="overview-x-view-all"]').exists()).toBe(false);
    }
  });

  it("falls back to a generic locked message when none is passed", async () => {
    const w = mount(OverviewSectionCard, {
      props: { section: "x", title: raw("X"), view: "locked" },
      global,
    });
    const locked = w.get('[data-test="overview-x-locked"]');
    expect(locked.text()).toBe("Available with an enterprise license");
    await locked.trigger("click");
    expect(w.emitted("unlock")).toHaveLength(1);
  });

  it("renders a plain notice, not a button, when unlock is not available", async () => {
    const w = mount(OverviewSectionCard, {
      props: { section: "x", title: raw("X"), view: "locked", canUnlock: false },
      global,
    });
    const locked = w.get('[data-test="overview-x-locked"]');
    expect(locked.element.tagName).not.toBe("BUTTON");
    expect(w.find("button").exists()).toBe(false);
    await locked.trigger("click");
    expect(w.emitted("unlock")).toBeUndefined();
  });
});

describe("forbidden copy", () => {
  it("asks for plain access when only one section was refused", () => {
    const w = mount(OverviewTopStreamsCard, {
      props: { ...base, section: { status: "forbidden" } as never },
      global,
    });
    const text = w.get('[data-test="overview-streams-forbidden"]').text();
    expect(text).toContain("Ask an org admin for access.");
    expect(text).not.toContain("Summary");
  });
});

describe("forbidden request", () => {
  it.each([
    ["streams", OverviewTopStreamsCard],
    ["limit", OverviewLimitCard],
  ])("shows %s as no access without Retry", (name, comp) => {
    const w = mount(comp as never, {
      props: { pending: false, failed: false, forbidden: true },
      global,
    });
    expect(w.find(`[data-test="overview-${name}-forbidden"]`).exists()).toBe(true);
    expect(w.find(`[data-test="overview-${name}-retry-btn"]`).exists()).toBe(false);
  });
});

describe("OverviewTopStreamsCard", () => {
  const mountTop = (props: Record<string, unknown> = {}) =>
    mount(OverviewTopStreamsCard, { props: { ...base, section: o.streams, ...props }, global });
  const rowKeys = (w: ReturnType<typeof mountTop>) =>
    w
      .findAll('[data-test^="overview-streams-top-"]')
      .map((r) => r.attributes("data-test")!)
      .filter((id) => !/-(share|bar|size)-/.test(id) && id !== "overview-streams-top");

  it("keeps each stream on one row with its type and share beside the name", () => {
    const w = mountTop();
    const share = w.get('[data-test="overview-streams-top-share-logs-app_logs"]');
    expect(
      share.element.closest('[data-test="overview-streams-top-logs-app_logs"]'),
    ).not.toBeNull();
    expect(share.element.parentElement!.classList.contains("items-baseline")).toBe(true);
  });

  it("is titled by data size, says whose streams, and links to all streams", () => {
    const w = mountTop();
    expect(w.get("h2").text()).toBe("Top streams by data size");
    expect(w.get('[data-test="overview-streams-subtitle"]').text()).toBe(
      "Largest streams you can access",
    );
    expect(w.get('[data-test="overview-streams-view-all"]').text()).toBe("All streams");
  });

  it("lists the largest streams of every type first, with type, share, bar and size", () => {
    const w = mountTop();
    expect(rowKeys(w)).toEqual([
      "overview-streams-top-logs-app_logs",
      "overview-streams-top-metrics-cpu_usage",
      "overview-streams-top-logs-web_logs",
    ]);
    const share = (id: string) => w.get(`[data-test="overview-streams-top-share-${id}"]`).text();
    expect(share("logs-app_logs")).toBe("Logs · 50% of total");
    expect(share("metrics-cpu_usage")).toBe("Metrics · 25% of total");
    expect(share("logs-web_logs")).toBe("Logs · 20% of total");
    expect(w.get('[data-test="overview-streams-top-size-logs-app_logs"]').text()).toBe("1.00 GB");
  });

  it("scales each bar to the largest stream and paints it with the signal colour", () => {
    const w = mountTop();
    const segment = (id: string) =>
      w.get(
        `[data-test="overview-streams-top-bar-${id}"] [data-test="o-segmented-bar-segment-share"]`,
      );
    expect(segment("logs-app_logs").attributes("style")).toContain("width: 100%");
    expect(segment("metrics-cpu_usage").attributes("style")).toContain("width: 50%");
    expect(segment("logs-app_logs").classes()).toContain("bg-signal-logs");
    expect(w.get('[data-test="overview-streams-top-bar-logs-app_logs"]').classes()).toEqual(
      expect.arrayContaining(["h-2.5", "bg-border-default"]),
    );
    expect(w.get('[data-test="overview-streams-top-size-logs-app_logs"]').classes()).toEqual(
      expect.arrayContaining([
        "text-text-heading",
        "text-compact",
        "font-semibold",
        "tabular-nums",
      ]),
    );
    expect(segment("metrics-cpu_usage").classes()).toContain("bg-signal-metrics");
  });

  it("caps the list at six streams", () => {
    const top = Array.from({ length: 8 }, (_, i) => ({
      name: `s${i}`,
      doc_num: 1,
      storage_size_mb: 100 - i,
    }));
    const byType = [{ ...o.streams.data!.by_type[0], top }];
    expect(rowKeys(mountTop({ section: streamsWith({ by_type: byType }) }))).toHaveLength(6);
  });

  it("says under 1% instead of 0% for a tiny share, and never NaN for an empty total", () => {
    const tiny = mountTop({ section: streamsWith({ total_storage_size_mb: 1_000_000 }) });
    expect(tiny.get('[data-test="overview-streams-top-share-logs-web_logs"]').text()).toBe(
      "Logs · Under 1% of total",
    );
    const zero = mountTop({ section: streamsWith({ total_storage_size_mb: 0 }) });
    expect(zero.text()).toContain("0% of total");
    expect(zero.text()).not.toContain("NaN");
  });

  it("emits open from a stream row", async () => {
    const w = mountTop();
    await w.get('[data-test="overview-streams-top-logs-app_logs"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("shows a one-line empty state and puts Start ingesting in the header for zero streams", async () => {
    const section = streamsWith({ total_streams: 0, total_storage_size_mb: 0, by_type: [] });
    const w = mountTop({ section });
    expect(w.get('[data-test="overview-streams-empty"]').text()).toContain("No streams yet");
    const action = w.get('[data-test="overview-streams-view-all"]');
    expect(action.text()).toBe("Start ingesting");
    await action.trigger("click");
    expect(w.emitted("startIngesting")).toHaveLength(1);
    expect(w.emitted("open")).toBeUndefined();
  });

  it.each(stateSections)("renders %s without the API text", (_n, section, suffix) => {
    const w = mountTop({ section: section as never });
    expect(w.find(`[data-test="overview-streams-${suffix}"]`).exists()).toBe(true);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows a skeleton while loading", () => {
    const w = mount(OverviewTopStreamsCard, { props: { pending: true, failed: false }, global });
    expect(w.find('[data-test="overview-streams-loading"]').exists()).toBe(true);
  });
});

describe("OverviewLimitCard", () => {
  const mountLimit = (
    limits: OverviewSection<OverviewLimitsData> | undefined = o.limits,
    streams: OverviewSection<OverviewStreamsData> | undefined = o.streams,
  ) => mount(OverviewLimitCard, { props: { ...base, limits, streams }, global });

  it("titles the card by limit and storage and explains the UTC day", () => {
    const w = mountLimit();
    expect(w.get("h2").text()).toBe("Ingest limit and storage");
    expect(w.get('[data-test="overview-limit-subtitle"]').text()).toBe(
      "Daily limit counts the UTC day, not a rolling 24h",
    );
  });

  it("shows used of limit with a bar and the reset countdown", () => {
    const w = mountLimit();
    const usage = w.get('[data-test="overview-limit-usage"]');
    expect(usage.get(".font-semibold").text()).toBe("85.50 GB");
    expect(usage.get(".text-text-secondary").text()).toBe("of 100.00 GB");
    const bar = w.get('[data-test="overview-limit-bar"]');
    expect(bar.attributes("role")).toBe("progressbar");
    expect(bar.find(".bg-progress-bar-warning").exists()).toBe(true);
    expect(w.get('[data-test="overview-limit-resets"]').text()).toBe(
      "Resets at 00:00 UTC, in 1h 46m",
    );
  });

  it.each([
    [50, "bg-progress-bar-default", null],
    [75, "bg-progress-bar-warning", "Approaching limit"],
    [100, "bg-progress-bar-danger", "Over limit"],
  ])("colours %s percent by the named thresholds and says it in words", (percent, fill, label) => {
    const w = mountLimit(limitsWith({ ingestion_used_percent: percent }));
    expect(w.get('[data-test="overview-limit-bar"]').find(`.${fill}`).exists()).toBe(true);
    const tag = w.find('[data-test="overview-limit-status"]');
    if (label) expect(tag.text()).toBe(label);
    else expect(tag.exists()).toBe(false);
  });

  it("states the days over the limit with the real allowed count, without a box", () => {
    const w = mountLimit();
    const days = w.get('[data-test="overview-limit-days-box"]');
    expect(days.classes()).not.toContain("border");
    expect(days.text()).toContain("Days over limit this month");
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("1 of 3 allowed");
    expect(w.get('[data-test="overview-limit-block-note"]').text()).toBe(
      "Search is blocked after more than 3 days over the limit",
    );
    const one = mountLimit(limitsWith({ allowed_days: 1 }));
    expect(one.get('[data-test="overview-limit-block-note"]').text()).toBe(
      "Search is blocked after more than 1 day over the limit",
    );
  });

  it.each([
    [0, 3, "text-text-heading"],
    [3, 3, "text-status-warning-text"],
    [4, 3, "text-status-negative"],
  ])("tones %s days over of %s allowed with %s", (days, allowed, tone) => {
    const w = mountLimit(limitsWith({ days_over_limit: days, allowed_days: allowed }));
    expect(w.get('[data-test="overview-limit-days-over"]').classes()).toContain(tone);
  });

  it("shows only the day count and no block note when the allowed days are unknown", () => {
    const w = mountLimit(limitsWith({ allowed_days: null, days_over_limit: 2 }));
    expect(w.get('[data-test="overview-limit-days-over"]').text()).toBe("2");
    expect(w.find('[data-test="overview-limit-block-note"]').exists()).toBe(false);
  });

  it("says of unlimited without a bar when the daily limit is unlimited", () => {
    const w = mountLimit(limitsWith({ limit_today_gb: null }));
    expect(w.get('[data-test="overview-limit-usage"]').text()).toBe("85.50 GBof unlimited");
    expect(w.find('[data-test="overview-limit-bar"]').exists()).toBe(false);
  });

  it("falls back to the percent when today's usage is unknown", () => {
    expect(
      mountLimit(limitsWith({ used_today_gb: null }))
        .get('[data-test="overview-limit-usage"]')
        .text(),
    ).toBe("85.5%");
  });

  it("counts down to zero minutes when the reset time already passed", () => {
    const w = mountLimit(limitsWith({ resets_at: o.generated_at - 5_000_000 }));
    expect(w.get('[data-test="overview-limit-resets"]').text()).toBe("Resets at 00:00 UTC, in 0m");
  });

  it("shows a license line only when the license expired", () => {
    expect(mountLimit().find('[data-test="overview-limit-expired"]').exists()).toBe(false);
    const w = mountLimit(limitsWith({ expired: true }));
    const line = w.get('[data-test="overview-limit-expired"]');
    expect(line.text()).toBe("License expired");
    expect(line.classes()).toContain("text-status-negative");
  });

  it("shows the data size under a divider with the signal split spread under one bar", () => {
    const w = mountLimit();
    const html = w.html();
    expect(html.indexOf("overview-limit-body")).toBeLessThan(html.indexOf('role="separator"'));
    expect(html.indexOf('role="separator"')).toBeLessThan(html.indexOf("overview-storage-body"));
    expect(w.get('[data-test="overview-storage-total"]').text()).toBe("2.00 GB");
    expect(w.get('[data-test="overview-storage-body"]').text()).toContain(
      "Uncompressed size across logs, metrics and traces",
    );
    const bar = w.get('[data-test="overview-storage-bar"]');
    expect(bar.attributes("aria-label")).toBe("Data size by signal");
    expect(bar.get('[data-test="o-segmented-bar-segment-logs"]').classes()).toContain(
      "bg-signal-logs",
    );
    expect(bar.find('[data-test="o-segmented-bar-segment-traces"]').exists()).toBe(false);
    expect(w.get('[data-test="overview-storage-legend"]').classes()).toContain("justify-between");
    expect(w.get('[data-test="overview-storage-legend-logs"]').text()).toBe("Logs 75%");
    expect(w.get('[data-test="overview-storage-legend-metrics"]').text()).toBe("Metrics 25%");
    expect(w.get('[data-test="overview-storage-legend-traces"]').text()).toBe("Traces 0%");
  });

  it("leaves enrichment streams out of the data size", () => {
    const byType = [
      ...o.streams.data!.by_type,
      {
        stream_type: "enrichment_tables",
        count: 1,
        doc_num: 1,
        storage_size_mb: 100000,
        compressed_size_mb: 1,
        top: [],
      },
    ];
    const w = mountLimit(o.limits, streamsWith({ by_type: byType }));
    expect(w.get('[data-test="overview-storage-total"]').text()).toBe("2.00 GB");
    expect(w.get('[data-test="overview-storage-legend-logs"]').text()).toBe("Logs 75%");
  });

  it("says no data yet, without a bar, when nothing is stored", () => {
    const w = mountLimit(o.limits, streamsWith({ by_type: [] }));
    expect(w.get('[data-test="overview-storage-empty"]').text()).toBe("No data yet");
    expect(w.find('[data-test="overview-storage-bar"]').exists()).toBe(false);
  });

  it("shows only the data size, titled data size, when the limit is locked", () => {
    const w = mountLimit({ status: "locked", reason: "secret internal reason" });
    expect(w.find('[data-test="overview-storage-card"]').exists()).toBe(true);
    expect(w.get("h2").text()).toBe("Data size");
    expect(w.find('[data-test="overview-storage-subtitle"]').exists()).toBe(false);
    expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(false);
    expect(w.find('[role="separator"]').exists()).toBe(false);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows only the data size on cloud", () => {
    const original = config.isCloud;
    config.isCloud = "true";
    try {
      const w = mountLimit();
      expect(w.get("h2").text()).toBe("Data size");
      expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(false);
      expect(w.get('[data-test="overview-storage-total"]').text()).toBe("2.00 GB");
    } finally {
      config.isCloud = original;
    }
  });

  it.each(stateSections.filter(([n]) => n !== "locked"))(
    "says the limit is unavailable on %s and keeps the data size",
    (_n, section) => {
      const w = mountLimit(section as never);
      expect(w.get('[data-test="overview-limit-unavailable"]').text()).toBe(
        "Ingest limit unavailable",
      );
      expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(false);
      expect(w.find('[data-test="overview-storage-body"]').exists()).toBe(true);
      expect(w.text()).not.toContain("secret internal");
    },
  );

  it("keeps the limit when only the streams section failed, with retry on the data size", async () => {
    const w = mountLimit(o.limits, { status: "error", error: "secret internal failure" } as never);
    expect(w.find('[data-test="overview-limit-body"]').exists()).toBe(true);
    await w.get('[data-test="overview-storage-retry-btn"]').trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
    expect(w.text()).not.toContain("secret internal");
  });

  it("shows one loading and one error state for the whole card", async () => {
    const loading = mount(OverviewLimitCard, { props: { pending: true, failed: false }, global });
    expect(loading.findAll('[data-test$="-loading"]')).toHaveLength(1);
    const failed = mount(OverviewLimitCard, { props: { pending: false, failed: true }, global });
    expect(failed.findAll('[data-test$="-retry-btn"]')).toHaveLength(1);
    await failed.get('[data-test="overview-limit-retry-btn"]').trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });
});

describe("OverviewSignalCards", () => {
  const mountSignals = (props: Record<string, unknown> = {}) =>
    mount(OverviewSignalCards, { props: { ...base, section: o.streams, ...props }, global });

  it("always shows logs, metrics and traces as three aligned columns", () => {
    const w = mountSignals();
    expect(w.get('[data-test="overview-signal-cards"]').classes()).toEqual(
      expect.arrayContaining(["grid-cols-3", "gap-x-8"]),
    );
    expect(w.findAll('[data-test$="-card"]').map((c) => c.attributes("data-test"))).toEqual([
      "overview-signal-logs-card",
      "overview-signal-metrics-card",
      "overview-signal-traces-card",
    ]);
  });

  it("heads each card with its signal colour and name", () => {
    const w = mountSignals();
    expect(w.get('[data-test="overview-signal-logs-swatch"]').classes()).toContain(
      "bg-signal-logs",
    );
    expect(w.get('[data-test="overview-signal-traces-swatch"]').classes()).toContain(
      "bg-signal-traces",
    );
    expect(w.get('[data-test="overview-signal-metrics-card"] h2').text()).toBe("Metrics");
  });

  it("lists streams, events and data size as label and value rows", () => {
    const w = mountSignals();
    const stats = w.get('[data-test="overview-signal-logs-stats"]');
    expect(stats.classes()).toEqual(expect.arrayContaining(["divide-y", "divide-border-subtle"]));
    expect(stats.findAll("dt").map((d) => d.text())).toEqual(["Streams", "Events", "Data size"]);
    expect(w.get('[data-test="overview-signal-logs-streams"]').text()).toBe("4");
    expect(w.get('[data-test="overview-signal-logs-events"]').text()).toBe("1K");
    expect(w.get('[data-test="overview-signal-logs-stored"]').text()).toBe("1.50 GB");
    expect(w.get('[data-test="overview-signal-metrics-streams"]').text()).toBe("3");
    expect(w.get('[data-test="overview-signal-metrics-card"]').text()).toContain("Samples");
    expect(w.get('[data-test="overview-signal-traces-card"]').text()).toContain("Spans");
  });

  it("shows a signal with no streams as zeros, not a missing card", () => {
    const w = mountSignals();
    expect(w.get('[data-test="overview-signal-traces-streams"]').text()).toBe("0");
    expect(w.get('[data-test="overview-signal-traces-stored"]').text()).toBe("0.00 MB");
  });

  it("compacts large event counts", () => {
    const byType = [{ ...o.streams.data!.by_type[0], doc_num: 2_900_000_000 }];
    const w = mountSignals({ section: streamsWith({ by_type: byType }) });
    expect(w.get('[data-test="overview-signal-logs-events"]').text()).toBe("2.9B");
  });

  it("gives each Open link a distinct accessible name that keeps the visible text", () => {
    const w = mountSignals();
    const names = ["logs", "metrics", "traces"].map((s) => {
      const link = w.get(`[data-test="overview-signal-${s}-view-all"]`);
      expect(link.text()).toBe("Open");
      return link.attributes("aria-label");
    });
    expect(names).toEqual(["Open logs", "Open metrics", "Open traces"]);
  });

  it("emits the signal from its Open link", async () => {
    const w = mountSignals();
    await w.get('[data-test="overview-signal-metrics-view-all"]').trigger("click");
    expect(w.emitted("open")).toEqual([["metrics"]]);
  });

  it("shows skeleton cards while loading and nothing misleading otherwise", () => {
    const loading = mount(OverviewSignalCards, { props: { pending: true, failed: false }, global });
    expect(loading.findAll('[data-test$="-loading"]')).toHaveLength(3);
    const failed = mount(OverviewSignalCards, { props: { pending: false, failed: true }, global });
    expect(failed.find('[data-test="overview-signal-cards"]').exists()).toBe(false);
    for (const section of [
      { status: "forbidden" },
      { status: "error" },
      { status: "locked" },
    ] as const) {
      const w = mountSignals({ section });
      expect(w.find('[data-test="overview-signal-cards"]').exists()).toBe(false);
    }
  });
});

describe("type roles", () => {
  it("uses one style per role across the cards", () => {
    const o2 = buildOverview();
    const top = mount(OverviewTopStreamsCard, { props: { ...base, section: o2.streams }, global });
    const limit = mount(OverviewLimitCard, {
      props: { ...base, limits: o2.limits, streams: o2.streams },
      global,
    });
    const signals = mount(OverviewSignalCards, { props: { ...base, section: o2.streams }, global });
    for (const w of [top, limit]) {
      expect(w.get("h2").classes()).toEqual(expect.arrayContaining(["text-sm", "font-semibold"]));
    }
    const valueClasses = ["text-compact", "font-semibold", "tabular-nums"];
    expect(top.get('[data-test="overview-streams-top-size-logs-app_logs"]').classes()).toEqual(
      expect.arrayContaining(valueClasses),
    );
    expect(limit.get('[data-test="overview-storage-total"]').classes()).toEqual(
      expect.arrayContaining(["text-sm", "font-semibold", "tabular-nums"]),
    );
    expect(signals.get('[data-test="overview-signal-logs-streams"]').classes()).toEqual(
      expect.arrayContaining(valueClasses),
    );
    const labels = [...signals.findAll("dt"), ...limit.findAll(".text-text-label")];
    expect(labels.length).toBeGreaterThan(5);
    for (const label of labels) expect(label.classes()).toContain("text-xs");
  });
});
