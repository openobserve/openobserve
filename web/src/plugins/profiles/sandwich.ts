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

/**
 * Sandwich view trees, built from the merged call tree in the browser.
 *
 *   root ─ main ─ a ─ F ─ x          callers of F:  F ─ a ─ main
 *        └ b ─ F ─ y                                 └ b
 *                                    callees of F:  F ─ x
 *                                                     └ y
 *
 * Only the outermost call of F on a path counts, so a recursive F is not added twice.
 * ponytail: the merged tree is capped (max_nodes), so calls folded into "other" are missing;
 * the page shows the coverage. A server-side sandwich endpoint would give exact numbers.
 */

export type CallNode = { name: string; self: number; total: number; children?: CallNode[] };

type Acc = { name: string; self: number; total: number; children: Map<string, Acc> };

const acc = (name: string): Acc => ({ name, self: 0, total: 0, children: new Map() });

const childOf = (parent: Acc, name: string) => {
  let child = parent.children.get(name);
  if (!child) parent.children.set(name, (child = acc(name)));
  return child;
};

const toNode = ({ name, self, total, children }: Acc): CallNode => {
  const list = [...children.values()].map(toNode).sort((a, b) => b.total - a.total);
  return { name, self, total, ...(list.length ? { children: list } : {}) };
};

/** Calls `visit(node, callers)` on every outermost call of `name`; `callers` runs from the top frame down. */
const eachOutermostCall = (
  root: CallNode,
  name: string,
  visit: (node: CallNode, callers: string[]) => void,
) => {
  const walk = (node: CallNode, callers: string[]) => {
    if (node.name === name) {
      visit(node, callers);
      return;
    }
    for (const child of node.children ?? []) walk(child, [...callers, node.name]);
  };
  // The root is the synthetic "total" frame, not a caller.
  for (const child of root.children ?? []) walk(child, []);
};

/** Everything `name` calls, merged into one tree with `name` at the root. */
export const calleesOf = (root: CallNode | null, name: string): CallNode | null => {
  if (!root || !name) return null;
  const result = acc(name);
  const add = (target: Acc, node: CallNode) => {
    target.total += node.total;
    target.self += node.self;
    for (const child of node.children ?? []) add(childOf(target, child.name), child);
  };
  eachOutermostCall(root, name, (node) => add(result, node));
  return result.total > 0 ? toNode(result) : null;
};

/** The call paths into `name`, inverted: `name` at the root, its callers as children, their callers below. */
export const callersOf = (root: CallNode | null, name: string): CallNode | null => {
  if (!root || !name) return null;
  const result = acc(name);
  eachOutermostCall(root, name, (node, callers) => {
    result.total += node.total;
    let target = result;
    for (const caller of [...callers].reverse()) {
      target = childOf(target, caller);
      target.total += node.total;
    }
    // The last frame on the inverted path keeps the samples as its own.
    target.self += node.total;
  });
  return result.total > 0 ? toNode(result) : null;
};
