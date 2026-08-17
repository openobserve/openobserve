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

//! The one expression field on the SLO form, in both of its languages.
//!
//! A time-slice SLI over a metrics stream is PromQL, not SQL, and the two need
//! different completions from different machinery. What is tested here is the
//! WIRING — which language the editor is put in and which typeahead drives it —
//! because getting that wrong is silent: the editor still works, it just offers
//! the wrong vocabulary.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const triggerAutoComplete = vi.fn();
const disableSuggestionPopup = vi.fn();
/** One call per editor INSTANCE — monaco reads its language once, at mount. */
const editorCreated = vi.fn();
/** The cursor sits at the end of what was last typed, as monaco's would. */
let cursorIndex = 0;

// Monaco is not the subject; what it is HANDED is. The stub also exposes the
// three methods the PromQL typeahead reaches for through the template ref —
// without them the composable cannot open its popup at all.
//
// `language` deliberately defaults to a sentinel rather than to "sql": a stub
// that defaults to the right answer cannot tell "bound correctly" from "never
// bound".
vi.mock("@/components/CodeQueryEditor.vue", () => ({
  __esModule: true,
  default: {
    name: "CodeQueryEditor",
    props: {
      editorId: { type: String, default: "" },
      query: { type: String, default: "" },
      language: { type: String, default: "UNBOUND" },
      keywords: { type: Array, default: () => [] },
      suggestions: { type: Array, default: null },
      fieldValueResolver: { type: Function, default: null },
      showLineNumbers: { type: Boolean, default: true },
      stickyScroll: { type: Boolean, default: true },
    },
    emits: ["update:query", "focus", "blur"],
    setup() {
      editorCreated();
      return {
        getCursorIndex: () => cursorIndex,
        triggerAutoComplete,
        disableSuggestionPopup,
      };
    },
    template: '<div class="code-query-editor-stub" />',
  },
}));

// The PromQL label typeahead reads the metric's SCHEMA. Unmocked it reaches
// axios from jsdom.
const schema = vi.fn();
vi.mock("@/services/stream", () => ({
  default: { schema: (...args: unknown[]) => schema(...args) },
}));

import SloExpressionField from "./SloExpressionField.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";

const SQL_KEYWORDS = [{ label: "duration_ms", kind: "Field" }];
const SQL_SUGGESTIONS = [{ label: "AVG", kind: "Function" }];
const resolveFieldValues = vi.fn().mockResolvedValue([]);

let wrapper: VueWrapper | null = null;

