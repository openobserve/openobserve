import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import CorrelationReasonBadge from "./CorrelationReasonBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("CorrelationReasonBadge", () => {
  describe("variant mapping", () => {
    it("uses primary-outline for service_discovery", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "service_discovery" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary-outline");
    });

    it("uses primary-outline for primary_match", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "primary_match" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary-outline");
    });

    it("uses warning-outline for secondary_match", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "secondary_match" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning-outline");
    });

    it("uses default-outline for alert_id", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "alert_id" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-outline");
    });

    it("uses default-outline for unknown reason", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "custom_reason" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-outline");
    });
  });

  describe("label", () => {
    it("renders Service Discovery for service_discovery", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "service_discovery" } });
      expect(w.text()).toContain("Service Discovery");
    });

    it("renders Primary Match for primary_match", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "primary_match" } });
      expect(w.text()).toContain("Primary Match");
    });

    it("renders Secondary Match for secondary_match", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "secondary_match" } });
      expect(w.text()).toContain("Secondary Match");
    });

    it("renders Alert ID for alert_id", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "alert_id" } });
      expect(w.text()).toContain("Alert ID");
    });

    it("renders raw reason for unknown reasons", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "my_custom_reason" } });
      expect(w.text()).toContain("my_custom_reason");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "primary_match" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(CorrelationReasonBadge, { props: { reason: "primary_match", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });
});
