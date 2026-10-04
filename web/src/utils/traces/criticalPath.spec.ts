// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import {
  computeCriticalPath,
  computeCriticalPathForRoots,
  toCriticalPathNode,
  type CriticalPathNode,
  type CriticalPathSection,
  type TraceTreeSpan,
} from "./criticalPath";

interface JaegerSpan {
  spanID: string;
  startTime: number;
  duration: number;
  references: { refType: "CHILD_OF"; spanID: string }[];
}

interface JaegerSection {
  spanId: string;
  section_start: number;
  section_end: number;
}

const span = (
  spanID: string,
  startTime: number,
  duration: number,
  parent?: string,
): JaegerSpan => ({
  spanID,
  startTime,
  duration,
  references: parent ? [{ refType: "CHILD_OF", spanID: parent }] : [],
});

const node = (
  spanId: string,
  startTimeUs: number,
  endTimeUs: number,
  children: CriticalPathNode[] = [],
): CriticalPathNode => ({ spanId, startTimeUs, endTimeUs, children });

const section = (
  spanId: string,
  sectionStartUs: number,
  sectionEndUs: number,
): CriticalPathSection => ({ spanId, sectionStartUs, sectionEndUs });

function jaegerToRoots(spans: JaegerSpan[]): CriticalPathNode[] {
  const nodes = new Map(
    spans.map((s) => [s.spanID, node(s.spanID, s.startTime, s.startTime + s.duration)]),
  );
  const roots: CriticalPathNode[] = [];
  for (const s of spans) {
    const parent = s.references[0] && nodes.get(s.references[0].spanID);
    if (parent) parent.children.push(nodes.get(s.spanID)!);
    else roots.push(nodes.get(s.spanID)!);
  }
  return roots;
}

const fromJaegerSections = (sections: JaegerSection[]) =>
  sections.map((s) => section(s.spanId, s.section_start, s.section_end));

// Fixtures ported from Grafana's CriticalPath/testCases (test5 is FOLLOWS_FROM-only, which the waterfall has no notion of).
const grafanaCases: { name: string; spans: JaegerSpan[]; expected: JaegerSection[] }[] = [
  {
    name: "test1: sequential children with gaps",
    spans: [
      span("span-E", 50, 10, "span-C"),
      span("span-C", 1, 100),
      span("span-D", 20, 20, "span-C"),
    ],
    expected: [
      { spanId: "span-C", section_start: 60, section_end: 101 },
      { spanId: "span-E", section_start: 50, section_end: 60 },
      { spanId: "span-C", section_start: 40, section_end: 50 },
      { spanId: "span-D", section_start: 20, section_end: 40 },
      { spanId: "span-C", section_start: 1, section_end: 20 },
    ],
  },
  {
    name: "test2: concurrent children, only the last finisher is critical",
    spans: [
      span("span-X", 1, 100),
      span("span-A", 10, 40, "span-X"),
      span("span-C", 20, 40, "span-X"),
    ],
    expected: [
      { spanId: "span-X", section_start: 60, section_end: 101 },
      { spanId: "span-C", section_start: 20, section_end: 60 },
      { spanId: "span-X", section_start: 1, section_end: 20 },
    ],
  },
  {
    name: "test3: child starting after its parent ends is dropped",
    spans: [
      span("006c3cf93508f205", 1679437737490189, 36),
      span("2dc4b796e2127e32", 1679437737491529, 79182, "006c3cf93508f205"),
    ],
    expected: [
      {
        spanId: "006c3cf93508f205",
        section_start: 1679437737490189,
        section_end: 1679437737490189 + 36,
      },
    ],
  },
  {
    name: "test4: a dropped child takes its subtree with it",
    spans: [
      span("span-A", 1, 30),
      span("span-B", 40, 40, "span-A"),
      span("span-c", 50, 10, "span-B"),
    ],
    expected: [{ spanId: "span-A", section_start: 1, section_end: 31 }],
  },
  {
    name: "test6: grandchild is clamped to its already-clamped parent",
    spans: [
      span("span-A", 1, 29),
      span("span-B", 15, 20, "span-A"),
      span("span-C", 10, 15, "span-B"),
    ],
    expected: [
      { spanId: "span-B", section_start: 25, section_end: 30 },
      { spanId: "span-C", section_start: 15, section_end: 25 },
      { spanId: "span-A", section_start: 1, section_end: 15 },
    ],
  },
  {
    name: "test7: overflowing chain is clamped at every level",
    spans: [
      span("span-A", 1, 29),
      span("span-B", 15, 20, "span-A"),
      span("span-C", 20, 20, "span-B"),
    ],
    expected: [
      { spanId: "span-C", section_start: 20, section_end: 30 },
      { spanId: "span-B", section_start: 15, section_end: 20 },
      { spanId: "span-A", section_start: 1, section_end: 15 },
    ],
  },
  {
    name: "test8: child overflowing both ends of its parent is clamped",
    spans: [span("span-A", 10, 20), span("span-B", 5, 30, "span-A")],
    expected: [{ spanId: "span-B", section_start: 10, section_end: 30 }],
  },
  {
    name: "test9: child ending before its parent starts is dropped",
    spans: [span("span-A", 10, 20), span("span-B", 1, 4, "span-A")],
    expected: [{ spanId: "span-A", section_start: 10, section_end: 30 }],
  },
];