const createWrapper = (props: Record<string, unknown> = {}) => {
  wrapper = mount(SloExpressionField, {
    props: {
      editorId: "slo-aggregate-editor",
      label: raw("Aggregate"),
      modelValue: "",
      keywords: SQL_KEYWORDS,
      suggestions: SQL_SUGGESTIONS,
      fieldValueResolver: resolveFieldValues,
      dataTest: "slos-addslo-aggregate",
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
  return wrapper;
};

const editor = (w: VueWrapper) => w.findComponent({ name: "CodeQueryEditor" });

const keywordLabels = (w: VueWrapper) =>
  (editor(w).props("keywords") as { label: string }[]).map((k) => k.label);

/** What the editor emits when the user types, cursor at the end. */
const type = async (w: VueWrapper, text: string) => {
  cursorIndex = text.length - 1;
  editor(w).vm.$emit("update:query", text);
  await flushPromises();
};

describe("SloExpressionField", () => {
  beforeEach(() => {
    triggerAutoComplete.mockClear();
    disableSuggestionPopup.mockClear();
    editorCreated.mockClear();
    schema.mockReset();
    schema.mockResolvedValue({ data: { schema: [] } });
    cursorIndex = 0;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  describe("the SQL path", () => {
    it("stays in SQL when no language is asked for", () => {
      expect(editor(createWrapper()).props("language")).toBe("sql");
    });

    // Structural, not by reference: vue-test-utils makes the mounting props
    // reactive, so what the child reads is a proxy of the array passed in.
    it("serves the parent's SQL typeahead, untouched", () => {
      const w = createWrapper({ language: "sql" });
      expect(editor(w).props("keywords")).toEqual(SQL_KEYWORDS);
      expect(editor(w).props("suggestions")).toEqual(SQL_SUGGESTIONS);
      expect(editor(w).props("fieldValueResolver")).toBe(resolveFieldValues);
    });

    // The SQL typeahead is parent-driven: the field lists arrive as props and
    // nothing here reacts to a keystroke.
    it("does not drive the PromQL typeahead on a keystroke", async () => {
      const w = createWrapper({ language: "sql" });
      await type(w, "avg(duration_ms)");
      expect(triggerAutoComplete).not.toHaveBeenCalled();
    });

    it("emits the edited value with newlines collapsed", async () => {
      const w = createWrapper();
      await type(w, "avg(a)\n  + avg(b)");
      expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["avg(a) + avg(b)"]);
    });
  });

  describe("the PromQL path", () => {
    it("puts the editor in monaco's promql language, not the wire spelling", () => {
      // `prom_ql` is the API's discriminator; monaco's language id is `promql`.
      expect(editor(createWrapper({ language: "prom_ql" })).props("language")).toBe("promql");
    });

    it("offers the PromQL catalog instead of the stream's SQL fields", () => {
      const labels = keywordLabels(createWrapper({ language: "prom_ql" }));
      expect(labels).toContain("rate");
      expect(labels).not.toContain("duration_ms");
    });

    // Both editor props default to `null`, which the shared resolver reads as
    // "no list" — so withholding them arrives as null, not undefined.
    it("withholds the SQL suggestion list and value resolver", () => {
      const w = createWrapper({ language: "prom_ql" });
      expect(editor(w).props("suggestions")).toBeNull();
      expect(editor(w).props("fieldValueResolver")).toBeNull();
    });

    // The cheap fallback branch: no metric, no braces, so the composable just
    // re-offers the catalog. It proves the popup handle is wired, nothing more.
    it("opens the popup on a keystroke", async () => {
      const w = createWrapper({ language: "prom_ql" });
      await type(w, "up");
      expect(triggerAutoComplete).toHaveBeenCalled();
    });

    // The one that needs ALL of it: the query text, the cursor offset and the
    // popup handles have to reach the composable before a label list can come
    // back. Nothing short of the real wiring produces this.
    it("completes label names from the metric's schema", async () => {
      schema.mockResolvedValue({
        data: { schema: [{ name: "pod" }, { name: "value" }, { name: "_timestamp" }] },
      });
      const w = createWrapper({ language: "prom_ql" });

      await type(w, "http_requests_total{");
      await flushPromises();

      expect(schema).toHaveBeenCalledWith("default", "http_requests_total", "metrics");
      const labels = keywordLabels(w);
      expect(labels).toEqual(["pod"]); // `value`/`_timestamp` are not labels
    });

    it("still emits the edited value with newlines collapsed", async () => {
      const w = createWrapper({ language: "prom_ql" });
      await type(w, "sum(\n  rate(x[5m])\n)");
      expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["sum( rate(x[5m]) )"]);
    });
  });

  // The form derives the language from the stream type, so it flips under a
  // mounted field. Monaco reads `language` ONCE, at creation — it registers the
  // grammar and the completion providers there and watches nothing — so
  // re-binding the prop on the same instance leaves a SQL editor forever.
  describe("when the language flips under it", () => {
    it("builds a new editor rather than re-labelling the old one", async () => {
      const w = createWrapper({ language: "sql" });
      const sqlId = editor(w).props("editorId");
      expect(editorCreated).toHaveBeenCalledTimes(1);

      await w.setProps({ language: "prom_ql" });

      expect(editorCreated).toHaveBeenCalledTimes(2);
      expect(editor(w).props("language")).toBe("promql");
      // A distinct DOM id too: the editor finds its host with
      // `getElementById`, and two instances sharing one id race.
      expect(editor(w).props("editorId")).not.toBe(sqlId);
    });

    it("hands the new editor the other language's typeahead", async () => {
      const w = createWrapper({ language: "sql" });
      await w.setProps({ language: "prom_ql" });

      expect(keywordLabels(w)).toContain("rate");
      await type(w, "up");
      expect(triggerAutoComplete).toHaveBeenCalled();
    });

    it("stops driving the PromQL typeahead once it is back in SQL", async () => {
      const w = createWrapper({ language: "prom_ql" });
      await w.setProps({ language: "sql" });
      triggerAutoComplete.mockClear();

      await type(w, "avg(took)");

      expect(editor(w).props("language")).toBe("sql");
      expect(triggerAutoComplete).not.toHaveBeenCalled();
    });
  });
});
