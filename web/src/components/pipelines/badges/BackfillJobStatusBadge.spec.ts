import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import BackfillJobStatusBadge from "./BackfillJobStatusBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("BackfillJobStatusBadge", () => {
  describe("variant mapping", () => {
    it("uses error when deletionFailed is true regardless of status", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "completed", deletionFailed: true } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error");
    });

    it("uses success for running", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "running" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success");
    });

    it("uses success for completed", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "completed" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success");
    });

    it("uses error for failed", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "failed" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error");
    });

    it("uses warning for pending", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "pending" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning");
    });

    it("uses default for canceled", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "canceled" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });

    it("uses default for unknown status", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "unknown" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });
  });

  describe("label", () => {
    it("renders Deletion Failed when deletionFailed is true", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "running", deletionFailed: true } });
      expect(w.text()).toBe("Deletion Failed");
    });

    it("capitalizes status", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "running" } });
      expect(w.text()).toBe("Running");
    });

    it("capitalizes completed", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "completed" } });
      expect(w.text()).toBe("Completed");
    });
  });

  describe("size passthrough", () => {
    it("defaults to md", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "running" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });

    it("accepts sm override", () => {
      const w = mount(BackfillJobStatusBadge, { props: { status: "running", size: "sm" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });
  });
});
