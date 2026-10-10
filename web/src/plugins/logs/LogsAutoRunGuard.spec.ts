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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import LogsAutoRunGuard from "./LogsAutoRunGuard.vue";
import type { AutoRunBlocked } from "@/composables/useLogs/useAutoRun";

const blocked = (overrides: Partial<AutoRunBlocked> = {}): AutoRunBlocked =>
  ({
    reason: "time",
    reasons: ["time"],
    op: "full",
    scope: {} as any,
    estimate: {
      status: "known",
      knownMb: 1843200,
      streams: [{ name: "k8s_logs", status: "known", estimateMb: 1843200, cause: null }],
      unknownStreams: [],
      unresolvedSources: [],
      superCluster: false,
      window: { startUs: 0, endUs: 1 },
    },
    decision: { allowed: false, reason: "over-threshold", estimateMb: 1843200 },
    estimateMb: 1843200,
    status: "known",
    streams: ["k8s_logs"],
    window: { type: "relative", period: "7d" },
    narrowTo: {
      period: "3h",
      durationUs: 3 * 3600e6,
      estimate: { status: "known", knownMb: 32768 } as any,
      decision: { allowed: true, reason: "within-threshold", estimateMb: 32768 },
    },
    ...overrides,
  }) as AutoRunBlocked;

const mountGuard = (props: Record<string, unknown>) =>
  mount(LogsAutoRunGuard, {
    props: { blocked: blocked(), ...props },
    global: { plugins: [i18n], provide: { store } },
  });

describe("LogsAutoRunGuard (J5, F5–F9)", () => {
  it("names the size, scope and Auto Run, with the three actions (F5)", async () => {
    const wrapper = mountGuard({ autoRunOn: true, showSearchJob: true });
    expect(wrapper.find('[data-test="logs-auto-run-guard"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("This search would scan about 1.76 TB");
    expect(wrapper.find('[data-test="logs-auto-run-guard-estimate"]').text()).toBe(
      "k8s_logs · Past 7 Days. Auto Run paused so you can narrow it first.",
    );
    expect(wrapper.find('[data-test="logs-auto-run-guard-hint"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="logs-auto-run-guard-narrow-btn"]').text()).toBe(
      "Narrow to Past 3 Hours (~32.00 GB)",
    );

    await wrapper.find('[data-test="logs-auto-run-guard-run-btn"]').trigger("click");
    await wrapper.find('[data-test="logs-auto-run-guard-narrow-btn"]').trigger("click");
    await wrapper.find('[data-test="logs-auto-run-guard-search-job-btn"]').trigger("click");
    expect(wrapper.emitted("run")).toHaveLength(1);
    expect(wrapper.emitted("narrow")?.[0]).toEqual(["3h"]);
    expect(wrapper.emitted("search-job")).toHaveLength(1);
  });

  it("says 'Paused' without the Auto Run hint when Auto Run is off (F14)", () => {
    const wrapper = mountGuard({ autoRunOn: false });
    expect(wrapper.find('[data-test="logs-auto-run-guard-estimate"]').text()).toContain(
      "Paused so you can narrow it first.",
    );
    expect(wrapper.find('[data-test="logs-auto-run-guard-hint"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="logs-auto-run-guard-search-job-btn"]').exists()).toBe(false);
  });

  it("titles a guarded shared link as a link (F7)", () => {
    const wrapper = mountGuard({ blocked: blocked({ reasons: ["url"], reason: "url" }) });
    expect(wrapper.text()).toContain("This link would scan about");
    expect(wrapper.text()).toContain("Opened from a link");
  });

  it("shows no number for an unknown size and offers the allowed hour (F8)", () => {
    const wrapper = mountGuard({
      blocked: blocked({
        decision: { allowed: false, reason: "unknown-window", estimateMb: 0 },
        estimate: { ...blocked().estimate, status: "unknown", unknownStreams: ["fresh"] },
        narrowTo: { ...blocked().narrowTo!, period: "1h", estimate: { status: "unknown" } as any },
      }),
    });
    expect(wrapper.text()).toContain("Size unknown for this window");
    expect(wrapper.text()).toContain("fresh has no size statistics yet");
    expect(wrapper.find('[data-test="logs-auto-run-guard-narrow-btn"]').text()).toBe(
      "Narrow to Past 1 Hour",
    );
  });

  it("is calm on a super cluster: Run query, no Narrow to (F9)", () => {
    const wrapper = mountGuard({
      blocked: blocked({
        decision: { allowed: false, reason: "unknown-unvalidated", estimateMb: 0 },
        estimate: { ...blocked().estimate, status: "unknown", superCluster: true },
        narrowTo: null,
      }),
    });
    expect(wrapper.text()).toContain("Ready to run across regions");
    expect(wrapper.find('[data-test="logs-auto-run-guard-run-btn"]').text()).toBe("Run query");
    expect(wrapper.find('[data-test="logs-auto-run-guard-narrow-btn"]').exists()).toBe(false);
  });

  it("names an unreadable SQL source and offers only Select a stream", async () => {
    const wrapper = mountGuard({
      showSearchJob: true,
      blocked: blocked({
        decision: { allowed: false, reason: "unresolved", estimateMb: 0 },
        estimate: { ...blocked().estimate, status: "unresolved", unresolvedSources: ["secret"] },
      }),
    });
    expect(wrapper.text()).toContain(
      "Stream secret does not exist or you don't have access to it.",
    );
    expect(wrapper.find('[data-test="logs-auto-run-guard-run-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="logs-auto-run-guard-search-job-btn"]').exists()).toBe(false);
    await wrapper.find('[data-test="logs-auto-run-guard-select-stream-btn"]').trigger("click");
    expect(wrapper.emitted("select-stream")).toHaveLength(1);
  });

  it("renders the banner over existing rows, naming a paused refresh (F6, F17)", () => {
    const banner = mountGuard({ variant: "banner", autoRunOn: true });
    expect(banner.find('[data-test="logs-auto-run-guard-banner"]').exists()).toBe(true);
    expect(banner.find('[data-test="logs-auto-run-guard-estimate"]').text()).toBe(
      "This change would scan about 1.76 TB (k8s_logs · Past 7 Days), so Auto Run paused. The results below are from the previous query.",
    );

    const refresh = mountGuard({
      variant: "banner",
      blocked: blocked({ reasons: ["refresh"], reason: "refresh" }),
    });
    expect(refresh.text()).toContain("Auto-refresh would scan about 1.76 TB per refresh");
  });

  it("lists up to three streams, then +N", () => {
    const wrapper = mountGuard({
      blocked: blocked({
        estimate: {
          ...blocked().estimate,
          streams: ["a", "b", "c", "d", "e"].map((name) => ({
            name,
            status: "known",
            estimateMb: 1,
            cause: null,
          })),
        },
      }),
    });
    expect(wrapper.find('[data-test="logs-auto-run-guard-estimate"]').text()).toContain(
      "a, b, c +2 · Past 7 Days",
    );
  });
});
