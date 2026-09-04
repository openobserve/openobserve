// Copyright 2026 OpenObserve Inc.
//
// hclLanguage.ts — a highlight.js grammar for HCL / Terraform.
//
// highlight.js ships no HCL grammar, and the near neighbours read badly: `ini`
// colours `key = value` but leaves `resource "type" "name" {` unclassed, and
// auto-detection guesses nginx. Registered by OCodeBlock so `lang="hcl"` works
// like any built-in language.

import type { HLJSApi, Language } from "highlight.js";

/** Block types that introduce a labelled block, plus the value literals. */
const KEYWORDS = [
  "resource",
  "data",
  "provider",
  "variable",
  "output",
  "module",
  "locals",
  "terraform",
  "dynamic",
  "provisioner",
  "lifecycle",
  "import",
  "moved",
  "removed",
  "check",
  "for",
  "in",
  "if",
];

/** The functions that actually turn up in generated or hand-written config. */
const BUILT_INS = [
  "jsonencode",
  "jsondecode",
  "yamlencode",
  "yamldecode",
  "base64encode",
  "base64decode",
  "file",
  "templatefile",
  "format",
  "join",
  "split",
  "lookup",
  "merge",
  "concat",
  "flatten",
  "keys",
  "values",
  "length",
  "coalesce",
  "try",
  "can",
  "tostring",
  "tonumber",
  "tolist",
  "toset",
  "tomap",
  "sensitive",
  "nonsensitive",
  "timestamp",
  "uuid",
];

export function hclLanguage(hljs: HLJSApi): Language {
  return {
    name: "HCL",
    aliases: ["terraform", "tf", "tofu"],
    keywords: { keyword: KEYWORDS, literal: ["true", "false", "null"], built_in: BUILT_INS },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          // `${…}` is interpolation, not string content — Terraform reads it, so
          // it should not look like the surrounding literal.
          { className: "subst", begin: /\$\{/, end: /\}/ },
        ],
      },
      // Attribute name: an identifier immediately left of a single `=`. The
      // lookahead keeps `==`, `>=` and `=>` out.
      { className: "attr", begin: /[A-Za-z_][A-Za-z0-9_-]*(?=\s*=[^=>])/ },
      // Nested block name: an identifier immediately left of `{`. Distinguishes
      // `trigger_condition {` from the attributes inside it.
      { className: "title", begin: /[A-Za-z_][A-Za-z0-9_-]*(?=\s*\{)/ },
      hljs.NUMBER_MODE,
    ],
  };
}
