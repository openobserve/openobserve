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
import { SQL_CLAUSE_KEYWORDS, SQL_KEYWORDS } from "@/utils/query/sqlCompletion";
import analytics from "@/services/product_analytics";
import { flushEditorSuggestSummary } from "@/utils/query/editorSuggestStats";

// Stable model instance. CodeQueryEditor's completion provider answers only for
// its OWN model (`if (own && model !== own) return { suggestions: [] }`), so a
// getModel() that returns a fresh object each call makes the provider
// permanently unreachable from tests — which is why the provider specs below
// were previously skipped.
let modelSeq = 0;
const makeModel = (initialValue = "") => ({
  // Returns what the editor was created with, as a real model does. A stub that
  // always answers "" makes anything reading model.getValue() — the
  // double-quote scan, for one — untestable: the assertion passes because the
  // model is empty, not because the code is right.
  getValue: vi.fn(() => initialValue),
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
  // Stable per model, as real monaco URIs are. A fresh value on every call
  // would break any implementation keying per-editor config by uri.
  uri: (() => {
    const value = `inmemory://model/${modelSeq++}`;
    return { toString: () => value };
  })(),
});

// The default model, used by the tests that only ever mount one editor.
const mockModel = makeModel();

/** Every editor stub monaco.editor.create has handed out, newest last. */
const createdEditors: any[] = [];

const makeEditorStub = (model: any) => ({
  onDidChangeModelContent: vi.fn(),
  createContextKey: vi.fn(() => ({ set: vi.fn() })),
  addAction: vi.fn(() => ({ dispose: vi.fn() })),
  executeEdits: vi.fn(),
  setPosition: vi.fn(),
  pushUndoStop: vi.fn(),
  getSelections: vi.fn(() => []),
  addCommand: vi.fn(),
  onKeyDown: vi.fn(),
  onDidFocusEditorWidget: vi.fn(),
  onDidBlurEditorWidget: vi.fn(),
  onDidBlurEditorText: vi.fn(),
  onDidChangeCursorPosition: vi.fn(),
  createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
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
  hasTextFocus: vi.fn(() => true),
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
    create: vi.fn((_el: any, options: any = {}) => {
      // A fresh editor AND model per call, as real monaco does. Sharing one
      // stub makes a per-language singleton provider impossible to test: it
      // distinguishes editors by model.
      const stub = makeEditorStub(makeModel(options?.value ?? ""));
      createdEditors.push(stub);
      Object.assign(mockEditorObj, stub);
      return stub;
    }),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    setModelMarkers: vi.fn(),
    addCommand: vi.fn(() => ({ dispose: vi.fn() })),
    addKeybindingRule: vi.fn(() => ({ dispose: vi.fn() })),
    addKeybindingRules: vi.fn(() => ({ dispose: vi.fn() })),
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    getEditors: vi.fn(() => []),
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
      Event: 10,
      Text: 18,
      Issue: 26,
      Folder: 23,
      Snippet: 27,
    },
    CompletionItemInsertTextRule: { None: 0, KeepWhitespace: 1, InsertAsSnippet: 4 },
    CompletionItemTag: { Deprecated: 1 },
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    setLanguageConfiguration: vi.fn(),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerSignatureHelpProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  KeyMod: { CtrlCmd: 2048, WinCtrl: 256 },
  KeyCode: {
    Backspace: 1,
    Tab: 2,
    Enter: 13,
    Escape: 9,
    Space: 10,
    PageUp: 11,
    PageDown: 12,
    UpArrow: 16,
    DownArrow: 18,
    KeyI: 39,
    KeyN: 44,
    KeyP: 46,
    KeyZ: 56,
  },
  Range: class {
    constructor(...args: number[]) {
      Object.assign(this, { args });
    }
  },
  Selection: class {
    constructor(...args: number[]) {
      Object.assign(this, { args });
    }
  },
  // Real values from monaco-editor/esm/vs/editor/editor.api. Omitting this
  // made validateDoubleQuotes throw on `monaco.MarkerSeverity.Warning` the
  // moment it found anything to report, so it published NOTHING and looked
  // like a component that simply never ran its validation.
  MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
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

vi.mock("@/utils/query/promqlLanguageDefinition", () => ({
  loadPromqlLanguage: async () => ({ language: {}, languageConfiguration: {} }),
}));

vi.mock("@/composables/usePromqlSuggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/usePromqlSuggestions")>()),
  resolvePromqlLabelValues: vi.fn(async () => ["api-gateway", "chat-service"]),
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

