// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const runPlayground = vi.fn();
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
    PLAYGROUND_USE_MOCK: true,
    runPlayground: (...args: unknown[]) => runPlayground(...args),
  };
});

vi.mock("@/services/online-evals.service", () => ({
  default: { providers: { list: (...args: unknown[]) => providersList(...args) } },
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
    runGateOpen: boolean;
    totalCells: number;
  };
}

describe("PlaygroundPage", () => {
  beforeEach(() => {
    providersList.mockResolvedValue([PROVIDER]);
    datasetsList.mockResolvedValue([]);
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

  it("starts as a single-variant editor bench", async () => {
    const page = vm(await mountPage());
    expect(page.draft.variants).toHaveLength(1);
    expect(page.draft.rows).toBeNull();
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

  it("clears staleness once the run that matches the config finishes", async () => {
    const wrapper = await mountPage();
    const page = vm(wrapper);
    page.draft.variants[0].stale = true;

    page.onRunAll();
    await flushPromises();

    expect(page.draft.variants[0].stale).toBe(false);
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
    for (let i = 0; i < 8; i += 1) page.addVariant();
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
    page.addVariant();
    const doomed = page.draft.variants[1].id;

    page.onRunAll();
    await flushPromises();
    expect(page.results[doomed]).toBeDefined();

    page.removeVariant(doomed);
    expect(page.results[doomed]).toBeUndefined();
  });

  it("inserts a duplicate directly after its source", async () => {
    const page = vm(await mountPage());
    page.addVariant();
    const first = page.draft.variants[0].id;

    page.duplicate(first);

    expect(page.draft.variants).toHaveLength(3);
    expect(page.draft.variants[1].id).not.toBe(first);
  });

  it("switches to table mode on the first row and back when the last one goes", async () => {
    const page = vm(await mountPage());

    page.addRow("first question", null);
    expect(page.draft.rows).toHaveLength(1);

    page.removeRow(page.draft.rows![0].id);
    expect(page.draft.rows).toBeNull();
  });

  it("gates a run whose template references no row field", async () => {
    const page = vm(await mountPage());
    page.draft.variants[0].messages[1].content = "Summarise the policy.";
    page.addRow("a question", null);

    page.onRunAll();
    await flushPromises();

    expect(page.runGateOpen).toBe(true);
    expect(runPlayground).not.toHaveBeenCalled();
  });

  it("does not gate once the template binds a row field", async () => {
    const page = vm(await mountPage());
    page.draft.variants[0].messages[1].content = "Summarise {{input}}";
    page.addRow("a question", null);

    page.onRunAll();
    await flushPromises();

    expect(page.runGateOpen).toBe(false);
    expect(runPlayground).toHaveBeenCalledTimes(1);
  });

  it("runs every row against every variant", async () => {
    const page = vm(await mountPage());
    page.draft.variants[0].messages[1].content = "Summarise {{input}}";
    page.addVariant();
    page.addRow("one", null);
    page.addRow("two", null);

    page.onRunAll();
    await flushPromises();

    expect(runPlayground).toHaveBeenCalledTimes(4);
  });

  it("substitutes the row's input into the prompt it sends", async () => {
    const page = vm(await mountPage());
    page.draft.variants[0].messages[1].content = "Summarise {{input}}";
    page.addRow("the refund policy", null);

    page.onRunAll();
    await flushPromises();

    const request = runPlayground.mock.calls[0][1] as {
      messages: { content: string }[];
    };
    expect(request.messages[0].content).toBe("Summarise the refund policy");
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
});
