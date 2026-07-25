// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

import VersionCompareView from "./VersionCompareView.vue";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";

// Stub the heavy children so this spec targets VersionCompareView's OWN wiring
// (align mode + manual-override → run payload), not their internals (each has
// its own spec). The stubs re-emit the events the view listens to.
const stub = (name: string, emits: string[] = []) => ({
  name,
  props: ["versions", "a", "b", "align", "prefix", "envs", "arm", "env", "version", "window", "traceCount", "limitedBy", "deltaHours", "overlap", "enoughSample", "nA", "nB", "result", "seriesA", "seriesB", "mode", "modelValue", "startDate", "startTime", "endDate", "endTime"],
  emits,
  template: `<div :data-test="'stub-' + '${name}'"></div>`,
});

const AGENT_A: GenAiAgentListItem = {
  name: "checkout-agent", id: "a1", source_stream: "s", source_stream_type: "traces",
  env: "prod", version: "1.5.0", first_seen: 1_700_000_000_000_000, last_seen: 1_700_100_000_000_000,
};
const AGENT_B: GenAiAgentListItem = { ...AGENT_A, id: "a2", version: "1.4.0" };

function mountView() {
  return mount(VersionCompareView, {
    props: {
      versionList: [AGENT_A, AGENT_B],
      stream: "s",
      windows: null,
      result: null,
      sparklinesA: null,
      sparklinesB: null,
    },
    global: {
      stubs: {
        VersionCompareBar: {
          ...stub("VersionCompareBar", ["update:a", "update:b", "update:align", "exit"]),
        },
        VersionCompareBanner: stub("VersionCompareBanner"),
        VersionWindowCard: stub("VersionWindowCard"),
        VersionDeltaStrip: stub("VersionDeltaStrip"),
        VersionOverlayChart: stub("VersionOverlayChart"),
        // ODateTimeRange stub emits the same `change` payload shape the real one does.
        ODateTimeRange: {
          name: "ODateTimeRange",
          props: ["mode", "disableRelative", "withSeconds", "label", "dataTest"],
          emits: ["change"],
          template: `<div :data-test="dataTest"></div>`,
        },
        OContent: { template: "<div><slot /></div>" },
        OCard: { template: "<div><slot /></div>" },
        OCardSection: { template: "<div><slot /></div>" },
        OInput: true,
      },
    },
  });
}

describe("VersionCompareView — manual override wiring (the O2 ODateTimeRange path)", () => {
  it("uses ODateTimeRange (not native datetime-local) for each arm in manual mode", async () => {
    const w = mountView();
    // Switch the (stubbed) bar to manual mode.
    w.findComponent({ name: "VersionCompareBar" }).vm.$emit("update:align", "manual");
    await w.vm.$nextTick();

    const aWindow = w.find('[data-test="version-compare-manual-a-window"]');
    const bWindow = w.find('[data-test="version-compare-manual-b-window"]');
    expect(aWindow.exists()).toBe(true);
    expect(bWindow.exists()).toBe(true);
    // No native datetime-local anywhere.
    expect(w.html()).not.toContain("datetime-local");
  });

  it("converts an ODateTimeRange change to an epoch-µs manual window and emits `run` for that arm", async () => {
    const w = mountView();
    w.findComponent({ name: "VersionCompareBar" }).vm.$emit("update:align", "manual");
    await w.vm.$nextTick();

    // Emit an absolute date/time range on arm A's control.
    const aRange = w
      .findAllComponents({ name: "ODateTimeRange" })
      .find((c) => c.attributes("data-test") === "version-compare-manual-a-window")!;
    aRange.vm.$emit("change", {
      startDate: "2026-07-01",
      startTime: "00:00:00",
      endDate: "2026-07-02",
      endTime: "00:00:00",
      timezone: "UTC",
    });
    await w.vm.$nextTick();

    const runEvents = w.emitted("run");
    expect(runEvents).toBeTruthy();
    const payload = runEvents!.at(-1)![0] as any;
    expect(payload.align).toBe("manual");
    // 2026-07-01T00:00:00 local → ms → *1000 µs. Assert it's the right arm and a finite µs value.
    expect(payload.manual.a).toBeTruthy();
    const expectedStart = new Date("2026-07-01T00:00:00").getTime() * 1000;
    const expectedEnd = new Date("2026-07-02T00:00:00").getTime() * 1000;
    expect(payload.manual.a.start).toBe(expectedStart);
    expect(payload.manual.a.end).toBe(expectedEnd);
    // Arm B untouched → not in this payload.
    expect(payload.manual.b).toBeUndefined();
  });
});
