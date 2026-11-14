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

import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ErrorImpactStrip from "@/components/rum/errorTracking/view/ErrorImpactStrip.vue";
import type { ErrorImpact } from "@/composables/rum/useErrorDetail";
import i18n from "@/locales";

const NOW_MS = Date.UTC(2026, 0, 10, 12, 0, 0);
const NOW_US = NOW_MS * 1000;
const HOUR_US = 3_600_000_000;
const DAY_US = 86_400_000_000;

const baseImpact: ErrorImpact = {
  events: 1240,
  usersAffected: 37,
  sessionsAffected: 52,
  firstSeen: NOW_US - 3 * DAY_US,
  lastSeen: NOW_US - 2 * HOUR_US,
};

describe("ErrorImpactStrip", () => {
  let wrapper: VueWrapper<any>;

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(ErrorImpactStrip, {
      props: { impact: baseImpact, ...props },
      global: { plugins: [i18n] },
    });

  const tileText = (key: string) => wrapper.find(`[data-test="rum-error-impact-${key}"]`).text();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("shows the occurrence count", () => {
      wrapper = mountComponent();

      expect(tileText("events")).toContain("1.2K");
    });

    it("shows the users and sessions reached", () => {
      wrapper = mountComponent();

      expect(tileText("users")).toContain("37");
      expect(tileText("sessions")).toContain("52");
    });

    it("shows first and last seen as compact ages", () => {
      wrapper = mountComponent();

      expect(tileText("first-seen")).toContain("3d");
      expect(tileText("last-seen")).toContain("2h");
    });

    it("shows the absolute lifespan caption", () => {
      wrapper = mountComponent();

      expect(wrapper.find('[data-test="rum-error-impact-strip-scope"]').text()).toContain(
        "First seen",
      );
    });
  });

  describe("missing data", () => {
    it("shows a dash for every tile while loading", () => {
      wrapper = mountComponent({ loading: true });

      expect(tileText("events")).toContain("—");
      expect(tileText("users")).toContain("—");
      expect(tileText("first-seen")).toContain("—");
    });

    it("hides the lifespan caption while loading", () => {
      wrapper = mountComponent({ loading: true });

      expect(wrapper.find('[data-test="rum-error-impact-strip-scope"]').exists()).toBe(false);
    });

    it("shows a dash rather than a zero when a count is unavailable", () => {
      wrapper = mountComponent({
        impact: { ...baseImpact, usersAffected: null, sessionsAffected: null },
      });

      expect(tileText("users")).toContain("—");
      expect(tileText("sessions")).toContain("—");
    });

    it("shows a dash for every tile when there is no impact at all", () => {
      wrapper = mountComponent({ impact: null });

      expect(tileText("events")).toContain("—");
      expect(tileText("last-seen")).toContain("—");
    });

    it("renders a real zero as zero", () => {
      wrapper = mountComponent({ impact: { ...baseImpact, events: 0 } });

      expect(tileText("events")).toContain("0");
    });
  });

  describe("weak signature", () => {
    it("explains why the issue cannot be aggregated", () => {
      wrapper = mountComponent({ impact: null, hasSignature: false });

      expect(wrapper.find('[data-test="rum-error-impact-strip-scope"]').text()).toContain(
        "cannot be grouped",
      );
    });
  });
});
