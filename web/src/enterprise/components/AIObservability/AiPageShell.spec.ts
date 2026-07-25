// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AiPageShell from "./AiPageShell.vue";

// Lightweight stubs for the O2 library primitives so the spec asserts the
// shell's OWN wiring (which data-test values it derives, slot passthrough,
// event forwarding) rather than the internals of the shared components —
// those are covered by their own specs.
const OPageLayout = {
  props: ["dataTest", "title", "subtitle", "icon", "bleed", "scroll"],
  template:
    '<div class="o-page-layout" :data-test="dataTest" :data-title="title" :data-subtitle="subtitle" :data-icon="icon"><slot name="actions" /><slot name="subnav" /><slot /></div>',
};
const DateTime = {
  props: [
    "autoApply",
    "menuAlign",
    "defaultType",
    "defaultAbsoluteTime",
    "defaultRelativeTime",
    "dataTest",
  ],
  emits: ["on:date-change"],
  template:
    '<div class="date-time" :data-test="dataTest" @click="$emit(\'on:date-change\', { valueType: \'relative\' })" />',
};
const ORefreshButton = {
  props: ["lastRunAt", "loading", "disabled", "dataTest"],
  emits: ["click"],
  template:
    '<button class="o-refresh-button" :data-test="dataTest" :data-loading="loading" :data-disabled="disabled" :data-last-run-at="lastRunAt" @click="$emit(\'click\')" />',
};

const stubs = { OPageLayout, DateTime, ORefreshButton };

const baseDateState = {
  valueType: "relative" as const,
  startTime: null,
  endTime: null,
  relativeTimePeriod: "15m",
};

const baseProps = {
  dataTest: "ai-agent-behavior",
  title: "Agent Behavior",
  subtitle: "Understand agent behavior",
  icon: "troubleshoot",
  dateState: baseDateState,
  lastRunAt: 1234,
  isLoading: false,
};

const mountShell = (
  overrides: Record<string, unknown> = {},
  slots: Record<string, string> = {},
) =>
  mount(AiPageShell, {
    global: { stubs },
    props: { ...baseProps, ...overrides },
    slots,
  });

describe("AiPageShell", () => {
  it("renders the page layout with the title/subtitle/icon and the exact page data-test (`${dataTest}-page`)", () => {
    const w = mountShell();
    const layout = w.find('[data-test="ai-agent-behavior-page"]');
    expect(layout.exists()).toBe(true);
    expect(layout.attributes("data-title")).toBe("Agent Behavior");
    expect(layout.attributes("data-subtitle")).toBe("Understand agent behavior");
    expect(layout.attributes("data-icon")).toBe("troubleshoot");
  });

  it("derives the date-time and refresh data-test values from the dataTest prefix", () => {
    const w = mountShell();
    expect(w.find('[data-test="ai-agent-behavior-date-time"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-agent-behavior-refresh-btn"]').exists()).toBe(true);
  });

  it("reproduces each page's exact data-test values unchanged (prefix parameterization)", () => {
    const w = mountShell({ dataTest: "ai-sessions" });
    expect(w.find('[data-test="ai-sessions-page"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-sessions-date-time"]').exists()).toBe(true);
    expect(w.find('[data-test="ai-sessions-refresh-btn"]').exists()).toBe(true);
  });

  it("passes the refresh button's last-run-at / loading / disabled through", () => {
    const w = mountShell({ isLoading: true, lastRunAt: 999 });
    const btn = w.find('[data-test="ai-agent-behavior-refresh-btn"]');
    expect(btn.attributes("data-loading")).toBe("true");
    expect(btn.attributes("data-disabled")).toBe("true");
    expect(btn.attributes("data-last-run-at")).toBe("999");
  });

  it("keeps the exact class strings on the date-time and refresh wrapper", () => {
    const w = mountShell();
    expect(w.find(".date-time").classes()).toContain("h-8");
    const wrapper = w.find(
      ".inline-flex.items-center.border.border-border-default.rounded-default.px-1.h-8.overflow-hidden",
    );
    expect(wrapper.exists()).toBe(true);
  });

  it("forwards the date-time on:date-change as a date-change event", async () => {
    const w = mountShell();
    await w.find(".date-time").trigger("click");
    expect(w.emitted("date-change")).toBeTruthy();
    expect(w.emitted("date-change")![0][0]).toEqual({ valueType: "relative" });
  });

  it("forwards the refresh button click as a refresh event", async () => {
    const w = mountShell();
    await w.find(".o-refresh-button").trigger("click");
    expect(w.emitted("refresh")).toBeTruthy();
  });

  it("renders the subnav and default slots", () => {
    const w = mountShell(
      {},
      {
        subnav: '<div class="my-subnav" />',
        default: '<div class="my-body" />',
      },
    );
    expect(w.find(".my-subnav").exists()).toBe(true);
    expect(w.find(".my-body").exists()).toBe(true);
  });
});
