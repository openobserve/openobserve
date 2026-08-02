// Copyright 2026 OpenObserve Inc.
//
// Phase 1 completion-provider integration tests (tmp/code.md).
//
// Deliberately a SEPARATE file from CodeQueryEditor.spec.ts: that suite's
// async-mount tests (Ctrl+Enter, setValue) are load-flaky on main — an
// unmodified copy fails ~9 of them on roughly 3 runs in 4 — and the contention
// starved this suite's beforeAll, skipping every test here. Isolated, these
// three mounts run reliably.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mount } from "@vue/test-utils";
import CodeQueryEditor from "./CodeQueryEditor.vue";
import { createStore } from "vuex";

// Stable model instance. CodeQueryEditor's completion provider answers only for
// its OWN model (`if (own && model !== own) return { suggestions: [] }`), so a
// getModel() that returns a fresh object each call makes the provider
// permanently unreachable from tests — which is why the provider specs below
// were previously skipped.
const mockModel = {
  getValue: vi.fn(() => ""),
  setValue: vi.fn(),
  getLineCount: vi.fn(() => 1),
  getLineLength: vi.fn(() => 0),
  pushEditOperations: vi.fn(),
  getOffsetAt: vi.fn(() => 0),
  getPositionAt: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  getLineContent: vi.fn(() => ""),
  getValueInRange: vi.fn(() => ""),
  getWordUntilPosition: vi.fn(() => ({ word: "", startColumn: 1, endColumn: 1 })),
};

// Stable mock editor instance so tests can reference it directly
const mockEditorObj = {
  onDidChangeModelContent: vi.fn(),
  createContextKey: vi.fn(),
  addCommand: vi.fn(),
  onDidFocusEditorWidget: vi.fn(),
  onDidBlurEditorWidget: vi.fn(),
  dispose: vi.fn(),
  getValue: vi.fn(() => ""),
  setValue: vi.fn(),
  layout: vi.fn(),
  getModel: vi.fn(() => mockModel),
  updateOptions: vi.fn(),
  hasWidgetFocus: vi.fn(() => false),
  getRawOptions: vi.fn(() => ({ readOnly: false })),
  deltaDecorations: vi.fn(() => []),
  getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  trigger: vi.fn(),
  getAction: vi.fn(() => ({ run: vi.fn(() => Promise.resolve()) })),
};

// Simple mock for monaco editor
vi.mock("monaco-editor/esm/vs/editor/editor.all.js", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  default: {},
  editor: {
    create: vi.fn(() => mockEditorObj),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    setModelMarkers: vi.fn(),
  },
  languages: {
    // Real values, mirroring monaco-editor/esm/vs/editor/common/languages.js
    CompletionItemKind: {
      Method: 0,
      Function: 1,
      Constructor: 2,
      Field: 3,
      Variable: 4,
      Operator: 11,
      Value: 13,
      Keyword: 17,
      Text: 18,
      Snippet: 27,
    },
    CompletionItemInsertTextRule: { None: 0, KeepWhitespace: 1, InsertAsSnippet: 4 },
    CompletionItemTag: { Deprecated: 1 },
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerSignatureHelpProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  KeyMod: { CtrlCmd: 1 },
  KeyCode: { Enter: 13 },
}));

