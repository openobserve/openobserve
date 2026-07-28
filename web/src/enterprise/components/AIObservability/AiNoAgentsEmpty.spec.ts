// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AiNoAgentsEmpty from "./AiNoAgentsEmpty.vue";

// Stub the OEmptyState primitive so the spec asserts THIS component's own
// wiring (which props it forwards, event mapping) rather than the empty
// state's internals, which have their own spec.
const OEmptyState = {
  props: ["size", "illustration", "dataTest", "title", "description", "actionLabel"],
  emits: ["action"],
  template:
    '<div class="o-empty-state" :data-test="dataTest" :data-size="size" :data-illustration="illustration" :data-title="title" :data-description="description" :data-action-label="actionLabel" @click="$emit(\'action\', \'view\')" />',
};

const stubs = { OEmptyState };

const baseProps = {
  dataTest: "sessions-empty-no-agents",
  title: "No agents discovered",
  description: "We couldn't find any agents in this window.",
  actionLabel: "View by stream",
};

const mountEmpty = (overrides: Record<string, unknown> = {}) =>
  mount(AiNoAgentsEmpty, {
    global: { stubs },
    props: { ...baseProps, ...overrides },
  });

describe("AiNoAgentsEmpty", () => {
  it("renders the empty state with the passed title, description, action-label and data-test", () => {
    const w = mountEmpty();
    const empty = w.find('[data-test="sessions-empty-no-agents"]');
    expect(empty.exists()).toBe(true);
    expect(empty.attributes("data-title")).toBe("No agents discovered");
    expect(empty.attributes("data-description")).toBe(
      "We couldn't find any agents in this window.",
    );
    expect(empty.attributes("data-action-label")).toBe("View by stream");
  });

  it("defaults the illustration to constellation", () => {
    const w = mountEmpty();
    expect(w.find(".o-empty-state").attributes("data-illustration")).toBe("constellation");
  });

  it("respects an overridden illustration (e.g. service-graph for Graph)", () => {
    const w = mountEmpty({ illustration: "service-graph", actionLabel: undefined });
    expect(w.find(".o-empty-state").attributes("data-illustration")).toBe("service-graph");
  });

  it("emits view-by-stream when the empty state's action fires", async () => {
    const w = mountEmpty();
    await w.find(".o-empty-state").trigger("click");
    expect(w.emitted("view-by-stream")).toBeTruthy();
  });
});
