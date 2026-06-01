import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import DestinationTypeBadge from "./DestinationTypeBadge.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

describe("DestinationTypeBadge", () => {
  describe("variant mapping", () => {
    it("uses primary for prebuilt destinations", () => {
      const w = mount(DestinationTypeBadge, { props: { isPrebuilt: true, label: "Slack" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("primary");
    });

    it("uses default for custom destinations", () => {
      const w = mount(DestinationTypeBadge, { props: { isPrebuilt: false, label: "My Webhook" } });
      expect(w.findComponent(OBadge).props("variant")).toBe("default");
    });
  });

  describe("label", () => {
    it("renders the provided label", () => {
      const w = mount(DestinationTypeBadge, { props: { isPrebuilt: true, label: "PagerDuty" } });
      expect(w.text()).toBe("PagerDuty");
    });

    it("renders custom label", () => {
      const w = mount(DestinationTypeBadge, { props: { isPrebuilt: false, label: "My Custom Hook" } });
      expect(w.text()).toBe("My Custom Hook");
    });
  });

  describe("size passthrough", () => {
    it("defaults to md", () => {
      const w = mount(DestinationTypeBadge, { props: { isPrebuilt: true, label: "Slack" } });
      expect(w.findComponent(OBadge).props("size")).toBe("md");
    });

    it("accepts sm override", () => {
      const w = mount(DestinationTypeBadge, { props: { isPrebuilt: true, label: "Slack", size: "sm" } });
      expect(w.findComponent(OBadge).props("size")).toBe("sm");
    });
  });
});
