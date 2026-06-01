import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import SessionStatusBadge from "./SessionStatusBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("SessionStatusBadge", () => {
  describe("variant mapping", () => {
    it("uses success-soft for active", () => {
      const w = mount(SessionStatusBadge, { props: { status: "active" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success-soft");
    });

    it("uses success-soft for ok", () => {
      const w = mount(SessionStatusBadge, { props: { status: "ok" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success-soft");
    });

    it("uses error-soft for error", () => {
      const w = mount(SessionStatusBadge, { props: { status: "error" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error-soft");
    });

    it("uses default-soft for unknown status", () => {
      const w = mount(SessionStatusBadge, { props: { status: "unknown" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-soft");
    });

    it("handles uppercase values", () => {
      const w = mount(SessionStatusBadge, { props: { status: "ACTIVE" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success-soft");
    });
  });

  describe("label", () => {
    it("capitalizes status", () => {
      const w = mount(SessionStatusBadge, { props: { status: "active" } });
      expect(w.text()).toBe("Active");
    });

    it("capitalizes error", () => {
      const w = mount(SessionStatusBadge, { props: { status: "error" } });
      expect(w.text()).toBe("Error");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(SessionStatusBadge, { props: { status: "active" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(SessionStatusBadge, { props: { status: "active", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });
});
