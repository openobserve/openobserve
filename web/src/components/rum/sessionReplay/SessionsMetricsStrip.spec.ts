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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SessionsMetricsStrip from "@/components/rum/sessionReplay/SessionsMetricsStrip.vue";
import i18n from "@/locales";

const baseProps = {
  total: 150,
  errorSessions: 12,
  frustratedSessions: 4,
  bouncedSessions: 30,
  bounceBase: 150,
  avgDurationMs: 65_000,
  medianDurationMs: 40_000,
  activeCard: "",
};

const mountStrip = (props: Record<string, unknown> = {}) =>
  mount(SessionsMetricsStrip, {
    props: { ...baseProps, ...props },
    global: { plugins: [i18n] },
  });

const value = (wrapper: ReturnType<typeof mountStrip>, key: string) =>
  wrapper.find(`[data-test="rum-sessions-metric-${key}-value"]`).text();

describe("SessionsMetricsStrip", () => {
  it("shows a dash, not the page count, while the window totals load", () => {
    const wrapper = mountStrip({ totalsPending: true });

    expect(value(wrapper, "sessions")).toBe("—");
    expect(value(wrapper, "errors")).toBe("—");
    expect(value(wrapper, "frustrated")).toBe("—");
    expect(wrapper.text()).not.toContain("8.0%");
  });

  it("shows page-scoped tiles as soon as the page is ready", () => {
    const wrapper = mountStrip({ totalsPending: true, pagePending: false });

    expect(value(wrapper, "duration")).not.toBe("—");
    expect(value(wrapper, "bounced")).toBe("20.0%");
  });

  it("shows a dash on page-scoped tiles while the page loads", () => {
    const wrapper = mountStrip({ pagePending: true });

    expect(value(wrapper, "duration")).toBe("—");
    expect(value(wrapper, "bounced")).toBe("—");
    expect(value(wrapper, "sessions")).toBe("150");
  });

  it("shows the numbers once nothing is pending", () => {
    const wrapper = mountStrip();

    expect(value(wrapper, "sessions")).toBe("150");
    expect(value(wrapper, "errors")).toBe("12");
  });
});
