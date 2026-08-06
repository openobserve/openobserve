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

import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import ContentTemplateForm from "./ContentTemplateForm.vue";
import { emptyContentSpec, starterContentSpec } from "./contentSpec";

const editorStub = {
  name: "QueryEditor",
  template: '<div class="stub-editor"></div>',
  props: ["query", "editorId", "language"],
  emits: ["update:query"],
};

async function mountForm(modelValue = emptyContentSpec()) {
  const w = mount(ContentTemplateForm, {
    props: { modelValue, "onUpdate:modelValue": () => {} },
    global: {
      plugins: [i18n],
      stubs: { QueryEditor: editorStub },
    },
  });
  await flushPromises();
  return w;
}

describe("ContentTemplateForm", () => {
  it("renders only title, body and the collapsed 'Add to this template' disclosure on first run", async () => {
    const w = await mountForm();
    expect(w.find('[data-test="content-template-form-title-input"]').exists()).toBe(true);
    expect(w.find('[data-test="content-template-form-body-editor"]').exists()).toBe(true);
    expect(w.find('[data-test="content-template-form-optional-collapsible"]').exists()).toBe(true);
    // Optional sections are present in the DOM (owned by the collapsible
    // content), but the collapsible itself starts closed for an empty spec.
    expect(
      w.find(`[data-test="content-template-form-optional-collapsible"]`).attributes("data-state"),
    ).toBe("closed");
  });

  it("does not render the chart toggle (Task 17 D4 — dead UI removed)", async () => {
    const w = await mountForm();
    expect(w.find('[data-test="content-template-form-chart-switch"]').exists()).toBe(false);
    expect(w.find('[data-test="content-template-form-chart-phase2-hint"]').exists()).toBe(false);
  });

  it("auto-opens the disclosure when the spec already has fields", async () => {
    const spec = emptyContentSpec();
    spec.fields = [{ label: "Value", value: "{alert_agg_value}" }];
    const w = await mountForm(spec);
    expect(
      w.find(`[data-test="content-template-form-optional-collapsible"]`).attributes("data-state"),
    ).toBe("open");
  });

  it("auto-opens the disclosure when rows are enabled", async () => {
    const spec = emptyContentSpec();
    spec.rows.enabled = true;
    const w = await mountForm(spec);
    expect(
      w.find(`[data-test="content-template-form-optional-collapsible"]`).attributes("data-state"),
    ).toBe("open");
  });

  it("keeps the disclosure CLOSED for a freshly seeded template, despite its optional content", async () => {
    // The starter seed deliberately carries rows + fields, so
    // hasOptionalContent() is honestly true for it. The disclosure's rule is
    // "would collapsing hide something the USER wrote?" — and on first run
    // they have written nothing. Without the isSeeded guard, every new
    // template opens fully expanded and the redesign is defeated.
    const w = mount(ContentTemplateForm, {
      props: {
        modelValue: starterContentSpec(),
        isSeeded: true,
        "onUpdate:modelValue": () => {},
      },
      global: { plugins: [i18n], stubs: { QueryEditor: editorStub } },
    });
    await flushPromises();
    expect(
      w.find(`[data-test="content-template-form-optional-collapsible"]`).attributes("data-state"),
    ).toBe("closed");
  });

  it("auto-opens for the SAME spec once it is no longer a fresh seed", async () => {
    // Same content, isSeeded false — i.e. a saved template the user reopens.
    const w = mount(ContentTemplateForm, {
      props: {
        modelValue: starterContentSpec(),
        isSeeded: false,
        "onUpdate:modelValue": () => {},
      },
      global: { plugins: [i18n], stubs: { QueryEditor: editorStub } },
    });
    await flushPromises();
    expect(
      w.find(`[data-test="content-template-form-optional-collapsible"]`).attributes("data-state"),
    ).toBe("open");
  });

  it("auto-opens the disclosure when a channel title override is present", async () => {
    const spec = emptyContentSpec();
    spec.title_overrides = { slack: "Custom slack title" };
    const w = await mountForm(spec);
    expect(
      w.find(`[data-test="content-template-form-optional-collapsible"]`).attributes("data-state"),
    ).toBe("open");
  });

  it("stays closed for an empty spec", async () => {
    const w = await mountForm(emptyContentSpec());
    expect(
      w.find(`[data-test="content-template-form-optional-collapsible"]`).attributes("data-state"),
    ).toBe("closed");
  });

  it("does not show the rows max/format controls until rows is enabled", async () => {
    // Mount already inside the open disclosure (rows.enabled seeds
    // auto-open) so the CollapsibleContent slot is actually rendered — reka-ui
    // unmounts its content while closed, so toggling rows on a form that
    // mounted collapsed would never surface these controls regardless of the
    // v-if below.
    const spec = emptyContentSpec();
    spec.rows.enabled = true;
    const w = await mountForm(spec);
    expect(w.find('[data-test="content-template-form-rows-max-input"]').exists()).toBe(true);
    expect(w.find('[data-test="content-template-form-rows-format-input"]').exists()).toBe(true);

    spec.rows.enabled = false;
    const wDisabled = await mountForm(spec);
    expect(wDisabled.find('[data-test="content-template-form-rows-max-input"]').exists()).toBe(
      false,
    );
  });

  it("shows the rows-format lint hint when the format references an unknown column", async () => {
    const spec = emptyContentSpec();
    spec.rows.enabled = true;
    spec.rows.columns = ["timestamp", "message"];
    spec.rows.format = "{timestamp} {unknown_col}";
    const w = await mountForm(spec);

    expect(w.find('[data-test="content-template-form-rows-format-lint-hint"]').exists()).toBe(true);
  });

  it("does NOT show the lint hint when every referenced column is declared", async () => {
    const spec = emptyContentSpec();
    spec.rows.enabled = true;
    spec.rows.columns = ["timestamp", "message"];
    spec.rows.format = "{timestamp} {message}";
    const w = await mountForm(spec);

    expect(w.find('[data-test="content-template-form-rows-format-lint-hint"]').exists()).toBe(
      false,
    );
  });

  // The reported case: `-{alert_agg_value}` with no space is not a list, so
  // consecutive lines collapse into one paragraph with no explanation.
  it("shows the body lint hint for a list marker with no following space", async () => {
    const spec = emptyContentSpec();
    spec.body = "Alert fired\n-{alert_agg_value}\n-{alert_operator}";
    const w = await mountForm(spec);

    const hint = w.find('[data-test="content-template-form-body-lint-hint"]');
    expect(hint.exists()).toBe(true);
    // Reports the FIRST offending line (1-based), not every one.
    expect(hint.text()).toContain("2");
  });

  it("shows the body lint hint for a heading marker with no following space", async () => {
    const spec = emptyContentSpec();
    spec.body = "##Summary";
    const w = await mountForm(spec);

    expect(w.find('[data-test="content-template-form-body-lint-hint"]').exists()).toBe(true);
  });

  it("does NOT show the body lint hint for well-formed markdown", async () => {
    const spec = emptyContentSpec();
    spec.body = "## Summary\n\n- {alert_agg_value}\n- {alert_operator}\n\nPlain text.";
    const w = await mountForm(spec);

    expect(w.find('[data-test="content-template-form-body-lint-hint"]').exists()).toBe(false);
  });

  // A hint, never a save-blocker: malformed markdown is still legal markdown
  // and the user may have meant it literally.
  it("does NOT block save when the body lint hint is showing", async () => {
    const spec = emptyContentSpec();
    spec.body = "-{alert_agg_value}";
    const w = await mountForm(spec);

    expect(w.find('[data-test="content-template-form-body-lint-hint"]').exists()).toBe(true);
    // The form emits changes normally — the hint is advisory only.
    await w
      .find('[data-test="content-template-form-title-input"] input')
      .setValue("Still editable");
    expect(w.emitted("update:modelValue")).toBeTruthy();
  });

  it("emits update:modelValue with the title change", async () => {
    const w = await mountForm();
    await w.find('[data-test="content-template-form-title-input"] input').setValue("New title");

    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    const last = emitted!.at(-1)![0] as any;
    expect(last.title).toBe("New title");
  });

  it("renders variable chips beneath the body editor and inserts the token on click", async () => {
    const w = await mountForm();
    const chip = w.find('[data-test="content-template-form-variable-chip-alert_name-btn"]');
    expect(chip.exists()).toBe(true);
    await chip.trigger("click");

    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    const last = emitted!.at(-1)![0] as any;
    // Editor isn't mounted in this stubbed test env, so insertVariable falls
    // back to appending — still proves the click wires through to the model.
    expect(last.body).toContain("{alert_name}");
  });

  it('shows a "+N more" affordance that reveals the rest of the variable list', async () => {
    const w = await mountForm();
    const more = w.find('[data-test="content-template-form-variable-chips-more-btn"]');
    expect(more.exists()).toBe(true);
    await more.trigger("click");
    expect(w.find('[data-test="content-template-form-variable-chips-more-btn"]').exists()).toBe(
      false,
    );
  });

  describe("toolbar actions", () => {
    // applyToolbarAction reads bodyEditorRef.value.editorObj — the plain-div
    // stub used above has no editorObj, so it only ever exercises the
    // "editor not mounted" fallback (append-to-end). To cover the real
    // cursor-aware path (the bug: list/heading inserted "- "/"## " wherever
    // the cursor sat instead of at column 1 of the current line) we need a
    // stub that fakes a minimal Monaco editor surface.
    function makeEditorStub(
      bodyLines: string[],
      selection: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      },
    ) {
      const lines = [...bodyLines];
      const model = {
        getValueInRange(range: any) {
          if (range.startLineNumber !== range.endLineNumber) return "";
          const line = lines[range.startLineNumber - 1] ?? "";
          return line.slice(range.startColumn - 1, range.endColumn - 1);
        },
        getValue() {
          return lines.join("\n");
        },
      };
      let currentSelection = { ...selection };
      const positions: any[] = [];
      const editorObj = {
        getSelection: () => currentSelection,
        getModel: () => model,
        executeEdits: (_source: string, edits: any[]) => {
          for (const edit of edits) {
            const { range, text } = edit;
            const lineIdx = range.startLineNumber - 1;
            const line = lines[lineIdx] ?? "";
            lines[lineIdx] =
              line.slice(0, range.startColumn - 1) + text + line.slice(range.endColumn - 1);
          }
        },
        setPosition: (pos: any) => positions.push(pos),
        setSelection: (sel: any) => {
          currentSelection = sel;
        },
        focus: () => {},
        __lines: lines,
        __positions: positions,
      };
      return { editorObj, lines };
    }

    async function mountWithEditorStub(body: string, selection: any) {
      const w = await mountForm({ ...emptyContentSpec(), body });
      const bodyLines = body.split("\n");
      const { editorObj, lines } = makeEditorStub(bodyLines, selection);
      (w.vm as any).bodyEditorRef = { editorObj };
      return { w, editorObj, lines };
    }

    async function click(w: any, name: string) {
      await w.find(`[data-test="content-template-form-toolbar-${name}-btn"]`).trigger("click");
    }

    const cursorAt = (line: number, col: number) => ({
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: col,
    });

    describe("list button — line-prefix marker, cursor-position matrix", () => {
      it("cursor at column 1 of a single line", async () => {
        const { w, lines } = await mountWithEditorStub("hello", cursorAt(1, 1));
        await click(w, "list");
        expect(lines).toEqual(["- hello"]);
      });

      it("cursor mid-word", async () => {
        const { w, lines } = await mountWithEditorStub("hello world", cursorAt(1, 6));
        await click(w, "list");
        expect(lines).toEqual(["- hello world"]);
      });

      it("cursor at end of a single line", async () => {
        const body = "Some existing text here.";
        const { w, editorObj, lines } = await mountWithEditorStub(
          body,
          cursorAt(1, body.length + 1),
        );
        await click(w, "list");
        expect(lines).toEqual(["- Some existing text here."]);
        expect((editorObj as any).__positions.at(-1)).toEqual({ lineNumber: 1, column: 3 });
      });

      it("cursor on the FIRST of several lines", async () => {
        const { w, lines } = await mountWithEditorStub(
          "line one\nline two\nline three",
          cursorAt(1, 5),
        );
        await click(w, "list");
        expect(lines).toEqual(["- line one", "line two", "line three"]);
      });

      it("cursor on a MIDDLE line (the reported repro shape: text, blanks, cursor further down)", async () => {
        const body = "**{alert_name}** fired.\n\n`{op} {th}` — observed **{val}**.\n\n\n";
        const bodyLines = body.split("\n");
        // Cursor parked on line 6 (the last, empty line) — mirrors the user's
        // screenshot: 3 content/blank lines above, cursor on line 6.
        const { w, lines } = await mountWithEditorStub(body, cursorAt(6, 1));
        await click(w, "list");
        expect(lines[5]).toBe("- ");
        // Every OTHER line must be untouched — this is the crux of the bug
        // report: the marker must not land on line 2 (or any line but 6).
        for (let i = 0; i < 5; i++) {
          expect(lines[i]).toBe(bodyLines[i]);
        }
      });

      it("cursor on a blank line between two content lines", async () => {
        const { w, lines } = await mountWithEditorStub("above\n\nbelow", cursorAt(2, 1));
        await click(w, "list");
        expect(lines).toEqual(["above", "- ", "below"]);
      });

      it("cursor on the LAST line when the body has many lines above it", async () => {
        const bodyLines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
        const { w, lines } = await mountWithEditorStub(bodyLines.join("\n"), cursorAt(10, 6));
        await click(w, "list");
        expect(lines[9]).toBe("- line 10");
        for (let i = 0; i < 9; i++) expect(lines[i]).toBe(bodyLines[i]);
      });

      it("cursor at column 1 of an entirely empty single-line body", async () => {
        const { w, lines } = await mountWithEditorStub("", cursorAt(1, 1));
        await click(w, "list");
        expect(lines).toEqual(["- "]);
      });

      it("multi-line selection (forward) prefixes every touched line", async () => {
        const { w, lines } = await mountWithEditorStub("First line\nSecond line\nThird line", {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 3,
          endColumn: "Third line".length + 1,
        });
        await click(w, "list");
        expect(lines).toEqual(["- First line", "- Second line", "- Third line"]);
      });

      it("multi-line selection (reversed — end before start per Monaco's own convention) still spans start..end line numbers", async () => {
        // Monaco selections track anchor/active independently of numeric
        // order; getSelection() always normalizes startLineNumber <=
        // endLineNumber, so a "reversed" drag still yields the same range.
        const { w, lines } = await mountWithEditorStub("alpha\nbeta\ngamma", {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 2,
          endColumn: "beta".length + 1,
        });
        await click(w, "list");
        expect(lines).toEqual(["- alpha", "- beta", "gamma"]);
      });

      it("selection spanning a blank line in the middle prefixes the blank line too", async () => {
        const { w, lines } = await mountWithEditorStub("one\n\nthree", {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 3,
          endColumn: "three".length + 1,
        });
        await click(w, "list");
        expect(lines).toEqual(["- one", "- ", "- three"]);
      });

      it("clicking twice on the same line double-prefixes (no idempotency guard — documents current behavior)", async () => {
        const { w, lines } = await mountWithEditorStub("hello", cursorAt(1, 1));
        await click(w, "list");
        await click(w, "list");
        expect(lines).toEqual(["- - hello"]);
      });

      it("line already starting with '- ' gets a second marker prepended (no dedup)", async () => {
        const { w, lines } = await mountWithEditorStub("- already a bullet", cursorAt(1, 5));
        await click(w, "list");
        expect(lines).toEqual(["- - already a bullet"]);
      });
    });

    describe("heading button — same line-prefix contract as list", () => {
      it("cursor mid-text on the second of two lines", async () => {
        const { w, lines } = await mountWithEditorStub(
          "Line one.\nLine two, cursor here.",
          cursorAt(2, "Line two, cursor here.".length + 1),
        );
        await click(w, "heading");
        expect(lines).toEqual(["Line one.", "## Line two, cursor here."]);
      });

      it("cursor on a later line with several blank lines above (mirrors the list repro)", async () => {
        const body = "text\n\n\n\n\ncursor line";
        const bodyLines = body.split("\n");
        const { w, lines } = await mountWithEditorStub(body, cursorAt(6, 1));
        await click(w, "heading");
        expect(lines[5]).toBe("## cursor line");
        for (let i = 0; i < 5; i++) expect(lines[i]).toBe(bodyLines[i]);
      });

      it("multi-line selection prefixes every line with '## '", async () => {
        const { w, lines } = await mountWithEditorStub("a\nb\nc", {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 3,
          endColumn: 2,
        });
        await click(w, "heading");
        expect(lines).toEqual(["## a", "## b", "## c"]);
      });
    });

    describe("wrap-style buttons (bold/italic/code/link) — must stay cursor/selection-relative, unaffected by the line-prefix fix", () => {
      it("bold: empty selection mid-line wraps AT the cursor, not at column 1", async () => {
        const body = "Some existing text here.";
        const { w, lines, editorObj } = await mountWithEditorStub(
          body,
          cursorAt(1, body.length + 1),
        );
        await click(w, "bold");
        expect(lines[0]).toBe("Some existing text here.****");
        expect((editorObj as any).__positions.at(-1)).toEqual({
          lineNumber: 1,
          column: body.length + 3,
        });
      });

      it("bold: empty selection on a LATER line (regression guard for the same cursor-position bug class)", async () => {
        const body = "line one\nline two\ncursor on this line";
        const bodyLines = body.split("\n");
        const { w, lines } = await mountWithEditorStub(
          body,
          cursorAt(3, "cursor on this line".length + 1),
        );
        await click(w, "bold");
        expect(lines[0]).toBe(bodyLines[0]);
        expect(lines[1]).toBe(bodyLines[1]);
        expect(lines[2]).toBe("cursor on this line****");
      });

      it("bold: non-empty selection wraps exactly the selected text", async () => {
        const body = "wrap me please";
        const { w, lines } = await mountWithEditorStub(body, {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: "wrap me".length + 1,
        });
        await click(w, "bold");
        expect(lines[0]).toBe("**wrap me** please");
      });

      it("italic and code buttons wrap the selection with their own delimiters", async () => {
        const body = "target word here";
        const range = { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 12 };

        const italic = await mountWithEditorStub(body, range);
        await click(italic.w, "italic");
        expect(italic.lines[0]).toBe("target _word_ here");

        const code = await mountWithEditorStub(body, range);
        await click(code.w, "code");
        expect(code.lines[0]).toBe("target `word` here");
      });

      it("link button wraps the selection and appends the (url) placeholder", async () => {
        const body = "see docs for details";
        const { w, lines } = await mountWithEditorStub(body, {
          startLineNumber: 1,
          startColumn: 5,
          endLineNumber: 1,
          endColumn: 9,
        });
        await click(w, "link");
        expect(lines[0]).toBe("see [docs](url) for details");
      });

      it("link button with an empty selection wraps at the cursor, leaving empty brackets", async () => {
        const { w, lines } = await mountWithEditorStub("no selection here", cursorAt(1, 4));
        await click(w, "link");
        expect(lines[0]).toBe("no [](url)selection here");
      });
    });

    describe("editor-not-mounted fallback (Monaco not yet loaded / unit-test double)", () => {
      it("list falls back to appending '- ' at the end of the body", async () => {
        const w = await mountForm({ ...emptyContentSpec(), body: "existing" });
        await click(w, "list");
        const last = w.emitted("update:modelValue")!.at(-1)![0] as any;
        expect(last.body).toBe("existing- ");
      });

      it("heading falls back to appending '## ' at the end of the body", async () => {
        const w = await mountForm({ ...emptyContentSpec(), body: "existing" });
        await click(w, "heading");
        const last = w.emitted("update:modelValue")!.at(-1)![0] as any;
        expect(last.body).toBe("existing## ");
      });

      it("bold falls back to appending '****' at the end of the body", async () => {
        const w = await mountForm({ ...emptyContentSpec(), body: "existing" });
        await click(w, "bold");
        const last = w.emitted("update:modelValue")!.at(-1)![0] as any;
        expect(last.body).toBe("existing****");
      });

      it("falls back correctly even when the body is empty", async () => {
        const w = await mountForm({ ...emptyContentSpec(), body: "" });
        await click(w, "list");
        const last = w.emitted("update:modelValue")!.at(-1)![0] as any;
        expect(last.body).toBe("- ");
      });
    });
  });

  describe("emoji picker", () => {
    it("renders a curated set of icon buttons in the popover once opened", async () => {
      // OPopover teleports its content to document.body (reka-ui's
      // PopoverPortal) — outside the mounted wrapper's own tree, so the
      // component must be attached to the real DOM to find it, same pattern
      // as OPopover.spec.ts itself.
      const w = mount(ContentTemplateForm, {
        props: { modelValue: emptyContentSpec(), "onUpdate:modelValue": () => {} },
        global: { plugins: [i18n], stubs: { QueryEditor: editorStub } },
        attachTo: document.body,
      });
      await flushPromises();
      await w.find('[data-test="content-template-form-toolbar-emoji-btn"]').trigger("click");
      await flushPromises();
      expect(
        document.querySelector('[data-test="content-template-form-emoji-siren-btn"]'),
      ).not.toBeNull();
      expect(
        document.querySelector('[data-test="content-template-form-emoji-fire-btn"]'),
      ).not.toBeNull();
      expect(
        document.querySelector('[data-test="content-template-form-emoji-warning-btn"]'),
      ).not.toBeNull();
      expect(
        document.querySelector('[data-test="content-template-form-emoji-check-btn"]'),
      ).not.toBeNull();
      w.unmount();
    });

    it("insertText appends the emoji when the editor isn't mounted (fallback path)", async () => {
      const w = await mountForm({ ...emptyContentSpec(), body: "existing" });
      (w.vm as any).insertText("🚨");
      const last = w.emitted("update:modelValue")!.at(-1)![0] as any;
      expect(last.body).toBe("existing🚨");
    });

    it("insertText inserts at the cursor via the same editorObj seam as insertVariable", async () => {
      const w = await mountForm({ ...emptyContentSpec(), body: "hello world" });
      const lines = ["hello world"];
      const positions: any[] = [];
      const editorObj = {
        getSelection: () => ({
          startLineNumber: 1,
          startColumn: 6,
          endLineNumber: 1,
          endColumn: 6,
        }),
        getModel: () => ({
          getValue: () => lines.join("\n"),
        }),
        executeEdits: (_source: string, edits: any[]) => {
          for (const edit of edits) {
            const { range, text } = edit;
            const lineIdx = range.startLineNumber - 1;
            const line = lines[lineIdx] ?? "";
            lines[lineIdx] =
              line.slice(0, range.startColumn - 1) + text + line.slice(range.endColumn - 1);
          }
        },
        setPosition: (pos: any) => positions.push(pos),
        focus: () => {},
      };
      (w.vm as any).bodyEditorRef = { editorObj };

      (w.vm as any).insertText("🔥");

      expect(lines[0]).toBe("hello🔥 world");
    });
  });
});
