// Copyright 2026 OpenObserve Inc.
//
// hcl.ts — the HCL writer shared by the per-resource Terraform exporters
// (alerts, SLOs). It knows how to spell values and lay out blocks; the callers
// own the mapping from an API payload to attribute names.
//
// Output is `terraform fmt`-canonical, including `=` alignment, so what a user
// copies out of the UI is already what fmt would produce.

import { PROVIDER_SOURCE, PROVIDER_VERSION } from "./provider";

/** Why a payload cannot be expressed as a Terraform resource. */
export type TerraformUnsupportedReason = "anomaly" | "incomplete";

export interface TerraformUnsupportedItem {
  name: string;
  reason: TerraformUnsupportedReason;
}

export interface TerraformExport {
  /** The rendered configuration. Empty when nothing could be converted. */
  hcl: string;
  /** Items with no provider equivalent; these are absent from `hcl`. */
  unsupported: TerraformUnsupportedItem[];
  /** Source fields the provider schema cannot carry, e.g. `having.ignore_case`. */
  droppedFields: string[];
}

export const INDENT = "  ";

export type Node =
  { kind: "attr"; name: string; expr: string } | { kind: "block"; name: string; body: Node[] };

/** An attribute, or nothing at all when the value resolved to null. */
export function attr(name: string, expr: string | null): Node[] {
  return expr === null ? [] : [{ kind: "attr", name, expr }];
}

/** A block, or nothing at all when its body is empty. */
export function block(name: string, body: Node[]): Node[] {
  return body.length ? [{ kind: "block", name, body }] : [];
}

export function quote(value: string): string {
  // HCL template strings treat ${ and %{ as interpolation openers, so a name or
  // query containing one has to escape it or Terraform fails to parse the file.
  // Those two replacements use a function, not a string: `$$` in a string
  // replacement is itself an escape for a literal `$`, which would silently undo
  // the doubling.
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\$\{/g, () => "$${")
    .replace(/%\{/g, () => "%%{");
  return `"${escaped}"`;
}

/**
 * Emits `left = right` pairs with the `=` aligned the way `terraform fmt` does:
 * only consecutive single-line pairs align with each other, and a pair whose
 * value spans lines stands alone and breaks the run.
 */
export function alignedLines(pairs: { left: string; right: string }[], indent: string): string[] {
  const lines: string[] = [];
  let run: { left: string; right: string }[] = [];
  const flush = () => {
    if (!run.length) return;
    const width = Math.max(...run.map((p) => p.left.length));
    run.forEach((p) => lines.push(`${indent}${p.left.padEnd(width)} = ${p.right}`));
    run = [];
  };
  for (const pair of pairs) {
    if (pair.right.includes("\n")) {
      flush();
      lines.push(`${indent}${pair.left} = ${pair.right}`);
    } else {
      run.push(pair);
    }
  }
  flush();
  return lines;
}

/** Renders any JSON value as an HCL expression. Object keys are always quoted. */
export function literal(value: unknown, indent: string): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return quote(value);
  const inner = indent + INDENT;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const items = value.map((v) => `${inner}${literal(v, inner)},`).join("\n");
    return `[\n${items}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "{}";
  const pairs = entries.map(([k, v]) => ({ left: quote(k), right: literal(v, inner) }));
  return `{\n${alignedLines(pairs, inner).join("\n")}\n${indent}}`;
}

export function render(nodes: Node[], indent: string): string {
  const lines: string[] = [];
  let pairs: { left: string; right: string }[] = [];
  const flush = () => {
    if (pairs.length) lines.push(...alignedLines(pairs, indent));
    pairs = [];
  };
  for (const node of nodes) {
    if (node.kind === "attr") {
      pairs.push({ left: node.name, right: node.expr });
      continue;
    }
    flush();
    lines.push(`${indent}${node.name} {\n${render(node.body, indent + INDENT)}\n${indent}}`);
  }
  flush();
  return lines.join("\n");
}

/** Wraps rendered nodes in `resource "<type>" "<label>" { … }`. */
export function resourceBlock(type: string, label: string, body: Node[]): string {
  return `resource ${quote(type)} ${quote(label)} {\n${render(body, INDENT)}\n}`;
}

// ── Value coercion ──────────────────────────────────────────────────────────

/** A non-empty string, quoted; null for anything else (so `attr` drops it). */
export function str(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return quote(value);
}

export function num(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Emits a number only when it differs from the provider's own default. */
export function numUnless(value: unknown, defaultValue: number): string | null {
  const rendered = num(value);
  return rendered === null || value === defaultValue ? null : rendered;
}

/** Emits the boolean only in its non-default direction. */
export function boolWhen(value: unknown, emitWhen: boolean): string | null {
  return value === emitWhen ? String(emitWhen) : null;
}

export function bool(value: unknown): string | null {
  return typeof value === "boolean" ? String(value) : null;
}

/** A single-line list of strings; null when there is nothing to list. */
export function list(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((v): v is string => typeof v === "string" && v !== "");
  if (!items.length) return null;
  return `[${items.map(quote).join(", ")}]`;
}

/** A map of string→string, rendered multi-line. */
export function map(value: unknown, indent: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v != null);
  if (!entries.length) return null;
  const inner = indent + INDENT;
  const pairs = entries.map(([k, v]) => ({ left: quote(k), right: quote(String(v)) }));
  return `{\n${alignedLines(pairs, inner).join("\n")}\n${indent}}`;
}

export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

// ── Resource labels ─────────────────────────────────────────────────────────

/** Turns a resource name into a Terraform label, unique within the file. */
export function resourceLabel(name: unknown, used: Set<string>, fallback = "resource"): string {
  let base = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base || /^[0-9]/.test(base)) base = `${fallback}_${base}`;
  let label = base;
  for (let n = 2; used.has(label); n += 1) label = `${base}_${n}`;
  used.add(label);
  return label;
}

/**
 * The header every export carries: what produced the file, and the provider it
 * needs. The `terraform` block is commented out because a config that already
 * declares one cannot take a second `required_providers`.
 */
export function providerHeader(): string {
  return [
    "# Generated by OpenObserve. Attributes left at their provider default are omitted,",
    "# apart from `enabled`, which is always written so the state is never implied.",
    "#",
    "# Provider setup — skip if your configuration already declares it:",
    "#",
    "#   terraform {",
    "#     required_providers {",
    "#       openobserve = {",
    `#         source  = "${PROVIDER_SOURCE}"`,
    `#         version = "${PROVIDER_VERSION}"`,
    "#       }",
    "#     }",
    "#   }",
  ].join("\n");
}

/** Assembles the finished document, or "" when no resource was rendered. */
export function document(resources: string[]): string {
  return resources.length ? `${providerHeader()}\n\n${resources.join("\n\n")}\n` : "";
}