// A function row carries its signature in an object label, so tests compare by name.
const nameOf = (s: any): string => (typeof s.label === "string" ? s.label : s.label.label);
const isHeader = (s: any): boolean => s.kind === 23;
const rowsOf = (result: any) => result.suggestions.filter((s: any) => !isHeader(s));

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
    result.suggestions.find((s: any) => nameOf(s) === label);

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

  it("N7 — detail/documentation/sortText survive the push", async () => {
    const item = itemFor(await invokeSug("SELECT ", ""), "approx_topk");
    expect(item).toBeDefined();
    expect(item.detail).toBe("(field, k) → top-k values");
    expect(item.documentation).toEqual({ value: "Approximate top-k." });
    expect(item.sortText).toBe("zz-approx_topk");
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
    expect(a.label).toEqual(appr.label);
    expect(a.insertText).toBe(appr.insertText);
  });

  it("N2 — the SQL fallback serves the shared catalog, aggregates included", async () => {
    const labels = (await invokeFallback("SELECT ", "")).suggestions.map(nameOf);
    // The component's old 7-entry local list had none of these.
    for (const agg of ["sum", "avg", "count", "max", "min", "histogram", "approx_topk"]) {
      expect(labels, `fallback missing ${agg}`).toContain(agg);
    }
  });

  it("N2 — the SQL fallback also serves the array family", async () => {
    const labels = (await invokeFallback("SELECT ", "")).suggestions.map(nameOf);
    for (const fn of ["arrcount", "arrsort", "arrjoin", "arrzip", "spath"]) {
      expect(labels, `fallback missing ${fn}`).toContain(fn);
    }
  });

  it("N2 — fallback items are Function-kinded and snippet-enabled", async () => {
    const sum = (await invokeFallback("SELECT ", "")).suggestions.find(
      (s: any) => nameOf(s) === "sum",
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

  it("A2/D10 — even a static list is reported as incomplete", async () => {
    // This asserted the OPPOSITE, on the reasoning that re-querying content
    // which cannot change is wasted work. The content cannot change; the
    // CONTEXT can. `severity = ` turns the same static catalog into a value
    // list, and monaco will not ask again unless the previous answer said
    // incomplete — so the values waited for a trigger character, and any value
    // fetched from the server after the first call could never arrive at all.
    //
    // The wasted work is real and small: a local catalog and a cached lookup,
    // rebuilt per keystroke. See tmp/code.md D10.
    expect((await invokeKw("SELECT a", "a")).incomplete).toBe(true);
    expect((await invokeFallback("SELECT a", "a")).incomplete).toBe(true);
  });

  it("B3 — deprecated aliases carry monaco's Deprecated tag (strikethrough)", async () => {
    const raw = (await invokeFallback("SELECT ", "")).suggestions.find(
      (s: any) => nameOf(s) === "match_all_raw",
    );
    expect(raw).toBeDefined();
    expect(raw.tags).toEqual([1]); // CompletionItemTag.Deprecated
  });

  it("B3 — match_all itself is not tagged deprecated", async () => {
    const ok = (await invokeFallback("SELECT ", "")).suggestions.find(
      (s: any) => nameOf(s) === "match_all",
    );
    expect(ok.tags).toBeUndefined();
  });

  it("D1 — catalog items carry a compact detail and prose documentation", async () => {
    const topk = (await invokeFallback("SELECT ", "")).suggestions.find(
      (s: any) => nameOf(s) === "approx_topk",
    );
    expect(topk.detail).toBe("(field, k)");
    expect(String((topk.documentation as any).value).length).toBeGreaterThan(15);
  });

  it("A4 — legacy callables get monaco's word, not a space-split token", async () => {
    // Old code did textUntilPosition.trim().split(" ").pop() => "*\nFROM".
    const labels = (await invokeSug("SELECT *\nFROM", "FROM")).suggestions.map(nameOf);
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

// D4 (resolveCompletionItem for lazy documentation) is deliberately NOT part of
// this phase. Measured: the whole catalog carries 37 KB of documentation (server
// 32.7 KB across 301 of 350 entries, median 66 chars; local 4 KB), and every byte
// is already resident — a module constant plus a per-org cached ref. Lazy
// resolution exists in VS Code because documentation usually means a
// language-server round trip; here it would save allocating a few hundred small
// wrapper objects per keystroke and would add a provider method, item identity
// for re-lookup, and a failure mode where docs silently vanish if the resolver
// is not wired. Revisit only if docs ever become expensive to produce.

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

  it("N4 — word-based suggestions are off for SQL", { timeout: 30000 }, async () => {
    const api = await mountEditor();
    const opts = vi.mocked(api.editor.create).mock.calls.at(-1)![1] as any;
    // Default is 'matchingDocuments', which pulls raw buffer text from every
    // other SQL editor on the page into this one's dropdown.
    expect(opts.wordBasedSuggestions).toBe("off");
  });

  it("N4 — but NOT for the non-query languages", { timeout: 30000 }, async () => {
    // N4 was about SQL and PromQL, where every suggestion should come from the
    // catalog. VRL, JS, JSON and the rest have no catalog at all, so turning
    // word-based completion off there removes the only completion they have.
    for (const language of ["vrl", "javascript", "json", "markdown"]) {
      const api = await mountEditor({ language });
      const opts = vi.mocked(api.editor.create).mock.calls.at(-1)![1] as any;
      expect(opts.wordBasedSuggestions, `${language} lost its word completion`).not.toBe("off");
    }
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
    // Hand back THIS editor's model. Invoking a provider with an unrelated
    // model is exactly what a correct per-model implementation should refuse.
    return { api, model: createdEditors.at(-1)!.getModel() };
  };

  const position = { lineNumber: 1, column: 12 };

  it(
    "D2 — provideSignatureHelp returns { value, dispose }, not a bare SignatureHelp",
    { timeout: 30000 },
    async () => {
      const { api, model } = await mountAndGet();
      const provider = vi
        .mocked((api.languages as any).registerSignatureHelpProvider)
        .mock.calls.at(-1)![1];
      model.getValueInRange.mockReturnValue("SELECT sum(");
      const result = await provider.provideSignatureHelp(model, position, {}, {});
      // monaco reads result.value (SignatureHelpResult extends IDisposable).
      // Returning the SignatureHelp directly yields undefined and NO hint, silently.
      expect(result).toBeTruthy();
      expect(result.value, "provider returned a bare SignatureHelp").toBeTruthy();
      expect(result.value.signatures[0].label).toContain("sum");
      expect(typeof result.dispose).toBe("function");
    },
  );

  it("D2 — returns null when the cursor is not in a call", { timeout: 30000 }, async () => {
    const { api, model } = await mountAndGet();
    const provider = vi
      .mocked((api.languages as any).registerSignatureHelpProvider)
      .mock.calls.at(-1)![1];
    model.getValueInRange.mockReturnValue("SELECT * FROM logs ");
    expect(await provider.provideSignatureHelp(model, position, {}, {})).toBeNull();
  });

  it(
    "D3 — provideHover returns { contents } as IMarkdownString[]",
    { timeout: 30000 },
    async () => {
      const { api, model } = await mountAndGet();
      const provider = vi
        .mocked((api.languages as any).registerHoverProvider)
        .mock.calls.at(-1)![1];
      model.getWordAtPosition.mockReturnValue({
        word: "host_name",
        startColumn: 1,
        endColumn: 10,
      });
      const hover = await provider.provideHover(model, position, {});
      expect(hover).toBeTruthy();
      expect(Array.isArray(hover.contents)).toBe(true);
      expect(hover.contents[0].value).toContain("Utf8");
    },
  );

  it("D3 — returns null for a word it knows nothing about", { timeout: 30000 }, async () => {
    const { api, model } = await mountAndGet();
    const provider = vi.mocked((api.languages as any).registerHoverProvider).mock.calls.at(-1)![1];
    model.getWordAtPosition.mockReturnValue({
      word: "zzz_unknown",
      startColumn: 1,
      endColumn: 12,
    });
    expect(await provider.provideHover(model, position, {})).toBeNull();
  });
});

describe("Phase 3 — C4: the value lookup is awaited inside the provider", () => {
  const store5 = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  // Awaiting the provider in the tests above only PERMITS an async
  // implementation; it does not require one. Nothing so far fails if the
  // current arrangement survives untouched: parent debounces, calls
  // getSuggestions, pushes contextKeywords down as a prop, then force-reopens
  // the widget. This is the test that makes the difference observable — the
  // values must be in the FIRST result the provider returns, with no second
  // trigger and no prop round trip.
  it(
    "returns field values on the FIRST call, from a delayed resolver",
    { timeout: 30000 },
    async () => {
      const api = await import("monaco-editor/esm/vs/editor/editor.api");
      const createFn = vi.mocked(api.editor.create);
      const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
      const before = createFn.mock.calls.length;

      let resolverCalls = 0;
      const fieldValueResolver = vi.fn(async (field: string) => {
        resolverCalls += 1;
        // Deliberately slower than a microtask: a provider that forgets to await
        // returns before this settles.
        await new Promise((r) => setTimeout(r, 60));
        return field === "level" ? ["error", "warn"] : [];
      });

      spy = vi
        .spyOn(document, "getElementById")
        .mockImplementation(() => document.createElement("div"));
      mount(CodeQueryEditor, {
        props: {
          editorId: "c4-editor",
          language: "sql",
          query: "",
          keywords: [
            { name: "level", label: "level", kind: "Field", insertText: "level", detail: "Utf8" },
          ],
          suggestions: [],
          fieldValueResolver,
        },
        global: { plugins: [store5] },
      });
      await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
        timeout: 15000,
        interval: 25,
      });

      const model = createdEditors.at(-1)!.getModel();
      const provider = registerFn.mock.calls.filter((c) => c[0] === "sql").at(-1)![1];
      model.getValueInRange.mockReturnValue("SELECT * FROM logs WHERE level = '");
      model.getWordUntilPosition.mockReturnValue({ word: "", startColumn: 34, endColumn: 34 });

      const result = await provider.provideCompletionItems(
        model,
        { lineNumber: 1, column: 34 },
        {},
        {},
      );

      expect(fieldValueResolver, "the provider never asked for values").toHaveBeenCalledWith(
        "level",
        expect.anything(),
      );
      const labels = result.suggestions.filter((s: any) => !isHeader(s)).map(nameOf);
      expect(labels, "values did not make the first result — they were not awaited").toEqual(
        expect.arrayContaining(["'error'", "'warn'"]),
      );
      expect(resolverCalls).toBe(1);
    },
  );

  it(
    "offers the normal list when the cursor is not after an operator",
    { timeout: 30000 },
    async () => {
      const api = await import("monaco-editor/esm/vs/editor/editor.api");
      const createFn = vi.mocked(api.editor.create);
      const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
      const before = createFn.mock.calls.length;
      const fieldValueResolver = vi.fn(async () => ["error"]);

      spy = vi
        .spyOn(document, "getElementById")
        .mockImplementation(() => document.createElement("div"));
      mount(CodeQueryEditor, {
        props: {
          editorId: "c4-editor-2",
          language: "sql",
          query: "",
          keywords: [
            { name: "level", label: "level", kind: "Field", insertText: "level", detail: "Utf8" },
          ],
          suggestions: [],
          fieldValueResolver,
        },
        global: { plugins: [store5] },
      });
      await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
        timeout: 15000,
        interval: 25,
      });

      const model = createdEditors.at(-1)!.getModel();
      const provider = registerFn.mock.calls.filter((c) => c[0] === "sql").at(-1)![1];
      model.getValueInRange.mockReturnValue("SELECT le");
      model.getWordUntilPosition.mockReturnValue({ word: "le", startColumn: 8, endColumn: 10 });

      const result = await provider.provideCompletionItems(
        model,
        { lineNumber: 1, column: 10 },
        {},
        {},
      );
      expect(result.suggestions.filter((s: any) => !isHeader(s)).map(nameOf)).toContain("level");
      expect(
        fieldValueResolver,
        "resolver was called outside value context",
      ).not.toHaveBeenCalled();
    },
  );
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

// Reported from the SLO form: inside approx_percentile_cont( on a metrics
// stream, twenty string labels sorted above `value` — the one column the
// function can take — and it fell below the visible list.
describe("numeric columns rank first inside a numeric aggregate", () => {
  const store6 = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  const FIELDS = [
    {
      name: "availability_zone",
      label: "availability_zone",
      kind: "Field",
      insertText: "availability_zone",
      detail: "Utf8",
      sortText: "\u0000availability_zone",
    },
    {
      name: "value",
      label: "value",
      kind: "Field",
      insertText: "value",
      detail: "Float64",
      sortText: "\u0000value",
    },
  ];

  /** Mount an editor and ask its provider for the list at `text`. */
  const completionsAt = async (editorId: string, text: string) => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
    const before = createFn.mock.calls.length;

    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    mount(CodeQueryEditor, {
      props: { editorId, language: "sql", query: "", keywords: FIELDS, suggestions: [] },
      global: { plugins: [store6] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });

    const model = createdEditors.at(-1)!.getModel();
    const provider = registerFn.mock.calls.filter((c) => c[0] === "sql").at(-1)![1];
    model.getValueInRange.mockReturnValue(text);
    model.getWordUntilPosition.mockReturnValue({
      word: "",
      startColumn: text.length + 1,
      endColumn: text.length + 1,
    });
    const result = await provider.provideCompletionItems(
      model,
      { lineNumber: 1, column: text.length + 1 },
      {},
      {},
    );
    // The order monaco applies to equally-scoring items.
    return result.suggestions
      .slice()
      .sort((a: any, b: any) => (String(a.sortText) < String(b.sortText) ? -1 : 1))
      .map((s: any) => s.label);
  };

  it("puts the numeric column above the string ones", { timeout: 30000 }, async () => {
    const labels = await completionsAt("numeric-rank-a", "SELECT approx_percentile_cont(");
    expect(labels.indexOf("value")).toBeLessThan(labels.indexOf("availability_zone"));
  });

  it("leaves the order alone outside such a call", { timeout: 30000 }, async () => {
    // Without this the first test passes for a trivial reason -- alphabetical
    // order would put `availability_zone` first either way, so a ranking that
    // never fires must be observably different here.
    const labels = await completionsAt("numeric-rank-b", "SELECT ");
    expect(labels.indexOf("availability_zone")).toBeLessThan(labels.indexOf("value"));
  });
});

// ─── tmp/code.md section E — hiding the popup ────────────────────────────────
// disableSuggestionPopup synthesizes an Escape KeyboardEvent and dispatches it
// at the container div. Monaco has a command for this — the same one this file
// already calls four lines later to hide the widget — and a synthetic key event
// is a guess about monaco's internal key handling that nothing verifies. It
// also reaches anything else listening for Escape on the way up.
describe("hiding the suggestion popup uses monaco's own command", () => {
  const store7 = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  it("triggers hideSuggestWidget and synthesizes no key event", { timeout: 30000 }, async () => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const before = createFn.mock.calls.length;

    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    const wrapper = mount(CodeQueryEditor, {
      props: { editorId: "hide-popup", language: "sql", query: "" },
      global: { plugins: [store7] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });

    const editor = createdEditors.at(-1)!;
    editor.trigger.mockClear();
    const dispatched: Event[] = [];
    const dispatchSpy = vi
      .spyOn(HTMLElement.prototype, "dispatchEvent")
      .mockImplementation(function (this: HTMLElement, e: Event) {
        dispatched.push(e);
        return true;
      });

    try {
      (wrapper.vm as any).disableSuggestionPopup();
    } finally {
      dispatchSpy.mockRestore();
    }

    expect(
      editor.trigger.mock.calls.some((c: any[]) => c[1] === "hideSuggestWidget"),
      "the widget was never asked to hide through monaco's command",
    ).toBe(true);
    expect(
      dispatched.filter((e) => e.type === "keydown"),
      "a synthetic key event was still dispatched",
    ).toEqual([]);
  });
});

// ─── tmp/code.md section E — the double-quote warning is WIRED ───────────────
// doubleQuoteWarnings.spec.ts proves the scan itself. This proves the editor
// calls it — the gap that shipped three times in this workstream (Alerts bound
// the wrong list, the SLO form never triggered the catalog load, Traces omitted
// a prop), every one of them a correct helper nobody had wired up.
describe("double-quote warnings reach the model", () => {
  const store8 = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  const markersFor = async (query: string, editorId: string) => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const setMarkers = vi.mocked((api.editor as any).setModelMarkers);
    const before = createFn.mock.calls.length;
    setMarkers.mockClear();

    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    mount(CodeQueryEditor, {
      props: { editorId, language: "sql", query },
      global: { plugins: [store8] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });
    // Give the tail of setupEditor a chance to run after create resolves.
    await vi.waitFor(() => expect(setMarkers.mock.calls.length).toBeGreaterThan(0), {
      timeout: 15000,
      interval: 25,
    });
    const calls = setMarkers.mock.calls.filter((c: any[]) => c[1] === "dq-validation");
    return calls.at(-1)?.[2] ?? null;
  };

  it("publishes a marker for a double-quoted value", { timeout: 30000 }, async () => {
    const markers = await markersFor(`SELECT * FROM t WHERE level = "error"`, "dq-real");
    expect(markers, "the validation never ran at all").not.toBeNull();
    expect(markers.length).toBe(1);
    // `useI18n` is stubbed to an identity `t` above, so the marker carries the
    // key rather than the resolved copy ("… use single quotes instead").
    expect(markers[0].message).toBe("sqlEditor.diagnostics.doubleQuotedValue");
  });

  it("publishes NOTHING for the same text inside a comment", { timeout: 30000 }, async () => {
    // The reported defect: a warning on SQL that is not SQL.
    const markers = await markersFor(`-- level = "error"\nSELECT * FROM t`, "dq-comment");
    expect(markers, "the validation never ran at all").not.toBeNull();
    expect(markers).toEqual([]);
  });
});

// ─── Phase 5 (tmp/code.md D10) — the list must be re-queried, not re-filtered ─
// Monaco only calls a provider again mid-word when the previous result said
// `incomplete` (suggestModel.js). Ours says complete, so while the widget is
// open monaco re-filters the list it already has — and the switch from fields
// to VALUES waits for a trigger character. Reproduced live: at `severity = `
// the widget still showed availability_zone/AWS/body; one quote later it showed
// INFO/ERROR/WARN, and a fresh provider call at either position returned
// values. The provider was right; the invalidation was wrong.
//
// It is also the mechanism D9 needs: values fetched from the server after the
// first call can only reach the list if there IS a next call.
describe("completion results invite monaco to ask again", () => {
  const store9 = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  const providerFor = async (props: any) => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
    const before = createFn.mock.calls.length;
    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    mount(CodeQueryEditor, {
      props: { language: "sql", query: "", ...props },
      global: { plugins: [store9] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });
    return {
      provide: registerFn.mock.calls.filter((c) => c[0] === "sql").at(-1)![1]
        .provideCompletionItems,
      model: createdEditors.at(-1)!.getModel(),
    };
  };

  const ask = async (provide: any, model: any, textUntilCursor: string) => {
    model.getValueInRange.mockReturnValue(textUntilCursor);
    model.getWordUntilPosition.mockReturnValue({ word: "", startColumn: 1, endColumn: 1 });
    return await provide(model, { lineNumber: 1, column: 1 }, {}, {});
  };

  const FIELDS = [
    { name: "level", label: "level", kind: "Field", insertText: "level", detail: "Utf8" },
  ];

  it("marks the ordinary list incomplete", { timeout: 30000 }, async () => {
    const { provide, model } = await providerFor({
      editorId: "incomplete-normal",
      keywords: FIELDS,
      fieldValueResolver: async () => [],
    });
    const result = await ask(provide, model, "SELECT * FROM logs WHERE ");
    expect(result.incomplete, "monaco will re-filter this list instead of asking again").toBe(true);
  });

  it("marks the VALUE list incomplete too", { timeout: 30000 }, async () => {
    // The values on screen may be a cold-cache partial answer, with the real
    // ones still in flight; the next keystroke has to come back here.
    const { provide, model } = await providerFor({
      editorId: "incomplete-values",
      keywords: FIELDS,
      fieldValueResolver: async () => ["error"],
    });
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
    const rows = result.suggestions.filter((s: any) => !isHeader(s)).map(nameOf);
    expect(rows.slice(0, 2)).toEqual(["'error'", "level"]);
    expect(rows).toContain("spath");
    expect(result.incomplete).toBe(true);
  });

  it("switches to values as soon as the operator is typed", { timeout: 30000 }, async () => {
    // The user-visible half: no quote needed, no second trigger character.
    const { provide, model } = await providerFor({
      editorId: "incomplete-switch",
      keywords: FIELDS,
      fieldValueResolver: async (f: string) => (f === "level" ? ["error", "warn"] : []),
    });
    const before = await ask(provide, model, "SELECT * FROM logs WHERE lev");
    expect(before.suggestions.filter((s: any) => !isHeader(s)).map(nameOf)).toContain("level");

    const after = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
    expect(
      after.suggestions
        .filter((s: any) => !isHeader(s))
        .map(nameOf)
        .slice(0, 3),
    ).toEqual(["'error'", "'warn'", "level"]);
  });
});

describe("P0-1 — the Enter fix follows ZO_EDITOR_SUGGEST_MODE", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  const optionsFor = async (mode: string | undefined, language = "sql") => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const before = createFn.mock.calls.length;
    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    const store = createStore({
      state: { theme: "light", zoConfig: mode === undefined ? {} : { editor_suggest_mode: mode } },
    });
    mount(CodeQueryEditor, {
      props: { editorId: `mode-${mode}-${language}`, language, query: "" },
      global: { plugins: [store] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });
    return createFn.mock.calls.at(-1)![1] as any;
  };

  it(
    "automatic opens trigger-character menus unhighlighted and uses smart Enter",
    { timeout: 30000 },
    async () => {
      const opts = await optionsFor("automatic");
      expect(opts.suggest).toEqual({ selectionMode: "whenQuickSuggestion" });
      expect(opts.acceptSuggestionOnEnter).toBe("smart");
    },
  );

  it("a missing flag is automatic", { timeout: 30000 }, async () => {
    const opts = await optionsFor(undefined);
    expect(opts.suggest).toEqual({ selectionMode: "whenQuickSuggestion" });
    expect(opts.acceptSuggestionOnEnter).toBe("smart");
  });

  it("typing keeps the same Enter fix", { timeout: 30000 }, async () => {
    const opts = await optionsFor("typing");
    expect(opts.suggest).toEqual({ selectionMode: "whenQuickSuggestion" });
    expect(opts.acceptSuggestionOnEnter).toBe("smart");
  });

  it("off is Monaco's own defaults, today's editor", { timeout: 30000 }, async () => {
    const opts = await optionsFor("off");
    expect(opts.suggest).toEqual({ selectionMode: "always" });
    expect(opts.acceptSuggestionOnEnter).toBe("on");
    expect(opts.quickSuggestions).toEqual({ other: "on", comments: "off", strings: "on" });
  });

  it(
    "a mode that arrives after the editor mounted is applied to it",
    { timeout: 30000 },
    async () => {
      const api = await import("monaco-editor/esm/vs/editor/editor.api");
      const createFn = vi.mocked(api.editor.create);
      const before = createFn.mock.calls.length;
      spy = vi
        .spyOn(document, "getElementById")
        .mockImplementation(() => document.createElement("div"));
      const store = createStore({ state: { theme: "light", zoConfig: {} as any } });
      mount(CodeQueryEditor, {
        props: { editorId: "mode-late", language: "sql", query: "" },
        global: { plugins: [store] },
      });
      await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
        timeout: 15000,
        interval: 25,
      });
      const editor = createdEditors.at(-1)!;
      store.state.zoConfig = { editor_suggest_mode: "off" };
      await vi.waitFor(() =>
        expect(editor.updateOptions).toHaveBeenCalledWith({
          suggest: { selectionMode: "always" },
          acceptSuggestionOnEnter: "on",
        }),
      );
    },
  );

  it("non-query editors are never touched", { timeout: 30000 }, async () => {
    const opts = await optionsFor("automatic", "javascript");
    expect(opts.suggest).toBeUndefined();
    expect(opts.acceptSuggestionOnEnter).toBeUndefined();
  });
});

