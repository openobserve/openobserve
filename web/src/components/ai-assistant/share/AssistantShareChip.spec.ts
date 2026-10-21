// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import type { ShareSummary } from "@/composables/assistant/pure";

import AssistantShareChip from "./AssistantShareChip.vue";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const summary = (over: Partial<ShareSummary> = {}): ShareSummary => ({
  id: "s1",
  visibility: "org",
  mode: "snapshot",
  expiresAt: NOW + 90 * 24 * HOUR,
  outOfDate: false,
  count: 1,
  ...over,
});

const chip = (share: ShareSummary | null) =>
  mount(AssistantShareChip, { props: { share, now: NOW } }).find(
    '[data-test="assistant-thread-share-chip"]',
  );

describe("AssistantShareChip", () => {
  it("is absent for a private chat", () => {
    expect(chip(null).exists()).toBe(false);
  });

  it("names visibility and content", () => {
    expect(chip(summary()).text()).toBe("Shared · Org · Snapshot");
    expect(chip(summary({ visibility: "public", mode: "live" })).text()).toBe(
      "Shared · Public · Live",
    );
  });

  it("shows the time left in the warm tone within a day", () => {
    const tag = chip(summary({ visibility: "public", expiresAt: NOW + 20 * HOUR + 60_000 }));
    expect(tag.text()).toBe("Shared · Public · 20 h left");
    expect(tag.classes().join(" ")).toMatch(/warning/);
    expect(chip(summary({ expiresAt: NOW + 25 * 60_000 })).text()).toBe(
      "Shared · Org · 25 min left",
    );
  });

  it("counts several links and marks a stale snapshot", () => {
    expect(chip(summary({ count: 2 })).text()).toBe("Shared · 2 links");
    expect(chip(summary({ outOfDate: true })).text()).toBe("Shared · Org · Snapshot · out of date");
  });

  it("counts down each minute on its own and leaves at expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const wrapper = mount(AssistantShareChip, {
        props: { share: summary({ expiresAt: NOW + 3 * 60_000 }) },
      });
      const tag = () => wrapper.find('[data-test="assistant-thread-share-chip"]');
      expect(tag().text()).toBe("Shared · Org · 3 min left");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(tag().text()).toBe("Shared · Org · 2 min left");
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(tag().exists()).toBe(false);
      wrapper.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens Manage link on click", async () => {
    const wrapper = mount(AssistantShareChip, { props: { share: summary(), now: NOW } });
    await wrapper.find('[data-test="assistant-thread-share-chip"]').trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });
});
