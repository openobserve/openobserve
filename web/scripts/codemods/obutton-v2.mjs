#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.
//
// One-shot codemod: OButton v1 (40 variants, 23 sizes) → v2 (7 variants, 4 sizes + iconOnly).
//
//   node scripts/codemods/obutton-v2.mjs            # rewrite web/src in place
//   node scripts/codemods/obutton-v2.mjs --dry      # report only
//
// NOT idempotent: v1 `xs`/`sm` are v2 names too (v1 xs → v2 sm, v1 sm → v2 md), so a second
// run would shift every size again. Run it once over a v1 tree, then fix the report by hand.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(WEB, "package.json"));
const { parse } = require("@vue/compiler-sfc");

const DRY = process.argv.includes("--dry");

// Old → new variant. `null` means the old look has no v2 job; the closest variant is used and
// the site is reported for review.
export const VARIANT_MAP = {
  primary: "primary",
  secondary: "secondary",
  outline: "secondary",
  "outline-primary": "secondary",
  ghost: "ghost",
  "ghost-muted": "ghost",
  "ghost-neutral": "ghost",
  "ghost-warning": "ghost",
  "ghost-success": "ghost",
  "ghost-subtle": "ghost",
  dashed: "ghost",
  "panel-collapse": "ghost",
  "ghost-primary": "accent-ghost",
  "ghost-destructive": "danger-ghost",
  "outline-destructive": "danger-ghost",
  destructive: "danger",
  "filter-exclude": "danger",
  "cancel-query": "secondary",
  warning: "primary",
  pending: "primary",
  "banner-dismiss": "link",
  "webinar-dismiss": "link",
  "sidebar-toggle": "secondary",
  "sidebar-button": "primary",
  "ai-gradient": "primary",
  "on-dark-primary": "secondary",
  "on-dark-ghost": "ghost",
  "preview-slack": "primary",
  "preview-teams": "primary",
  "preview-email": "primary",
  "preview-opsgenie": "primary",
  "preview-action": "secondary",
  "pricing-chip": "secondary",
  "section-chip": "ghost",
  "tint-teal": "secondary",
  "tint-purple": "secondary",
  "tint-blue": "secondary",
  "tint-orange": "secondary",
  cell: "link",
  row: "ghost",
  "locked-body": "secondary",
};

// Variants whose look carried a meaning v2 expresses differently; their sites are reported.
const REVIEW_VARIANTS = new Set([
  "filter-exclude",
  "ai-gradient",
  "on-dark-primary",
  "on-dark-ghost",
  "preview-slack",
  "preview-teams",
  "preview-email",
  "preview-opsgenie",
  "preview-action",
  "section-chip",
  "cell",
  "row",
  "locked-body",
  "banner-dismiss",
  "webinar-dismiss",
  "warning",
]);

// A ternary whose two branches collapse to one v2 variant keeps its meaning as a state prop.
const PRESSED_WHEN = new Set(["outline-primary"]);
const STALE_WHEN = new Set(["warning", "pending", "ghost-warning"]);

// Old size → [new size, iconOnly].
export const SIZE_MAP = {
  chip: ["xs", false],
  "chip-12": ["xs", false],
  xs: ["sm", false],
  "xs-grouped": ["sm", false],
  sm: ["md", false],
  "sm-action": ["md", false],
  md: ["md", false],
  "sm-toolbar": ["md", false],
  cta: ["lg", false],
  lg: ["lg", false],
  icon: ["xs", true],
  "icon-chip": ["xs", true],
  "icon-xs-circle": ["xs", true],
  "icon-panel": ["xs", true],
  "icon-xs-sq": ["sm", true],
  "icon-circle-sm": ["sm", true],
  "icon-sm": ["md", true],
  "icon-xs": ["md", true],
  "icon-toolbar": ["md", true],
  "icon-circle": ["md", true],
  "icon-md": ["md", true],
  "icon-lg": ["lg", true],
  "sidebar-button": ["xs", true],
};

const PROP_RENAMES = {
  "icon-left": "icon",
  iconLeft: "icon",
  "icon-right": "icon-end",
  iconRight: "icon-end",
  active: "pressed",
  disable: "disabled",
};

const SLOT_RENAMES = { "icon-left": "icon", "icon-right": "icon-end" };

const DROPPED_PROPS = new Set(["round", "ripple", "no-wrap", "noWrap", "spinner"]);

const BUTTON_VARIANT_PROP =
  /^(primary|secondary|neutral)-?button-?variant$|^(primary|secondary|neutral)ButtonVariant$|^(ok|confirm)-?variant$|^(ok|confirm)Variant$/;

// ── class cleanup ────────────────────────────────────────────────────────────

