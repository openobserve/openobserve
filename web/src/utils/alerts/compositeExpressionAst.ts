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
 * AST for the composite alert boolean expression, used by the visual "Fires
 * when" builder. The expression is persisted as a string (e.g. "(a && b) || c");
 * this module parses it to a tree the pill builder edits, and serialises back.
 *
 * Grammar (n-ary, C precedence `&&` > `||`), matching the enterprise back-end
 * and `compositeExpression.ts`. NOT (`!`) is not represented in the builder —
 * an expression containing it (or anything unparseable) falls back to text mode.
 */

export type ExprNode =
  | { type: "term"; alias: string }
  | { type: "group"; op: "AND" | "OR"; children: ExprNode[] };

type Tok =
  | { t: "("; }
  | { t: ")"; }
  | { t: "AND" }
  | { t: "OR" }
  | { t: "ID"; v: string };

function tokenize(str: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === "(" || c === ")") {
      out.push({ t: c });
      i += 1;
    } else if (str.substr(i, 2) === "&&") {
      out.push({ t: "AND" });
      i += 2;
    } else if (str.substr(i, 2) === "||") {
      out.push({ t: "OR" });
      i += 2;
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(str.slice(i));
      if (!m) throw new Error(`Unexpected character "${c}"`);
      const w = m[0];
      const up = w.toUpperCase();
      if (up === "AND") out.push({ t: "AND" });
      else if (up === "OR") out.push({ t: "OR" });
      else out.push({ t: "ID", v: w });
      i += w.length;
    }
  }
  return out;
}

/** Parse an expression string into a tree. Throws on invalid input. */
export function parseToAst(str: string): ExprNode {
  const toks = tokenize(str);
  let p = 0;
  const eat = (t: Tok["t"]): Tok | null =>
    toks[p] && toks[p].t === t ? (toks[p++] as Tok) : null;

  function primary(): ExprNode {
    if (eat("(")) {
      const n = orExpr();
      if (!eat(")")) throw new Error("Missing a closing parenthesis");
      return n;
    }
    const id = eat("ID") as { t: "ID"; v: string } | null;
    if (!id)
      throw new Error(
        p >= toks.length ? "Expression is incomplete" : "Unexpected token",
      );
    return { type: "term", alias: id.v };
  }
  function andExpr(): ExprNode {
    const kids = [primary()];
    while (eat("AND")) kids.push(primary());
    return kids.length > 1 ? { type: "group", op: "AND", children: kids } : kids[0];
  }
  function orExpr(): ExprNode {
    const kids = [andExpr()];
    while (eat("OR")) kids.push(andExpr());
    return kids.length > 1 ? { type: "group", op: "OR", children: kids } : kids[0];
  }

  if (!toks.length) throw new Error("Expression is empty");
  let node = orExpr();
  if (p < toks.length) throw new Error("Unexpected trailing input");
  // Always hand back a group so the builder has a root to add into.
  if (node.type === "term") node = { type: "group", op: "AND", children: [node] };
  return node;
}

/** Serialise a tree back to a string with minimal parentheses. */
export function serializeAst(node: ExprNode, parentOp?: "AND" | "OR"): string {
  if (node.type === "term") return node.alias;
  if (!node.children.length) return "";
  const op = node.op === "AND" ? "&&" : "||";
  const parts = node.children.map((c) => serializeAst(c, node.op));
  let s = parts.join(` ${op} `);
  if (node.children.length > 1 && parentOp && parentOp !== node.op) s = `(${s})`;
  return s;
}

/** Plain-English rendering for the restate line, e.g. "a and (b or c)". */
export function astToEnglish(
  node: ExprNode,
  labelOf: (alias: string) => string,
  parentOp?: "AND" | "OR",
): string {
  if (node.type === "term") return labelOf(node.alias);
  if (!node.children.length) return "";
  const j = node.op === "AND" ? " and " : " or ";
  const parts = node.children.map((c) => astToEnglish(c, labelOf, node.op));
  let s = parts.join(j);
  if (node.children.length > 1 && parentOp && parentOp !== node.op) s = `(${s})`;
  return s;
}

/** The node at a child-index path from the root. */
export function nodeAtPath(root: ExprNode, path: number[]): ExprNode {
  let n = root;
  for (const idx of path) {
    if (n.type !== "group") break;
    n = n.children[idx];
  }
  return n;
}

/** Toggle a group's operator (AND ⇄ OR). */
export function toggleOpAtPath(root: ExprNode, path: number[]): void {
  const n = nodeAtPath(root, path);
  if (n.type === "group") n.op = n.op === "AND" ? "OR" : "AND";
}

/** Remove the node at `path`, collapsing any now-empty ancestor groups. */
export function removeAtPath(root: ExprNode, path: number[]): void {
  if (!path.length) return;
  const parent = nodeAtPath(root, path.slice(0, -1));
  if (parent.type !== "group") return;
  parent.children.splice(path[path.length - 1], 1);
  let cur = path.slice(0, -1);
  while (cur.length) {
    const node = nodeAtPath(root, cur);
    if (node.type === "group" && node.children.length === 0) {
      const up = cur.slice(0, -1);
      const upNode = nodeAtPath(root, up);
      if (upNode.type === "group") upNode.children.splice(cur[cur.length - 1], 1);
      cur = up;
    } else break;
  }
}

/** Append a term to the group at `path`. */
export function addTermAtPath(
  root: ExprNode,
  path: number[],
  alias: string,
): void {
  const g = nodeAtPath(root, path);
  if (g.type === "group") g.children.push({ type: "term", alias });
}

/** Append a nested bracketed group (opposite op) seeded with the given terms. */
export function addGroupAtPath(
  root: ExprNode,
  path: number[],
  seedAliases: string[],
): void {
  const g = nodeAtPath(root, path);
  if (g.type !== "group") return;
  g.children.push({
    type: "group",
    op: g.op === "AND" ? "OR" : "AND",
    children: seedAliases.map((alias) => ({ type: "term", alias })),
  });
}

/** Every alias referenced anywhere in the tree (for "in use" markers). */
export function usedAliases(node: ExprNode, acc: Set<string> = new Set()): Set<string> {
  if (node.type === "term") acc.add(node.alias);
  else node.children.forEach((c) => usedAliases(c, acc));
  return acc;
}

/** Remove every occurrence of `alias`, pruning groups that become empty. */
export function pruneAlias(node: ExprNode, alias: string): void {
  if (node.type !== "group") return;
  node.children = node.children.filter((c) => {
    if (c.type === "term") return c.alias !== alias;
    pruneAlias(c, alias);
    return c.children.length > 0;
  });
}
