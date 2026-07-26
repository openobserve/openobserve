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

function mountView(versionList: GenAiAgentListItem[] = [AGENT_A, AGENT_B]) {
  return mount(VersionCompareView, {
    props: {
      versionList,
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
          // Render the window-a/window-b slots: the per-arm Manual date pickers
          // now live inside the bar (under each version picker), not in a
          // separate row, so the stub must project those slots for the manual
          // wiring tests to reach the ODateTimeRange controls.
          template: `<div data-test="stub-VersionCompareBar"><slot /><slot name="window-a" /><slot name="window-b" /></div>`,
        },
        VersionCompareBanner: stub("VersionCompareBanner"),
        VersionWindowCard: stub("VersionWindowCard"),
        VersionDeltaStrip: stub("VersionDeltaStrip"),
        VersionOverlayChart: stub("VersionOverlayChart"),
        // DateTime is the app-standard picker (same as the page header). Its stub
        // emits `on:date-change` with the epoch-µs { startTime, endTime } payload
        // the real component produces.
        DateTime: {
          name: "DateTime",
          props: ["autoApply", "disableRelative", "defaultType", "defaultAbsoluteTime", "dataTest"],
          emits: ["on:date-change"],
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

describe("VersionCompareView — default version seeding", () => {
  it("seeds A and B to two DISTINCT versions even when versionList has duplicate rows per version", () => {
    // `listVersionsForCompare` returns one row per version PER time-bucket, so a
    // version active across several windows appears multiple times. Sorting the
    // raw list by first_seen and taking [0]/[1] can pick two duplicates of the
    // SAME version → A === B → run() gated off → blank panels. Dedup must prevent
    // that. Here 2.1.0 appears 3× and 2.0.0 3× (interleaved) — the regression
    // repro from the ddsketch_test org.
    const v21 = (fs: number): GenAiAgentListItem => ({ ...AGENT_A, version: "2.1.0", first_seen: fs });
    const v20 = (fs: number): GenAiAgentListItem => ({ ...AGENT_A, version: "2.0.0", first_seen: fs });
    const dupes = [
      v21(1_784_989_582_452_101), v21(1_784_989_582_452_101),
      v20(1_784_989_422_452_101), v20(1_784_989_422_452_101),
      v21(1_784_989_113_443_419), v20(1_784_988_953_443_419),
    ];
    const w = mountView(dupes);
    const runEvents = w.emitted("run");
    expect(runEvents).toBeTruthy();
    const payload = runEvents!.at(-1)![0] as any;
    // A = latest (2.1.0), B = previous (2.0.0) — NOT two copies of 2.1.0.
    expect(payload.a.version).toBe("2.1.0");
    expect(payload.b.version).toBe("2.0.0");
    expect(payload.a.version).not.toBe(payload.b.version);
  });
});

describe("VersionCompareView — manual override wiring (the app-standard DateTime path)", () => {
  it("uses the app-standard DateTime picker for each arm in manual mode", async () => {
    const w = mountView();
    // Switch the (stubbed) bar to manual mode.
    w.findComponent({ name: "VersionCompareBar" }).vm.$emit("update:align", "manual");
    await w.vm.$nextTick();

    const aWindow = w.find('[data-test="version-compare-manual-a-window"]');
    const bWindow = w.find('[data-test="version-compare-manual-b-window"]');
    expect(aWindow.exists()).toBe(true);
    expect(bWindow.exists()).toBe(true);
    // Both pickers are the shared DateTime component (not a native input or the
    // O2-lib ODateTimeRange).
    const pickers = w
      .findAllComponents({ name: "DateTime" })
      .filter((c) => String(c.attributes("data-test") ?? "").includes("version-compare-manual"));
    expect(pickers.length).toBe(2);
    expect(w.html()).not.toContain("datetime-local");
  });

  it("swallows each picker's mount-time seed emit, then a real edit runs with BOTH arms pinned", async () => {
    const w = mountView();
    w.findComponent({ name: "VersionCompareBar" }).vm.$emit("update:align", "manual");
    await w.vm.$nextTick();

    const aPicker = w
      .findAllComponents({ name: "DateTime" })
      .find((c) => c.attributes("data-test") === "version-compare-manual-a-window")!;
    const bPicker = w
      .findAllComponents({ name: "DateTime" })
      .find((c) => c.attributes("data-test") === "version-compare-manual-b-window")!;

    // 1) Both pickers fire their mount-time seeding emit — these must be SWALLOWED
    //    (no manual run yet; entering Manual keeps the last good comparison).
    const runsBefore = (w.emitted("run") ?? []).length;
    aPicker.vm.$emit("on:date-change", { startTime: 1, endTime: 2, valueType: "absolute" });
    bPicker.vm.$emit("on:date-change", { startTime: 3, endTime: 4, valueType: "absolute" });
    await w.vm.$nextTick();
    // The last run (if any) is NOT a manual run — the seeds were swallowed.
    const afterSeed = w.emitted("run") ?? [];
    if (afterSeed.length > runsBefore) {
      expect((afterSeed.at(-1)![0] as any).align).not.toBe("manual");
    }

    // 2) A REAL user edit of arm A now runs, pinning BOTH arms (B at its seeded 3–4).
    const start = new Date("2026-07-01T00:00:00").getTime() * 1000;
    const end = new Date("2026-07-02T00:00:00").getTime() * 1000;
    aPicker.vm.$emit("on:date-change", { startTime: start, endTime: end, valueType: "absolute" });
    await w.vm.$nextTick();

    const payload = w.emitted("run")!.at(-1)![0] as any;
    expect(payload.align).toBe("manual");
    expect(payload.manual.a.start).toBe(start);
    expect(payload.manual.a.end).toBe(end);
    // Arm B pinned to its swallowed seed (3–4), NOT left empty → no NaN.
    expect(payload.manual.b).toEqual({ start: 3, end: 4 });
  });
});
