import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import IncidentSeverityBadge from "./IncidentSeverityBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("IncidentSeverityBadge", () => {
  describe("variant mapping", () => {
    it("uses error-soft for P1", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "P1" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error-soft");
    });

    it("uses warning-soft for P2", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "P2" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning-soft");
    });

    it("uses warning-soft for P3", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "P3" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning-soft");
    });

    it("uses default-soft for P4", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "P4" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-soft");
    });

    it("uses default-soft for unknown severity", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "P5" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-soft");
    });

    it("handles lowercase severity values", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "p1" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error-soft");
    });
  });

  describe("label", () => {
    it("renders severity as uppercase label", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "p2" } });
      expect(w.text()).toBe("P2");
    });

    it("renders P4 as label", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "P4" } });
      expect(w.text()).toBe("P4");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "P1" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(IncidentSeverityBadge, { props: { severity: "P1", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });
});
