// Copyright 2026 OpenObserve Inc.
//
// hcl.ts — the HCL writer shared by the per-resource Terraform exporters
// (alerts, composite alerts, SLOs, dashboards). It knows how to spell values,
// lay out blocks and write import blocks; the callers own the mapping from an
// API payload to attribute names.
//
// Output is `terraform fmt`-canonical, including `=` alignment, so what a user
// copies out of the UI is already what fmt would produce.

import { PROVIDER_SOURCE, PROVIDER_VERSION } from "./provider";

/**
 * Why a payload cannot be expressed as a Terraform resource.
 *
 * `anomaly` and `scheduled` are both "the provider has no resource for this
 * shape yet", kept apart because they are different gaps and a reader chasing
 * one should not be told the other. `incomplete` means the payload itself is
 * missing something the resource requires.
 */
export type TerraformUnsupportedReason = "anomaly" | "scheduled" | "incomplete";

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

/**
 * What every exporter needs in order to write `import` blocks: the organization
 * the definitions were read from, and the server-assigned id of each one.
 *
 * The ids arrive separately rather than on the payloads because the export
 * endpoints deliberately strip them — an exported definition describes a
 * resource to CREATE, and carrying the source id would make it look like it
 * describes the one it came from. Import blocks need exactly that stripped id
 * back, so it is passed alongside instead of being put back on the payload.
 *
 * `ids` is aligned to the payload array by index. Exporters skip items they
 * cannot render, so they track the index themselves rather than relying on the
 * output order.
 */
export interface TerraformIdentityOptions {
  /** Organization the definitions came from. Import blocks need it for the id. */
  orgId?: string;
  /** Server-assigned ids, aligned by index with the payloads. */
  ids?: (string | null | undefined)[];
}

/** A resource to adopt into state rather than create. */
export interface ImportTarget {
  /** Resource type, e.g. `openobserve_alert`. */
  type: string;
  /** The label the resource block was written under. */
  label: string;
  /** Server-assigned resource id, without the org prefix. */
  id: string;
}

/**
 * Builds an import target, or nothing when the caller has no id to import by.
 *
 * Every resource this exports uses the same `{org_id}/{id}` import address, so
 * the shape is assembled here rather than repeated per exporter.
 */
export function importTarget(
  type: string,
  label: string,
  orgId: string | undefined,
  id: unknown,
): ImportTarget[] {
  if (!orgId || typeof id !== "string" || id === "") return [];
  return [{ type, label, id }];
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

/**
 * The `import` section appended to an export.
 *
 * An exported configuration describes resources that already exist. Applying it
 * as-is creates a SECOND copy of each one, which is the single most expensive
 * mistake available here. `import` blocks (Terraform 1.5+, and OpenTofu 1.6+)
 * say "adopt the existing object into this address instead", so the first
 * `terraform apply` reconciles rather than duplicates.
 *
 * They are emitted live rather than commented out because adopting what you
 * already run is the reason to export in the first place. The comment says the
 * one case where they are wrong — copying the config into a different
 * organization, where these ids do not resolve — and what to do about it.
 */
export function importSection(imports: ImportTarget[], orgId: string): string {
  if (!imports.length) return "";
  const header = [
    "# Adopt the existing objects instead of creating copies of them.",
    "#",
    "# `terraform plan` reports these as imports rather than creations, and the",
    "# first apply brings them under management unchanged. Once that apply has",
    "# run the blocks have done their job and can be deleted.",
    "#",
    "# Delete them BEFORE applying if this configuration is going somewhere else:",
    `# the ids below resolve only in the "${orgId}" organization, and a different`,
    "# organization needs these resources created rather than adopted.",
    "#",
    "# Requires Terraform 1.5+ or OpenTofu 1.6+.",
  ].join("\n");

  const blocks = imports.map((target) =>
    [
      "import {",
      // `to` is a resource address, not a string, so it is written unquoted.
      `${INDENT}to = ${target.type}.${target.label}`,
      `${INDENT}id = ${quote(`${orgId}/${target.id}`)}`,
      "}",
    ].join("\n"),
  );

  return `${header}\n\n${blocks.join("\n\n")}`;
}

/**
 * Assembles the finished document, or "" when no resource was rendered.
 *
 * Import blocks come after the resources they refer to. Terraform does not care
 * about order, and a reader wants the definitions first.
 */
export function document(resources: string[], imports: ImportTarget[] = [], orgId = ""): string {
  if (!resources.length) return "";
  const sections = [providerHeader(), resources.join("\n\n")];
  const importBlocks = orgId ? importSection(imports, orgId) : "";
  if (importBlocks) sections.push(importBlocks);
  return `${sections.join("\n\n")}\n`;
}
