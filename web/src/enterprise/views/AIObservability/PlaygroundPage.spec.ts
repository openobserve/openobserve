// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const runPlayground = vi.fn();
const scorePlayground = vi.fn();
const scorersList = vi.fn();
const providersList = vi.fn();
const datasetsList = vi.fn();
const push = vi.fn();
const toast = vi.fn();

vi.mock("@/services/llm-playground.service", async () => {
  const actual = await vi.importActual<typeof import("@/services/llm-playground.service")>(
    "@/services/llm-playground.service",
  );
  return {
    ...actual,
    runPlayground: (...args: unknown[]) => runPlayground(...args),
    scorePlayground: (...args: unknown[]) => scorePlayground(...args),
  };
});

vi.mock("@/services/online-evals.service", () => ({
  default: {
    providers: { list: (...args: unknown[]) => providersList(...args) },
    scorers: { list: (...args: unknown[]) => scorersList(...args) },
  },
}));

vi.mock("@/services/llm-datasets.service", () => ({
  default: { list: (...args: unknown[]) => datasetsList(...args) },
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push }),
}));

// Partial: the real vuex createStore is still needed by modules the page pulls
// in transitively (services/http reaches for the store singleton).
vi.mock("vuex", async () => {
  const actual = await vi.importActual<typeof import("vuex")>("vuex");
  return {
    ...actual,
    useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
  };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: unknown[]) => toast(...args) }));

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

import PlaygroundPage from "./PlaygroundPage.vue";
import { SINGLE_ROW_KEY } from "./playgroundDraft";

// Structural stubs: this spec is about the run engine and draft mutations, not
// about how the shared components paint.
const passthrough = (name: string) => ({
  name,
  inheritAttrs: false,
  template: `<div class="${name}"><slot /><slot name="actions" /><slot name="title" /></div>`,
});

