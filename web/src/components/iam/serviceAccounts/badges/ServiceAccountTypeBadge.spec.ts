import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import ServiceAccountTypeBadge from "./ServiceAccountTypeBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("ServiceAccountTypeBadge", () => {
  describe("variant mapping", () => {
    it("uses primary-outline for system accounts", () => {
      const w = mount(ServiceAccountTypeBadge, { props: { isSystem: true } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary-outline");
    });

    it("uses default-outline for non-system accounts", () => {
      const w = mount(ServiceAccountTypeBadge, { props: { isSystem: false } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-outline");
    });
  });

  describe("label", () => {
    it("renders System for isSystem without managed flag", () => {
      const w = mount(ServiceAccountTypeBadge, { props: { isSystem: true } });
      expect(w.text()).toBe("System");
    });

    it("renders System Managed when managed is true", () => {
      const w = mount(ServiceAccountTypeBadge, { props: { isSystem: true, managed: true } });
      expect(w.text()).toBe("System Managed");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(ServiceAccountTypeBadge, { props: { isSystem: true } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(ServiceAccountTypeBadge, { props: { isSystem: true, size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });

  describe("data-test", () => {
    it("has default data-test attribute", () => {
      const w = mount(ServiceAccountTypeBadge, { props: { isSystem: true } });
      expect(w.findComponent(OBadge).attributes("data-test")).toBe("service-account-type-badge");
    });
  });
});
