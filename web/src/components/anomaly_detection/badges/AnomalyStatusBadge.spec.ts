import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import AnomalyStatusBadge from "./AnomalyStatusBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("AnomalyStatusBadge", () => {
  describe("variant mapping — disabled", () => {
    it("uses default variant when disabled regardless of status", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "ready", enabled: false } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });
  });

  describe("variant mapping — enabled", () => {
    it("uses success for ready status", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "ready", enabled: true } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success");
    });

    it("uses primary for training status", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "training", enabled: true } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary");
    });

    it("uses error for failed status", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "failed", enabled: true } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error");
    });

    it("uses default for waiting status", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "waiting", enabled: true } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });

    it("uses default for unknown status", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "unknown", enabled: true } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });
  });

  describe("label", () => {
    it("renders Disabled when not enabled", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "ready", enabled: false } });
      expect(w.text()).toBe("Disabled");
    });

    it("capitalizes status when enabled", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "ready", enabled: true } });
      expect(w.text()).toBe("Ready");
    });

    it("capitalizes training when enabled", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "training", enabled: true } });
      expect(w.text()).toBe("Training");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "ready", enabled: true } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(AnomalyStatusBadge, { props: { status: "ready", enabled: true, size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });
});
