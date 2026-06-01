import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import IncidentStatusBadge from "./IncidentStatusBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("IncidentStatusBadge", () => {
  describe("variant mapping", () => {
    it("uses error-soft for open", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "open" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error-soft");
    });

    it("uses warning-soft for acknowledged", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "acknowledged" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning-soft");
    });

    it("uses success-soft for resolved", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "resolved" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success-soft");
    });

    it("uses default-soft for unknown status", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "unknown" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-soft");
    });
  });

  describe("label", () => {
    it("renders Open for open", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "open" } });
      expect(w.text()).toBe("Open");
    });

    it("renders Acknowledged for acknowledged", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "acknowledged" } });
      expect(w.text()).toBe("Acknowledged");
    });

    it("renders Resolved for resolved", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "resolved" } });
      expect(w.text()).toBe("Resolved");
    });

    it("capitalizes unknown status", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "pending" } });
      expect(w.text()).toBe("Pending");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "open" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(IncidentStatusBadge, { props: { status: "open", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });
});
