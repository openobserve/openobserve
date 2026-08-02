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
const makeModel = () => ({
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
  getWordAtPosition: vi.fn(() => ({ word: "", startColumn: 1, endColumn: 1 })),
  uri: { toString: () => `inmemory://model/${Math.random()}` },
});

// The default model, used by the tests that only ever mount one editor.
const mockModel = makeModel();

/** Every editor stub monaco.editor.create has handed out, newest last. */
const createdEditors: any[] = [];

const makeEditorStub = (model: any) => ({
  onDidChangeModelContent: vi.fn(),
  createContextKey: vi.fn(),
  addCommand: vi.fn(),
  onDidFocusEditorWidget: vi.fn(),
  onDidBlurEditorWidget: vi.fn(),
  dispose: vi.fn(),
  getValue: vi.fn(() => ""),
  setValue: vi.fn(),
  layout: vi.fn(),
  getModel: vi.fn(() => model),
  updateOptions: vi.fn(),
  hasWidgetFocus: vi.fn(() => false),
  getRawOptions: vi.fn(() => ({ readOnly: false })),
  deltaDecorations: vi.fn(() => []),
  getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  trigger: vi.fn(),
  getAction: vi.fn(() => ({ run: vi.fn(() => Promise.resolve()) })),
});

// Kept for the tests that assert on "the editor" without caring which one.
// Points at the most recently created stub.
const mockEditorObj: any = makeEditorStub(mockModel);

