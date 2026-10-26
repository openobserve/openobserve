// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OSegmentedBar from "./OSegmentedBar.vue";
import { SEGMENT_SWATCH, type SegmentedBarVariant } from "./OSegmentedBar.types";
import { raw } from "@/types/i18n";

const find = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-test="${id}"]`);

describe("OSegmentedBar", () => {
  it("renders one segment per entry with its width", () => {
    const w = mount(OSegmentedBar, {
      props: {
        segments: [
          { id: "a", pct: 60, variant: "success" },
          { id: "b", pct: 40, variant: "danger" },
        ],
      },
    });
    expect(find(w, "o-segmented-bar-segment-a").attributes("style")).toContain("width: 60%");
    expect(find(w, "o-segmented-bar-segment-b").attributes("style")).toContain("width: 40%");
  });

  it("maps variants to token classes and defaults to the accent", () => {
    const w = mount(OSegmentedBar, {
      props: {
        segments: [
          { id: "a", pct: 10, variant: "warning" },
          { id: "b", pct: 10 },
        ],
      },
    });
    expect(find(w, "o-segmented-bar-segment-a").classes()).toContain("bg-status-warning-text");
    expect(find(w, "o-segmented-bar-segment-b").classes()).toContain("bg-accent");
  });

  it("clamps out-of-range percentages", () => {
    const w = mount(OSegmentedBar, {
      props: {
        segments: [
          { id: "a", pct: -5 },
          { id: "b", pct: 250 },
        ],
      },
    });
    expect(find(w, "o-segmented-bar-segment-a").attributes("style")).toContain("width: 0%");
    expect(find(w, "o-segmented-bar-segment-b").attributes("style")).toContain("width: 100%");
  });

  it("draws markers at their position", () => {
    const w = mount(OSegmentedBar, {
      props: {
        segments: [],
        markers: [{ id: "limit", pct: 80, variant: "danger" }],
      },
    });
    const marker = find(w, "o-segmented-bar-marker-limit");
    expect(marker.attributes("style")).toContain("inset-inline-start: 80%");
    expect(marker.classes()).toContain("bg-status-negative");
  });

  it("uses a taller track for size md", () => {
    expect(mount(OSegmentedBar, { props: { segments: [] } }).classes()).toContain("h-2");
    expect(mount(OSegmentedBar, { props: { segments: [], size: "md" } }).classes()).toContain(
      "h-2.5",
    );
  });

  it("exposes an image role when labelled and hides itself otherwise", () => {
    const labelled = mount(OSegmentedBar, { props: { segments: [], label: raw("Pods") } });
    expect(labelled.attributes("role")).toBe("img");
    expect(labelled.attributes("aria-label")).toBe("Pods");
    const plain = mount(OSegmentedBar, { props: { segments: [] } });
    expect(plain.attributes("aria-hidden")).toBe("true");
    expect(plain.attributes("role")).toBeUndefined();
  });

  it("exports one swatch class per variant and the bar paints with the same classes", () => {
    const variants = Object.keys(SEGMENT_SWATCH) as SegmentedBarVariant[];
    expect(variants).toHaveLength(8);
    const w = mount(OSegmentedBar, {
      props: { segments: variants.map((variant) => ({ id: variant, pct: 1, variant })) },
    });
    for (const variant of variants) {
      expect(find(w, `o-segmented-bar-segment-${variant}`).classes()).toContain(
        SEGMENT_SWATCH[variant],
      );
    }
  });
});
