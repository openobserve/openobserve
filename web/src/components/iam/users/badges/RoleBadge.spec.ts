import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import RoleBadge from "./RoleBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("RoleBadge", () => {
  describe("variant mapping", () => {
    it.each(["admin", "viewer", "user", "root", "member", "editor", "serviceaccount"])(
      "uses warning-outline for built-in role '%s'",
      (roleName) => {
        const w = mount(RoleBadge, { props: { roleName } });
        expect(w.findComponent(OBadge).props("variant")).toBe("warning-outline");
      }
    );

    it("uses error-outline for custom role", () => {
      const w = mount(RoleBadge, { props: { roleName: "my-custom-role" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error-outline");
    });

    it("uses error-outline for unknown role", () => {
      const w = mount(RoleBadge, { props: { roleName: "unknown-xyz" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("error-outline");
    });
  });

  describe("label formatting", () => {
    it("capitalizes built-in role names", () => {
      const w = mount(RoleBadge, { props: { roleName: "admin" } });
      expect(w.text()).toBe("Admin");
    });

    it("capitalizes serviceaccount", () => {
      const w = mount(RoleBadge, { props: { roleName: "serviceaccount" } });
      expect(w.text()).toBe("Serviceaccount");
    });

    it("renders custom roles as-is", () => {
      const w = mount(RoleBadge, { props: { roleName: "my-custom-role" } });
      expect(w.text()).toBe("my-custom-role");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(RoleBadge, { props: { roleName: "admin" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(RoleBadge, { props: { roleName: "admin", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });

  describe("data-test", () => {
    it("has default data-test attribute", () => {
      const w = mount(RoleBadge, { props: { roleName: "admin" } });
      expect(w.findComponent(OBadge).attributes("data-test")).toBe("role-badge");
    });

    it("accepts custom data-test", () => {
      const w = mount(RoleBadge, { props: { roleName: "admin", dataTest: "my-role-badge" } });
      expect(w.findComponent(OBadge).attributes("data-test")).toBe("my-role-badge");
    });
  });
});
