import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import AlertStatusBadge from "./AlertStatusBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("AlertStatusBadge", () => {
  describe("variant mapping", () => {
    it("uses error for failed status", () => {
      const w = mount(AlertStatusBadge, { props: { status: "failed" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error");
    });

    it("uses success for active status", () => {
      const w = mount(AlertStatusBadge, { props: { status: "active" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success");
    });

    it("uses warning for training status", () => {
      const w = mount(AlertStatusBadge, { props: { status: "training" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning");
    });

    it("uses default for disabled status", () => {
      const w = mount(AlertStatusBadge, { props: { status: "disabled" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });

    it("uses success as the default variant for unknown status", () => {
      const w = mount(AlertStatusBadge, { props: { status: "pending" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success");
    });
  });

  describe("label formatting", () => {
    it("capitalizes the first letter", () => {
      const w = mount(AlertStatusBadge, { props: { status: "active" } });
      expect(w.text()).toBe("Active");
    });

    it("capitalizes failed", () => {
      const w = mount(AlertStatusBadge, { props: { status: "failed" } });
      expect(w.text()).toBe("Failed");
    });

    it("returns empty string for empty status", () => {
      const w = mount(AlertStatusBadge, { props: { status: "" } });
      expect(w.text()).toBe("");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(AlertStatusBadge, { props: { status: "active" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(AlertStatusBadge, { props: { status: "active", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });
});