/** The utility part of a Tailwind token, without variant prefixes or the `!` modifier. */
function utilityOf(token) {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ":" && depth === 0) last = i + 1;
  }
  return token.slice(last).replace(/^!/, "").replace(/!$/, "");
}

const HEIGHT = /^-?(min-|max-)?h-|^size-/;
const SQUARE_GEOMETRY = /^-?(min-|max-)?w-|^p[xytbse]?-|^p-/;

/** Drops height overrides (and, on a square icon button, width and padding overrides). */
export function cleanClassList(value, iconOnly) {
  const kept = value
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const u = utilityOf(token);
      if (HEIGHT.test(u)) return false;
      if (iconOnly && SQUARE_GEOMETRY.test(u)) return false;
      return true;
    });
  return kept.join(" ");
}

function cleanClassExpression(expr, iconOnly) {
  return expr.replace(/'([^'\\]*)'|`([^`\\$]*)`/g, (m, single, tick) => {
    const inner = single ?? tick;
    const cleaned = cleanClassList(inner, iconOnly);
    const q = single !== undefined ? "'" : "`";
    return `${q}${cleaned}${q}`;
  });
}

// ── expression helpers ───────────────────────────────────────────────────────

const TERNARY = /^\s*([\s\S]+?)\s*\?\s*'([\w-]+)'\s*:\s*'([\w-]+)'\s*$/;

function mapLiterals(expr, map, onUnknown) {
  return expr.replace(/'([\w-]+)'/g, (m, name) => {
    if (!(name in map)) {
      onUnknown?.(name);
      return m;
    }
    const v = map[name];
    return `'${Array.isArray(v) ? v[0] : v}'`;
  });
}

const negate = (cond) => (/^[\w.$]+$/.test(cond) ? `!${cond}` : `!(${cond})`);

// ── per-file transform ───────────────────────────────────────────────────────

function attrName(p) {
  if (p.type === 6) return { name: p.name, bound: false };
  if (p.name === "bind" && p.arg?.type === 4 && p.arg.isStatic) {
    return { name: p.arg.content, bound: true };
  }
  return null;
}

function walk(node, visit) {
  if (node.type === 1) visit(node);
  for (const c of node.children ?? []) walk(c, visit);
  for (const b of node.branches ?? []) walk(b, visit);
}