// Simple mock for monaco editor
vi.mock("monaco-editor/esm/vs/editor/editor.all.js", () => ({}));
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  default: {},
  editor: {
    create: vi.fn(() => {
      // A fresh editor AND model per call, as real monaco does. Sharing one
      // stub makes a per-language singleton provider impossible to test: it
      // distinguishes editors by model.
      const stub = makeEditorStub(makeModel());
      createdEditors.push(stub);
      Object.assign(mockEditorObj, stub);
      return stub;
    }),
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

  let kwModel: any;
  let sugModel: any;
  let fallbackModel: any;

  beforeAll(async () => {
    const monacoApi = await import("monaco-editor/esm/vs/editor/editor.api");
    const registerFn = vi.mocked(monacoApi.languages.registerCompletionItemProvider);
    const createFn = vi.mocked(monacoApi.editor.create);

    getElementByIdSpy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));

    // Waits for THIS editor to be created, then takes the current provider.
    // Deliberately does NOT require a new registration per mount: C5 makes the
    // provider a per-language singleton, at which point the second and third
    // mounts register nothing and a "wait for another registration" helper
    // would hang forever.
    const mountAndCapture = async (editorId: string, props: any) => {
      const createsBefore = createFn.mock.calls.length;
      mount(CodeQueryEditor, {
        props: { editorId, language: "sql", query: "SELECT * FROM logs", ...props },
        global: { plugins: [providerStore] },
      });
      await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(createsBefore + 1), {
        timeout: 15000,
        interval: 25,
      });
      const sqlCalls = registerFn.mock.calls.filter((c) => c[0] === "sql");
      const provider = sqlCalls.at(-1)![1].provideCompletionItems as Function;
      const model = createdEditors.at(-1)!.getModel();
      return { provider, model };
    };

    ({ provider: provideKw, model: kwModel } = await mountAndCapture("provider-kw", {
      keywords: KEYWORDS,
      suggestions: [],
    }));
    ({ provider: provideSug, model: sugModel } = await mountAndCapture("provider-sug", {
      keywords: [],
      suggestions: SUGGESTIONS,
    }));
    // suggestions omitted => the shared catalog fallback (N2/D7)
    ({ provider: provideFallback, model: fallbackModel } = await mountAndCapture(
      "provider-fallback",
      { keywords: [] },
    ));
  }, 60000);

  afterAll(() => getElementByIdSpy?.mockRestore());

  /**
   * Invoke a provider as monaco would.
   *
   * Awaited on purpose: C4 turns provideCompletionItems async so the field-value
   * lookup can be resolved inline. A helper that read `.suggestions` off the
   * returned value would silently read it off a Promise and every assertion
   * here would start failing the moment that lands.
   */
  const invokeWith = async (
    provide: Function,
    model: any,
    textUntilCursor: string,
    word: string,
  ) => {
    model.getValueInRange.mockReturnValue(textUntilCursor);
    model.getWordUntilPosition.mockReturnValue({
      word,
      startColumn: 1,
      endColumn: word.length + 1,
    });
    return await provide(model, { lineNumber: 1, column: word.length + 1 });
  };
  const invokeKw = (t: string, w: string) => invokeWith(provideKw, kwModel, t, w);
  const invokeSug = (t: string, w: string) => invokeWith(provideSug, sugModel, t, w);
  const invokeFallback = (t: string, w: string) => invokeWith(provideFallback, fallbackModel, t, w);

  const itemFor = (result: any, label: string) =>
    result.suggestions.find((s: any) => s.label === label);

  it("answers for its own model", async () => {
    expect(provideKw).toBeTypeOf("function");
    expect((await invokeKw("SELECT ", "")).suggestions.length).toBeGreaterThan(0);
  });

  it("A5 — snippet keywords carry the NUMERIC InsertAsSnippet flag", async () => {
    const item = itemFor(await invokeKw("where ", ""), "like");
    expect(item).toBeDefined();
    expect(typeof item.insertTextRules).toBe("number");
    expect(item.insertTextRules).toBe(4);
  });

  it("A5 — plain keywords carry no snippet flag", async () => {
    expect(itemFor(await invokeKw("where ", ""), "and").insertTextRules).toBeUndefined();
  });

  it("N7 — detail and sortText survive the push", async () => {
    const item = itemFor(await invokeSug("SELECT ", ""), "approx_topk");
    expect(item).toBeDefined();
    expect(item.detail).toBe("(field, k) → top-k values");
    expect(item.sortText).toBe("zz-approx_topk");
  });

  it("D4 — documentation is NOT shipped with the initial list", async () => {
    // ~350 items per keystroke, each carrying prose, for one visible row.
    const item = itemFor(await invokeSug("SELECT ", ""), "approx_topk");
    expect(
      item.documentation,
      "docs are eager; resolveCompletionItem is dead weight",
    ).toBeUndefined();
  });

  it("D4 — resolveCompletionItem attaches the documentation", async () => {
    // Asserting only that a resolver EXISTS is satisfied by a no-op alongside
    // eager docs. This asserts it does the work.
    const monacoApi = await import("monaco-editor/esm/vs/editor/editor.api");
    const provider = vi
      .mocked(monacoApi.languages.registerCompletionItemProvider)
      .mock.calls.filter((c) => c[0] === "sql")
      .at(-1)![1] as any;
    const item = itemFor(await invokeSug("SELECT ", ""), "approx_topk");
    const resolved = await provider.resolveCompletionItem(item, {});
    expect(resolved.documentation).toEqual({ value: "Approximate top-k." });
  });

  it("N7/A5 — suggestion snippets reach monaco as a number too", async () => {
    expect(itemFor(await invokeSug("SELECT ", ""), "approx_topk").insertTextRules).toBe(4);
  });

  it("A1 — a Function-kind suggestion maps to monaco kind 1", async () => {
    expect(itemFor(await invokeSug("SELECT ", ""), "approx_topk").kind).toBe(1);
  });

  it("C1 — subsequence candidates are not dropped by a substring pre-filter", async () => {
    // "knn" is a subsequence of kubernetes_namespace_name but NOT a substring,
    // so String.includes() removes it before monaco can score it.
    expect(itemFor(await invokeKw("SELECT knn", "knn"), "kubernetes_namespace_name")).toBeDefined();
  });

  it("A2 — items are identical no matter how much of the word is typed", async () => {
    const a = itemFor(await invokeSug("SELECT a", "a"), "approx_topk");
    const appr = itemFor(await invokeSug("SELECT appr", "appr"), "approx_topk");
    expect(a.label).toBe(appr.label);
    expect(a.insertText).toBe(appr.insertText);
  });

  it("N2 — the SQL fallback serves the shared catalog, aggregates included", async () => {
    const labels = (await invokeFallback("SELECT ", "")).suggestions.map((s: any) => s.label);
    // The component's old 7-entry local list had none of these.
    for (const agg of ["sum", "avg", "count", "max", "min", "histogram", "approx_topk"]) {
      expect(labels, `fallback missing ${agg}`).toContain(agg);
    }
  });

  it("N2 — the SQL fallback also serves the array family", async () => {
    const labels = (await invokeFallback("SELECT ", "")).suggestions.map((s: any) => s.label);
    for (const fn of ["arrcount", "arrsort", "arrjoin", "arrzip", "spath"]) {
      expect(labels, `fallback missing ${fn}`).toContain(fn);
    }
  });

  it("N2 — fallback items are Function-kinded and snippet-enabled", async () => {
    const sum = (await invokeFallback("SELECT ", "")).suggestions.find(
      (s: any) => s.label === "sum",
    );
    expect(sum).toBeDefined();
    expect(sum.kind).toBe(1);
    expect(sum.insertTextRules).toBe(4);
    expect(sum.insertText).toBe("sum(${1:field})");
  });

  it("A2 — a list containing legacy callables is reported as incomplete", async () => {
    // SUGGESTIONS includes one callable entry, so monaco must re-query as the
    // user keeps typing rather than freezing the first-keystroke content.
    expect((await invokeSug("SELECT a", "a")).incomplete).toBe(true);
  });

  it("A2 — a purely static list is NOT reported as incomplete", async () => {
    // Re-querying every keystroke for content that cannot change is wasted work.
    expect((await invokeKw("SELECT a", "a")).incomplete).toBeFalsy();
    expect((await invokeFallback("SELECT a", "a")).incomplete).toBeFalsy();
  });

  it("B3 — deprecated aliases carry monaco's Deprecated tag (strikethrough)", async () => {
    const raw = (await invokeFallback("SELECT ", "")).suggestions.find(
      (s: any) => s.label === "match_all_raw",
    );
    expect(raw).toBeDefined();
    expect(raw.tags).toEqual([1]); // CompletionItemTag.Deprecated
  });

  it("B3 — match_all itself is not tagged deprecated", async () => {
    const ok = (await invokeFallback("SELECT ", "")).suggestions.find(
      (s: any) => s.label === "match_all",
    );
    expect(ok.tags).toBeUndefined();
  });

  it("D1 — catalog items carry a compact detail and prose documentation", async () => {
    const topk = (await invokeFallback("SELECT ", "")).suggestions.find(
      (s: any) => s.label === "approx_topk",
    );
    expect(topk.detail).toBe("(field, k)");
    expect(String((topk.documentation as any).value).length).toBeGreaterThan(15);
  });

  it("A4 — legacy callables get monaco's word, not a space-split token", async () => {
    // Old code did textUntilPosition.trim().split(" ").pop() => "*\nFROM".
    const labels = (await invokeSug("SELECT *\nFROM", "FROM")).suggestions.map((s: any) => s.label);
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
    // The full set from the plan. Omitting the double quote leaves quoted
    // identifiers (FROM "my stream") untriggered, and omitting the space leaves
    // the position right after a keyword untriggered — both the moments a user
    // most expects the list to appear.
    expect(provider.triggerCharacters).toEqual(
      expect.arrayContaining(["(", ",", "'", ".", '"', " "]),
    );
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

describe("Phase 3 — providers return the shapes monaco requires", () => {
  const store4 = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  const mountAndGet = async () => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const before = createFn.mock.calls.length;
    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    mount(CodeQueryEditor, {
      props: {
        editorId: `shape-${Math.random()}`,
        language: "sql",
        query: "",
        keywords: [
          {
            name: "host_name",
            label: "host_name",
            kind: "Field",
            insertText: "host_name",
            detail: "Utf8",
          },
        ],
      },
      global: { plugins: [store4] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });
    return api;
  };

  const position = { lineNumber: 1, column: 12 };

  it(
    "D2 — provideSignatureHelp returns { value, dispose }, not a bare SignatureHelp",
    { timeout: 30000 },
    async () => {
      const api = await mountAndGet();
      const provider = vi
        .mocked((api.languages as any).registerSignatureHelpProvider)
        .mock.calls.at(-1)![1];
      mockModel.getValueInRange.mockReturnValue("SELECT sum(");
      const result = await provider.provideSignatureHelp(mockModel, position, {}, {});
      // monaco reads result.value (SignatureHelpResult extends IDisposable).
      // Returning the SignatureHelp directly yields undefined and NO hint, silently.
      expect(result).toBeTruthy();
      expect(result.value, "provider returned a bare SignatureHelp").toBeTruthy();
      expect(result.value.signatures[0].label).toContain("sum");
      expect(typeof result.dispose).toBe("function");
    },
  );

  it("D2 — returns null when the cursor is not in a call", { timeout: 30000 }, async () => {
    const api = await mountAndGet();
    const provider = vi
      .mocked((api.languages as any).registerSignatureHelpProvider)
      .mock.calls.at(-1)![1];
    mockModel.getValueInRange.mockReturnValue("SELECT * FROM logs ");
    expect(await provider.provideSignatureHelp(mockModel, position, {}, {})).toBeNull();
  });

  it(
    "D3 — provideHover returns { contents } as IMarkdownString[]",
    { timeout: 30000 },
    async () => {
      const api = await mountAndGet();
      const provider = vi
        .mocked((api.languages as any).registerHoverProvider)
        .mock.calls.at(-1)![1];
      mockModel.getWordAtPosition.mockReturnValue({
        word: "host_name",
        startColumn: 1,
        endColumn: 10,
      });
      const hover = await provider.provideHover(mockModel, position, {});
      expect(hover).toBeTruthy();
      expect(Array.isArray(hover.contents)).toBe(true);
      expect(hover.contents[0].value).toContain("Utf8");
    },
  );

  it("D3 — returns null for a word it knows nothing about", { timeout: 30000 }, async () => {
    const api = await mountAndGet();
    const provider = vi.mocked((api.languages as any).registerHoverProvider).mock.calls.at(-1)![1];
    mockModel.getWordAtPosition.mockReturnValue({
      word: "zzz_unknown",
      startColumn: 1,
      endColumn: 12,
    });
    expect(await provider.provideHover(mockModel, position, {})).toBeNull();
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
      const total = reg.mock.calls.filter((c) => c[0] === "sql").length;

      // Asserting `added === 1` would be order-dependent AND unsatisfiable once
      // the fix lands: registration moves to module scope, so an earlier
      // describe in this file has already done it and three more editors add
      // ZERO. The order-independent invariant is that the module ever registers
      // one SQL provider. Monaco aggregates every provider registered for a
      // language, so today each editor adds another that answers every
      // keystroke only to return an empty list for a model that did not ask.
      expect(added, `three editors added ${added} SQL completion providers`).toBeLessThanOrEqual(1);
      expect(total, `${total} SQL completion providers registered in this file`).toBe(1);
    },
  );
});
