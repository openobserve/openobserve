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
});
