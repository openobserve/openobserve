import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import BackfillDeletionStatusBadge from "./BackfillDeletionStatusBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("BackfillDeletionStatusBadge", () => {
  describe("variant mapping", () => {
    it("uses default for null status", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: null } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });

    it("uses default for undefined status", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: undefined } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });

    it("uses error for object with failed key", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: { failed: "some error" } } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error");
    });

    it("uses success for completed", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "completed" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("success");
    });

    it("uses primary for in_progress", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "in_progress" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary");
    });

    it("uses warning for pending", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "pending" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning");
    });

    it("uses default for unknown status string", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "unknown" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });
  });

  describe("label", () => {
    it("renders Not Required for null status", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: null } });
      expect(w.text()).toBe("Not Required");
    });

    it("renders Failed for object with failed key", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: { failed: "err" } } });
      expect(w.text()).toBe("Failed");
    });

    it("renders Completed for completed", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "completed" } });
      expect(w.text()).toBe("Completed");
    });

    it("renders In Progress for in_progress", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "in_progress" } });
      expect(w.text()).toBe("In Progress");
    });

    it("renders Pending for pending", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "pending" } });
      expect(w.text()).toBe("Pending");
    });

    it("renders Unknown for unrecognized status", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "weird" } });
      expect(w.text()).toBe("Unknown");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "completed" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(BackfillDeletionStatusBadge, { props: { status: "completed", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });
});
