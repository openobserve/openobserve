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

// Ported from the Jaeger UI critical-path algorithm (Apache-2.0), as adapted by Grafana.

export interface CriticalPathSection {
  spanId: string;
  sectionStartUs: number;
  sectionEndUs: number;
}

export interface CriticalPathNode {
  spanId: string;
  startTimeUs: number;
  endTimeUs: number;
  children: CriticalPathNode[];
}

export interface TraceTreeSpan {
  spanId: string;
  startTimeUs: number;
  endTimeUs: number;
  spans: TraceTreeSpan[];
}

interface WindowNode {
  spanId: string;
  start: number;
  end: number;
  children: WindowNode[];
}

interface WalkFrame {
  node: WindowNode;
  cursor: number;
}

/** Critical path of one span tree, in walk order (latest section first). */
export function computeCriticalPath(root: CriticalPathNode): CriticalPathSection[] {
  const sections: CriticalPathSection[] = [];
  const stack: WalkFrame[] = [{ node: sanitise(root), cursor: 0 }];
  let returnStart: number | undefined;

  while (stack.length) {
    const frame = stack[stack.length - 1];
    const { node } = frame;
    const sectionEnd = returnStart ?? node.end;
    const child = nextLastFinishingChild(frame, returnStart);

    if (child) {
      pushSection(sections, node.spanId, child.end, sectionEnd);
      stack.push({ node: child, cursor: 0 });
      returnStart = undefined;
    } else {
      pushSection(sections, node.spanId, node.start, sectionEnd);
      stack.pop();
      returnStart = node.start;
    }
  }
  return sections;
}

export function computeCriticalPathForRoots(roots: CriticalPathNode[]): CriticalPathSection[] {
  return roots.flatMap(computeCriticalPath);
}

/** Iterative, so trace depth never bounds the call stack. */
export function toCriticalPathNode(span: TraceTreeSpan): CriticalPathNode {
  const toNode = (s: TraceTreeSpan): CriticalPathNode => ({
    spanId: s.spanId,
    startTimeUs: s.startTimeUs,
    endTimeUs: s.endTimeUs,
    children: [],
  });
  const root = toNode(span);
  const stack: [TraceTreeSpan, CriticalPathNode][] = [[span, root]];

  while (stack.length) {
    const [raw, node] = stack.pop()!;
    for (const child of raw.spans) {
      const converted = toNode(child);
      node.children.push(converted);
      stack.push([child, converted]);
    }
  }
  return root;
}

/** Clamps children into their parent's window (dropping disjoint subtrees) and orders them latest-ending first. */
function sanitise(root: CriticalPathNode): WindowNode {
  const top = toWindowNode(root, root.startTimeUs, root.endTimeUs);
  const stack: [CriticalPathNode, WindowNode][] = [[root, top]];

  while (stack.length) {
    const [raw, parent] = stack.pop()!;
    for (const child of raw.children) {
      const outside =
        child.startTimeUs >= parent.end ||
        (child.startTimeUs < parent.start && child.endTimeUs <= parent.start);
      if (outside) continue;
      const clamped = toWindowNode(child, parent.start, parent.end);
      parent.children.push(clamped);
      stack.push([child, clamped]);
    }
    parent.children.sort((a, b) => b.end - a.end);
  }
  return top;
}

function toWindowNode(node: CriticalPathNode, minStart: number, maxEnd: number): WindowNode {
  const start = Math.max(node.startTimeUs, minStart);
  return {
    spanId: node.spanId,
    start,
    end: Math.max(start, Math.min(node.endTimeUs, maxEnd)),
    children: [],
  };
}

function nextLastFinishingChild(
  frame: WalkFrame,
  returnStart: number | undefined,
): WindowNode | undefined {
  const { children } = frame.node;
  // Children are end-sorted and returnStart only moves earlier, so a skipped child never qualifies later.
  while (frame.cursor < children.length) {
    const child = children[frame.cursor++];
    if (returnStart === undefined || child.end <= returnStart) return child;
  }
  return undefined;
}

function pushSection(
  sections: CriticalPathSection[],
  spanId: string,
  sectionStartUs: number,
  sectionEndUs: number,
) {
  if (sectionStartUs !== sectionEndUs) sections.push({ spanId, sectionStartUs, sectionEndUs });
}
