// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  EXPECTED_OUTPUT_TOKEN,
  adoptIds,
  cloneVariant,
  draftFromSnapshot,
  emptyVariant,
  extractVariantVars,
  extractVars,
  hasReference,
  moveMessage,
  nextMessageRole,
  playgroundId,
  renderTemplate,
  renderedMessages,
  scorerEvidence,
  snapshotPayload,
  starterDraft,
  tokenAtCaret,
  variantLabel,
  withFieldInserted,
  withRole,
  type PlaygroundMessage,
  type PlaygroundResults,
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

describe("tokenAtCaret", () => {
  it("names the token the caret sits inside", () => {
    expect(tokenAtCaret("Hello {{input}}!", 10)).toBe("input");
  });

  it("matches at either edge of the token", () => {
    expect(tokenAtCaret("{{input}}", 0)).toBe("input");
    expect(tokenAtCaret("{{input}}", 9)).toBe("input");
  });

  it("returns null outside any token", () => {
    expect(tokenAtCaret("Hello {{input}}!", 2)).toBeNull();
  });

  it("returns null when there is no token at all", () => {
    expect(tokenAtCaret("Hello!", 3)).toBeNull();
  });

  it("picks the token the caret is actually inside, among several", () => {
    expect(tokenAtCaret("{{a}} {{b}} {{c}}", 8)).toBe("b");
  });
});

describe("labels", () => {
  it("letters the first four variants", () => {
    expect([0, 1, 2, 3].map(variantLabel)).toEqual(["A", "B", "C", "D"]);
  });

  it("falls back to a number past the fourth variant", () => {
    expect(variantLabel(4)).toBe("5");
  });
});