const stubs = {
  OPageLayout: passthrough("o-page-layout"),
  OBanner: passthrough("o-banner"),
  ODialog: passthrough("o-dialog"),
  ODropdown: passthrough("o-dropdown"),
  ODropdownItem: passthrough("o-dropdown-item"),
  OIcon: true,
  OTag: true,
  OButton: {
    props: ["disabled", "variant", "size", "loading"],
    emits: ["click"],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  PlaygroundVariableBar: true,
  PlaygroundVariantColumn: true,
  PlaygroundVariantConfig: true,
  PlaygroundCompareTable: true,
  PlaygroundRowDrawer: true,
  PlaygroundSampleDialog: true,
  PlaygroundAddRowDialog: true,
};

const PROVIDER = {
  id: "p1",
  name: "Production OpenAI",
  availableModels: ["gpt-4o-mini"],
  defaultModel: "gpt-4o-mini",
  isDefault: true,
};

async function mountPage() {
  const wrapper = mount(PlaygroundPage, { global: { stubs } });
  await flushPromises();
  return wrapper;
}

/** The page keeps its draft in a reactive object exposed on the instance. */
function vm(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  return wrapper.vm as unknown as {
    draft: import("./playgroundDraft").PlaygroundDraft;
    results: import("./playgroundDraft").PlaygroundResults;
    onRunAll: (force?: boolean) => void;
    runVariant: (id: string, skipGate?: boolean) => void;
    stopAll: () => void;
    addVariant: () => void;
    removeVariant: (id: string) => void;
    duplicate: (id: string) => void;
    addRow: (input: string, expected: string | null) => void;
    removeRow: (id: string) => void;
    createExperiment: (id: string) => void;
    updateVariant: (variant: import("./playgroundDraft").PlaygroundVariant) => void;
    setTools: (tools: import("./playgroundDraft").PlaygroundTool[]) => void;
    scoreAll: () => Promise<void>;
    totalCells: number;
  };
}

describe("PlaygroundPage", () => {
  beforeEach(() => {
    localStorage.clear();
    providersList.mockResolvedValue([PROVIDER]);
    datasetsList.mockResolvedValue([]);
    scorersList.mockResolvedValue([]);
    scorePlayground.mockReset();
    runPlayground.mockReset();
    push.mockReset();
    toast.mockReset();
    runPlayground.mockResolvedValue({
      text: "an answer",
      toolCall: null,
      usage: { promptTokens: 5, completionTokens: 2, costUsd: 0.001, latencyMs: 100 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts as a single-variant bench", async () => {
    const page = vm(await mountPage());
    expect(page.draft.variants).toHaveLength(1);
    expect(page.draft.scorerIds).toEqual([]);
    expect(page.draft.autoScore).toBe(false);
  });

  it("seeds the first variant with the default provider, so Run is reachable", async () => {
    const page = vm(await mountPage());
    expect(page.draft.variants[0].providerId).toBe("p1");
    expect(page.draft.variants[0].model).toBe("gpt-4o-mini");
  });

  it("disables Run when the org has no provider configured", async () => {
    providersList.mockResolvedValue([]);
    const wrapper = await mountPage();
    const runButton = wrapper.find('[data-test="ai-playground-run-all-btn"]');
    expect(runButton.attributes("disabled")).toBeDefined();
  });

  it("writes the finished answer and its usage into the cell", async () => {
    const wrapper = await mountPage();
    const page = vm(wrapper);

    page.onRunAll();
    await flushPromises();

    const cell = page.results[page.draft.variants[0].id][SINGLE_ROW_KEY];
    expect(cell.status).toBe("done");
    expect(cell.text).toBe("an answer");
    expect(cell.usage?.promptTokens).toBe(5);
  });

  it("clears the previous verdicts when a fresh run starts", async () => {
    const wrapper = await mountPage();
    const page = vm(wrapper);

    page.onRunAll();
    await flushPromises();
    const cell = page.results[page.draft.variants[0].id][SINGLE_ROW_KEY];
    expect(cell.scores).toBeUndefined();
    expect(cell.scoredKey).toBeUndefined();
  });

  it("sends only non-empty messages — a blank system prompt is not a message", async () => {
    const wrapper = await mountPage();
    const page = vm(wrapper);
    page.draft.variants[0].messages[1].content = "Hello";

    page.onRunAll();
    await flushPromises();

    const request = runPlayground.mock.calls[0][1] as { messages: unknown[] };
    expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("records a failed run as a retryable error rather than an empty answer", async () => {
    const { PlaygroundRunError } = await import("@/services/llm-playground.service");
    runPlayground.mockRejectedValue(new PlaygroundRunError("provider 429", true));

    const wrapper = await mountPage();
    const page = vm(wrapper);
    page.onRunAll();
    await flushPromises();

    const cell = page.results[page.draft.variants[0].id][SINGLE_ROW_KEY];
    expect(cell.status).toBe("error");
    expect(cell.error).toEqual({ message: "provider 429", retryable: true });
  });

  it("treats an abort as a user action, not a failure", async () => {
    runPlayground.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const wrapper = await mountPage();
    const page = vm(wrapper);
    page.onRunAll();
    await flushPromises();

    const cell = page.results[page.draft.variants[0].id][SINGLE_ROW_KEY];
    expect(cell.status).not.toBe("error");
  });

  it("caps variants at four", async () => {
    const page = vm(await mountPage());
    for (let i = 0; i < 8; i += 1) page.duplicate(page.draft.variants[0].id);
    expect(page.draft.variants).toHaveLength(4);
  });

  it("keeps the last variant — an empty bench is not a state", async () => {
    const page = vm(await mountPage());
    page.removeVariant(page.draft.variants[0].id);
    expect(page.draft.variants).toHaveLength(1);
  });

  it("drops a removed variant's results with it", async () => {
    const wrapper = await mountPage();
    const page = vm(wrapper);
    page.duplicate(page.draft.variants[0].id);
    const doomed = page.draft.variants[1].id;

    page.onRunAll();
    await flushPromises();
    expect(page.results[doomed]).toBeDefined();

    page.removeVariant(doomed);
    expect(page.results[doomed]).toBeUndefined();
  });

  // A comparison only says something when the prompt or model is the one thing
  // that differs, so the tool harness is shared rather than per column.
  it("gives every bench the same tools", async () => {
    const page = vm(await mountPage());
    page.duplicate(page.draft.variants[0].id);
    page.duplicate(page.draft.variants[0].id);

    page.setTools([{ name: "search", description: "", parameters: "{}" }]);

    expect(page.draft.variants).toHaveLength(3);
    for (const variant of page.draft.variants) {
      expect(variant.tools.map((tool) => tool.name)).toEqual(["search"]);
    }
  });

  it("gives each bench its own copy, so editing one never mutates another", async () => {
    const page = vm(await mountPage());
    page.duplicate(page.draft.variants[0].id);

    page.setTools([{ name: "search", description: "", parameters: "{}" }]);
    page.draft.variants[0].tools[0].name = "changed";

    expect(page.draft.variants[1].tools[0].name).toBe("search");
  });

  it("inserts a duplicate directly after its source, with an id of its own", async () => {
    const page = vm(await mountPage());
    const first = page.draft.variants[0].id;
    page.draft.variants[0].messages[1].content = "Summarise {{input}}";

    page.duplicate(first);

    expect(page.draft.variants).toHaveLength(2);
    expect(page.draft.variants[0].id).toBe(first);
    expect(page.draft.variants[1].id).not.toBe(first);
    expect(page.draft.variants[1].messages[1].content).toBe("Summarise {{input}}");
  });

  it("binds the bench variables into the prompt it sends", async () => {
    const page = vm(await mountPage());
    page.draft.variants[0].messages[1].content = "Summarise {{input}}";
    page.draft.vars = { input: "the refund policy" };

    page.onRunAll();
    await flushPromises();

    const request = runPlayground.mock.calls[0][1] as { messages: { content: string }[] };
    expect(request.messages[0].content).toBe("Summarise the refund policy");
  });

  it("runs every variant on the bench", async () => {
    const page = vm(await mountPage());
    page.draft.variants[0].messages[1].content = "Hello";
    page.duplicate(page.draft.variants[0].id);

    page.onRunAll();
    await flushPromises();

    expect(runPlayground).toHaveBeenCalledTimes(2);
  });

  it("hands the variant's config to the experiment form", async () => {
    const page = vm(await mountPage());
    page.draft.variants[0].messages[0].content = "You are terse.";
    page.draft.variants[0].messages[1].content = "Summarise {{input}}";

    page.createExperiment(page.draft.variants[0].id);

    const target = push.mock.calls[0][0] as { query: Record<string, string> };
    expect(target.query.provider).toBe("p1");
    expect(target.query.model).toBe("gpt-4o-mini");
    expect(target.query.systemPrompt).toBe("You are terse.");
    expect(target.query.userPrompt).toBe("Summarise {{input}}");
  });

  // The route is keepAlive:false, so leaving the page unmounts it. The bench is
  // unsaved work; only Reset is allowed to clear it.
  it("restores the bench after the page is left and reopened", async () => {
    const first = await mountPage();
    const page = vm(first);
    page.draft.variants[0].messages[1].content = "keep me";
    page.draft.vars = { input: "bound" };
    first.unmount();

    const second = vm(await mountPage());
    expect(second.draft.variants[0].messages[1].content).toBe("keep me");
    expect(second.draft.vars).toEqual({ input: "bound" });
  });

  // Ids outlive the page load now (session, recent drafts, snapshots) while the
  // counter restarts at 1 — without adoption a NEW column takes an id the bench
  // already holds and every lookup resolves to the first match.
  it("gives a column added after a restore an id of its own", async () => {
    const first = await mountPage();
    vm(first).draft.variants[0].messages[1].content = "restored";
    first.unmount();

    const page = vm(await mountPage());
    page.duplicate(page.draft.variants[0].id);
    const [a, b] = page.draft.variants;
    expect(b.id).not.toBe(a.id);

    page.updateVariant({ ...b, model: "claude-3" });
    expect(page.draft.variants[1].model).toBe("claude-3");
    expect(page.draft.variants[0].model).toBe("gpt-4o-mini");
  });

  it("re-scores when an expected output is added, without needing another run", async () => {
    scorePlayground.mockResolvedValue([]);
    const page = vm(await mountPage());
    page.draft.scorerIds = ["scorer-1"];
    page.draft.variants[0].messages[1].content = "Hello";

    page.onRunAll();
    await flushPromises();
    await page.scoreAll();
    expect(scorePlayground).toHaveBeenCalledTimes(1);

    // Same answer, same scorers: nothing the judge sees has changed.
    await page.scoreAll();
    expect(scorePlayground).toHaveBeenCalledTimes(1);

    page.draft.expectedSingle = "the golden answer";
    await page.scoreAll();
    expect(scorePlayground).toHaveBeenCalledTimes(2);
    expect(scorePlayground.mock.calls[1][1].expectedOutput).toBe("the golden answer");
  });
});
