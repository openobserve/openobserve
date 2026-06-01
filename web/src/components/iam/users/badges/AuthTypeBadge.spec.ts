import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import AuthTypeBadge from "./AuthTypeBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("AuthTypeBadge", () => {
  describe("variant mapping", () => {
    it("uses primary-outline for SSO", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "SSO" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary-outline");
    });

    it("uses primary-outline for lowercase sso", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "sso" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary-outline");
    });

    it("uses warning-outline for LDAP", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "LDAP" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning-outline");
    });

    it("uses warning-outline for lowercase ldap", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "ldap" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("warning-outline");
    });

    it("uses default-outline for unknown type", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "internal" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-outline");
    });

    it("uses default-outline for empty type", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default-outline");
    });
  });

  describe("label", () => {
    it("renders the authType as label", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "SSO" } });
      expect(w.text()).toBe("SSO");
    });

    it("renders internal authType as label", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "internal" } });
      expect(w.text()).toBe("internal");
    });
  });

  describe("size passthrough", () => {
    it("defaults to sm", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "SSO" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });

    it("accepts md override", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "SSO", size: "md" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });
  });

  describe("data-test", () => {
    it("has default data-test attribute", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "SSO" } });
      expect(w.findComponent(OBadge).attributes("data-test")).toBe("auth-type-badge");
    });

    it("accepts custom data-test", () => {
      const w = mount(AuthTypeBadge, { props: { authType: "SSO", dataTest: "my-auth-badge" } });
      expect(w.findComponent(OBadge).attributes("data-test")).toBe("my-auth-badge");
    });
  });
});
