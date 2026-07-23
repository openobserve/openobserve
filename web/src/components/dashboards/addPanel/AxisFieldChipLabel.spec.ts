// Copyright 2026 OpenObserve Inc.
//
// Unit tests for AxisFieldChipLabel — the query-builder chip label that mirrors
// the SQL editor's syntax highlighting (function magenta, column body text,
// brackets blue). Focuses on the label parser, including the truncation edge
// case that previously flattened the whole chip to one colour.

import { describe, expect, it, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import AxisFieldChipLabel from "./AxisFieldChipLabel.vue";

const CHIP = '[data-test="dashboard-axis-field-chip-label"]';

function mountLabel(props: Record<string, unknown>) {
  return mount(AxisFieldChipLabel, { props: props as any });
}

// Return [text, class] for each leaf span, in document order.
function leafSpans(wrapper: VueWrapper) {
  return wrapper
    .findAll("span")
    .filter((s) => s.findAll("span").length === 0 && s.text().length > 0)
    .map((s) => ({ text: s.text(), class: s.attributes("class") ?? "" }));
}

describe("AxisFieldChipLabel", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should render the root chip with its data-test hook", () => {
    wrapper = mountLabel({ label: "count(field)" });
    expect(wrapper.find(CHIP).exists()).toBe(true);
  });

  describe("function labels", () => {
    it("should split fn(stream.field) into function, brackets, prefix and field", () => {
      wrapper = mountLabel({ label: "histogram(_anomalies._timestamp)" });
      const spans = leafSpans(wrapper);
      expect(spans.map((s) => s.text)).toEqual([
        "histogram",
        "(",
        "_anomalies.",
        "_timestamp",
        ")",
      ]);
    });

    it("should colour the function magenta and the brackets blue by default", () => {
      wrapper = mountLabel({ label: "count(a.b)" });
      const spans = leafSpans(wrapper);
      const fn = spans.find((s) => s.text === "count");
      const openBracket = spans.find((s) => s.text === "(");
      const field = spans.find((s) => s.text === "b");
      expect(fn?.class).toContain("text-badge-magenta-ol-text");
      expect(openBracket?.class).toContain("text-badge-blue-ol-text");
      expect(field?.class).toContain("text-text-body");
    });

    it("should treat a dotless argument as all field with no prefix", () => {
      wrapper = mountLabel({ label: "count(kubernetes_namespace_name)" });
      expect(leafSpans(wrapper).map((s) => s.text)).toEqual([
        "count",
        "(",
        "kubernetes_namespace_name",
        ")",
      ]);
    });
  });

  describe("truncated labels", () => {
    it("should still colour the function when the closing paren is cut off", () => {
      wrapper = mountLabel({
        label: "count(e2e_automate.kubernetes_labels_operator_prom...",
      });
      const spans = leafSpans(wrapper);
      const fn = spans.find((s) => s.text === "count");
      expect(fn?.class).toContain("text-badge-magenta-ol-text");
      // No closing-bracket span is rendered for a truncated label.
      const closeBracket = spans.filter((s) => s.text === ")");
      expect(closeBracket).toHaveLength(0);
      // The ellipsis stays with the field, not the stream prefix.
      const field = spans.find((s) => s.text.endsWith("..."));
      expect(field?.text).toBe("kubernetes_labels_operator_prom...");
    });
  });

  describe("plain column labels (no function)", () => {
    it("should render stream prefix + field with no brackets", () => {
      wrapper = mountLabel({ label: "audit.log_level" });
      const spans = leafSpans(wrapper);
      expect(spans.map((s) => s.text)).toEqual(["audit.", "log_level"]);
      expect(spans.some((s) => s.text === "(")).toBe(false);
    });

    it("should apply a custom columnClass override", () => {
      wrapper = mountLabel({
        label: "log_level",
        columnClass: "text-badge-orange-ol-text",
      });
      const field = leafSpans(wrapper).find((s) => s.text === "log_level");
      expect(field?.class).toContain("text-badge-orange-ol-text");
    });
  });

  it("should render everything non-bold (font-normal) like the query", () => {
    wrapper = mountLabel({ label: "count(a.b)" });
    expect(wrapper.find(CHIP).attributes("class")).toContain("font-normal");
  });
});
