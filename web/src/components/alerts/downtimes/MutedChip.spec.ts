// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import store from "@/test/unit/helpers/store";
import announcements from "@/services/announcements";
import { useAnnouncementBanners } from "@/composables/useAnnouncementBanners";
import MutedChip from "./MutedChip.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});

const NOW = Date.parse("2026-09-17T14:10:00Z");

describe("MutedChip", () => {
  afterEach(() => vi.useRealTimers());

  it("says how long the mute has left, rounded up to the minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const wrapper = mount(MutedChip, {
      props: {
        downtime: { id: "d1", name: "INC-231", ends_at: (NOW + 72 * 60_000 - 30_000) * 1000 },
      },
    });
    expect(wrapper.text()).toContain("Muted · ends in 1 h 12 min");
  });

  const at = (minutes: number) => (NOW + minutes * 60_000) * 1000;
  const chipText = (downtime: Record<string, unknown>) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return mount(MutedChip, {
      props: { downtime: { id: "d1", name: "Quick mute", ...downtime } as never },
    }).text();
  };

  it("says an until-it-clears mute ends when the alert clears, not at its 24 h safety end", () => {
    const text = chipText({ ends_at: at(24 * 60), end_on_clear: { alert_id: "a1" } });
    expect(text).toContain("Muted until it clears · 24 h at most");
    expect(text).not.toContain("ends in");
  });

  it("counts the groups of a group mute", () => {
    expect(
      chipText({ ends_at: at(52), alert_groups: [{ alert_id: "a1", group_key: "k1" }] }),
    ).toContain("Muted · 1 group · ends in 52 min");
    expect(
      chipText({
        ends_at: at(52),
        alert_groups: [
          { alert_id: "a1", group_key: "k1" },
          { alert_id: "a1", group_key: "k2" },
        ],
      }),
    ).toContain("Muted · 2 groups · ends in 52 min");
  });

  it("counts the groups of an until-it-clears group mute", () => {
    expect(
      chipText({
        ends_at: at(24 * 60),
        end_on_clear: { alert_id: "a1", group_key: "k1" },
        alert_groups: [{ alert_id: "a1", group_key: "k1" }],
      }),
    ).toContain("Muted until it clears · 1 group");
  });

  it("keeps the plain countdown when the server sends empty group and clear fields", () => {
    const text = chipText({ ends_at: at(219), end_on_clear: null, alert_groups: [] });
    expect(text).toContain("Muted · ends in 3 h 39 min");
  });

  it("renders nothing once the mute has ended", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const wrapper = mount(MutedChip, {
      props: { downtime: { id: "d1", name: "INC-231", ends_at: (NOW - 1000) * 1000 } },
    });
    expect(wrapper.find('[data-test="muted-chip"]').exists()).toBe(false);
  });

  it("counts down on the banner's skew-corrected clock, not the browser's", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(announcements, "getActive").mockResolvedValue({
      // Server runs 30 minutes ahead of this browser.
      data: { banners: [], now: (NOW + 30 * 60_000) * 1000 },
    } as never);
    const host = mount(
      defineComponent({
        setup() {
          const { refresh } = useAnnouncementBanners();
          return { refresh };
        },
        render: () => h("div"),
      }),
      { global: { plugins: [store] } },
    );
    await (host.vm as unknown as { refresh: () => Promise<void> }).refresh();

    const wrapper = mount(MutedChip, {
      props: { downtime: { id: "d1", name: "INC-231", ends_at: (NOW + 60 * 60_000) * 1000 } },
    });
    expect(wrapper.text()).toContain("Muted · ends in 30 min");
    host.unmount();
  });

  const tooltipOf = (downtime: Record<string, unknown>) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const wrapper = mount(MutedChip, {
      props: { downtime: { id: "d1", name: "Quick mute", ...downtime } as never },
    });
    return String(wrapper.findComponent({ name: "OTooltip" }).props("content"));
  };

  it("names the muted groups on hover when the server sends their labels", () => {
    const tip = tooltipOf({
      ends_at: at(52),
      alert_groups: [{ alert_id: "a1", group_key: "k1", group_labels: "cluster=prod-ap" }],
    });
    expect(tip).toContain("cluster=prod-ap");
  });

  it("keeps the plain hover text for a group mute without labels", () => {
    const tip = tooltipOf({ ends_at: at(52), alert_groups: [{ alert_id: "a1", group_key: "k1" }] });
    expect(tip).toContain("Muted by Quick mute until");
    expect(tip).not.toContain("Groups:");
  });
});
