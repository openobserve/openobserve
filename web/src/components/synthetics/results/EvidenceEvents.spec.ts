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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import i18n from "@/locales";
import EvidenceEvents from "./EvidenceEvents.vue";
import EvidenceEventDetail from "./EvidenceEventDetail.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { EvidenceEvent } from "@/composables/synthetics/syntheticResultsSchema";

const ev = (over: Partial<EvidenceEvent>): EvidenceEvent => ({
  ts: 0,
  stepId: "s1",
  kind: "response",
  level: null,
  text: null,
  message: null,
  stack: null,
  method: null,
  url: null,
  status: null,
  resourceType: null,
  initiatedTs: null,
  durationMs: null,
  firstParty: true,
  stepName: "Click Sign In",
  ...over,
});

const EVENTS = [
  ev({ kind: "pageerror", message: "Uncaught TypeError: c.user is undefined" }),
  ev({ status: 503, method: "POST", url: "https://app.dev/auth/login", durationMs: 1200 }),
];

const mountEvents = (props: Record<string, unknown> = {}) =>
  mount(EvidenceEvents, {
    props: { events: EVENTS, mode: "panel", ...props },
    global: { plugins: [i18n] },
  });

describe("EvidenceEvents", () => {
  it("renders one row per event", () => {
    const w = mountEvents();
    expect(w.findAll('[data-test="synthetics-evidence-events-row"]')).toHaveLength(2);
  });

  it("shows the step column in panel mode", () => {
    const w = mountEvents({ mode: "panel" });
    expect(w.find('[data-test="synthetics-evidence-events-step"]').exists()).toBe(true);
  });

  it("drops the step column inline, where the step is already the context", () => {
    const w = mountEvents({ mode: "inline" });
    expect(w.find('[data-test="synthetics-evidence-events-step"]').exists()).toBe(false);
  });

  it("shows a response status and hides it for a page error", () => {
    const w = mountEvents();
    const cells = w.findAll('[data-test="synthetics-evidence-events-status"]');
    expect(cells[0].text()).toBe("");
    expect(cells[1].text()).toContain("503");
  });

  it("truncates a url from the left, because the host repeats and the path differs", () => {
    const w = mountEvents();
    expect(w.text()).toContain("/auth/login");
  });

  it("dims a third-party row rather than dropping it", () => {
    // A failing third-party script is a legitimate cause of a broken page.
    const w = mountEvents({ events: [ev({ status: 200, firstParty: false })] });
    expect(w.find('[data-test="synthetics-evidence-events-row"]').classes().join(" ")).toContain(
      "opacity-60",
    );
  });

  it("counts every row from one zero, so two rows can be compared", () => {
    // Elapsed, not wall-clock: every row of a four-second run carries the same
    // date, and "2 months ago" describes the bundle rather than the event.
    const w = mountEvents({
      events: [ev({ ts: 1_000 }), ev({ ts: 1_340 }), ev({ ts: 3_500 })],
    });
    expect(
      w.findAll('[data-test="synthetics-evidence-events-elapsed"]').map((c) => c.text()),
    ).toEqual(["+0ms", "+340ms", "+2.5s"]);
  });

  it("takes the caller's zero when given one", () => {
    // Sections zeroed independently would put a 200 at +0ms next to the 503
    // that preceded it by three seconds.
    const w = mountEvents({ events: [ev({ ts: 4_000 })], originTs: 1_000 });
    expect(w.find('[data-test="synthetics-evidence-events-elapsed"]').text()).toBe("+3.0s");
  });

  it("places an event where the work began, not where it landed", () => {
    const w = mountEvents({
      events: [ev({ ts: 5_000, initiatedTs: 1_000 }), ev({ ts: 2_000, initiatedTs: 2_000 })],
    });
    expect(
      w.findAll('[data-test="synthetics-evidence-events-elapsed"]').map((c) => c.text()),
    ).toEqual(["+0ms", "+1.0s"]);
  });

  it("names each row's kind, so one table can hold all four", () => {
    const w = mountEvents({
      events: [
        ev({ kind: "pageerror" }),
        ev({ kind: "requestfailed" }),
        ev({ kind: "console", level: "error" }),
        ev({ status: 200 }),
      ],
    });
    expect(w.findAll('[data-test="synthetics-evidence-events-type"]').map((b) => b.text())).toEqual(
      ["Page error", "Failed req.", "Console", "Network"],
    );
  });

  it("keeps the kind badge neutral, because kind is not severity", () => {
    // `network` holds both a 503 and a healthy 200 — a coloured kind badge would
    // be wrong on one of them. Severity is the rail and the status text.
    const w = mountEvents({ events: [ev({ kind: "pageerror" }), ev({ status: 200 })] });
    const [bad, fine] = w.findAllComponents(OBadge);
    expect(bad.props("variant")).toBe("default-soft");
    expect(fine.props("variant")).toBe(bad.props("variant"));
  });

  it("labels the columns in the panel and stays bare inline", () => {
    // Seven unlabelled columns are a puzzle in a full table; a header strip on a
    // five-row card is chrome.
    expect(mountEvents().findComponent(OTable).props("showHeader")).toBe(true);
    expect(mountEvents({ mode: "inline" }).findComponent(OTable).props("showHeader")).toBe(false);
  });

  it("lets the panel re-sort, so a chronological default is recoverable", () => {
    // Sorting by Type reproduces the old grouped read, in place.
    const table = mountEvents().findComponent(OTable);
    expect(table.props("sorting")).toBe("client");
    const sortable = (table.props("columns") as { id: string; sortable?: boolean }[])
      .filter((c) => c.sortable)
      .map((c) => c.id);
    expect(sortable).toEqual(["elapsed", "type", "status", "duration"]);
    expect(mountEvents({ mode: "inline" }).findComponent(OTable).props("sorting")).toBe("none");
  });

  it("rails only the rows that deserve one", () => {
    // A rail on every row of an all-200 bundle is decoration; the point is that
    // the anomalies are findable at a glance.
    const rail = mountEvents().findComponent(OTable).props("getRowStatusColor") as (
      r: EvidenceEvent,
    ) => string | undefined;
    expect(rail(ev({ kind: "pageerror" }))).toContain("error");
    expect(rail(ev({ kind: "requestfailed" }))).toContain("error");
    expect(rail(ev({ status: 503 }))).toContain("error");
    expect(rail(ev({ status: 404 }))).toContain("warning");
    expect(rail(ev({ status: 200 }))).toBeUndefined();
    expect(rail(ev({ status: 302 }))).toBeUndefined();
  });

  it("pages a long list in the panel and leaves the step expansion whole", () => {
    // The bundle arrives as one NDJSON fetch, so there is no page to ask the
    // backend for — but a group section can hold 136 rows.
    const many = Array.from({ length: 25 }, (_, i) => ev({ ts: i }));
    expect(
      mountEvents({ events: many }).findAll('[data-test="synthetics-evidence-events-row"]'),
    ).toHaveLength(20);
    expect(
      mountEvents({ events: many, mode: "inline" }).findAll(
        '[data-test="synthetics-evidence-events-row"]',
      ),
    ).toHaveLength(25);
  });

  it("offers a filtered empty state that can clear the filter", async () => {
    const w = mountEvents({ events: [], mode: "panel", filtered: true });
    const empty = w.findComponent(OEmptyState);
    expect(empty.props("filtered")).toBe(true);
    empty.vm.$emit("action", "clear-filters");
    await w.vm.$nextTick();
    expect(w.emitted("clear-filters")).toBeTruthy();
  });

  it("offers an expand control on every panel row", () => {
    const w = mountEvents({ mode: "panel" });
    expect(w.find('[data-test="o2-table-expand-0"]').exists()).toBe(true);
    expect(w.find('[data-test="o2-table-expand-1"]').exists()).toBe(true);
  });

  it("leaves the inline step list unexpandable, where the cap is the point", () => {
    const w = mountEvents({ mode: "inline" });
    expect(w.find('[data-test="o2-table-expand-cell"]').exists()).toBe(false);
    expect(w.find('[data-test="o2-table-expand-0"]').exists()).toBe(false);
  });

  it("renders the detail panel for an expanded row", async () => {
    const w = mountEvents({ mode: "panel" });
    await w.find('[data-test="o2-table-expand-0"]').trigger("click");
    expect(w.findComponent(EvidenceEventDetail).exists()).toBe(true);
  });

  it("hands the detail panel the row it was expanded from", async () => {
    const w = mountEvents({ mode: "panel" });
    await w.find('[data-test="o2-table-expand-0"]').trigger("click");
    expect(w.findComponent(EvidenceEventDetail).props("event")).toMatchObject({
      kind: "pageerror",
      message: "Uncaught TypeError: c.user is undefined",
    });
  });

  it("keeps two rows open at once — comparing two events is the point", async () => {
    const w = mountEvents({ mode: "panel" });
    await w.find('[data-test="o2-table-expand-0"]').trigger("click");
    await w.find('[data-test="o2-table-expand-1"]').trigger("click");
    expect(w.findAllComponents(EvidenceEventDetail)).toHaveLength(2);
  });
});
