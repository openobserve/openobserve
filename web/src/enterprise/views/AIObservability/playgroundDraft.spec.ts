// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  EXPECTED_OUTPUT_TOKEN,
  SINGLE_ROW_KEY,
  cloneVariant,
  emptyVariant,
  expectedForRow,
  extractVariantVars,
  extractVars,
  hasZeroFieldReference,
  insertTokenAt,
  renderTemplate,
  renderedMessages,
  rowFieldsFor,
  rowKeysFor,
  starterDraft,
  variantLabel,
  variantSummary,
  varsForRow,
  withFieldInserted,
  type PlaygroundDraft,
  type PlaygroundRow,
  type PlaygroundVariant,
} from "./playgroundDraft";

function variantWith(contents: string[]): PlaygroundVariant {
  const variant = emptyVariant("provider-1", "gpt-4o-mini");
  variant.messages = contents.map((content, index) => ({
    id: `m${index}`,
    role: index === 0 ? "system" : "user",
    content,
  }));
  return variant;
}

function rowWith(id: string, input: string, expectedOutput: string | null = null): PlaygroundRow {
  return { id, input, expectedOutput, source: null };
}

describe("variable extraction", () => {
  it("collects distinct tokens in first-seen order", () => {
    const variant = variantWith(["Answer using {{context}}.", "{{question}} — recall {{context}}"]);
    expect(extractVariantVars(variant)).toEqual(["context", "question"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(extractVariantVars(variantWith(["{{ context }}"]))).toEqual(["context"]);
  });

  it("ignores malformed tokens", () => {
    expect(extractVariantVars(variantWith(["{{1bad}} {single} {{ }}"]))).toEqual([]);
  });

  it("unions across variants without duplicating", () => {
    const a = variantWith(["{{context}}"]);
    const b = variantWith(["{{context}} {{tone}}"]);
    expect(extractVars([a, b])).toEqual(["context", "tone"]);
  });
});

describe("renderTemplate", () => {
  it("substitutes matched variables", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Ada" })).toBe("Hi Ada");
  });

  it("renders an unmatched variable as empty rather than leaving the literal", () => {
    expect(renderTemplate("Hi {{name}}!", {})).toBe("Hi !");
  });

  it("never binds expected_output, so a golden answer cannot leak into the prompt", () => {
    const rendered = renderTemplate(`Answer: {{${EXPECTED_OUTPUT_TOKEN}}}`, {
      [EXPECTED_OUTPUT_TOKEN]: "the golden answer",
    });
    expect(rendered).toBe("Answer: ");
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(renderTemplate("{{a}}-{{a}}", { a: "x" })).toBe("x-x");
  });
});

describe("row fields and the zero-reference guard", () => {
  it("exposes input as the only field of a plain-text row", () => {
    expect(rowFieldsFor([rowWith("r1", "hello")])).toEqual(["input"]);
    expect(rowFieldsFor(null)).toEqual([]);
    expect(rowFieldsFor([])).toEqual([]);
  });

  it("flags a template that references none of the row fields", () => {
    const variant = variantWith(["Summarise the policy."]);
    expect(hasZeroFieldReference([variant], [rowWith("r1", "hello")])).toBe(true);
  });

  it("clears once any variant references a row field", () => {
    const a = variantWith(["Summarise the policy."]);
    const b = variantWith(["Summarise {{input}}"]);
    expect(hasZeroFieldReference([a, b], [rowWith("r1", "hello")])).toBe(false);
  });

  it("does not fire in editor-bench mode, where there are no rows to differ", () => {
    expect(hasZeroFieldReference([variantWith(["static"])], null)).toBe(false);
  });
});

describe("labels", () => {
  it("letters the first four variants", () => {
    expect([0, 1, 2, 3].map(variantLabel)).toEqual(["A", "B", "C", "D"]);
  });

  it("collapses the first non-empty message into a one-line summary", () => {
    const variant = variantWith(["", "  Answer\n  concisely  "]);
    expect(variantSummary(variant).promptLine).toBe("Answer concisely");
  });

  it("returns an empty prompt line when nothing has been written", () => {
    expect(variantSummary(variantWith(["", ""])).promptLine).toBe("");
  });
});

describe("cloneVariant", () => {
  it("gives the clone fresh ids and a clean slate", () => {
    const source = variantWith(["sys", "user"]);
    source.stale = true;
    source.tools = [{ name: "lookup", description: "", parameters: "{}" }];

    const clone = cloneVariant(source);

    expect(clone.id).not.toBe(source.id);
    expect(clone.messages.map((m) => m.id)).not.toEqual(source.messages.map((m) => m.id));
    expect(clone.messages.map((m) => m.content)).toEqual(["sys", "user"]);
    expect(clone.stale).toBe(false);
  });

  it("copies tools by value so editing the clone leaves the source alone", () => {
    const source = variantWith(["sys"]);
    source.tools = [{ name: "lookup", description: "d", parameters: "{}" }];

    const clone = cloneVariant(source);
    clone.tools[0].name = "changed";

    expect(source.tools[0].name).toBe("lookup");
  });
});

describe("withFieldInserted", () => {
  it("appends the token to the last editable user message", () => {
    const variant = variantWith(["system", "first user", "second user"]);
    const next = withFieldInserted(variant, "input");

    expect(next.messages[2].content).toBe("second user\n{{input}}");
    expect(next.messages[1].content).toBe("first user");
    expect(next.stale).toBe(true);
  });

  it("leaves a variant that already references the field untouched", () => {
    const variant = variantWith(["system", "uses {{input}}"]);
    expect(withFieldInserted(variant, "input")).toBe(variant);
  });

  it("skips read-only trace messages when picking a target", () => {
    const variant = variantWith(["system", "editable"]);
    variant.messages.push({ id: "ro", role: "user", content: "from trace", readonly: true });

    const next = withFieldInserted(variant, "input");

    expect(next.messages[1].content).toBe("editable\n{{input}}");
    expect(next.messages[2].content).toBe("from trace");
  });

  it("returns the variant unchanged when there is no editable user message", () => {
    const variant = emptyVariant();
    variant.messages = [{ id: "s", role: "system", content: "only a system message" }];
    expect(withFieldInserted(variant, "input")).toBe(variant);
  });

  it("does not leave a blank line when the target message is empty", () => {
    const variant = variantWith(["system", ""]);
    expect(withFieldInserted(variant, "input").messages[1].content).toBe("{{input}}");
  });
});

describe("insertTokenAt", () => {
  it("inserts at the caret and reports where the caret lands", () => {
    expect(insertTokenAt("ab", "{{x}}", 1, 1)).toEqual({ content: "a{{x}}b", caret: 6 });
  });

  it("replaces the selection", () => {
    expect(insertTokenAt("abcd", "{{x}}", 1, 3)).toEqual({ content: "a{{x}}d", caret: 6 });
  });

  it("clamps a caret past the end of the content", () => {
    expect(insertTokenAt("ab", "{{x}}", 99, 99)).toEqual({ content: "ab{{x}}", caret: 7 });
  });
});

describe("run keys and per-row inputs", () => {
  const draft: PlaygroundDraft = {
    ...starterDraft(),
    rows: [rowWith("r1", "first", "golden"), rowWith("r2", "second")],
  };

  it("fans a table run out over the row ids", () => {
    expect(rowKeysFor(draft)).toEqual(["r1", "r2"]);
  });

  it("collapses an editor-bench run to the single key", () => {
    expect(rowKeysFor(starterDraft())).toEqual([SINGLE_ROW_KEY]);
    expect(rowKeysFor({ ...draft, rows: [] })).toEqual([SINGLE_ROW_KEY]);
  });

  it("binds a table row's input as the input variable", () => {
    expect(varsForRow(draft, "r1")).toEqual({ input: "first" });
  });

  it("binds the hand-entered variables in editor-bench mode", () => {
    const bench = { ...starterDraft(), vars: { context: "docs" } };
    expect(varsForRow(bench, SINGLE_ROW_KEY)).toEqual({ context: "docs" });
  });

  it("reads the reference answer from whichever mode is active", () => {
    expect(expectedForRow(draft, "r1")).toBe("golden");
    expect(expectedForRow(draft, "r2")).toBeNull();
    expect(expectedForRow({ ...starterDraft(), expectedSingle: "g" }, SINGLE_ROW_KEY)).toBe("g");
  });
});

describe("renderedMessages", () => {
  it("substitutes into every message while preserving role and order", () => {
    const variant = variantWith(["You are terse.", "Summarise {{input}}"]);
    const rendered = renderedMessages(variant, { input: "the refund policy" });

    expect(rendered.map((m) => m.role)).toEqual(["system", "user"]);
    expect(rendered[1].content).toBe("Summarise the refund policy");
  });
});