describe("P0-4 — values awaited within a budget, guarded, never identifiers in a string", () => {
  const storeV = createStore({ state: { theme: "light" } });
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  const FIELDS = [
    { name: "level", label: "level", kind: "Field", insertText: "level", detail: "Utf8" },
    {
      name: "status_text",
      label: "status_text",
      kind: "Field",
      insertText: "status_text",
      detail: "Utf8",
    },
    { name: "code", label: "code", kind: "Field", insertText: "code", detail: "Int64" },
  ];

  const mountWith = async (editorId: string, fieldValueResolver: any, suggestions: any[] = []) => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
    const before = createFn.mock.calls.length;
    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    const wrapper = mount(CodeQueryEditor, {
      props: {
        editorId,
        language: "sql",
        query: "",
        keywords: FIELDS,
        suggestions,
        fieldValueResolver,
      },
      global: { plugins: [storeV] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });
    const editor = createdEditors.at(-1)!;
    const registration = registerFn.mock.calls.filter((c) => c[0] === "sql").at(-1)![1];
    return {
      provide: registration.provideCompletionItems,
      // Monaco resolves a row as it gains focus; a row whose resolve never settles is one the key rules step over.
      steppedOver: async (item: any) =>
        !(await Promise.race([
          Promise.resolve(registration.resolveCompletionItem(item)).then(() => true),
          new Promise((r) => setTimeout(() => r(false), 30)),
        ])),
      model: editor.getModel(),
      editor,
      wrapper,
    };
  };

  const TYPED_SPACE = { triggerKind: 1, triggerCharacter: " " };
  const CTRL_SPACE = { triggerKind: 0 };
  const ask = (
    provide: any,
    model: any,
    text: string,
    token: any = {},
    context: any = TYPED_SPACE,
  ) => {
    model.getValueInRange.mockReturnValue(text);
    model.getWordUntilPosition.mockReturnValue({ word: "", startColumn: 1, endColumn: 1 });
    return provide(model, { lineNumber: 1, column: text.length + 1 }, context, token);
  };
  // Group header rows are layout, not choices, so most assertions read the rows under them.
  const labels = (r: any) => r.suggestions.filter((s: any) => !isHeader(s)).map(nameOf);
  const noLookup = () =>
    vi.fn(async () =>
      Promise.reject(Object.assign(new Error("no lookup"), { name: "NoValueLookup" })),
    );

  it("never claims there are no values when no lookup ran", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith("v-nolookup", noLookup());
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
    expect(labels(result)).toEqual(["level", "status_text", "code"]);
  });

  it("does not look values up for a word that is not a field", { timeout: 30000 }, async () => {
    const resolver = vi.fn(async () => ["x"]);
    const { provide, model } = await mountWith("v-unknown", resolver);
    await ask(provide, model, "SELECT * FROM logs WHERE nope = ");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("offers nothing for `key=` written inside a string", { timeout: 30000 }, async () => {
    const resolver = vi.fn(async () => ["bob"]);
    const { provide, model } = await mountWith("v-instring", resolver);
    const result = await ask(provide, model, "SELECT * FROM logs WHERE match_all('level=");
    expect(result.suggestions).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("in a highlighted menu a status row is never row 1", { timeout: 30000 }, async () => {
    const { provide, model, steppedOver } = await mountWith(
      "v-hl-empty",
      vi.fn(async () => []),
    );
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ", {}, CTRL_SPACE);
    const status = rowsOf(result).find((s: any) => nameOf(s).includes("valuesEmpty"));
    expect(await steppedOver(status), "Tab and the arrows step over it").toBe(true);
    expect(status.preselect).toBeUndefined();
    const field = rowsOf(result).find((s: any) => nameOf(s) === "level");
    expect(await steppedOver(field)).toBe(false);
    expect(field.preselect, "the highlight starts on a real row").toBe(true);
  });

  it("in a highlighted menu a slow lookup shows no row at all", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith("v-hl-slow", delayed(2500, ["error"]));
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ", {}, CTRL_SPACE);
    expect(result.suggestions).toEqual([]);
  });
  const delayed = (ms: number, values: string[]) =>
    vi.fn(() => new Promise<string[]>((r) => setTimeout(() => r(values), ms)));

  it("a fast resolver puts values above fields", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith("v-fast", delayed(60, ["error", "warn"]));
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
    expect(labels(result)).toEqual(["'error'", "'warn'", "level", "status_text", "code"]);
    expect(result.suggestions.every((s: any) => s.kind !== 1 && s.kind !== 17)).toBe(true);
  });

  it(
    "a resolver slower than the budget gives one row that inserts nothing",
    { timeout: 30000 },
    async () => {
      const { provide, model, steppedOver } = await mountWith("v-slow", delayed(2500, ["error"]));
      const started = Date.now();
      const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
      expect(Date.now() - started).toBeLessThan(2000);
      const [row] = rowsOf(result);
      expect(rowsOf(result)).toHaveLength(1);
      expect(row.label.label).toContain("valuesLoading");
      expect(row.label.description).toContain("valuesLoadingHint");
      expect(row.kind).toBe(10);
      expect(row.insertText).toBe("");
      expect(await steppedOver(row)).toBe(true);
    },
  );

  it("an empty answer says so, and still offers the fields", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith(
      "v-empty",
      vi.fn(async () => []),
    );
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
    expect(nameOf(rowsOf(result)[0])).toContain("valuesEmpty");
    expect(rowsOf(result)[0].insertText).toBe("");
    expect(labels(result)).toContain("level");
  });

  it("a failed lookup says it could not load", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith(
      "v-fail",
      vi.fn(async () => Promise.reject(new Error("x"))),
    );
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
    expect(nameOf(rowsOf(result)[0])).toContain("valuesFailed");
  });

  it("drops a late answer after Esc", { timeout: 30000 }, async () => {
    const { provide, model, editor } = await mountWith("v-esc", delayed(150, ["error"]));
    const onKey = editor.onKeyDown.mock.calls.at(-1)![0];
    const pending = ask(provide, model, "SELECT * FROM logs WHERE level = ");
    onKey({ keyCode: 9 });
    expect((await pending).suggestions).toEqual([]);
  });

  it("drops a late answer after blur", { timeout: 30000 }, async () => {
    const { provide, model, editor } = await mountWith("v-blur", delayed(150, ["error"]));
    const pending = ask(provide, model, "SELECT * FROM logs WHERE level = ");
    editor.hasTextFocus.mockReturnValue(false);
    expect((await pending).suggestions).toEqual([]);
  });

  it("drops it when Monaco cancelled the request", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith("v-token", delayed(50, ["error"]));
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ", {
      isCancellationRequested: true,
    });
    expect(result.suggestions).toEqual([]);
  });

  it("offers values only, never fields, inside an open string", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith(
      "v-quote",
      vi.fn(async () => ["error"]),
    );
    expect(labels(await ask(provide, model, "SELECT * FROM logs WHERE level = 'e"))).toEqual([
      "'error'",
    ]);
  });

  it("ILIKE ' offers values and no fields", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith(
      "v-ilike",
      vi.fn(async () => ["warn"]),
    );
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level ILIKE '");
    expect(labels(result)).toEqual(["'%warn%'"]);
    expect(rowsOf(result)[0].insertText).toBe("%warn%'");
  });

  it("a bare = 50 keeps value help", { timeout: 30000 }, async () => {
    const resolver = vi.fn(async () => ["500", "404"]);
    const { provide, model } = await mountWith("v-bare", resolver);
    const result = await ask(provide, model, "SELECT * FROM logs WHERE code = 50");
    expect(resolver).toHaveBeenCalledWith("code", expect.anything());
    // The provider filters by the typed token, so only values that start with it remain.
    expect(labels(result)).toEqual(["500"]);
    expect(rowsOf(result)[0].insertText).toBe("500");
    expect(rowsOf(result)[0].range.startColumn).toBe("SELECT * FROM logs WHERE code = ".length + 1);
  });

  it("quotes by column type: a Utf8 200 is quoted", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith(
      "v-type",
      vi.fn(async () => ["200"]),
    );
    const result = await ask(provide, model, "SELECT * FROM logs WHERE status_text = ");
    expect(rowsOf(result)[0].insertText).toBe("'200'");
  });

  it("skips the lookup when the typed text is a column", { timeout: 30000 }, async () => {
    const resolver = vi.fn(async () => ["x"]);
    const { provide, model } = await mountWith("v-col", resolver);
    const result = await ask(provide, model, "SELECT * FROM a JOIN b ON a.level = code");
    expect(resolver).not.toHaveBeenCalled();
    expect(labels(result)).toContain("code");
  });

  it(
    "a full list says it may be cut short, in a row that inserts nothing",
    { timeout: 30000 },
    async () => {
      const many = Array.from({ length: 10 }, (_, i) => `v${i}`);
      const { provide, model } = await mountWith(
        "v-cap",
        vi.fn(async () => many),
      );
      const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
      const values = rowsOf(result).filter((s: any) => String(s.sortText).startsWith("0"));
      const last = values.at(-1);
      expect(nameOf(last)).toContain("valuesCap");
      expect(last.insertText).toBe("");
      expect(last.kind).toBe(26);
    },
  );

  it("orders values the same way every time", { timeout: 30000 }, async () => {
    const { provide, model } = await mountWith(
      "v-order",
      vi.fn(async () => ["warn", "error", "info"]),
    );
    const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
    expect(labels(result).slice(0, 3)).toEqual(["'error'", "'info'", "'warn'"]);
  });

  it(
    "inside a quote with no values, says so after the caret and never as a row",
    {
      timeout: 30000,
    },
    async () => {
      const { provide, model, editor } = await mountWith(
        "v-hint",
        vi.fn(async () => []),
      );
      const result = await ask(provide, model, "SELECT * FROM logs WHERE level = 'zz");
      expect(result.suggestions).toEqual([]);
      const set = editor.createDecorationsCollection.mock.results.at(-1).value.set;
      expect(JSON.stringify(set.mock.calls.at(-1)[0])).toContain("valuesEmpty");
    },
  );

  it(
    "a value typed across a line break never gets a range before column 1",
    { timeout: 30000 },
    async () => {
      const { provide, model } = await mountWith(
        "v-multiline",
        vi.fn(async () => ["\nerror"]),
      );
      model.getValueInRange.mockReturnValue("SELECT * FROM t WHERE level = '\ner");
      model.getWordUntilPosition.mockReturnValue({ word: "er", startColumn: 1, endColumn: 3 });
      const result = await provide(model, { lineNumber: 2, column: 3 }, CTRL_SPACE, {});
      for (const row of result.suggestions) {
        if (row.range?.startColumn !== undefined)
          expect(row.range.startColumn).toBeGreaterThanOrEqual(1);
        if (row.range?.insert) expect(row.range.insert.startColumn).toBeGreaterThanOrEqual(1);
      }
    },
  );

  describe("functions after the columns in a value position", () => {
    const CATALOG = [
      { name: "lower", label: "lower", kind: "Function", insertText: "lower(x)" },
      { name: "now", label: "now", kind: "Function", insertText: "now()" },
      { name: "count", label: "count", kind: "Function", insertText: "count(x)", aggregate: true },
      { name: "CAST", label: "CAST", kind: "Keyword", insertText: "CAST(x AS t)" },
      { name: "SELECT", label: "SELECT", kind: "Keyword", insertText: "SELECT" },
    ];
    const headersOf = (r: any) => r.suggestions.filter(isHeader).map(nameOf);
    const resolve = () => vi.fn(async () => ["error"]);

    it(
      "a comparison offers values, then columns, then functions, never an aggregate or a keyword",
      { timeout: 30000 },
      async () => {
        const { provide, model } = await mountWith("v-fn-order", resolve(), CATALOG);
        const result = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
        expect(labels(result)).toEqual([
          "'error'",
          "level",
          "status_text",
          "code",
          "lower",
          "now",
          "CAST",
        ]);
        expect(headersOf(result)).toEqual([
          "sqlEditor.completion.groupValues",
          "sqlEditor.completion.groupFields",
          "sqlEditor.completion.groupFunctions",
        ]);
      },
    );

    it("code = CAS offers CAST alone, over the typed letters", { timeout: 30000 }, async () => {
      const { provide, model } = await mountWith("v-fn-cast", resolve(), CATALOG);
      const text = "SELECT * FROM logs WHERE code = CAS";
      const result = await ask(provide, model, text, {}, CTRL_SPACE);
      expect(labels(result)).toEqual(["CAST"]);
      expect(headersOf(result)).toEqual(["sqlEditor.completion.groupFunctions"]);
      const cast = result.suggestions.find((s: any) => nameOf(s) === "CAST");
      expect(cast.range.startColumn).toBe(text.length + 1 - "CAS".length);
    });

    it("inside an open quote only values are offered", { timeout: 30000 }, async () => {
      const { provide, model } = await mountWith("v-fn-quote", resolve(), CATALOG);
      const result = await ask(provide, model, "SELECT * FROM logs WHERE level = '");
      expect(labels(result)).toEqual(["'error'"]);
    });

    it(
      "an IN list offers values, then columns, then functions after each comma",
      { timeout: 30000 },
      async () => {
        const { provide, model } = await mountWith(
          "v-fn-in",
          vi.fn(async () => ["error", "warn"]),
          CATALOG,
        );
        const result = await ask(provide, model, "SELECT * FROM logs WHERE level IN ('error', ");
        expect(labels(result)).toEqual([
          "'warn'",
          "level",
          "status_text",
          "code",
          "lower",
          "now",
          "CAST",
        ]);
      },
    );

    it("LIKE takes a pattern, so it offers no functions", { timeout: 30000 }, async () => {
      const { provide, model } = await mountWith("v-fn-like", resolve(), CATALOG);
      const result = await ask(provide, model, "SELECT * FROM logs WHERE level LIKE ");
      expect(labels(result)).not.toContain("lower");
    });
  });

  it(
    "quotes a value by the column type current when the lookup returns",
    { timeout: 30000 },
    async () => {
      let finish!: (values: string[]) => void;
      const resolver = vi.fn(() => new Promise<string[]>((resolve) => (finish = resolve)));
      const { provide, model, wrapper } = await mountWith("v-type-switch", resolver);
      const pending = ask(provide, model, "SELECT * FROM logs WHERE code = ");
      await vi.waitFor(() => expect(resolver).toHaveBeenCalled());
      await wrapper.setProps({
        keywords: FIELDS.map((f) => (f.name === "code" ? { ...f, detail: "Utf8" } : f)),
      });
      finish(["service-unavailable"]);
      const value = (await pending).suggestions.find(
        (s: any) => nameOf(s) === "'service-unavailable'",
      );
      expect(value?.insertText).toBe("'service-unavailable'");
    },
  );

  it(
    "a qualified column after = is filtered by the name after the dot",
    { timeout: 30000 },
    async () => {
      const { provide, model } = await mountWith(
        "v-qualified",
        vi.fn(async () => ["x"]),
      );
      const text = "SELECT * FROM a JOIN b ON a.level = b.le";
      model.getValueInRange.mockReturnValue(text);
      model.getWordUntilPosition.mockReturnValue({
        word: "le",
        startColumn: text.length - 1,
        endColumn: text.length + 1,
      });
      const result = await provide(
        model,
        { lineNumber: 1, column: text.length + 1 },
        CTRL_SPACE,
        {},
      );
      expect(labels(result)).toEqual(["level"]);
    },
  );

  it(
    "a retry at the same caret that finds values clears the no-values hint",
    { timeout: 30000 },
    async () => {
      const resolver = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(["error"]);
      const { provide, model, editor } = await mountWith("v-hint-retry", resolver);
      const text = "SELECT * FROM logs WHERE level = '";
      await ask(provide, model, text, {}, CTRL_SPACE);
      const hint = editor.createDecorationsCollection.mock.results.at(-1).value;
      expect(JSON.stringify(hint.set.mock.calls.at(-1)[0])).toContain("valuesEmpty");
      hint.clear.mockClear();
      const retry = await ask(provide, model, text, {}, CTRL_SPACE);
      expect(labels(retry)).toContain("'error'");
      expect(hint.clear).toHaveBeenCalled();
    },
  );

  it(
    "typing forward past the budget still says it is loading, after the caret",
    {
      timeout: 30000,
    },
    async () => {
      const { provide, model, editor } = await mountWith("v-forward", delayed(2500, ["error"]));
      const result = await ask(
        provide,
        model,
        "SELECT * FROM logs WHERE level = 'e",
        {},
        CTRL_SPACE,
      );
      expect(result.suggestions).toEqual([]);
      const set = editor.createDecorationsCollection.mock.results.at(-1).value.set;
      expect(JSON.stringify(set.mock.calls.at(-1)[0])).toContain("valuesLoading");
    },
  );

  // A typed quote reopens its menu as an auto Invoke, which highlights the preselected first value.
  const typeQuote = async (editor: any, model: any, text: string) => {
    model.getValueInRange.mockReturnValue(text);
    editor.getPosition.mockReturnValue({ lineNumber: 1, column: text.length + 1 });
    editor.trigger.mockClear();
    editor.onDidChangeModelContent.mock.calls.at(-1)![0]({ changes: [{ text: "''" }] });
    await new Promise((r) => setTimeout(r, 20));
    return editor.trigger.mock.calls.map((c: any[]) => [c[1], c[2]]);
  };

  it(
    "a typed quote in a value position reopens the menu so the first value is highlighted",
    { timeout: 30000 },
    async () => {
      const { model, editor } = await mountWith(
        "v-quote-enter",
        vi.fn(async () => ["error"]),
      );
      expect(await typeQuote(editor, model, "SELECT * FROM logs WHERE level = '")).toEqual([
        ["hideSuggestWidget", {}],
        ["editor.action.triggerSuggest", { auto: true }],
      ]);
    },
  );

  it(
    "a key typed after the quote voids the reopen, so a later menu never inherits its highlight",
    { timeout: 30000 },
    async () => {
      const { model, editor } = await mountWith(
        "v-quote-late",
        vi.fn(async () => ["error"]),
      );
      let version = 1;
      model.getVersionId = vi.fn(() => version);
      model.getValueInRange.mockReturnValue("SELECT * FROM logs WHERE level = '");
      editor.getPosition.mockReturnValue({ lineNumber: 1, column: 35 });
      editor.trigger.mockClear();
      editor.onDidChangeModelContent.mock.calls.at(-1)![0]({ changes: [{ text: "''" }] });
      version = 2;
      await new Promise((r) => setTimeout(r, 20));
      expect(editor.trigger.mock.calls.map((c: any[]) => c[1])).not.toContain(
        "editor.action.triggerSuggest",
      );
    },
  );

  it(
    "Esc or a blur before the queued reopen runs leaves the menu closed",
    { timeout: 30000 },
    async () => {
      const { model, editor } = await mountWith(
        "v-quote-dismissed",
        vi.fn(async () => ["error"]),
      );
      const text = "SELECT * FROM logs WHERE level = '";
      model.getValueInRange.mockReturnValue(text);
      editor.getPosition.mockReturnValue({ lineNumber: 1, column: text.length + 1 });
      const typeThen = async (dismiss: () => void) => {
        editor.trigger.mockClear();
        editor.onDidChangeModelContent.mock.calls.at(-1)![0]({ changes: [{ text: "''" }] });
        dismiss();
        await new Promise((r) => setTimeout(r, 20));
        return editor.trigger.mock.calls.map((c: any[]) => c[1]);
      };
      const escape = () => editor.onKeyDown.mock.calls.at(-1)![0]({ keyCode: 9 });
      expect(await typeThen(escape)).not.toContain("editor.action.triggerSuggest");
      editor.hasTextFocus.mockReturnValue(false);
      expect(await typeThen(() => {})).not.toContain("editor.action.triggerSuggest");
      editor.hasTextFocus.mockReturnValue(true);
    },
  );

  it("a quote outside a value position reopens nothing", { timeout: 30000 }, async () => {
    const { model, editor } = await mountWith(
      "v-quote-none",
      vi.fn(async () => ["error"]),
    );
    expect(await typeQuote(editor, model, "SELECT * FROM logs WHERE match_all('")).toEqual([]);
  });

  it(
    "only real rows are preselected, and only in a menu no trigger character opened",
    { timeout: 30000 },
    async () => {
      const { provide, model } = await mountWith(
        "v-preselect",
        vi.fn(async () => ["error"]),
      );
      const invoked = await ask(
        provide,
        model,
        "SELECT * FROM logs WHERE level = '",
        {},
        CTRL_SPACE,
      );
      expect(rowsOf(invoked).every((s: any) => s.preselect)).toBe(true);
      expect(invoked.suggestions.filter(isHeader).every((s: any) => !s.preselect)).toBe(true);
      const typed = await ask(
        provide,
        model,
        "SELECT * FROM logs WHERE level = '",
        {},
        {
          triggerKind: 1,
          triggerCharacter: "'",
        },
      );
      expect(typed.suggestions.some((s: any) => s.preselect)).toBe(false);
    },
  );

  it(
    "a menu opened by a space outside a quote stays unhighlighted",
    { timeout: 30000 },
    async () => {
      const { provide, model, editor } = await mountWith(
        "v-space-enter",
        vi.fn(async () => ["error"]),
      );
      editor.trigger.mockClear();
      await ask(provide, model, "SELECT * FROM logs WHERE level = ");
      await new Promise((r) => setTimeout(r, 200));
      expect(editor.trigger.mock.calls.some((c: any[]) => c[1] === "focusSuggestion")).toBe(false);
    },
  );

  it(
    "never offers identifiers inside a string that is not a value",
    { timeout: 30000 },
    async () => {
      const { provide, model } = await mountWith(
        "v-str",
        vi.fn(async () => ["x"]),
      );
      expect(
        (await ask(provide, model, "SELECT * FROM logs WHERE match_all('err")).suggestions,
      ).toEqual([]);
    },
  );
  describe("an IN list continues after each comma", () => {
    const resolve = () => vi.fn(async () => ["checkout", "cart", "search"]);

    it(
      "a bare letter after a comma offers the values, quoted, over the letter",
      { timeout: 30000 },
      async () => {
        const { provide, model } = await mountWith("v-in-letter", resolve());
        const text = "SELECT * FROM logs WHERE level IN ('checkout',c";
        const result = await ask(provide, model, text, {}, CTRL_SPACE);
        const values = result.suggestions.filter((s: any) => nameOf(s).startsWith("'"));
        expect(values.map(nameOf)).toEqual(["'cart'"]);
        expect(values[0].range).toMatchObject({
          startColumn: text.length,
          endColumn: text.length + 1,
        });
        expect(labels(result)).toEqual(["'cart'", "code"]);
        expect(labels(result)).not.toContain("count");
      },
    );

    it("never offers a value the list already has", { timeout: 30000 }, async () => {
      const { provide, model } = await mountWith("v-in-chosen", resolve());
      const result = await ask(provide, model, "SELECT * FROM logs WHERE level IN ('checkout', ");
      expect(labels(result)).toContain("'cart'");
      expect(labels(result)).not.toContain("'checkout'");
    });

    it("a numeric list offers bare numbers", { timeout: 30000 }, async () => {
      const { provide, model } = await mountWith(
        "v-in-num",
        vi.fn(async () => ["200", "404"]),
      );
      const result = await ask(provide, model, "SELECT * FROM logs WHERE code IN (200, ");
      const values = result.suggestions.filter((s: any) => /^\d+$/.test(nameOf(s)));
      expect(values.map((s: any) => s.insertText)).toEqual(["404"]);
    });

    it(
      "falls back to the fields, with no status row, once every value is chosen",
      { timeout: 30000 },
      async () => {
        const { provide, model } = await mountWith("v-in-all", resolve());
        const result = await ask(
          provide,
          model,
          "SELECT * FROM logs WHERE level IN ('checkout', 'cart', 'search', ",
        );
        expect(labels(result)).toEqual(["level", "status_text", "code"]);
      },
    );
  });
});