describe("computeCriticalPath", () => {
  describe.each(grafanaCases)("Grafana fixture $name", ({ spans, expected }) => {
    it("matches Grafana's critical path sections", () => {
      expect(computeCriticalPathForRoots(jaegerToRoots(spans))).toEqual(
        fromJaegerSections(expected),
      );
    });
  });

  it("covers a single span end to end", () => {
    expect(computeCriticalPath(node("root", 5, 25))).toEqual([section("root", 5, 25)]);
  });

  it("marks only the last finisher of concurrent children as critical", () => {
    const root = node("parent", 0, 100_000, [node("A", 0, 80_000), node("B", 0, 50_000)]);

    expect(computeCriticalPath(root)).toEqual([
      section("parent", 80_000, 100_000),
      section("A", 0, 80_000),
    ]);
  });

  it("walks every sequential child, unlike a heaviest-chain pick", () => {
    // Summing durations picks parent → A → A1 (100+40+40), which skips B entirely.
    const root = node("parent", 0, 100, [
      node("A", 0, 40, [node("A1", 0, 40)]),
      node("B", 45, 100),
    ]);

    expect(computeCriticalPath(root)).toEqual([
      section("B", 45, 100),
      section("parent", 40, 45),
      section("A1", 0, 40),
    ]);
  });

  it("treats back-to-back sequential children as all critical", () => {
    const root = node("parent", 0, 100, [node("A", 0, 50), node("B", 50, 100)]);

    expect(computeCriticalPath(root)).toEqual([section("B", 50, 100), section("A", 0, 50)]);
  });

  it("clamps a child that overflows its parent", () => {
    const root = node("parent", 10, 50, [node("child", 30, 90)]);

    expect(computeCriticalPath(root)).toEqual([
      section("child", 30, 50),
      section("parent", 10, 30),
    ]);
  });

  it("drops a child that lies entirely outside its parent", () => {
    const root = node("parent", 10, 50, [node("late", 60, 90, [node("grandchild", 70, 80)])]);

    expect(computeCriticalPath(root)).toEqual([section("parent", 10, 50)]);
  });

  it("concatenates the sections of every root tree", () => {
    const roots = [node("root1", 0, 10, [node("child1", 2, 10)]), node("orphan", 20, 30)];

    expect(computeCriticalPathForRoots(roots)).toEqual([
      section("child1", 2, 10),
      section("root1", 0, 2),
      section("orphan", 20, 30),
    ]);
  });

  it("handles 20,000 sequential children without overflowing the stack", () => {
    const count = 20_000;
    const children = Array.from({ length: count }, (_, i) => node(`c${i}`, i, i + 1));
    const root = node("parent", 0, count, children);

    const sections = computeCriticalPath(root);

    expect(sections).toHaveLength(count);
    expect(sections[0]).toEqual(section(`c${count - 1}`, count - 1, count));
    expect(sections[count - 1]).toEqual(section("c0", 0, 1));
  });
});

describe("toCriticalPathNode", () => {
  const treeSpan = (spanId: string, start: number, end: number, spans: TraceTreeSpan[] = []) => ({
    spanId,
    startTimeUs: start,
    endTimeUs: end,
    spans,
  });

  it("keeps ids, times and child order", () => {
    const tree = treeSpan("root", 0, 10, [
      treeSpan("a", 1, 2),
      treeSpan("b", 3, 9, [treeSpan("c", 4, 5)]),
    ]);

    expect(toCriticalPathNode(tree)).toEqual(
      node("root", 0, 10, [node("a", 1, 2), node("b", 3, 9, [node("c", 4, 5)])]),
    );
  });

  it("converts a 20,000-deep chain without overflowing the stack", () => {
    const depth = 20_000;
    const root = treeSpan("s0", 0, depth);
    let parent = root;
    for (let i = 1; i < depth; i++) {
      const child = treeSpan(`s${i}`, i, depth);
      parent.spans.push(child);
      parent = child;
    }

    const sections = computeCriticalPath(toCriticalPathNode(root));

    expect(sections).toHaveLength(depth);
    expect(sections[0]).toEqual(section(`s${depth - 1}`, depth - 1, depth));
  });
});
