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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import InsightBlock from "./InsightBlock.vue";
import type { InsightCta, InsightParts } from "./insightCopy";

const cta: InsightCta = {
  key: "review-query",
  label: raw("Review query"),
  target: {
    type: "review_alert",
    action: { type: "review_alert", alert_id: "a2", focus: "query" },
    alertName: "payments-latency",
    findingId: "f1",
  },
  note: raw("Opens the alert editor at the query. Nothing is saved until you save."),
};

const logs: InsightCta = {
  key: "logs-app",
  label: raw("Open in Logs"),
  target: { type: "route", to: { path: "/logs" } },
  note: null,
};

const insight = (over: Partial<InsightParts> = {}): InsightParts => ({
  id: "f1",
  chip: { label: raw("Not working"), variant: "error-soft", tone: "failure" },
  headline: raw("payments-latency filters on duration_ms, a field its stream no longer has"),
  why: raw("4 of 9 runs failed in the last calibration window."),
  whyDetail: null,
  next: raw("Check the field the query filters on: none of its streams has it."),
  cta,
  secondary: [logs],
  note: cta.note,
  facts: [],
  meta: null,
  dismissable: {
    finding_id: "f1",
    rule_id: "failure",
    scope_kind: "alert",
    scope_key: "a2",
  },
  ...over,
});

const mountBlock = (parts: InsightParts, variant?: "card" | "details") =>
  mount(InsightBlock, {
    props: { parts, ...(variant ? { variant } : {}) },
    global: { plugins: [i18n] },
  });

const sel = (part: string) => `[data-test="insight-block-f1-${part}"]`;

describe("InsightBlock card (test 8)", () => {
  it("paints chip, headline, why and CTA with Details collapsed (M-L)", () => {
    const wrapper = mountBlock(insight());
    expect(wrapper.get(sel("chip")).text()).toBe("Not working");
    expect(wrapper.get(sel("headline")).text()).toContain("payments-latency");
    expect(wrapper.get(sel("why")).text()).toBe(
      "4 of 9 runs failed in the last calibration window.",
    );
    expect(wrapper.get(sel("cta")).text()).toBe("Review query");
    expect(wrapper.find(sel("details")).exists()).toBe(false);
    expect(wrapper.get(sel("details-toggle")).attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("article > span").classes()).toContain("bg-status-error-text");
  });

  it("unclamps the why while Details is open", async () => {
    const wrapper = mountBlock(insight());
    const why = wrapper.get(sel("why"));
    expect(why.classes()).toContain("line-clamp-2");
    await wrapper.get(sel("details-toggle")).trigger("click");
    expect(why.classes()).not.toContain("line-clamp-2");
    await wrapper.get(sel("details-toggle")).trigger("click");
    expect(why.classes()).toContain("line-clamp-2");
  });

  it("opens Details with Next, the secondary action, Dismiss… and the note", async () => {
    const wrapper = mountBlock(insight());
    const toggle = wrapper.get(sel("details-toggle"));
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const details = wrapper.get(sel("details"));
    expect(toggle.attributes("aria-controls")).toBe(details.attributes("id"));
    expect(wrapper.get(sel("next")).text()).toContain("Check the field");
    expect(wrapper.find(sel("why-detail")).exists()).toBe(false);
    expect(wrapper.get(sel("secondary-logs-app")).text()).toBe("Open in Logs");
    expect(wrapper.get(sel("dismiss")).text()).toBe("Dismiss…");
    expect(wrapper.get(sel("note")).text()).toContain("Nothing is saved until you save.");
    expect(details.findAll(sel("cta"))).toHaveLength(0);
  });

  it("shows Dismiss… only for a dismissable insight", async () => {
    const wrapper = mountBlock(insight({ dismissable: null }));
    await wrapper.get(sel("details-toggle")).trigger("click");
    expect(wrapper.find(sel("dismiss")).exists()).toBe(false);
  });

  it("keeps the CTA when there is no why", () => {
    const wrapper = mountBlock(insight({ why: null }));
    expect(wrapper.find(sel("why")).exists()).toBe(false);
    expect(wrapper.get(sel("cta")).text()).toBe("Review query");
  });

  it("emits each button's action and holds no data logic", async () => {
    const wrapper = mountBlock(insight());
    await wrapper.get(sel("cta")).trigger("click");
    await wrapper.get(sel("details-toggle")).trigger("click");
    await wrapper.get(sel("secondary-logs-app")).trigger("click");
    await wrapper.get(sel("dismiss")).trigger("click");
    expect(wrapper.emitted("cta")).toEqual([[cta]]);
    expect(wrapper.emitted("secondary")).toEqual([[logs]]);
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
  });

  it("shows the CTA as busy while its target is looked up", () => {
    const wrapper = mount(InsightBlock, {
      props: { parts: insight(), pending: true },
      global: { plugins: [i18n] },
    });
    expect(wrapper.get(sel("cta")).attributes("aria-busy")).toBe("true");
  });

  it("draws a gap amber and information neutral", () => {
    const amber = mountBlock(
      insight({ chip: { label: raw("Coverage gap"), variant: "warning-soft", tone: "gap" } }),
    );
    expect(amber.find("article > span").classes()).toContain("bg-ingest-accent-amber");
    const neutral = mountBlock(
      insight({ chip: { label: raw("Other"), variant: "default-soft", tone: "info" } }),
    );
    expect(neutral.find("article > span").classes()).toContain("bg-border-default");
  });
});

describe("InsightBlock details only (drawer row)", () => {
  it("is the open Details with the why and the CTA as the main action", () => {
    const wrapper = mountBlock(insight(), "details");
    expect(wrapper.find(sel("chip")).exists()).toBe(false);
    expect(wrapper.get(sel("why-detail")).text()).toBe(
      "4 of 9 runs failed in the last calibration window.",
    );
    expect(wrapper.get(sel("details")).find(sel("cta")).text()).toBe("Review query");
  });

  it("prefers the longer Details why when a kind has one", () => {
    const wrapper = mountBlock(
      insight({ whyDetail: raw("Errors: none, latency: none") }),
      "details",
    );
    expect(wrapper.get(sel("why-detail")).text()).toBe("Errors: none, latency: none");
  });
});