describe("P0-4 — PromQL label values come from the provider", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  it(
    "drops label values when the organization changes while they load",
    { timeout: 30000 },
    async () => {
      const api = await import("monaco-editor/esm/vs/editor/editor.api");
      const { resolvePromqlLabelValues } = await import("@/composables/usePromqlSuggestions");
      const createFn = vi.mocked(api.editor.create);
      const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
      const before = createFn.mock.calls.length;
      spy = vi
        .spyOn(document, "getElementById")
        .mockImplementation(() => document.createElement("div"));
      const store = createStore({
        state: { theme: "light", selectedOrganization: { identifier: "old-org" } },
      });
      mount(CodeQueryEditor, {
        props: { editorId: "promql-org-switch", language: "promql", query: "", keywords: [] },
        global: { plugins: [store] },
      });
      await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
        timeout: 15000,
        interval: 25,
      });
      const model = createdEditors.at(-1)!.getModel();
      const provide = registerFn.mock.calls.filter((c) => c[0] === "promql").at(-1)![1]
        .provideCompletionItems;
      let finish!: (values: string[]) => void;
      vi.mocked(resolvePromqlLabelValues).mockImplementationOnce(
        () => new Promise<string[]>((resolve) => (finish = resolve)),
      );
      const text = 'up{job="';
      model.getValueInRange.mockReturnValue(text);
      model.getLineContent.mockReturnValue(`${text}"}`);
      model.getWordUntilPosition.mockReturnValue({ word: "", startColumn: 1, endColumn: 1 });
      const pending = provide(model, { lineNumber: 1, column: text.length + 1 }, {}, {});
      await vi.waitFor(() => expect(finish).toBeDefined());
      store.state.selectedOrganization = { identifier: "new-org" };
      finish(["old-org-only-service"]);
      expect((await pending).suggestions.map(nameOf)).not.toContain('"old-org-only-service"');
    },
  );

  it(
    "awaits label values in a value position and closes the quote",
    { timeout: 30000 },
    async () => {
      const api = await import("monaco-editor/esm/vs/editor/editor.api");
      const createFn = vi.mocked(api.editor.create);
      const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
      const before = createFn.mock.calls.length;
      spy = vi
        .spyOn(document, "getElementById")
        .mockImplementation(() => document.createElement("div"));
      const store = createStore({
        state: { theme: "light", selectedOrganization: { identifier: "myorg" } },
      });
      mount(CodeQueryEditor, {
        props: { editorId: "promql-values", language: "promql", query: "", keywords: [] },
        global: { plugins: [store] },
      });
      await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
        timeout: 15000,
        interval: 25,
      });
      const model = createdEditors.at(-1)!.getModel();
      const provide = registerFn.mock.calls.filter((c) => c[0] === "promql").at(-1)![1]
        .provideCompletionItems;
      const text = 'cpu_utilization_percent{service="';
      model.getValueInRange.mockReturnValue(text);
      model.getLineContent.mockReturnValue(`${text}"}`);
      model.getWordUntilPosition.mockReturnValue({ word: "", startColumn: 1, endColumn: 1 });
      const result = await provide(model, { lineNumber: 1, column: text.length + 1 }, {}, {});
      expect(result.suggestions.filter((s: any) => !isHeader(s)).map(nameOf)).toEqual([
        '"api-gateway"',
        '"chat-service"',
      ]);
      expect(result.suggestions[0].insertText).toBe('api-gateway"');
      expect(result.suggestions[0].range.endColumn).toBe(text.length + 2);

      const bare = "cpu_utilization_percent{service=api-g";
      model.getValueInRange.mockReturnValue(bare);
      model.getLineContent.mockReturnValue(`${bare}}`);
      const typedBare = await provide(model, { lineNumber: 1, column: bare.length + 1 }, {}, {});
      expect(typedBare.suggestions[0].insertText).toBe('"api-gateway"');
      expect(typedBare.suggestions[0].range.startColumn).toBe(bare.length + 1 - "api-g".length);

      const comparison = "rate(http_total[5m]) =";
      model.getValueInRange.mockReturnValue(comparison);
      model.getLineContent.mockReturnValue(comparison);
      const noMenu = await provide(
        model,
        { lineNumber: 1, column: comparison.length + 1 },
        { triggerKind: 1, triggerCharacter: "=" },
        {},
      );
      expect(noMenu.suggestions).toEqual([]);
    },
  );
});

