// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import i18n from "@/locales";
import EvidenceEvents from "./EvidenceEvents.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
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

  it("offers a filtered empty state that can clear the filter", async () => {
    const w = mountEvents({ events: [], mode: "panel", filtered: true });
    const empty = w.findComponent(OEmptyState);
    expect(empty.props("filtered")).toBe(true);
    empty.vm.$emit("action", "clear-filters");
    await w.vm.$nextTick();
    expect(w.emitted("clear-filters")).toBeTruthy();
  });
});
