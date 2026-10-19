// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import hljs from "./highlighter";

describe("highlighter", () => {
  // The fence names our ingestion, alert and setup content and the AI chat use; each must resolve to a real grammar.
  it.each([
    "bash",
    "shell",
    "json",
    "yaml",
    "sql",
    "python",
    "javascript",
    "typescript",
    "tsx",
    "html",
    "toml",
    "ini",
    "text",
    "swift",
    "kotlin",
    "rust",
    "properties",
    "ruby",
    "css",
    "scss",
    "markdown",
    "groovy",
    "http",
    "powershell",
    "hcl",
  ])("resolves %s", (lang) => {
    expect(hljs.getLanguage(lang)).toBeDefined();
  });

  it("does not ship the full grammar set", () => {
    expect(hljs.getLanguage("fortran")).toBeUndefined();
  });
});