// Runs after the PromQL block: each language's provider keeps the store of the first editor that registered it.
describe("value quotes, late values, the empty-values copy and the typed prefix", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  const FIELDS = [
    { name: "level", label: "level", kind: "Field", insertText: "level", detail: "Utf8" },
  ];

  const mountWith = async (editorId: string, props: any = {}, zoConfig: any = {}) => {
    const api: any = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
    const before = createFn.mock.calls.length;
    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    const wrapper = mount(CodeQueryEditor, {
      props: { editorId, language: "sql", query: "", keywords: FIELDS, ...props },
      global: { plugins: [createStore({ state: { theme: "light", zoConfig } })] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });
    const editor = createdEditors.at(-1)!;
    const language = props.language ?? "sql";
    const registration = registerFn.mock.calls.filter((c: any) => c[0] === language).at(-1)![1];
    return {
      api,
      editor,
      wrapper,
      model: editor.getModel(),
      provide: registration.provideCompletionItems,
    };
  };

  // Puts the caret at the end of `before`, with `after` following it on the same line.
  const placeCaret = (editor: any, model: any, before: string, after = "") => {
    model.getValueInRange.mockReturnValue(before);
    model.getLineContent.mockReturnValue(before + after);
    model.getWordUntilPosition.mockReturnValue({ word: "", startColumn: 1, endColumn: 1 });
    editor.getPosition.mockReturnValue({ lineNumber: 1, column: before.length + 1 });
  };

  const TYPED_SPACE = { triggerKind: 1, triggerCharacter: " " };
  const ask = (provide: any, editor: any, model: any, text: string) => {
    placeCaret(editor, model, text);
    return provide(model, { lineNumber: 1, column: text.length + 1 }, TYPED_SPACE, {});
  };
  const delayed = (ms: number, values: string[]) =>
    vi.fn(
      (_field: string, _options?: any) =>
        new Promise<string[]>((r) => setTimeout(() => r(values), ms)),
    );
  const triggers = (editor: any) =>
    editor.trigger.mock.calls.filter((c: any[]) => c[1] === "editor.action.triggerSuggest");

  describe("Escape as the keyboard exit", () => {
    it("binds Escape only while no widget or selection owns it", { timeout: 30000 }, async () => {
      const { api, editor } = await mountWith("q-escape");
      const action = editor.addAction.mock.calls
        .map((c: any[]) => c[0])
        .find((a: any) => a.id === "o2.editor.escapeToNextControl");
      expect(action.keybindings).toEqual([api.KeyCode.Escape]);
      for (const guard of [
        "!suggestWidgetVisible",
        "!findWidgetVisible",
        "!inSnippetMode",
        "!inlineSuggestionVisible",
        "!editorHasSelection",
      ]) {
        expect(action.precondition).toContain(guard);
      }
    });
  });

  describe("Enter in an unclosed value quote", () => {
    const enterAction = (editor: any) =>
      editor.addAction.mock.calls
        .map((c: any[]) => c[0])
        .find((a: any) => a.id === "o2.suggest.closeValueQuote");
    const quoteKey = (editor: any) => {
      const index = editor.createContextKey.mock.calls.findIndex(
        (c: any[]) => c[0] === "o2InValueQuote",
      );
      return editor.createContextKey.mock.results[index].value;
    };
    const moveCaret = (editor: any) => editor.onDidChangeCursorPosition.mock.calls.at(-1)![0]();

    it("binds Enter only while no suggest row is focused", { timeout: 30000 }, async () => {
      const { api, editor } = await mountWith("q-bind");
      const action = enterAction(editor);
      expect(action.keybindings).toEqual([api.KeyCode.Enter]);
      expect(action.precondition).toContain("o2InValueQuote");
      expect(action.precondition).toContain("!suggestWidgetHasFocusedSuggestion");
    });

    it(
      "steps over an auto-closed quote instead of breaking the string",
      { timeout: 30000 },
      async () => {
        const { editor, model } = await mountWith("q-closer");
        const before = "SELECT * FROM logs WHERE level = 'zz";
        placeCaret(editor, model, before, "'");
        enterAction(editor).run();
        expect(editor.setPosition).toHaveBeenCalledWith({
          lineNumber: 1,
          column: before.length + 2,
        });
        expect(editor.executeEdits).not.toHaveBeenCalled();
        expect(editor.trigger).toHaveBeenCalledWith("o2", "hideSuggestWidget", {});
      },
    );

    it("inserts the closing quote when none follows", { timeout: 30000 }, async () => {
      const { editor, model } = await mountWith("q-insert");
      const before = "SELECT * FROM logs WHERE level = 'zz";
      placeCaret(editor, model, before, " AND x = 1");
      enterAction(editor).run();
      const [, edits, selection] = editor.executeEdits.mock.calls.at(-1)!;
      expect(edits[0].text).toBe("'");
      expect(edits[0].range.args).toEqual([1, before.length + 1, 1, before.length + 1]);
      expect(selection[0].args).toEqual([1, before.length + 2, 1, before.length + 2]);
    });

    it("closes a PromQL label value with a double quote", { timeout: 30000 }, async () => {
      const { editor, model } = await mountWith("q-promql", { language: "promql" });
      const before = 'up{job="zz';
      placeCaret(editor, model, before);
      enterAction(editor).run();
      expect(editor.executeEdits.mock.calls.at(-1)![1][0].text).toBe('"');
    });

    it("claims Enter only inside a value quote", { timeout: 30000 }, async () => {
      const { editor, model } = await mountWith("q-key");
      const key = quoteKey(editor);
      placeCaret(editor, model, "SELECT * FROM logs WHERE level = 'zz", "'");
      moveCaret(editor);
      expect(key.set).toHaveBeenLastCalledWith(true);
      placeCaret(editor, model, "SELECT * FROM logs WHERE level = 'zz' ");
      moveCaret(editor);
      expect(key.set).toHaveBeenLastCalledWith(false);
      placeCaret(editor, model, "SELECT * FROM logs WHERE match_all('zz");
      moveCaret(editor);
      expect(key.set).toHaveBeenLastCalledWith(false);
    });

    it("leaves Enter alone in off mode", { timeout: 30000 }, async () => {
      const { editor, model } = await mountWith("q-off", {}, { editor_suggest_mode: "off" });
      placeCaret(editor, model, "SELECT * FROM logs WHERE level = 'zz", "'");
      moveCaret(editor);
      expect(quoteKey(editor).set).toHaveBeenLastCalledWith(false);
    });
  });

  describe("a menu left on Still loading", () => {
    it("asks Monaco again once the lookup lands", { timeout: 30000 }, async () => {
      const resolver = delayed(1300, ["error"]);
      const { editor, model, provide } = await mountWith("r-once", {
        fieldValueResolver: resolver,
      });
      const result = await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
      expect(nameOf(rowsOf(result)[0])).toContain("valuesLoading");
      expect(triggers(editor)).toHaveLength(0);
      await vi.waitFor(() => expect(triggers(editor)).toHaveLength(1), { timeout: 3000 });
      expect(triggers(editor)[0]).toEqual(["o2", "editor.action.triggerSuggest", { auto: true }]);
      const ids = editor.trigger.mock.calls.map((c: any[]) => c[1]);
      expect(ids.indexOf("hideSuggestWidget"), "closed first, or Monaco ignores the trigger").toBe(
        ids.indexOf("editor.action.triggerSuggest") - 1,
      );
    });

    it("never refills twice for the same lookup", { timeout: 30000 }, async () => {
      const resolver = delayed(1100, ["error"]);
      const { editor, model, provide } = await mountWith("r-twice", {
        fieldValueResolver: resolver,
      });
      await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
      await vi.waitFor(() => expect(triggers(editor)).toHaveLength(1), { timeout: 3000 });
      await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
      await new Promise((r) => setTimeout(r, 400));
      expect(triggers(editor)).toHaveLength(1);
    });

    it(
      "refills a second slow lookup after the range changes at the same caret",
      { timeout: 30000 },
      async () => {
        const resolver = delayed(1300, ["error"]);
        const { editor, model, provide, wrapper } = await mountWith("r-range", {
          fieldValueResolver: resolver,
          valuesTimeRange: { startTime: 1_000_000, endTime: 2_000_000 },
        });
        await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
        await vi.waitFor(() => expect(triggers(editor)).toHaveLength(1), { timeout: 3000 });
        await wrapper.setProps({ valuesTimeRange: { startTime: 3_000_000, endTime: 4_000_000 } });
        await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
        await vi.waitFor(() => expect(triggers(editor)).toHaveLength(2), { timeout: 3000 });
      },
    );

    it(
      "refills again once an answered lookup sits between two slow ones",
      { timeout: 30000 },
      async () => {
        const slow = () => new Promise<string[]>((r) => setTimeout(() => r(["error"]), 1300));
        const resolver = vi
          .fn()
          .mockImplementationOnce(slow)
          .mockImplementationOnce(async () => ["error"])
          .mockImplementationOnce(slow);
        const { editor, model, provide } = await mountWith("r-scope", {
          fieldValueResolver: resolver,
        });
        await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
        await vi.waitFor(() => expect(triggers(editor)).toHaveLength(1), { timeout: 3000 });
        await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
        await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
        await vi.waitFor(() => expect(triggers(editor)).toHaveLength(2), { timeout: 3000 });
      },
    );

    it("does not refill after Esc", { timeout: 30000 }, async () => {
      const resolver = delayed(1300, ["error"]);
      const { editor, model, provide } = await mountWith("r-esc", { fieldValueResolver: resolver });
      await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
      editor.onKeyDown.mock.calls.at(-1)![0]({ keyCode: 9 });
      await new Promise((r) => setTimeout(r, 600));
      expect(triggers(editor)).toHaveLength(0);
    });

    it("does not refill after typed whitespace", { timeout: 30000 }, async () => {
      const resolver = delayed(1300, ["error"]);
      const { editor, model, provide } = await mountWith("r-space", {
        fieldValueResolver: resolver,
      });
      const text = "SELECT * FROM logs WHERE level = ";
      await ask(provide, editor, model, text);
      editor.getPosition.mockReturnValue({ lineNumber: 1, column: text.length + 3 });
      model.getValueInRange.mockImplementation((range: any) =>
        range.startColumn === 1 ? text : "x ",
      );
      await new Promise((r) => setTimeout(r, 600));
      expect(triggers(editor)).toHaveLength(0);
    });
  });

  describe("the values copy follows the lookup's range", () => {
    const emptyRow = async (editorId: string, props: any) => {
      const { editor, model, provide } = await mountWith(editorId, {
        fieldValueResolver: vi.fn(async () => []),
        ...props,
      });
      const result = await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
      return nameOf(rowsOf(result)[0]);
    };

    it("names the default lookback when no range is set", { timeout: 30000 }, async () => {
      expect(await emptyRow("e-default", {})).toContain("valuesEmpty");
      expect(await emptyRow("e-default2", {})).not.toContain("valuesEmptyInRange");
    });

    const valuesHeader = async (editorId: string, props: any) => {
      const { editor, model, provide } = await mountWith(editorId, {
        fieldValueResolver: vi.fn(async () => ["error"]),
        ...props,
      });
      const result = await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
      return nameOf(result.suggestions.find(isHeader));
    };

    it("heads values as recent when no range is set", { timeout: 30000 }, async () => {
      expect(await valuesHeader("h-default", {})).toBe("sqlEditor.completion.groupValues");
    });

    it("heads values plainly when they come from a set range", { timeout: 30000 }, async () => {
      const range = { startTime: 1_000_000, endTime: 2_000_000 };
      expect(await valuesHeader("h-range", { valuesTimeRange: range })).toBe(
        "sqlEditor.completion.groupValuesName",
      );
    });

    it("speaks of the selected range when one is set", { timeout: 30000 }, async () => {
      const range = { startTime: 1_000_000, endTime: 2_000_000 };
      expect(await emptyRow("e-range", { valuesTimeRange: range })).toContain("valuesEmptyInRange");
    });
  });

  describe("the typed prefix reaches the resolver", () => {
    it("passes what is typed inside an open quote", { timeout: 30000 }, async () => {
      const resolver = vi.fn(async (_field: string, _options?: any) => ["openobserve"]);
      const { editor, model, provide } = await mountWith("p-quote", {
        fieldValueResolver: resolver,
      });
      await ask(provide, editor, model, "SELECT * FROM logs WHERE level = 'openobs");
      expect(resolver.mock.calls.at(-1)![1]).toMatchObject({ prefix: "openobs" });
    });

    it("passes an empty prefix outside a quote", { timeout: 30000 }, async () => {
      const resolver = vi.fn(async (_field: string, _options?: any) => ["openobserve"]);
      const { editor, model, provide } = await mountWith("p-bare", {
        fieldValueResolver: resolver,
      });
      await ask(provide, editor, model, "SELECT * FROM logs WHERE level = ");
      expect(resolver.mock.calls.at(-1)![1]).toMatchObject({ prefix: "" });
    });
  });
});