describe("cloneVariant", () => {
  it("gives the clone fresh ids and a clean slate", () => {
    const source = variantWith(["sys", "user"]);
    source.tools = [{ name: "lookup", description: "", parameters: "{}" }];

    const clone = cloneVariant(source);

    expect(clone.id).not.toBe(source.id);
    expect(clone.messages.map((m) => m.id)).not.toEqual(source.messages.map((m) => m.id));
    expect(clone.messages.map((m) => m.content)).toEqual(["sys", "user"]);
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

describe("renderedMessages", () => {
  it("substitutes into every message while preserving role and order", () => {
    const variant = variantWith(["You are terse.", "Summarise {{input}}"]);
    const rendered = renderedMessages(variant, { input: "the refund policy" });

    expect(rendered.map((m) => m.role)).toEqual(["system", "user"]);
    expect(rendered[1].content).toBe("Summarise the refund policy");
  });
});

describe("message roles", () => {
  it("continues the conversation with the opposite turn, skipping context messages", () => {
    expect(nextMessageRole([{ id: "s", role: "system", content: "" }])).toBe("user");
    expect(
      nextMessageRole([
        { id: "s", role: "system", content: "" },
        { id: "u", role: "user", content: "hi" },
      ]),
    ).toBe("assistant");
    expect(
      nextMessageRole([
        { id: "u", role: "user", content: "hi" },
        { id: "a", role: "assistant", content: "hello" },
        { id: "t", role: "tool", content: "{}" },
      ]),
    ).toBe("user");
  });

  it("keeps the content when a message is retyped, and drops a tool label on the way out", () => {
    const tool: PlaygroundMessage = { id: "t", role: "tool", content: "{}", toolName: "lookup" };
    expect(withRole(tool, "user")).toEqual({ id: "t", role: "user", content: "{}" });
    expect(withRole(tool, "tool")).toEqual(tool);
  });
});

describe("moveMessage", () => {
  const thread = (): PlaygroundMessage[] => [
    { id: "m1", role: "system", content: "frame" },
    { id: "m2", role: "user", content: "a" },
    { id: "m3", role: "assistant", content: "b" },
  ];

  it("moves a turn and leaves the rest in order", () => {
    expect(moveMessage(thread(), 2, 1).map((m) => m.id)).toEqual(["m1", "m3", "m2"]);
  });

  it("never moves the system frame, and never lets anything above it", () => {
    expect(moveMessage(thread(), 0, 2)).toEqual(thread());
    expect(moveMessage(thread(), 2, 0).map((m) => m.id)).toEqual(["m1", "m3", "m2"]);
  });

  it("clamps an out-of-range target and returns the same array when nothing moves", () => {
    const source = thread();
    expect(moveMessage(source, 1, 99).map((m) => m.id)).toEqual(["m1", "m3", "m2"]);
    expect(moveMessage(source, 1, 1)).toBe(source);
    expect(moveMessage(source, 9, 0)).toBe(source);
  });
});

describe("scorer evidence", () => {
  it("reads the same requirements out of a template that the server does", () => {
    expect(scorerEvidence("{{output}} vs {{expected_output}}")).toEqual({
      expectedOutput: true,
      trace: false,
    });
    expect(scorerEvidence("inspect {{ spans.0.name }}")).toEqual({
      expectedOutput: false,
      trace: true,
    });
    expect(scorerEvidence("walk {{steps}}")).toEqual({ expectedOutput: false, trace: true });
    expect(scorerEvidence("just {{output}}")).toEqual({ expectedOutput: false, trace: false });
  });

  it("treats a blank expected output as no reference at all", () => {
    expect(hasReference(null)).toBe(false);
    expect(hasReference("  ")).toBe(false);
    expect(hasReference("golden")).toBe(true);
  });
});

describe("snapshots", () => {
  it("carries the bench, and only outcomes from the results", () => {
    const draft = starterDraft("p1", "gpt-4o");
    draft.vars = { input: "hi" };
    draft.expectedSingle = "golden";
    const variantId = draft.variants[0].id;
    const results: PlaygroundResults = {
      [variantId]: {
        single: { status: "done", text: "answer", toolCall: null, usage: null, error: null },
        other: { status: "streaming", text: "half", toolCall: null, usage: null, error: null },
      },
    };

    const payload = snapshotPayload(draft, results);

    expect(payload.columns).toHaveLength(1);
    expect(payload.columns[0]).toMatchObject({ providerId: "p1", model: "gpt-4o" });
    expect(payload.rows).toEqual([{ vars: { input: "hi" }, expected: "golden" }]);
    // A cell caught mid-stream would restore as a run that never finishes.
    expect(Object.keys(payload.results[variantId])).toEqual(["single"]);
  });

  it("reads a payload back, and refuses one carrying no bench", () => {
    const draft = starterDraft("p1", "gpt-4o");
    const wire = JSON.parse(JSON.stringify(snapshotPayload(draft, {})));

    expect(draftFromSnapshot(wire)?.draft).toEqual(draft);
    expect(draftFromSnapshot({ version: 1 })).toBeNull();
    expect(draftFromSnapshot(null)).toBeNull();
  });
});

describe("adoptIds", () => {
  it("pushes the counter past ids an earlier page load already spent", () => {
    const restored = JSON.parse(
      JSON.stringify({
        ...starterDraft("p1", "m"),
        variants: [
          {
            id: "variant-900",
            providerId: "p1",
            model: "m",
            temperature: "0",
            tools: [],
            responseSchema: null,
            messages: [{ id: "msg-901", role: "system", content: "" }],
          },
        ],
      }),
    );

    adoptIds(restored);

    // Without this, a duplicate makes every lookup by id resolve to the first
    // match — a model change lands on the wrong column and one x deletes both.
    const clone = cloneVariant(restored.variants[0]);
    expect(clone.id).not.toBe("variant-900");
    expect(Number(playgroundId("msg").split("-")[1])).toBeGreaterThan(901);
  });

  it("ignores ids it did not mint", () => {
    const draft = starterDraft("p1", "m");
    draft.variants[0].id = "9f2c1b6e-a4d3-4f10-8f21-0c9d2e7b5a44";
    expect(() => adoptIds(draft)).not.toThrow();
  });
});
