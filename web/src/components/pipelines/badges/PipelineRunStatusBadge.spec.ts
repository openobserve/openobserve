import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import PipelineRunStatusBadge from "./PipelineRunStatusBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("PipelineRunStatusBadge", () => {
  describe("variant mapping", () => {
    it.each([
      ["success", "success-outline"],
      ["ok", "success-outline"],
      ["completed", "success-outline"],
      ["error", "error-outline"],
      ["failed", "error-outline"],
      ["warning", "warning-outline"],
      ["pending", "primary-outline"],
      ["running", "primary-outline"],
      ["unknown", "default-outline"],
      ["", "default-outline"],
    ])("maps status '%s' to variant '%s'", (status, expectedVariant) => {
      const w = mount(PipelineRunStatusBadge, { props: { status } });
      expect(w.findComponent(OBadge).props("variant")).toBe(expectedVariant);
    });

    it("handles uppercase status values", () => {
      const w = mount(PipelineRunStatusBadge, { props: { status: "SUCCESS" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success-outline");
    });
  });

  describe("label", () => {
    it("renders the status as label", () => {
      const w = mount(PipelineRunStatusBadge, { props: { status: "completed" } });
      expect(w.text()).toBe("completed");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(PipelineRunStatusBadge, { props: { status: "success" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(PipelineRunStatusBadge, { props: { status: "success", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });

  describe("data-test", () => {
    it("has default data-test attribute", () => {
      const w = mount(PipelineRunStatusBadge, { props: { status: "success" } });
      expect(w.findComponent(OBadge).attributes("data-test")).toBe("pipeline-run-status-badge");
    });

    it("accepts custom data-test", () => {
      const w = mount(PipelineRunStatusBadge, { props: { status: "success", dataTest: "custom-badge" } });
      expect(w.findComponent(OBadge).attributes("data-test")).toBe("custom-badge");
    });
  });
});
