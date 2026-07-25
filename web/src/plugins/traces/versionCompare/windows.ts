// windows.ts
import { CONCURRENT_MIN } from "./constants";

export interface VersionMeta { firstSeen: number; lastSeen: number; }
export type AlignMode = "sinceRollout" | "sameWallClock" | "manual";
export type OverlapState = "concurrent" | "partial" | "disjoint";
export interface Win { start: number; end: number; }
export interface CompareWindows {
  mode: AlignMode; a: Win; b: Win; deltaMicros: number;
  limitedBy: "a" | "b" | null; overlap: OverlapState; overlapFraction: number;
}

function overlapMicros(a: Win, b: Win): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function resolveCompareWindows(
  a: VersionMeta, b: VersionMeta, now: number, mode: AlignMode = "sinceRollout",
): CompareWindows {
  const aNat: Win = { start: a.firstSeen, end: Math.min(a.lastSeen, now) };
  const bNat: Win = { start: b.firstSeen, end: b.lastSeen };
  const durA = aNat.end - aNat.start;
  const durB = bNat.end - bNat.start;
  const ov = overlapMicros(aNat, bNat);
  const overlapFraction = Math.min(durA, durB) > 0 ? ov / Math.min(durA, durB) : 0;
  const overlap: OverlapState =
    overlapFraction >= CONCURRENT_MIN ? "concurrent" : overlapFraction > 0 ? "partial" : "disjoint";

  if (mode === "manual") {
    return { mode, a: aNat, b: bNat, deltaMicros: Math.min(durA, durB),
      limitedBy: null, overlap, overlapFraction };
  }

  // auto-pick sameWallClock only when concurrent
  const resolvedMode: AlignMode = overlap === "concurrent" ? "sameWallClock" : "sinceRollout";

  if (resolvedMode === "sameWallClock") {
    // caller supplies the shared page window; here we report natural for reference.
    return { mode: resolvedMode, a: aNat, b: bNat, deltaMicros: Math.min(durA, durB),
      limitedBy: null, overlap, overlapFraction };
  }

  // sinceRollout: equal-length Δ, A's first Δ, B's last Δ
  const delta = Math.min(durA, durB);
  const limitedBy = durA === durB ? null : durA < durB ? "a" : "b";
  const aWin: Win = { start: aNat.start, end: aNat.start + delta };
  const bWin: Win = { start: bNat.end - delta, end: bNat.end };
  return { mode: resolvedMode, a: aWin, b: bWin, deltaMicros: delta, limitedBy, overlap, overlapFraction };
}
