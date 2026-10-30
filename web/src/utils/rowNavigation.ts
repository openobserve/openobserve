// Copyright 2026 OpenObserve Inc.

export type RowNavTarget =
  | { kind: "select"; index: number }
  | { kind: "page"; page: number; position: "first" | "last" }
  | { kind: "edge"; edge: "first" | "last" }
  | { kind: "none" };

export interface RowNavInput {
  anchor: number | null;
  count: number;
  direction: 1 | -1;
  /** 1-based. */
  page: number;
  pageCount: number;
  canChangePage: boolean;
  isRepeat: boolean;
}

export function nextRowTarget(input: RowNavInput): RowNavTarget {
  const { anchor, count, direction, page, pageCount, canChangePage, isRepeat } = input;
  if (count <= 0) return { kind: "none" };
  if (anchor === null || anchor < 0 || anchor >= count) {
    return direction === 1 ? { kind: "select", index: 0 } : { kind: "none" };
  }
  const next = anchor + direction;
  if (next >= 0 && next < count) return { kind: "select", index: next };
  const mayCross = canChangePage && !isRepeat;
  if (direction === 1) {
    return mayCross && page < pageCount
      ? { kind: "page", page: page + 1, position: "first" }
      : { kind: "edge", edge: "last" };
  }
  return mayCross && page > 1
    ? { kind: "page", page: page - 1, position: "last" }
    : { kind: "edge", edge: "first" };
}

export function nextVisibleSpan(
  visibleIds: string[],
  selectedId: string | null,
  ancestorsOf: (spanId: string) => string[],
  direction: 1 | -1,
): string | null {
  if (visibleIds.length === 0) return null;
  const position = new Map(visibleIds.map((id, i) => [id, i]));
  const fromStart = () => (direction === 1 ? visibleIds[0] : null);
  if (selectedId === null) return fromStart();

  const at = position.get(selectedId);
  if (at !== undefined) return visibleIds[at + direction] ?? null;

  const ancestorAt = ancestorsOf(selectedId)
    .map((id) => position.get(id))
    .find((i) => i !== undefined);
  if (ancestorAt === undefined) return fromStart();
  return direction === -1 ? visibleIds[ancestorAt] : (visibleIds[ancestorAt + 1] ?? null);
}

export function ancestorChain(
  spanId: string,
  parentOf: (spanId: string) => string | null | undefined,
  maxHops: number,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([spanId]);
  let current = parentOf(spanId);
  while (current && !seen.has(current) && chain.length < maxHops) {
    chain.push(current);
    seen.add(current);
    current = parentOf(current);
  }
  return chain;
}
