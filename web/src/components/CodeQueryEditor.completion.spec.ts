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
      );
      const labels = result.suggestions.map((s: any) => s.label);
      expect(labels, "values did not make the first result — they were not awaited").toEqual(
        expect.arrayContaining(["error", "warn"]),
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
      expect(result.suggestions.map((s: any) => s.label)).toContain("level");
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
    expect(result.suggestions.map((s: any) => s.label)).toEqual(["error"]);
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
    expect(before.suggestions.map((s: any) => s.label)).toContain("level");

    const after = await ask(provide, model, "SELECT * FROM logs WHERE level = ");
    expect(after.suggestions.map((s: any) => s.label)).toEqual(["error", "warn"]);
  });
});