// Mock dynamic imports
vi.mock("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/language/json/monaco.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/language/html/monaco.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/python/python.contribution.js", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js", () => ({}));

// Fix: component imports default from "@/composables/useLogs/searchState"
vi.mock("@/composables/useLogs/searchState", () => ({
  default: () => ({
    searchObj: { data: {}, meta: {} },
  }),
  searchState: () => ({
    searchObj: { data: {}, meta: {} },
  }),
}));

vi.mock("@/composables/useNLQuery", () => ({
  useNLQuery: () => ({
    detectNaturalLanguage: vi.fn(() => false),
    generateSQL: vi.fn(() => Promise.resolve(null)),
    transformToSQL: vi.fn((_nl: string, sql: string) => sql),
    isGenerating: { value: false },
    streamingResponse: { value: "" },
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `/mocked/${path}`),
}));

vi.mock("@/utils/query/vrlLanguageDefinition", () => ({
  vrlLanguageDefinition: {},
}));

// ─── Phase 1 integration (tmp/code.md A2/A4/A5/N7/C1) ─────────────────────────
// The pure helper specs in src/utils/query/sqlCompletion.spec.ts can all pass
// while CodeQueryEditor keeps its own split(" ") tokenisation, String.includes
// pre-filter, singular `insertTextRule` lookup and four-field push. These tests
// drive the REGISTERED provider so the component itself is on the hook.
//
// Mounted ONCE in beforeAll. The suite's other async-mount tests (Ctrl+Enter,
// setValue) are already load-flaky on main — they time out on ~1 run in 2 with
// no source changes at all — so we do not add nine more waitFor mounts here.

describe("Phase 1 — the registered completion provider", () => {
  const providerStore = createStore({ state: { theme: "light" } });
  // Two providers so a throw on the suggestions path cannot mask the
  // keyword-path signals (A5/C1) — otherwise every assertion here fails for
  // the same single reason and only one bug is observable at a time.
  let provideKw: Function;
  let provideSug: Function;
  let provideFallback: Function;
  let getElementByIdSpy: ReturnType<typeof vi.spyOn>;

  const KEYWORDS = [
    {
      name: "like",
      label: "like",
      kind: "Keyword",
      insertText: "like '%${1:params}%' ",
      insertTextRules: "InsertAsSnippet",
    },
    {
      name: "kubernetes_namespace_name",
      label: "kubernetes_namespace_name",
      kind: "Field",
      insertText: "kubernetes_namespace_name",
      sortText: "\u0000kubernetes_namespace_name",
    },
    { name: "and", label: "and", kind: "Keyword", insertText: "and " },
  ];

  const SUGGESTIONS = [
    {
      name: "approx_topk",
      label: "approx_topk",
      kind: "Function",
      detail: "(field, k) → top-k values",
      documentation: "Approximate top-k.",
      insertText: "approx_topk(${1:field}, ${2:10})",
      insertTextRules: "InsertAsSnippet",
      sortText: "zz-approx_topk",
    },
    // Legacy callable shape — the `suggestions` prop is public API.
    {
      label: (kw: string) => `legacy('${kw}')`,
      kind: "Text",
      insertText: (kw: string) => `legacy('${kw}')`,
    },
  ];

  beforeAll(async () => {
    const monacoApi = await import("monaco-editor/esm/vs/editor/editor.api");
    const registerFn = vi.mocked(monacoApi.languages.registerCompletionItemProvider);

    getElementByIdSpy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));

    const mountAndCapture = async (editorId: string, props: any) => {
      const baseline = registerFn.mock.calls.length;
      mount(CodeQueryEditor, {
        props: { editorId, language: "sql", query: "SELECT * FROM logs", ...props },
        global: { plugins: [providerStore] },
      });
      await vi.waitFor(() => expect(registerFn.mock.calls.length).toBeGreaterThan(baseline), {
        timeout: 15000,
        interval: 25,
      });
      return registerFn.mock.calls[baseline][1].provideCompletionItems as Function;
    };

    provideKw = await mountAndCapture("provider-kw", {
      keywords: KEYWORDS,
      suggestions: [],
    });
    provideSug = await mountAndCapture("provider-sug", {
      keywords: [],
      suggestions: SUGGESTIONS,
    });
    // N2/D7: suggestions prop omitted => the component must fall back to the
    // SHARED catalog. Its old local copy had 7 entries and no aggregates, which
    // is what Traces was shipping.
    provideFallback = await mountAndCapture("provider-fallback", { keywords: [] });
    // editorObj must exist so the provider's own-model guard resolves to mockModel.
    await vi.waitFor(() => expect(mockEditorObj.createContextKey).toHaveBeenCalled(), {
      timeout: 15000,
      interval: 25,
    });
  }, 60000);

  afterAll(() => getElementByIdSpy?.mockRestore());

  /** Invoke a provider as monaco would, for a given buffer + current word. */
  const invokeWith = (provide: Function, textUntilCursor: string, word: string) => {
    mockModel.getValueInRange.mockReturnValue(textUntilCursor);
    mockModel.getWordUntilPosition.mockReturnValue({
      word,
      startColumn: 1,
      endColumn: word.length + 1,
    });
    return provide(mockModel, { lineNumber: 1, column: word.length + 1 });
  };
  const invokeKw = (t: string, w: string) => invokeWith(provideKw, t, w);
  const invokeSug = (t: string, w: string) => invokeWith(provideSug, t, w);
  const invokeFallback = (t: string, w: string) => invokeWith(provideFallback, t, w);

  const itemFor = (result: any, label: string) =>
    result.suggestions.find((s: any) => s.label === label);

  it("answers for its own model", () => {
    expect(provideKw).toBeTypeOf("function");
    expect(invokeKw("SELECT ", "").suggestions.length).toBeGreaterThan(0);
  });

  it("A5 — snippet keywords carry the NUMERIC InsertAsSnippet flag", () => {
    const item = itemFor(invokeKw("where ", ""), "like");
    expect(item).toBeDefined();
    expect(typeof item.insertTextRules).toBe("number");
    expect(item.insertTextRules).toBe(4);
  });

  it("A5 — plain keywords carry no snippet flag", () => {
    expect(itemFor(invokeKw("where ", ""), "and").insertTextRules).toBeUndefined();
  });

  it("N7 — detail/documentation/sortText survive the push", () => {
    const item = itemFor(invokeSug("SELECT ", ""), "approx_topk");
    expect(item).toBeDefined();
    expect(item.detail).toBe("(field, k) → top-k values");
    expect(item.documentation).toEqual({ value: "Approximate top-k." });
    expect(item.sortText).toBe("zz-approx_topk");
  });

  it("N7/A5 — suggestion snippets reach monaco as a number too", () => {
    expect(itemFor(invokeSug("SELECT ", ""), "approx_topk").insertTextRules).toBe(4);
  });

  it("A1 — a Function-kind suggestion maps to monaco kind 1", () => {
    expect(itemFor(invokeSug("SELECT ", ""), "approx_topk").kind).toBe(1);
  });

  it("C1 — subsequence candidates are not dropped by a substring pre-filter", () => {
    // "knn" is a subsequence of kubernetes_namespace_name but NOT a substring,
    // so String.includes() removes it before monaco can score it.
    expect(itemFor(invokeKw("SELECT knn", "knn"), "kubernetes_namespace_name")).toBeDefined();
  });

  it("A2 — items are identical no matter how much of the word is typed", () => {
    const a = itemFor(invokeSug("SELECT a", "a"), "approx_topk");
    const appr = itemFor(invokeSug("SELECT appr", "appr"), "approx_topk");
    expect(a.label).toBe(appr.label);
    expect(a.insertText).toBe(appr.insertText);
  });

  it("N2 — the SQL fallback serves the shared catalog, aggregates included", () => {
    const labels = invokeFallback("SELECT ", "").suggestions.map((s: any) => s.label);
    // The component's old 7-entry local list had none of these.
    for (const agg of ["sum", "avg", "count", "max", "min", "histogram", "approx_topk"]) {
      expect(labels, `fallback missing ${agg}`).toContain(agg);
    }
  });

  it("N2 — the SQL fallback also serves the array family", () => {
    const labels = invokeFallback("SELECT ", "").suggestions.map((s: any) => s.label);
    for (const fn of ["arrcount", "arrsort", "arrjoin", "arrzip", "spath"]) {
      expect(labels, `fallback missing ${fn}`).toContain(fn);
    }
  });

  it("N2 — fallback items are Function-kinded and snippet-enabled", () => {
    const sum = invokeFallback("SELECT ", "").suggestions.find((s: any) => s.label === "sum");
    expect(sum).toBeDefined();
    expect(sum.kind).toBe(1);
    expect(sum.insertTextRules).toBe(4);
    expect(sum.insertText).toBe("sum(${1:field})");
  });

  it("A2 — a list containing legacy callables is reported as incomplete", () => {
    // SUGGESTIONS includes one callable entry, so monaco must re-query as the
    // user keeps typing rather than freezing the first-keystroke content.
    expect(invokeSug("SELECT a", "a").incomplete).toBe(true);
  });

  it("A2 — a purely static list is NOT reported as incomplete", () => {
    // Re-querying every keystroke for content that cannot change is wasted work.
    expect(invokeKw("SELECT a", "a").incomplete).toBeFalsy();
    expect(invokeFallback("SELECT a", "a").incomplete).toBeFalsy();
  });

  it("B3 — deprecated aliases carry monaco's Deprecated tag (strikethrough)", () => {
    const raw = invokeFallback("SELECT ", "").suggestions.find(
      (s: any) => s.label === "match_all_raw",
    );
    expect(raw).toBeDefined();
    expect(raw.tags).toEqual([1]); // CompletionItemTag.Deprecated
  });

  it("B3 — match_all itself is not tagged deprecated", () => {
    const ok = invokeFallback("SELECT ", "").suggestions.find((s: any) => s.label === "match_all");
    expect(ok.tags).toBeUndefined();
  });

  it("D1 — catalog items carry a compact detail and prose documentation", () => {
    const topk = invokeFallback("SELECT ", "").suggestions.find(
      (s: any) => s.label === "approx_topk",
    );
    expect(topk.detail).toBe("(field, k)");
    expect(String((topk.documentation as any).value).length).toBeGreaterThan(15);
  });

  it("A4 — legacy callables get monaco's word, not a space-split token", () => {
    // Old code did textUntilPosition.trim().split(" ").pop() => "*\nFROM".
    const labels = invokeSug("SELECT *\nFROM", "FROM").suggestions.map((s: any) => s.label);
    expect(labels).toContain("legacy('FROM')");
    expect(labels.join("|")).not.toContain("\n");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — IntelliSense parity (tmp/code.md D2, D3, C3, D4, N3, N4, C5)
//
// Deliberately at the REGISTRATION level, not against helper modules. Every
// gap that escaped in this workstream — Alerts binding the base list, the SLO
// form never loading the catalog, Traces omitting a prop — was a helper that
// worked perfectly and a component that never called it.
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — providers are registered and configured", () => {
  const providerStore2 = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;

  const mountEditor = async (props: any = {}) => {
    const monacoApi = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(monacoApi.editor.create);
    // Wait for THIS mount, not for any past one. createContextKey is a shared
    // spy that earlier describes have already tripped, so waiting on
    // toHaveBeenCalled() returns instantly and the assertions below would read
    // whatever the previous test left behind.
    const createsBefore = createFn.mock.calls.length;
    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    mount(CodeQueryEditor, {
      props: { editorId: `p3-${Math.random()}`, language: "sql", query: "", ...props },
      global: { plugins: [providerStore2] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(createsBefore + 1), {
      timeout: 15000,
      interval: 25,
    });
    return monacoApi;
  };

  afterAll(() => spy?.mockRestore());

  it("D2 — registers a signature help provider for SQL", { timeout: 30000 }, async () => {
    const api = await mountEditor();
    const reg = vi.mocked((api.languages as any).registerSignatureHelpProvider);
    expect(reg, "no signature help provider is registered at all").toBeDefined();
    expect(reg.mock.calls.length).toBeGreaterThan(0);
    expect(reg.mock.calls.at(-1)![0]).toBe("sql");
  });

  it("D2 — signature help triggers on ( and ,", { timeout: 30000 }, async () => {
    const api = await mountEditor();
    const provider = vi
      .mocked((api.languages as any).registerSignatureHelpProvider)
      .mock.calls.at(-1)![1];
    expect(provider.signatureHelpTriggerCharacters).toEqual(expect.arrayContaining(["(", ","]));
  });

  it("D3 — registers a hover provider for SQL", { timeout: 30000 }, async () => {
    const api = await mountEditor();
    const reg = vi.mocked((api.languages as any).registerHoverProvider);
    expect(reg, "no hover provider is registered at all").toBeDefined();
    expect(reg.mock.calls.length).toBeGreaterThan(0);
    expect(reg.mock.calls.at(-1)![0]).toBe("sql");
  });

  it("C3 — completion declares trigger characters", { timeout: 30000 }, async () => {
    const api = await mountEditor();
    const provider = vi.mocked(api.languages.registerCompletionItemProvider).mock.calls.at(-1)![1];
    // Without these nothing opens after a paren, a comma or an opening quote —
    // exactly the positions where the user most needs help.
    expect(provider.triggerCharacters).toEqual(expect.arrayContaining(["(", ",", "'", "."]));
  });

  it(
    "D4 — completion supplies resolveCompletionItem for lazy docs",
    { timeout: 30000 },
    async () => {
      const api = await mountEditor();
      const provider = vi
        .mocked(api.languages.registerCompletionItemProvider)
        .mock.calls.at(-1)![1];
      expect(typeof provider.resolveCompletionItem).toBe("function");
    },
  );

  it("N4 — word-based suggestions are off for SQL", { timeout: 30000 }, async () => {
    const api = await mountEditor();
    const opts = vi.mocked(api.editor.create).mock.calls.at(-1)![1] as any;
    // Default is 'matchingDocuments', which pulls raw buffer text from every
    // other SQL editor on the page into this one's dropdown.
    expect(opts.wordBasedSuggestions).toBe("off");
  });

  it("N3 — quick suggestions are enabled inside string literals", { timeout: 30000 }, async () => {
    const api = await mountEditor();
    const opts = vi.mocked(api.editor.create).mock.calls.at(-1)![1] as any;
    // Monaco defaults strings to 'off', which is why field-VALUE completion
    // needed the hide/re-trigger hack.
    expect(opts.quickSuggestions).toMatchObject({ other: "on", strings: "on" });
  });
});

describe("Phase 3 — C5: one provider per language, not per editor", () => {
  const store3 = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  it(
    "registers the completion provider once for three SQL editors",
    { timeout: 60000 },
    async () => {
      const api = await import("monaco-editor/esm/vs/editor/editor.api");
      const reg = vi.mocked(api.languages.registerCompletionItemProvider);
      const createFn = vi.mocked(api.editor.create);
      const providersBefore = reg.mock.calls.filter((c) => c[0] === "sql").length;

      spy = vi
        .spyOn(document, "getElementById")
        .mockImplementation(() => document.createElement("div"));

      // Mounted SEQUENTIALLY, each awaited to completion. Mounting them in one
      // synchronous burst is not equivalent: only the first editor finishes
      // initialising, so the count would look like 1 whether or not the
      // per-language fix exists — a green test for the wrong reason.
      for (const id of ["c5-a", "c5-b", "c5-c"]) {
        const createsBefore = createFn.mock.calls.length;
        mount(CodeQueryEditor, {
          props: { editorId: id, language: "sql", query: "" },
          global: { plugins: [store3] },
        });
        await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(createsBefore + 1), {
          timeout: 15000,
          interval: 25,
        });
      }

      const added = reg.mock.calls.filter((c) => c[0] === "sql").length - providersBefore;
      // Monaco aggregates every provider registered for a language, so N editors
      // meant N providers answering on every keystroke — N-1 of them only to
      // return an empty list for a model that did not ask.
      expect(added, `three editors registered ${added} SQL completion providers`).toBe(1);
    },
  );
});
