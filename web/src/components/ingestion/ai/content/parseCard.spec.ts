// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { parseCard } from "./parseCard";

const FIXTURE = `# OpenAI — Data Sources UI panel content

What the OpenObserve panel should render.

> ⚠ **Important** — this card emits logs, not traces. Check the Logs tab.

---

## Card metadata

| Field | Value |
|---|---|
| Display name | OpenAI |
| Category | AI / Providers |
| Icon | \`openai.svg\` |
| Tagline | Trace every OpenAI Python SDK call |
| Supported runtime | Python 3.9+ |

## Section 1 — Install

\`\`\`bash
curl -fsSL https://example.com/setup.sh | bash -s -- --url={url} --org={org}
\`\`\`

Some install prose.

## Section 2 — Paste this into your app

\`\`\`python
openobserve_init()
\`\`\`

---

## Panel implementation notes

- Internal note that should not render.

## Reference link

[docs](../../openobserve-docs/openai.md)
`;

describe("parseCard", () => {
  const parsed = parseCard(FIXTURE);

  it("extracts metadata from the Card metadata table", () => {
    expect(parsed.metadata.displayName).toBe("OpenAI");
    expect(parsed.metadata.category).toBe("AI / Providers");
    expect(parsed.metadata.tagline).toBe("Trace every OpenAI Python SDK call");
    expect(parsed.metadata.runtime).toBe("Python 3.9+");
  });

  it("surfaces ⚠ preamble blockquotes as warnings (without the ⚠ marker)", () => {
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("logs, not traces");
    expect(parsed.warnings[0]).not.toContain("⚠");
  });

  it("keeps body sections and strips the 'Section N — ' prefix", () => {
    const titles = parsed.sections.map((s) => s.title);
    expect(titles).toEqual(["Install", "Paste this into your app"]);
  });

  it("excludes Card metadata / Panel implementation notes / Reference sections", () => {
    const titles = parsed.sections.map((s) => s.title);
    expect(titles).not.toContain("Card metadata");
    expect(titles).not.toContain("Panel implementation notes");
    expect(titles).not.toContain("Reference link");
  });

  it("preserves the section body markdown including code fences", () => {
    const install = parsed.sections.find((s) => s.title === "Install");
    expect(install?.body).toContain("curl -fsSL");
    expect(install?.body).toContain("{url}");
  });

  it("falls back to the H1 name when there is no metadata table", () => {
    const parsedNoMeta = parseCard("# Claude Code — Data Sources UI panel content\n\nbody");
    expect(parsedNoMeta.metadata.displayName).toBe("Claude Code");
  });
});
