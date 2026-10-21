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

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settleAsyncParts } from "@/components/ai-assistant/__tests__/assistantPartStubs";
import { AVAILABLE, fakeRuntime } from "@/composables/assistant/__tests__/fakeRuntime";
import { createOpenAssistant } from "@/composables/assistant/openAssistant";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";
import {
  proposalFor,
  resetEditorProposalsForTests,
} from "@/composables/assistant/useEditorProposal";
import { contextRegistry } from "@/composables/contextProviders/registry";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const { flag } = vi.hoisted(() => ({ flag: { on: true } }));

vi.mock("@/composables/assistant/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant/flags")>()),
  isAssistantV2: () => flag.on,
}));
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { search: vi.fn().mockResolvedValue({ data: { hits: [] } }) },
  });
});
vi.mock("@/composables/useQuery", () => ({
  default: () => ({ buildQueryPayload: vi.fn().mockReturnValue({ query: { sql: "" } }) }),
}));
vi.mock("@/composables/useParser", () => ({
  default: () => ({ sqlParser: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/utils/alerts/alertSqlUtils", () => ({ getParser: vi.fn().mockReturnValue(null) }));
vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false", isAiEnabled: "true" },
}));
vi.mock("@/services/query_functions", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn().mockResolvedValue({ data: { list: [] } }) },
  });
});
vi.mock("@/components/ai-assistant/entry/AiEntryButton.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.aiEntryButtonStub),
);
vi.mock("@/components/ai-assistant/shell/AssistantDock.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.assistantDockStub),
);
vi.mock("@/components/ai-assistant/entry/AiLabel.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.aiLabelStub),
);
vi.mock("@/components/ai-assistant/evidence/AssistantDiffBlock.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.diffBlockStub),
);

import QueryEditorDialog from "./QueryEditorDialog.vue";

const replaceValue = vi.fn();

function setup(modelValue = true) {
  const base = fakeRuntime();
  const runtime = {
    ...base,
    openAssistant: createOpenAssistant({
      store: base.store,
      capability: () => AVAILABLE,
      hosts: base.hosts,
      routeName: () => "alerts",
      routePrefersFloating: () => false,
      pushRoute: vi.fn(),
      lgUp: () => true,
      viewportPx: () => 1280,
      currentOrg: () => "org1",
      now: () => Date.now(),
      notify: vi.fn(),
    }),
  };
  setRuntimeHandle(runtime as never);
  const wrapper = mount(QueryEditorDialog, {
    props: {
      modelValue,
      tab: "sql",
      sqlQuery: 'SELECT * FROM "default"',
      promqlQuery: "",
      vrlFunction: "",
      streamName: "default",
      streamType: "logs",
      columns: [],
      period: 10,
      multiTimeRange: [],
      savedFunctions: [],
      sqlQueryErrorMsg: "",
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        CodeQueryEditor: { template: "<div />" },
        QueryEditor: { template: "<div />" },
        UnifiedQueryEditor: {
          template: '<div class="stub-unified-editor"><textarea /></div>',
          props: ["query"],
          methods: { replaceValue },
        },
        FullViewContainer: { template: "<div><slot /></div>" },
        O2AIChat: { template: '<div data-test="legacy-chat" />' },
      },
    },
    attachTo: document.body,
  });
  return { wrapper, runtime };
}

beforeEach(() => {
  flag.on = true;
  store.state.zoConfig = { ...store.state.zoConfig, ai_enabled: true };
  sessionStorage.clear();
  localStorage.clear();
  contextRegistry.cleanup();
  replaceValue.mockClear();
});

afterEach(() => {
  resetEditorProposalsForTests();
  setRuntimeHandle(null);
  document.body.innerHTML = "";
});

