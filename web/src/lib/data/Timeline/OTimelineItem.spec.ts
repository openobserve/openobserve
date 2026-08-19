import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OTimelineItem from "./OTimelineItem.vue";

describe("OTimelineItem", () => {
  it("renders a list item", () => {
    const wrapper = mount(OTimelineItem);
    expect(wrapper.element.tagName).toBe("LI");
  });

  it("renders title text", () => {
    const wrapper = mount(OTimelineItem, {
      props: { title: "Job Started" },
    });
    expect(wrapper.text()).toContain("Job Started");
  });

  it("renders subtitle text", () => {
    const wrapper = mount(OTimelineItem, {
      props: { title: "Job Started", subtitle: "2024-01-01 12:00:00" },
    });
    expect(wrapper.text()).toContain("2024-01-01 12:00:00");
  });

  it("does not render subtitle when omitted", () => {
    const wrapper = mount(OTimelineItem, {
      props: { title: "Job Started" },
    });
    const subtitle = wrapper.find("p + p");
    expect(subtitle.exists()).toBe(false);
  });

  it("renders icon span when icon prop is provided", () => {
    const wrapper = mount(OTimelineItem, {
      props: { icon: "check_circle" },
    });
    const iconSpan = wrapper.find(".material-icons");
    expect(iconSpan.exists()).toBe(true);
    expect(iconSpan.text()).toBe("check_circle");
  });

  it("does not render icon span when icon is omitted", () => {
    const wrapper = mount(OTimelineItem);
    expect(wrapper.find(".material-icons").exists()).toBe(false);
  });

  it("renders slot content", () => {
    const wrapper = mount(OTimelineItem, {
      slots: { default: '<span class="extra">extra</span>' },
    });
    expect(wrapper.find(".extra").exists()).toBe(true);
  });

  it("always renders the connector div for connector visibility management", () => {
    const wrapper = mount(OTimelineItem);
    expect(wrapper.find(".timeline-connector").exists()).toBe(true);
  });

  /// The rail's last line used to be hidden by a scoped rule on OTimeline,
  /// which never matched: slotted markup carries the CONSUMER's scope id, so
  /// the final rung's connector hung out below the card. The item hides its
  /// own, the way OStep does.
  it("hides its connector when it is the last item, without help from OTimeline", () => {
    const wrapper = mount(OTimelineItem);
    expect(wrapper.classes()).toContain("o-timeline-item");
    expect(wrapper.find(".timeline-connector").classes()).toContain(
      "[.o-timeline-item:last-child_&]:hidden",
    );
  });

  it.each([["primary"], ["success"], ["destructive"], ["info"], ["muted"]] as const)(
    "accepts variant=%s without throwing",
    (variant) => {
      expect(() => mount(OTimelineItem, { props: { variant } })).not.toThrow();
    },
  );
});
