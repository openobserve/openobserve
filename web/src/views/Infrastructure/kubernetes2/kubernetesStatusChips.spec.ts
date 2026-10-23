import { describe, expect, it } from "vitest";
import { matchesStatusChip, statusChipsFor } from "./kubernetesStatusChips";

const pod = (phase: string, ready: string | null = "true") =>
  ({ kind: "pod", phase, ready, statusReason: null, object: null }) as any;

describe("statusChipsFor", () => {
  it("counts pod buckets with All first", () => {
    const rows = [
      pod("Running"),
      pod("Running"),
      pod("Pending", null),
      pod("Failed"),
      pod("Succeeded"),
    ];
    expect(statusChipsFor("pods", rows).map((c) => [c.id, c.count])).toEqual([
      ["all", 5],
      ["running", 2],
      ["pending", 1],
      ["failing", 1],
      ["completed", 1],
    ]);
  });

  it("buckets events by type", () => {
    const rows = [{ type: "Warning" }, { type: "Normal" }, { type: "Normal" }];
    expect(statusChipsFor("events", rows).map((c) => [c.id, c.count])).toEqual([
      ["all", 3],
      ["warnings", 1],
      ["normal", 2],
    ]);
  });

  it("offers no chips on other views", () => {
    expect(statusChipsFor("nodes", [])).toEqual([]);
  });
});

describe("matchesStatusChip", () => {
  it("filters pods and passes everything for all", () => {
    expect(matchesStatusChip("pods", pod("Failed"), "failing")).toBe(true);
    expect(matchesStatusChip("pods", pod("Running"), "failing")).toBe(false);
    expect(matchesStatusChip("pods", pod("Running"), "all")).toBe(true);
  });
});