describe("QueryEditorDialog with the revamped assistant", () => {
  it("offers the one Assistant toggle and registers the alert query host while open", async () => {
    const { wrapper, runtime } = setup();
    await settleAsyncParts();
    expect(document.querySelector('[data-test="ai-entry-alert-query-ask"]')).not.toBeNull();
    expect(document.querySelector('[data-test="menu-link-ai-item"]')).toBeNull();
    expect(runtime.hosts.has("alert_query")).toBe(true);
    const context = await contextRegistry.getActiveContext();
    expect(context).toMatchObject({
      selectedStreams: ["default"],
      currentSQLQuery: 'SELECT * FROM "default"',
    });
    wrapper.unmount();
    expect(runtime.hosts.has("alert_query")).toBe(false);
  });

  it("docks the shared shell in the dialog's body row and closes it through the toggle", async () => {
    const { runtime } = setup();
    await settleAsyncParts();
    await runtime.openAssistant({
      entryKind: "editor_toggle",
      entryVerb: "ask",
      objectKind: "alert",
      intent: "open",
      dockHost: "alert_query",
      container: "docked",
    });
    await settleAsyncParts();
    const dock = document.querySelector('[data-test="assistant-dock-stub"]');
    expect(dock?.getAttribute("data-host")).toBe("alert_query");
    expect(dock?.parentElement?.getAttribute("data-test")).toBe("query-editor-dialog-card");
    const toggle = document.querySelector<HTMLElement>('[data-test="ai-entry-alert-query-ask"]')!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    toggle.click();
    await settleAsyncParts();
    expect(runtime.store.state.shell.placement.kind).toBe("hidden");
  });

  it("previews an Insert as a diff and lands it only on Accept, then labels it with Revert", async () => {
    const { wrapper } = setup();
    await settleAsyncParts();
    const proposal = proposalFor("alert_query")!;
    const handle = await proposal.propose('SELECT count(*) FROM "default"', {
      mode: "replace",
      provenance: { prompt: "count" },
      canRun: true,
    });
    await settleAsyncParts();
    expect(document.querySelector('[data-test="assistant-diff-block"]')).not.toBeNull();
    expect(wrapper.emitted("update:sqlQuery")).toBeUndefined();
    (document.querySelector('[data-test="assistant-diff-accept"]') as HTMLElement).click();
    await expect(handle.decision).resolves.toBe("accepted");
    await settleAsyncParts();
    expect(wrapper.emitted("update:sqlQuery")?.at(-1)).toEqual([
      '-- count\nSELECT count(*) FROM "default"',
    ]);
    expect(replaceValue).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-test="ai-label-editor"]')).not.toBeNull();
    (document.querySelector('[data-test="ai-label-revert"]') as HTMLElement).click();
    await settleAsyncParts();
    expect(wrapper.emitted("update:sqlQuery")?.at(-1)).toEqual(['SELECT * FROM "default"']);
    expect(document.querySelector('[data-test="ai-label-editor"]')).toBeNull();
  });

  it("remounts the diff for a second proposal, so Accept never applies text the user did not see", async () => {
    setup();
    await settleAsyncParts();
    const proposal = proposalFor("alert_query")!;
    const first = await proposal.propose("SELECT 1", {
      mode: "replace",
      provenance: { prompt: "one" },
      canRun: false,
    });
    await settleAsyncParts();
    const shown = document.querySelector('[data-test="assistant-diff-block"]');
    await proposal.propose("SELECT 2", {
      mode: "replace",
      provenance: { prompt: "two" },
      canRun: false,
    });
    await settleAsyncParts();
    await expect(first.decision).resolves.toBe("discarded");
    const now = document.querySelector('[data-test="assistant-diff-block"]');
    expect(now).not.toBe(shown);
    expect(now?.getAttribute("data-proposal-id")).toBe(String(proposal.pending.value!.id));
  });

  it("settles an open diff as discarded when the dialog closes, and shows nothing on reopen", async () => {
    const { wrapper } = setup();
    await settleAsyncParts();
    const handle = await proposalFor("alert_query")!.propose("SELECT 1", {
      mode: "replace",
      provenance: { prompt: "one" },
      canRun: false,
    });
    await wrapper.setProps({ modelValue: false });
    await expect(handle.decision).resolves.toBe("discarded");
    await wrapper.setProps({ modelValue: true });
    await settleAsyncParts();
    expect(document.querySelector('[data-test="assistant-diff-block"]')).toBeNull();
  });

  it("drops the label when the tab changes, so Revert never writes SQL into PromQL", async () => {
    const { wrapper } = setup();
    await settleAsyncParts();
    const handle = await proposalFor("alert_query")!.propose('SELECT count(*) FROM "default"', {
      mode: "replace",
      provenance: { prompt: "count" },
      canRun: false,
    });
    handle.accept();
    await settleAsyncParts();
    expect(document.querySelector('[data-test="ai-label-editor"]')).not.toBeNull();
    await wrapper.setProps({ tab: "promql" });
    (wrapper.vm as unknown as { localTab: string }).localTab = "promql";
    await settleAsyncParts();
    expect(document.querySelector('[data-test="ai-label-editor"]')).toBeNull();
  });

  it("keeps the legacy toggle and chat with the revamp off", async () => {
    flag.on = false;
    const { runtime } = setup();
    await settleAsyncParts();
    expect(document.querySelector('[data-test="menu-link-ai-item"]')).not.toBeNull();
    expect(document.querySelector('[data-test="ai-entry-alert-query-ask"]')).toBeNull();
    expect(runtime.hosts.has("alert_query")).toBe(false);
  });
});
