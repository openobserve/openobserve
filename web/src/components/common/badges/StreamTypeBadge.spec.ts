import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import StreamTypeBadge from "./StreamTypeBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("StreamTypeBadge", () => {
  describe("variant mapping", () => {
    it("uses info-outline for logs", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "logs" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("info-outline");
    });

    it("uses purple-outline for metrics", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "metrics" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("purple-outline");
    });

    it("uses success-outline for traces", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "traces" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success-outline");
    });

    it("uses warning-outline for rum", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "rum" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning-outline");
    });

    it("uses primary-outline as default for unknown stream type", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "custom" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary-outline");
    });

    it("handles uppercase stream types", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "LOGS" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("info-outline");
    });
  });

  describe("label", () => {
    it("capitalizes stream type", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "logs" } });
      expect(w.text()).toBe("Logs");
    });

    it("capitalizes metrics", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "metrics" } });
      expect(w.text()).toBe("Metrics");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "logs" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(StreamTypeBadge, { props: { streamType: "logs", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });
});