export function transform(src, rel, report) {
  const { descriptor } = parse(src, { filename: rel });
  const ast = descriptor.template?.ast;
  if (!ast) return src;
  const edits = [];
  const note = (node, msg) => report.push(`${rel}:${node.loc.start.line} ${msg}`);
  const remove = (p) => {
    let start = p.loc.start.offset;
    while (start > 0 && /\s/.test(src[start - 1])) start--;
    edits.push({ start, end: p.loc.end.offset, text: "" });
  };
  const replace = (p, text) =>
    edits.push({ start: p.loc.start.offset, end: p.loc.end.offset, text });
  const insertAfterTag = (node, text) => {
    const at = node.loc.start.offset + 1 + node.tag.length;
    edits.push({ start: at, end: at, text: ` ${text}` });
  };

  walk(ast, (node) => {
    if (node.tag === "OButton") transformButton(node);
    else if (node.tag === "OButtonGroup") transformGroup(node);
    else if (/^O[A-Z]|^[A-Z]/.test(node.tag)) transformVariantProps(node);
  });

  function transformVariantProps(node) {
    for (const p of node.props) {
      const a = attrName(p);
      if (!a || !BUTTON_VARIANT_PROP.test(a.name)) continue;
      if (!a.bound) {
        const v = p.value?.content;
        if (v in VARIANT_MAP && VARIANT_MAP[v] !== v) replace(p, `${a.name}="${VARIANT_MAP[v]}"`);
      } else {
        const expr = p.exp.content;
        const mapped = mapLiterals(expr, VARIANT_MAP);
        if (mapped !== expr) replace(p, `:${a.name}="${mapped}"`);
      }
    }
  }

  function transformGroup(node) {
    for (const p of node.props) {
      const a = attrName(p);
      if (a && ["radius", "divided", "orientation", "align"].includes(a.name)) remove(p);
    }
  }

  function transformButton(node) {
    const props = node.props;
    const find = (...names) =>
      props.find((p) => {
        const a = attrName(p);
        return a && names.includes(a.name);
      });
    if (props.some((p) => p.type === 7 && p.name === "bind" && !p.arg)) {
      note(node, "v-bind spread: props invisible, review by hand");
    }

    // size → size + iconOnly
    let iconOnly = false;
    const sizeP = find("size");
    const extra = [];
    if (sizeP && !attrName(sizeP).bound) {
      const v = sizeP.value?.content;
      const m = SIZE_MAP[v];
      if (!m) note(node, `unknown size "${v}"`);
      else {
        iconOnly = m[1];
        if (m[0] === "md") remove(sizeP);
        else replace(sizeP, `size="${m[0]}"`);
        if (iconOnly) extra.push("icon-only");
      }
    } else if (sizeP) {
      const expr = sizeP.exp.content;
      const t = expr.match(TERNARY);
      if (t && SIZE_MAP[t[2]] && SIZE_MAP[t[3]]) {
        const [cond, a, b] = [t[1], SIZE_MAP[t[2]], SIZE_MAP[t[3]]];
        if (a[0] === b[0]) {
          if (a[0] === "md") remove(sizeP);
          else replace(sizeP, `size="${a[0]}"`);
        } else replace(sizeP, `:size="${cond} ? '${a[0]}' : '${b[0]}'"`);
        if (a[1] && b[1]) {
          iconOnly = true;
          extra.push("icon-only");
        } else if (a[1]) {
          iconOnly = "dynamic";
          extra.push(`:icon-only="${cond}"`);
        } else if (b[1]) {
          iconOnly = "dynamic";
          extra.push(`:icon-only="${negate(cond)}"`);
        }
      } else {
        const mapped = mapLiterals(expr, SIZE_MAP, (n) => note(node, `unknown size literal ${n}`));
        if (mapped !== expr) replace(sizeP, `:size="${mapped}"`);
        note(node, `dynamic size "${expr.replace(/\s+/g, " ")}": check iconOnly by hand`);
      }
    }

    // variant
    const variantP = find("variant");
    if (!variantP) {
      extra.unshift(`variant="primary"`);
    } else if (!attrName(variantP).bound) {
      const v = variantP.value?.content;
      if (!(v in VARIANT_MAP)) note(node, `unknown variant "${v}"`);
      else {
        if (VARIANT_MAP[v] !== v) replace(variantP, `variant="${VARIANT_MAP[v]}"`);
        if (REVIEW_VARIANTS.has(v)) note(node, `REVIEW variant "${v}" → "${VARIANT_MAP[v]}"`);
      }
    } else {
      const expr = variantP.exp.content;
      const t = expr.match(TERNARY);
      if (t && t[2] in VARIANT_MAP && t[3] in VARIANT_MAP) {
        const [cond, a, b] = [t[1], t[2], t[3]];
        const [na, nb] = [VARIANT_MAP[a], VARIANT_MAP[b]];
        if (na === nb) {
          replace(variantP, `variant="${na}"`);
          if (PRESSED_WHEN.has(a)) extra.push(`:pressed="${cond}"`);
          else if (PRESSED_WHEN.has(b)) extra.push(`:pressed="${negate(cond)}"`);
          else if (STALE_WHEN.has(a)) extra.push(`:stale="${cond}"`);
          else if (STALE_WHEN.has(b)) extra.push(`:stale="${negate(cond)}"`);
          else note(node, `variant ternary "${a}"/"${b}" collapsed to "${na}"`);
        } else {
          replace(variantP, `:variant="${cond} ? '${na}' : '${nb}'"`);
          // Only `pending` means "result behind the inputs"; a `warning` tone keeps just its emphasis.
          if (a === "pending") extra.push(`:stale="${cond}"`);
          else if (b === "pending") extra.push(`:stale="${negate(cond)}"`);
        }
        for (const v of [a, b]) {
          if (REVIEW_VARIANTS.has(v) && !STALE_WHEN.has(v)) note(node, `REVIEW variant "${v}"`);
        }
      } else {
        const mapped = mapLiterals(expr, VARIANT_MAP, (n) =>
          note(node, `unknown variant literal ${n}`),
        );
        if (mapped !== expr) replace(variantP, `:variant="${mapped}"`);
        if (/'(warning|pending|ghost-warning|outline-primary)'/.test(expr)) {
          note(node, `REVIEW variant expression "${expr.replace(/\s+/g, " ")}"`);
        } else if (!/^[^']*('[\w-]+'[^']*)+$/.test(expr)) {
          note(node, `dynamic variant "${expr.replace(/\s+/g, " ")}": values come from script`);
        }
      }
    }

    // renames, drops
    for (const p of props) {
      const a = attrName(p);
      if (!a) continue;
      if (a.name in PROP_RENAMES) {
        const to = PROP_RENAMES[a.name];
        if (a.bound) replace(p, `:${to}="${p.exp.content}"`);
        else replace(p, p.value ? `${to}="${p.value.content}"` : to);
      } else if (DROPPED_PROPS.has(a.name)) {
        remove(p);
        note(node, `dropped "${a.name}"`);
      } else if (a.name === "as" && !a.bound && p.value?.content === "a") {
        remove(p);
        if (!find("href")) note(node, `as="a" without href`);
      } else if (a.name === "icon" || a.name === "icon-only" || a.name === "iconOnly") {
        note(node, `"${a.name}" was undeclared and now renders: review`);
      } else if (a.name === "tooltip" || a.name === "to") {
        note(node, `"${a.name}" was undeclared: review`);
      } else if (a.name === "class") {
        const cleaned = cleanClassList(p.value?.content ?? "", iconOnly === true);
        if (cleaned !== (p.value?.content ?? "").trim().split(/\s+/).join(" ")) {
          if (cleaned) replace(p, `class="${cleaned}"`);
          else remove(p);
        }
      }
    }
    for (const p of props) {
      if (p.type === 7 && p.name === "bind" && p.arg?.content === "class") {
        const expr = p.exp.content;
        const cleaned = cleanClassExpression(expr, iconOnly === true);
        if (cleaned !== expr) {
          replace(p, `:class="${cleaned}"`);
          note(node, `:class literals cleaned: check for empty strings`);
        }
        if (/\b\w+Class\b|computedClass/.test(expr))
          note(node, `:class "${expr.trim()}" from script: check heights`);
      }
    }

    // focusable-unavailable + #unavailable-reason → disabled-reason
    const fuP = find("focusable-unavailable", "focusableUnavailable");
    const descP = find("description-id", "descriptionId");
    const reasonTpl = node.children.find(
      (c) =>
        c.type === 1 &&
        c.tag === "template" &&
        c.props.some(
          (p) => p.type === 7 && p.name === "slot" && p.arg?.content === "unavailable-reason",
        ),
    );
    if (reasonTpl) {
      const content = src
        .slice(
          reasonTpl.children[0]?.loc.start.offset ?? 0,
          reasonTpl.children.at(-1)?.loc.end.offset ?? 0,
        )
        .trim();
      const m = content.match(/^\{\{\s*([\s\S]+?)\s*\}\}$/);
      const vIf = reasonTpl.props.find((p) => p.type === 7 && p.name === "if");
      const conds = [];
      if (fuP && attrName(fuP).bound) conds.push(fuP.exp.content);
      if (vIf) conds.push(vIf.exp.content);
      if (m) {
        const reason = m[1].replace(/"/g, "'");
        const expr = conds.length
          ? `${conds.map((c) => (/^[\w.$!?]+$/.test(c) ? c : `(${c})`)).join(" && ")} ? ${reason} : undefined`
          : reason;
        extra.push(`:disabled-reason="${expr}"`);
        let start = reasonTpl.loc.start.offset;
        while (start > 0 && /\s/.test(src[start - 1])) start--;
        edits.push({ start, end: reasonTpl.loc.end.offset, text: "" });
        if (fuP) remove(fuP);
      } else note(node, `#unavailable-reason is not a single interpolation: migrate by hand`);
    } else if (fuP) {
      remove(fuP);
      note(node, `focusable-unavailable without a reason slot: add disabled-reason by hand`);
    }
    if (descP) {
      remove(descP);
      note(node, `description-id dropped: add disabled-reason by hand`);
    }

    // slot renames
    for (const c of node.children) {
      if (c.type !== 1 || c.tag !== "template") continue;
      const slot = c.props.find((p) => p.type === 7 && p.name === "slot");
      const name = slot?.arg?.content;
      if (name && name in SLOT_RENAMES) {
        const text = src.slice(slot.loc.start.offset, slot.loc.end.offset);
        edits.push({
          start: slot.loc.start.offset,
          end: slot.loc.end.offset,
          text: text.replace(name, SLOT_RENAMES[name]),
        });
      }
    }

    if (extra.length) insertAfterTag(node, extra.join(" "));
  }

  if (!edits.length) return src;
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = src;
  let guard = Infinity;
  for (const e of edits) {
    if (e.end > guard) throw new Error(`${rel}: overlapping edits at ${e.start}`);
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    guard = e.start;
  }
  return out;
}

function main() {
  const files = [];
  (function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(p);
      else if (entry.name.endsWith(".vue")) files.push(p);
    }
  })(path.join(WEB, "src"));

  const report = [];
  let changed = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!/OButton|ButtonVariant|button-variant|ok-variant|confirm-variant/i.test(src)) continue;
    const rel = path.relative(path.join(WEB, "src"), file).replace(/\\/g, "/");
    const out = transform(src, rel, report);
    if (out !== src) {
      changed++;
      if (!DRY) fs.writeFileSync(file, out);
    }
  }
  console.log(report.join("\n"));
  console.log(`\n${changed} files ${DRY ? "would change" : "changed"}; ${report.length} notes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