describe("P0-2 / P0-3 / W0-B — the chain, the operator lane and comments", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  afterAll(() => spy?.mockRestore());

  const FIELDS = [
    { name: "level", label: "level", kind: "Field", insertText: "level", detail: "Utf8" },
    { name: "code", label: "code", kind: "Field", insertText: "code", detail: "Int64" },
  ];

  const mountIn = async (
    editorId: string,
    mode = "automatic",
    extra: { keywords?: any[]; filterMode?: boolean } = {},
  ) => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
    const before = createFn.mock.calls.length;
    spy = vi
      .spyOn(document, "getElementById")
      .mockImplementation(() => document.createElement("div"));
    const store = createStore({
      state: { theme: "light", zoConfig: { editor_suggest_mode: mode } },
    });
    const wrapper = mount(CodeQueryEditor, {
      props: {
        editorId,
        language: "sql",
        query: "",
        keywords: extra.keywords ?? FIELDS,
        suggestions: [],
        filterMode: extra.filterMode ?? false,
      },
      global: { plugins: [store] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });
    const registration = registerFn.mock.calls.filter((c) => c[0] === "sql").at(-1)![1];
    return { wrapper, registration, editor: createdEditors.at(-1)!, api };
  };

  const ask = async (
    registration: any,
    editor: any,
    text: string,
    word = "",
    context: any = {},
  ) => {
    const model = editor.getModel();
    model.getValueInRange.mockReturnValue(text);
    model.getLineContent.mockReturnValue(text);
    model.getWordUntilPosition.mockReturnValue({
      word,
      startColumn: text.length + 1 - word.length,
      endColumn: text.length + 1,
    });
    return await registration.provideCompletionItems(
      model,
      { lineNumber: 1, column: text.length + 1 },
      context,
      {},
    );
  };
  const item = (r: any, label: string) =>
    r.suggestions.find((s: any) => !isHeader(s) && nameOf(s) === label);

  // Monaco runs an accepted item's command; this runs it the same way and reports whether a space was typed.
  const accept = (api: any, editor: any, suggestion: any): boolean => {
    vi.mocked(api.editor.getEditors).mockReturnValue([editor] as any);
    editor.hasTextFocus.mockReturnValue(true);
    editor.trigger.mockClear();
    const handler = (vi.mocked(api.editor.registerCommand).mock.calls as any[]).find(
      (c) => c[0] === suggestion.command?.id,
    )?.[1];
    handler?.({}, ...(suggestion.command?.arguments ?? []));
    vi.mocked(api.editor.getEditors).mockReturnValue([]);
    return editor.trigger.mock.calls.some(
      (c: any[]) => c[0] === "keyboard" && c[1] === "type" && c[2]?.text === " ",
    );
  };
  const TYPED_SPACE = { triggerKind: 1, triggerCharacter: " " };

  it(
    "under off, typing = after a field opens nothing; otherwise it opens values",
    {
      timeout: 30000,
    },
    async () => {
      const off = await mountIn("trigger-off", "off");
      const eq = { triggerKind: 1, triggerCharacter: "=" };
      expect(
        (await ask(off.registration, off.editor, "SELECT * FROM t WHERE level=", "", eq))
          .suggestions,
      ).toEqual([]);
      const on = await mountIn("trigger-on", "automatic");
      const values = await ask(on.registration, on.editor, "SELECT * FROM t WHERE level=", "", eq);
      expect(item(values, "level"), "a value position offers columns").toBeDefined();
    },
  );

  it(
    "the grouped operator menu still counts its rows in the operator lane",
    { timeout: 30000 },
    async () => {
      const { registration, editor } = await mountIn("lane-grouped");
      const track = vi.spyOn(analytics, "track");
      flushEditorSuggestSummary();
      track.mockClear();
      const model = editor.getModel();
      const text = "SELECT * FROM t WHERE level ";
      model.getLineContent.mockReturnValue(`${text}AND code = 1`);
      model.getValueInRange.mockReturnValue(text);
      model.getWordUntilPosition.mockReturnValue({
        word: "",
        startColumn: text.length + 1,
        endColumn: text.length + 1,
      });
      const result = await registration.provideCompletionItems(
        model,
        { lineNumber: 1, column: text.length + 1 },
        TYPED_SPACE,
        {},
      );
      expect(item(result, "=")?.command?.arguments).toEqual(["operator"]);
      flushEditorSuggestSummary();
      const summary = track.mock.calls
        .map((c: any[]) => c[1])
        .find((p: any) => p?.lane_offered_operator !== undefined);
      expect(summary?.lane_offered_operator).toBe(1);
      track.mockRestore();
    },
  );

  it(
    "level NOT offers every NOT operator, replacing the typed words",
    { timeout: 30000 },
    async () => {
      const { registration, editor } = await mountIn("not-partial");
      const text = "SELECT * FROM t WHERE level NOT ";
      const result = await ask(registration, editor, text);
      const rows = result.suggestions.filter((s: any) => !isHeader(s));
      for (const label of ["NOT IN", "NOT LIKE", "NOT ILIKE", "NOT BETWEEN"]) {
        expect(rows.map(nameOf)).toContain(label);
      }
      expect(rows.find((s: any) => nameOf(s) === "NOT IN").range.startColumn).toBe(
        text.length + 1 - "NOT ".length,
      );
    },
  );

  it(
    "a value position offers functions after the columns, except under off",
    { timeout: 30000 },
    async () => {
      const keywords = [
        ...FIELDS,
        { name: "lower", label: "lower", kind: "Function", insertText: "lower(x)" },
      ];
      const rowsIn = async (mode: string) => {
        const { registration, editor } = await mountIn(`fn-mode-${mode}`, mode, { keywords });
        const result = await ask(registration, editor, "SELECT * FROM t WHERE level = ");
        return result.suggestions.filter((s: any) => !isHeader(s)).map(nameOf);
      };
      expect(await rowsIn("automatic")).toEqual(["level", "code", "lower"]);
      expect(await rowsIn("off")).toEqual(["level", "code"]);
    },
  );

  it(
    "accepting a field in WHERE types a space, and that menu leads with =",
    {
      timeout: 30000,
    },
    async () => {
      const { registration, editor, api } = await mountIn("chain-where");
      const field = item(
        await ask(registration, editor, "SELECT * FROM t WHERE lev", "lev"),
        "level",
      );
      expect(field.insertText).toBe("level");
      expect(accept(api, editor, field)).toBe(true);
      const next = await ask(registration, editor, "SELECT * FROM t WHERE level ", "", TYPED_SPACE);
      const sorted = [...next.suggestions].sort((a: any, b: any) =>
        String(a.sortText ?? a.label).localeCompare(String(b.sortText ?? b.label)),
      );
      expect(nameOf(sorted.find((s: any) => !isHeader(s)))).toBe("=");
      expect(rowsOf(next).filter((s: any) => nameOf(s) === "=")).toHaveLength(1);
      expect(item(next, "code"), "the catalog stays below the lane").toBeDefined();
    },
  );

  it("accepting = types a space that opens the value position", { timeout: 30000 }, async () => {
    const { registration, editor, api } = await mountIn("chain-op");
    const result = await ask(registration, editor, "SELECT * FROM t WHERE level ", "", TYPED_SPACE);
    const eq = item(result, "=");
    expect(eq.insertText).toBe("=");
    expect(accept(api, editor, eq)).toBe(true);
  });

  it(
    "never chains in SELECT, GROUP BY, ORDER BY or function arguments",
    {
      timeout: 30000,
    },
    async () => {
      const { registration, editor, api } = await mountIn("chain-nowhere");
      for (const text of [
        "SELECT lev",
        "SELECT * FROM t GROUP BY lev",
        "SELECT * FROM t ORDER BY lev",
        "SELECT * FROM t WHERE str_match(lev",
        "SELECT CASE WHEN a = 1 AND lev",
        "SELECT NOT lev",
        "SELECT * FROM t WHERE ts BETWEEN now() - 1 AND lev",
      ]) {
        const field = item(await ask(registration, editor, text, "lev"), "level");
        expect(accept(api, editor, field), text).toBe(false);
      }
    },
  );

  it("typing mode never chains, and operators keep today's space", { timeout: 30000 }, async () => {
    const { registration, editor, api } = await mountIn("chain-typing", "typing");
    const field = item(
      await ask(registration, editor, "SELECT * FROM t WHERE lev", "lev"),
      "level",
    );
    expect(accept(api, editor, field)).toBe(false);
    const eq = item(await ask(registration, editor, "SELECT * FROM t WHERE level "), "=");
    expect(eq.insertText).toBe("= ");
    expect(accept(api, editor, eq)).toBe(false);
  });

  it(
    "an operator accepted with text already after it on the line does not chain",
    {
      timeout: 30000,
    },
    async () => {
      const { registration, editor, api } = await mountIn("chain-midline");
      const model = editor.getModel();
      const text = "SELECT * FROM t WHERE level ";
      model.getValueInRange.mockReturnValue(text);
      model.getLineContent.mockReturnValue(`${text} AND code = 1`);
      model.getWordUntilPosition.mockReturnValue({ word: "", startColumn: 29, endColumn: 29 });
      const result = await registration.provideCompletionItems(
        model,
        { lineNumber: 1, column: text.length + 1 },
        TYPED_SPACE,
        {},
      );
      const eq = item(result, "=");
      expect(eq.insertText).toBe("= ");
      expect(accept(api, editor, eq)).toBe(false);
    },
  );

  it("a bare filter chains its first field only in filter mode", { timeout: 30000 }, async () => {
    const api = await import("monaco-editor/esm/vs/editor/editor.api");
    const createFn = vi.mocked(api.editor.create);
    const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
    const before = createFn.mock.calls.length;
    const store = createStore({ state: { theme: "light", zoConfig: {} } });
    mount(CodeQueryEditor, {
      props: {
        editorId: "chain-filter",
        language: "sql",
        query: "",
        keywords: FIELDS,
        suggestions: [],
        filterMode: true,
      },
      global: { plugins: [store] },
    });
    await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
      timeout: 15000,
      interval: 25,
    });
    const editor = createdEditors.at(-1)!;
    const registration = registerFn.mock.calls.filter((c) => c[0] === "sql").at(-1)![1];
    const inFilter = item(await ask(registration, editor, "lev", "lev"), "level");
    expect(accept(api, editor, inFilter)).toBe(true);
    const plain = await mountIn("chain-nofilter");
    const inSql = item(await ask(plain.registration, plain.editor, "lev", "lev"), "level");
    expect(accept(api, plain.editor, inSql)).toBe(false);
  });

  it(
    "a non-query editor gets no counting command it could not run",
    { timeout: 30000 },
    async () => {
      const api = await import("monaco-editor/esm/vs/editor/editor.api");
      const createFn = vi.mocked(api.editor.create);
      const registerFn = vi.mocked(api.languages.registerCompletionItemProvider);
      const before = createFn.mock.calls.length;
      mount(CodeQueryEditor, {
        props: { editorId: "vrl-commands", language: "vrl", query: "", keywords: FIELDS },
        global: { plugins: [createStore({ state: { theme: "light" } })] },
      });
      await vi.waitFor(() => expect(createFn.mock.calls.length).toBe(before + 1), {
        timeout: 15000,
        interval: 25,
      });
      const editor = createdEditors.at(-1)!;
      const registration = registerFn.mock.calls.filter((c) => c[0] === "vrl").at(-1)![1];
      const result = await ask(registration, editor, ".lev", "lev");
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.every((s: any) => s.command === undefined)).toBe(true);
    },
  );

  describe("a space typed right after the chain's own space", () => {
    const press = (editor: any, browserEvent: Record<string, unknown> = {}) => {
      const event = {
        keyCode: 10,
        browserEvent,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };
      editor.onKeyDown.mock.calls.at(-1)![0](event);
      return event.preventDefault.mock.calls.length > 0;
    };
    const chainThenSpace = async (editorId: string) => {
      const { registration, editor, api } = await mountIn(editorId);
      const text = "SELECT * FROM t WHERE level";
      const field = item(
        await ask(registration, editor, "SELECT * FROM t WHERE lev", "lev"),
        "level",
      );
      expect(accept(api, editor, field)).toBe(true);
      editor.onDidChangeModelContent.mock.calls.at(-1)![0]({
        changes: [{ text: " ", range: { startLineNumber: 1, startColumn: text.length + 1 } }],
      });
      editor.getPosition.mockReturnValue({ lineNumber: 1, column: text.length + 2 });
      return editor;
    };

    it("is swallowed once, and the next one types", { timeout: 30000 }, async () => {
      const editor = await chainThenSpace("swallow-once");
      expect(press(editor)).toBe(true);
      expect(press(editor)).toBe(false);
    });

    it("is left alone during IME composition", { timeout: 30000 }, async () => {
      const editor = await chainThenSpace("swallow-ime");
      expect(press(editor, { isComposing: true })).toBe(false);
    });

    it("is left alone once the caret has moved", { timeout: 30000 }, async () => {
      const editor = await chainThenSpace("swallow-moved");
      editor.getPosition.mockReturnValue({ lineNumber: 1, column: 3 });
      expect(press(editor)).toBe(false);
    });

    it("never touches a space typed without a chain", { timeout: 30000 }, async () => {
      const { editor } = await mountIn("swallow-none");
      editor.onDidChangeModelContent.mock.calls.at(-1)![0]({
        changes: [{ text: " ", range: { startLineNumber: 1, startColumn: 5 } }],
      });
      editor.getPosition.mockReturnValue({ lineNumber: 1, column: 6 });
      expect(press(editor)).toBe(false);
    });
  });

  describe("after a complete predicate, AND and OR lead", () => {
    const CATALOG = [
      ...FIELDS.map((f) => ({ ...f, sortText: `\u0000${f.name}` })),
      ...SQL_KEYWORDS,
      ...SQL_CLAUSE_KEYWORDS,
    ];
    const leading = (result: any, count: number) =>
      [...result.suggestions]
        .sort((a: any, b: any) => (String(a.sortText) < String(b.sortText) ? -1 : 1))
        .slice(0, count)
        .map((s: any) => (typeof s.label === "string" ? s.label : s.label.label));

    it("in filter mode, after every predicate shape", { timeout: 30000 }, async () => {
      const { registration, editor } = await mountIn("lead-filter", "automatic", {
        keywords: CATALOG,
        filterMode: true,
      });
      for (const text of [
        "level = 'x' ",
        "level IS NULL ",
        "level IN ('a','b') ",
        "code BETWEEN 1 AND 5 ",
        "(code = 1) ",
      ]) {
        const result = await ask(registration, editor, text, "", TYPED_SPACE);
        expect(leading(result, 2), text).toEqual(["AND", "OR"]);
        expect(item(result, "level"), `${text}: fields stay`).toBeDefined();
      }
      const inGroup = await ask(registration, editor, "(code = 1 ", "", TYPED_SPACE);
      expect(leading(inGroup, 3)).toEqual(["AND", "OR", ")"]);
    });

    it("in full SQL, the clauses that can follow come next", { timeout: 30000 }, async () => {
      const { registration, editor } = await mountIn("lead-sql", "automatic", {
        keywords: CATALOG,
      });
      const result = await ask(
        registration,
        editor,
        "SELECT * FROM t WHERE level = 'x' ",
        "",
        TYPED_SPACE,
      );
      expect(leading(result, 5)).toEqual(["AND", "OR", "GROUP BY", "ORDER BY", "LIMIT"]);
      const when = await ask(registration, editor, "SELECT CASE WHEN code = 1 ", "", TYPED_SPACE);
      expect(leading(when, 3)).toEqual(["AND", "OR", "THEN"]);
    });

    it("AND chains into the field menu, which leads with fields", { timeout: 30000 }, async () => {
      const { registration, editor, api } = await mountIn("lead-chain", "automatic", {
        keywords: CATALOG,
        filterMode: true,
      });
      const result = await ask(registration, editor, "level = 'x' ", "", TYPED_SPACE);
      const and = item(result, "AND");
      expect(and.insertText).toBe("AND");
      expect(accept(api, editor, and)).toBe(true);
      const next = await ask(registration, editor, "level = 'x' AND ", "", TYPED_SPACE);
      expect(leading(next, 1)).toEqual(["code"]);
      const field = item(await ask(registration, editor, "level = 'x' AND lev", "lev"), "level");
      expect(accept(api, editor, field)).toBe(true);
    });

    it("typing mode ranks the same lead without chaining", { timeout: 30000 }, async () => {
      const { registration, editor, api } = await mountIn("lead-typing", "typing", {
        keywords: CATALOG,
        filterMode: true,
      });
      const result = await ask(registration, editor, "level = 'x' ", "", TYPED_SPACE);
      expect(leading(result, 2)).toEqual(["AND", "OR"]);
      const and = item(result, "AND");
      expect(and.insertText).toBe("AND ");
      expect(accept(api, editor, and)).toBe(false);
    });
  });

  it(
    "the match functions sit under Functions and fields, described, and Operators holds the plain operators",
    { timeout: 30000 },
    async () => {
      const { registration, editor } = await mountIn("op-groups");
      const result = await ask(
        registration,
        editor,
        "SELECT * FROM t WHERE level ",
        "",
        TYPED_SPACE,
      );
      const sorted = [...result.suggestions].sort((a: any, b: any) =>
        a.sortText < b.sortText ? -1 : 1,
      );
      const groups: Record<string, string[]> = {};
      let current = "";
      for (const row of sorted) {
        if (isHeader(row)) current = nameOf(row);
        else (groups[current] ??= []).push(nameOf(row));
      }
      expect(groups["sqlEditor.completion.groupOperators"]).toEqual([
        "=",
        "!=",
        "IN",
        "LIKE",
        "ILIKE",
        "IS NULL",
        "IS NOT NULL",
        "NOT LIKE",
      ]);
      expect(groups["sqlEditor.completion.groupFunctionsAndFields"].slice(0, 3)).toEqual([
        "str_match",
        "re_match",
        "re_not_match",
      ]);
      const described = (name: string) => item(result, name).label.description;
      expect(described("str_match")).toBe("sqlEditor.completion.wrapStrMatch");
      expect(described("re_not_match")).toBe("sqlEditor.completion.wrapReNotMatch");
    },
  );

  it(
    "an underscored prefix keeps the grouped menu: re_n gives Functions and fields with re_not_match",
    { timeout: 30000 },
    async () => {
      const { registration, editor } = await mountIn("op-groups-underscore");
      const result = await ask(registration, editor, "SELECT * FROM t WHERE level re_n", "re_n");
      expect(result.suggestions.filter(isHeader).map(nameOf)).toEqual([
        "sqlEditor.completion.groupFunctionsAndFields",
      ]);
      expect(rowsOf(result).map(nameOf)).toEqual(["re_not_match"]);
    },
  );

  it(
    "IS N offers only IS NULL and IS NOT NULL, over the whole prefix",
    { timeout: 30000 },
    async () => {
      const { registration, editor } = await mountIn("op-groups-isn", "automatic", {
        keywords: [...FIELDS, ...SQL_KEYWORDS, ...SQL_CLAUSE_KEYWORDS],
      });
      const text = "SELECT * FROM t WHERE level IS N";
      const result = await ask(registration, editor, text, "N");
      expect(rowsOf(result).map(nameOf)).toEqual(["IS NULL", "IS NOT NULL"]);
      expect(rowsOf(result)[0].range.startColumn).toBe(text.length - "IS N".length + 1);
    },
  );

  it(
    "typed letters keep the header of every group that still has matches",
    { timeout: 30000 },
    async () => {
      const { registration, editor } = await mountIn("op-groups-typed");
      const result = await ask(registration, editor, "SELECT * FROM t WHERE level I", "I");
      expect(result.suggestions.filter(isHeader).map(nameOf)).toContain(
        "sqlEditor.completion.groupOperators",
      );
    },
  );

  it("a numeric field leads with >=", { timeout: 30000 }, async () => {
    const { registration, editor } = await mountIn("chain-num");
    const result = await ask(registration, editor, "SELECT * FROM t WHERE code ");
    expect(nameOf(rowsOf(result)[0])).toBe(">=");
  });

  it(
    "returns nothing inside a -- comment, even for a trigger character",
    { timeout: 30000 },
    async () => {
      const { registration, editor } = await mountIn("chain-comment");
      const result = await ask(registration, editor, "-- show me errors ", "", {
        triggerKind: 1,
        triggerCharacter: " ",
      });
      expect(result.suggestions).toEqual([]);
    },
  );

  it("announces a chained menu to screen readers", { timeout: 30000 }, async () => {
    const { wrapper, registration, editor, api } = await mountIn("chain-announce");
    vi.mocked(api.editor.getEditors).mockReturnValue([editor] as any);
    editor.hasTextFocus.mockReturnValue(true);
    const chain = (vi.mocked(api.editor.registerCommand).mock.calls as any[]).find(
      (c) => c[0] === "o2.suggest.chainSpace",
    )[1];
    chain({}, "field");
    expect(editor.trigger).toHaveBeenCalledWith("keyboard", "type", { text: " " });
    await ask(registration, editor, "SELECT * FROM t WHERE level ", "", {
      triggerKind: 1,
      triggerCharacter: " ",
    });
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="query-editor-suggest-status"]').text()).toContain(
        "sqlEditor.completion.chainedMenuAnnouncement",
      ),
    );
    vi.mocked(api.editor.getEditors).mockReturnValue([]);
  });
});
