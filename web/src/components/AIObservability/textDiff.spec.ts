// Copyright 2026 OpenObserve Inc.
import { describe, expect, it } from "vitest";
import { diffLines, diffStats } from "./textDiff";

const changedText = (segments: { text: string; changed: boolean }[] = []) =>
  segments
    .filter((segment) => segment.changed)
    .map((segment) => segment.text)
    .join("");

describe("diffLines", () => {
  it("reports no changes for identical text", () => {
    const rows = diffLines("a\nb", "a\nb");
    expect(rows.every((row) => !row.changed)).toBe(true);
    expect(diffStats(rows)).toEqual({ added: 0, removed: 0 });
  });

  it("pairs an edited line and highlights only the changed words", () => {
    const [row] = diffLines("Keep answers short.", "Keep answers under 120 words.");
    expect(row.changed).toBe(true);
    expect(changedText(row.left?.segments)).toBe("short.");
    expect(changedText(row.right?.segments)).toContain("under");
    expect(changedText(row.right?.segments)).not.toContain("Keep");
  });

  it("leaves the other side empty for pure additions and removals", () => {
    const rows = diffLines("a\nb", "a\nb\nc");
    const added = rows.find((row) => row.changed);
    expect(added?.left).toBeNull();
    expect(added?.right?.lineNumber).toBe(3);
    expect(diffStats(diffLines("a\nb\nc", "a"))).toEqual({ added: 0, removed: 2 });
  });

  it("numbers each side independently", () => {
    const rows = diffLines("x\na", "a");
    expect(
      rows.map((row) => [row.left?.lineNumber ?? null, row.right?.lineNumber ?? null]),
    ).toEqual([
      [1, null],
      [2, 1],
    ]);
  });
});
