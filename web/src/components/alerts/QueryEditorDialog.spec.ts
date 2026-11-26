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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      search: vi.fn().mockResolvedValue({ data: { hits: [] } }),
    },
  });
});

vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    buildQueryPayload: vi.fn().mockReturnValue({
      query: { sql: "", size: 10, sql_mode: true, query_fn: null, per_query_response: true },
    }),
  }),
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock("@/utils/alerts/alertSqlUtils", () => ({
  getParser: vi.fn().mockReturnValue(null),
}));

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false", isCloud: "false", isAiEnabled: "false" },
}));

import QueryEditorDialog from "@/components/alerts/QueryEditorDialog.vue";
import config from "@/aws-exports";
import { settleAsyncParts } from "@/components/ai-assistant/__tests__/assistantPartStubs";
import { AVAILABLE, fakeRuntime } from "@/composables/assistant/__tests__/fakeRuntime";
import { createOpenAssistant } from "@/composables/assistant/openAssistant";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";
import {
  proposalFor,
  resetEditorProposalsForTests,
} from "@/composables/assistant/useEditorProposal";
import { contextRegistry } from "@/composables/contextProviders/registry";

const childEditorStub = {
  template: '<div class="stub-editor"></div>',
  props: ["query", "editorId", "language", "readOnly"],
  emits: ["update:query", "blur"],
};

const unifiedEditorStub = {
  template: '<div class="stub-unified-editor"></div>',
  props: ["query", "editorId", "streamName", "streamType"],
  emits: ["update:query", "blur"],
};

async function mountComp(props: Record<string, any> = {}) {
  return mount(QueryEditorDialog, {
    props: {
      modelValue: true,
      tab: "sql",
      sqlQuery: "",
      promqlQuery: "",
      vrlFunction: "",
      streamName: "my-stream",
      streamType: "logs",
      columns: [
        { label: "host", value: "host" },
        { label: "level", value: "level" },
      ],
      period: 10,
      multiTimeRange: [],
      savedFunctions: [],
      sqlQueryErrorMsg: "",
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        CodeQueryEditor: childEditorStub,
        QueryEditor: childEditorStub,
        UnifiedQueryEditor: unifiedEditorStub,
        FullViewContainer: {
          template: '<div><slot /><slot name="right" /></div>',
          props: ["name", "label", "isExpanded"],
          emits: ["update:isExpanded"],
        },
      },
    },
  });
}

describe("QueryEditorDialog - rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without errors", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.exists()).toBe(true);
  });

  it("renders when modelValue is true", async () => {
    const w = await mountComp({ modelValue: true });
    await flushPromises();
    expect(w.html()).toBeTruthy();
  });
});

describe("QueryEditorDialog - initial state", () => {
  it("localTab defaults to sql", async () => {
    const w = await mountComp({ tab: "sql" });
    await flushPromises();
    expect((w.vm as any).localTab).toBe("sql");
  });

  it("localTab uses provided tab prop", async () => {
    const w = await mountComp({ tab: "promql" });
    await flushPromises();
    expect((w.vm as any).localTab).toBe("promql");
  });

  it("localSqlQuery initialized from props.sqlQuery", async () => {
    const w = await mountComp({ sqlQuery: "SELECT * FROM stream" });
    await flushPromises();
    expect((w.vm as any).localSqlQuery).toBe("SELECT * FROM stream");
  });

  it("localPromqlQuery initialized from props.promqlQuery", async () => {
    const w = await mountComp({ promqlQuery: "rate(metric[5m])" });
    await flushPromises();
    expect((w.vm as any).localPromqlQuery).toBe("rate(metric[5m])");
  });

  it("vrlFunctionContent initialized from props.vrlFunction", async () => {
    const w = await mountComp({ vrlFunction: ".level = upcase(.level)" });
    await flushPromises();
    expect((w.vm as any).vrlFunctionContent).toBe(".level = upcase(.level)");
  });

  it("functionOptions initialized from props.savedFunctions", async () => {
    const w = await mountComp({ savedFunctions: [{ name: "fn1" }, { name: "fn2" }] });
    await flushPromises();
    expect((w.vm as any).functionOptions).toHaveLength(2);
  });

  it("expandSqlOutput defaults to true", async () => {
    const w = await mountComp();
    expect((w.vm as any).expandSqlOutput).toBe(true);
  });

  it("expandCombinedOutput defaults to true", async () => {
    const w = await mountComp();
    expect((w.vm as any).expandCombinedOutput).toBe(true);
  });
});

describe("QueryEditorDialog - closeDialog", () => {
  it("emits update:modelValue with false", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).closeDialog();
    expect(w.emitted("update:modelValue")).toBeTruthy();
    expect((w.emitted("update:modelValue") as any[][])[0][0]).toBe(false);
  });
});

describe("QueryEditorDialog - updateSqlQuery", () => {
  it("updates localSqlQuery", async () => {
    const w = await mountComp();
    (w.vm as any).updateSqlQuery("SELECT count(*) FROM logs");
    expect((w.vm as any).localSqlQuery).toBe("SELECT count(*) FROM logs");
  });

  it("emits update:sqlQuery with new value", async () => {
    const w = await mountComp();
    (w.vm as any).updateSqlQuery("SELECT count(*) FROM logs");
    expect(w.emitted("update:sqlQuery")).toBeTruthy();
    expect((w.emitted("update:sqlQuery") as any[][])[0][0]).toBe("SELECT count(*) FROM logs");
  });
});

describe("QueryEditorDialog - updatePromqlQuery", () => {
  it("updates localPromqlQuery", async () => {
    const w = await mountComp();
    (w.vm as any).updatePromqlQuery("rate(http_requests[5m])");
    expect((w.vm as any).localPromqlQuery).toBe("rate(http_requests[5m])");
  });

  it("emits update:promqlQuery", async () => {
    const w = await mountComp();
    (w.vm as any).updatePromqlQuery("rate(http_requests[5m])");
    expect(w.emitted("update:promqlQuery")).toBeTruthy();
  });
});

describe("QueryEditorDialog - updateVrlFunction", () => {
  it("updates vrlFunctionContent", async () => {
    const w = await mountComp();
    (w.vm as any).updateVrlFunction(".level = upcase(.level)");
    expect((w.vm as any).vrlFunctionContent).toBe(".level = upcase(.level)");
  });

  it("emits update:vrlFunction", async () => {
    const w = await mountComp();
    (w.vm as any).updateVrlFunction(".level = upcase(.level)");
    expect(w.emitted("update:vrlFunction")).toBeTruthy();
  });
});

// The saved-functions OSelect is configured with valueKey="name", so it emits
// the function NAME, never the option object. These tests must pass a name —
// passing an object here is what let the "select does nothing" bug through.
describe("QueryEditorDialog - onFunctionSelect", () => {
  const FUNCS = [
    { name: "myFn", function: ".level = upcase(.level)" },
    { name: "otherFn", function: ".a = 1" },
  ];

  it("sets vrlFunctionContent from the selected function's body", async () => {
    const w = await mountComp({ savedFunctions: FUNCS });
    (w.vm as any).onFunctionSelect("myFn");
    expect((w.vm as any).vrlFunctionContent).toBe(".level = upcase(.level)");
  });

  it("emits update:vrlFunction so the parent form keeps the selection", async () => {
    const w = await mountComp({ savedFunctions: FUNCS });
    (w.vm as any).onFunctionSelect("myFn");
    expect(w.emitted("update:vrlFunction")?.at(-1)).toEqual([".level = upcase(.level)"]);
  });

  it("replaces the body when switching to a different function", async () => {
    const w = await mountComp({ savedFunctions: FUNCS });
    (w.vm as any).onFunctionSelect("myFn");
    (w.vm as any).onFunctionSelect("otherFn");
    expect((w.vm as any).vrlFunctionContent).toBe(".a = 1");
  });

  it("falls back to `body` when the function has no `function` field", async () => {
    const w = await mountComp({ savedFunctions: [{ name: "bodyFn", body: ".b = 2" }] });
    (w.vm as any).onFunctionSelect("bodyFn");
    expect((w.vm as any).vrlFunctionContent).toBe(".b = 2");
  });

  it("does nothing when the name matches no saved function", async () => {
    const w = await mountComp({ vrlFunction: "existing", savedFunctions: FUNCS });
    (w.vm as any).onFunctionSelect("nope");
    expect((w.vm as any).vrlFunctionContent).toBe("existing");
  });
});

describe("QueryEditorDialog - onFunctionClear", () => {
  it("clears vrlFunctionContent", async () => {
    const w = await mountComp({ vrlFunction: ".level = upcase(.level)" });
    (w.vm as any).onFunctionClear();
    expect((w.vm as any).vrlFunctionContent).toBe("");
  });

  it("clears selectedFunction", async () => {
    const w = await mountComp();
    (w.vm as any).selectedFunction = { name: "myFn" };
    (w.vm as any).onFunctionClear();
    expect((w.vm as any).selectedFunction).toBeNull();
  });
});

describe("QueryEditorDialog - buildMultiWindowQuery", () => {
  it("returns empty array when multiTimeRange is empty", async () => {
    const w = await mountComp({ multiTimeRange: [] });
    const result = (w.vm as any).buildMultiWindowQuery("SELECT * FROM logs", false, 600000000);
    expect(result).toEqual([]);
  });

  it("builds queries for each multiTimeRange entry", async () => {
    const w = await mountComp({
      multiTimeRange: [{ offSet: "1h" }, { offSet: "24h" }],
    });
    const result = (w.vm as any).buildMultiWindowQuery("SELECT * FROM logs", false, 600000000);
    expect(result).toHaveLength(2);
  });

  it("includes sql in each query", async () => {
    const w = await mountComp({
      multiTimeRange: [{ offSet: "1h" }],
    });
    const result = (w.vm as any).buildMultiWindowQuery(
      "SELECT count(*) FROM logs",
      false,
      600000000,
    );
    expect(result[0].sql).toBe("SELECT count(*) FROM logs");
  });

  it("ignores entries with invalid offset format", async () => {
    const w = await mountComp({
      multiTimeRange: [{ offSet: "invalid-format" }],
    });
    const result = (w.vm as any).buildMultiWindowQuery("SELECT * FROM logs", false, 600000000);
    expect(result).toHaveLength(0);
  });
});

describe("QueryEditorDialog - prop watchers", () => {
  it("updates localTab when tab prop changes", async () => {
    const w = await mountComp({ tab: "sql" });
    await flushPromises();
    await w.setProps({ tab: "promql" });
    await flushPromises();
    expect((w.vm as any).localTab).toBe("promql");
  });

  it("updates localSqlQuery when sqlQuery prop changes", async () => {
    const w = await mountComp({ sqlQuery: "SELECT 1" });
    await flushPromises();
    await w.setProps({ sqlQuery: "SELECT count(*) FROM logs" });
    await flushPromises();
    expect((w.vm as any).localSqlQuery).toBe("SELECT count(*) FROM logs");
  });

  it("updates localPromqlQuery when promqlQuery prop changes", async () => {
    const w = await mountComp({ promqlQuery: "" });
    await flushPromises();
    await w.setProps({ promqlQuery: "rate(http[5m])" });
    await flushPromises();
    expect((w.vm as any).localPromqlQuery).toBe("rate(http[5m])");
  });

  it("updates vrlFunctionContent when vrlFunction prop changes", async () => {
    const w = await mountComp({ vrlFunction: "" });
    await flushPromises();
    await w.setProps({ vrlFunction: ".level = downcase(.level)" });
    await flushPromises();
    expect((w.vm as any).vrlFunctionContent).toBe(".level = downcase(.level)");
  });

  it("updates functionOptions when savedFunctions prop changes", async () => {
    const w = await mountComp({ savedFunctions: [] });
    await flushPromises();
    await w.setProps({ savedFunctions: [{ name: "newFn" }] });
    await flushPromises();
    expect((w.vm as any).functionOptions).toHaveLength(1);
    expect((w.vm as any).functionOptions[0].name).toBe("newFn");
  });
});

describe("QueryEditorDialog - onBlurFunctionEditor", () => {
  it("sets functionEditorPlaceholderFlag to true when vrl is empty", async () => {
    const w = await mountComp({ vrlFunction: "" });
    (w.vm as any).onBlurFunctionEditor();
    expect((w.vm as any).functionEditorPlaceholderFlag).toBe(true);
  });

  it("sets functionEditorPlaceholderFlag to false when vrl is not empty", async () => {
    const w = await mountComp({ vrlFunction: ".level = upcase(.level)" });
    (w.vm as any).onBlurFunctionEditor();
    expect((w.vm as any).functionEditorPlaceholderFlag).toBe(false);
  });
});

// Coverage for the dialog → ODrawer migration. The template now renders
// <ODrawer v-model:open="isOpen" size="full" :show-close="false"> where
// isOpen is a computed get/set bound to the modelValue prop.
describe("QueryEditorDialog - ODrawer Migration", () => {
  // Lightweight stub mirroring ODrawer's migrated prop surface so we can
  // assert the open/size/showClose contract without pulling in reka-ui.
  const ODrawerStub = {
    name: "ODrawer",
    props: {
      open: { type: Boolean, default: false },
      size: { type: String, default: undefined },
      showClose: { type: Boolean, default: true },
      title: { type: String, default: undefined },
      persistent: { type: Boolean, default: false },
      width: { type: [String, Number], default: undefined },
    },
    emits: ["update:open"],
    template: `
      <div
        data-test="o-drawer-stub"
        :data-open="String(open)"
        :data-size="size"
        :data-show-close="String(!!showClose)"
      >
        <slot name="header" />
        <slot name="header-left" />
        <slot name="header-right" />
        <slot />
        <slot name="footer" />
        <button
          data-test="o-drawer-stub-close"
          @click="$emit('update:open', false)"
        >close</button>
      </div>
    `,
  };

  async function mountWithDrawerStub(props: Record<string, any> = {}) {
    return mount(QueryEditorDialog, {
      props: {
        modelValue: true,
        tab: "sql",
        sqlQuery: "",
        promqlQuery: "",
        vrlFunction: "",
        streamName: "my-stream",
        streamType: "logs",
        columns: [],
        period: 10,
        multiTimeRange: [],
        savedFunctions: [],
        sqlQueryErrorMsg: "",
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ODrawer: ODrawerStub,
          CodeQueryEditor: childEditorStub,
          QueryEditor: childEditorStub,
          UnifiedQueryEditor: unifiedEditorStub,
          FullViewContainer: {
            template: '<div><slot /><slot name="right" /></div>',
            props: ["name", "label", "isExpanded"],
            emits: ["update:isExpanded"],
          },
        },
      },
    });
  }

  beforeEach(() => vi.clearAllMocks());

  it("renders exactly one ODrawer at the root of the template", async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    const drawers = w.findAllComponents(ODrawerStub);
    expect(drawers.length).toBe(1);
  });

  it("forwards modelValue=true to ODrawer's open prop", async () => {
    const w = await mountWithDrawerStub({ modelValue: true });
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(true);
  });

  it("forwards modelValue=false to ODrawer's open prop", async () => {
    const w = await mountWithDrawerStub({ modelValue: false });
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(false);
  });

  it("reflects modelValue prop changes onto ODrawer's open prop", async () => {
    const w = await mountWithDrawerStub({ modelValue: true });
    await flushPromises();
    let drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(true);

    await w.setProps({ modelValue: false });
    await flushPromises();
    drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("open")).toBe(false);
  });

  it('renders ODrawer with size="full"', async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("size")).toBe("full");
  });

  it('renders ODrawer with :show-close="false"', async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    expect(drawer.props("showClose")).toBe(false);
  });

  it("emits update:modelValue=false when ODrawer emits update:open=false", async () => {
    const w = await mountWithDrawerStub({ modelValue: true });
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    await drawer.vm.$emit("update:open", false);
    await flushPromises();
    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([false]);
  });

  it("emits update:modelValue=true when ODrawer emits update:open=true", async () => {
    const w = await mountWithDrawerStub({ modelValue: false });
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    await drawer.vm.$emit("update:open", true);
    await flushPromises();
    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([true]);
  });

  it("emits update:modelValue=false when the back button inside the drawer is clicked (closeDialog path)", async () => {
    const w = await mountWithDrawerStub({ modelValue: true });
    await flushPromises();
    const backBtn = w.find('[data-test="add-alert-back-btn"]');
    expect(backBtn.exists()).toBe(true);
    await backBtn.trigger("click");
    await flushPromises();
    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([false]);
  });

  it("renders the dialog body content (drawer default slot) inside the ODrawer", async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    const drawer = w.findComponent(ODrawerStub);
    // the dialog card lives inside the drawer's default slot
    expect(drawer.find('[data-test="query-editor-dialog-card"]').exists()).toBe(true);
  });

  it("renders ODrawer as the migration wrapper (migration completed)", async () => {
    const w = await mountWithDrawerStub();
    await flushPromises();
    expect(w.findComponent(ODrawerStub).exists()).toBe(true);
  });
});

// ─── Phase 1 (N1) / Phase 3 (C4) — autocomplete reaches the editor ───────────
// These two tests used to drive a VALUE context and assert that values arrived
// through `keywords` while `suggestions` went blank. That was the only way to
// tell effectiveKeywords from autoCompleteKeywords, which are identical unless
// a context is active — and it was a fair test until the value round trip was
// removed: the completion PROVIDER now resolves values itself, so nothing
// pushes them through the props any more.
//
// What replaces each half:
//   - the N1 invariant (bind the context-aware list, never the base one) is now
//     enforced for EVERY editor host in utils/query/editorWiring.spec.ts, which
//     needs no context to make the distinction visible;
//   - what this file can still prove is its own wiring — that the resolver the
//     provider awaits arrives, and resolves against the stream context the
//     dialog sets.

describe("QueryEditorDialog - autocomplete wiring reaches the editor", () => {
  const editorStubDef = {
    name: "UnifiedQueryEditor",
    template: '<div class="stub-kw-editor" />',
    props: ["query", "keywords", "suggestions", "fieldValueResolver"],
    emits: ["update:query", "blur", "focus", "language-change", "ask-ai", "run-query"],
    methods: {
      // handleQueryUpdate reads these off queryEditorRef.
      getCursorIndex() {
        return 9999; // past end-of-query => analyse the whole string
      },
      triggerAutoComplete() {},
    },
  };

  const mountWithStub = () =>
    mount(QueryEditorDialog, {
      props: {
        modelValue: true,
        tab: "sql",
        sqlQuery: "",
        promqlQuery: "",
        vrlFunction: "",
        streamName: "my-stream",
        streamType: "logs",
        columns: [
          { label: "host", value: "host" },
          { label: "level", value: "level" },
        ],
        period: 10,
        multiTimeRange: [],
        savedFunctions: [],
        sqlQueryErrorMsg: "",
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          UnifiedQueryEditor: editorStubDef,
          // ODrawer is the dialog root; without a slot-rendering stub none of
          // its content (including the editor) mounts.
          ODrawer: {
            name: "ODrawer",
            props: ["open", "size", "showClose", "bleed", "persistent", "title", "width"],
            emits: ["update:open"],
            template: "<div><slot name='header-left' /><slot name='header-right' /><slot /></div>",
          },
          FullViewContainer: {
            template: "<div><slot /><slot name='right' /></div>",
            props: ["name", "label", "isExpanded"],
            emits: ["update:isExpanded"],
          },
        },
      },
    });

  it("renders the unified editor", () => {
    const wrapper = mountWithStub();
    expect(wrapper.findComponent({ name: "UnifiedQueryEditor" }).exists()).toBe(true);
  });

  it("hands the editor a resolver that produces the stored values", async () => {
    const wrapper = mountWithStub();
    const editor = wrapper.findComponent({ name: "UnifiedQueryEditor" });
    // Drives handleQueryUpdate, which is where the dialog sets the org/stream
    // context the lookup is keyed on. Without that the resolver returns [] and
    // this fails — which is the wiring worth guarding.
    await editor.vm.$emit("update:query", "level = ");
    await flushPromises();

    const resolve = editor.props("fieldValueResolver") as (f: string) => Promise<string[]>;
    expect(typeof resolve, "no resolver reached the editor").toBe("function");
    await expect(resolve("level")).resolves.toEqual(expect.arrayContaining(["error", "warn"]));
  });

  it("leaves the catalog suggestions alone in a value position", async () => {
    // The provider swaps the whole list out for values itself. The parent
    // blanking the catalog was part of the removed round trip, and doing it
    // here would now take the functions away for no one's benefit.
    const wrapper = mountWithStub();
    const editor = wrapper.findComponent({ name: "UnifiedQueryEditor" });
    await editor.vm.$emit("update:query", "level = ");
    await flushPromises();

    const suggestions = (editor.props("suggestions") ?? []) as any[];
    expect(suggestions.some((s: any) => s.name === "match_all")).toBe(true);
  });
});

// Stored field values for the resolver test above. Only useSuggestions
// consumes this module, so mocking it does not affect the rest of the suite.
vi.mock("@/composables/fieldValueStore", () => ({
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue(["error", "warn"]),
  requestFieldValues: vi.fn().mockResolvedValue([]),
  fieldValuesUnavailable: vi.fn(() => false),
}));

// getSuggestions now awaits a lazy fetch of the server function catalog. Stub it
// so this suite makes no HTTP call and the awaited chain settles inside
// flushPromises(); the fetch itself is covered in
// useSuggestions.serverCatalog.spec.ts.
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

describe("QueryEditorDialog with the revamped assistant", () => {
  const replaceAssistantValue = vi.fn();

  function setupWithAssistant(modelValue = true) {
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
            methods: { replaceValue: replaceAssistantValue },
          },
          FullViewContainer: { template: "<div><slot /></div>" },
        },
      },
      attachTo: document.body,
    });
    return { wrapper, runtime };
  }

  beforeEach(() => {
    Object.assign(config, { isEnterprise: "true", isAiEnabled: "true" });
    store.state.zoConfig = { ...store.state.zoConfig, ai_enabled: true };
    sessionStorage.clear();
    localStorage.clear();
    contextRegistry.cleanup();
    replaceAssistantValue.mockClear();
  });

  afterEach(() => {
    resetEditorProposalsForTests();
    setRuntimeHandle(null);
    document.body.innerHTML = "";
    Object.assign(config, { isEnterprise: "false", isAiEnabled: "false" });
  });

  it("offers the one Assistant toggle and registers the alert query host while open", async () => {
    const { wrapper, runtime } = setupWithAssistant();
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
    const { runtime } = setupWithAssistant();
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
    const { wrapper } = setupWithAssistant();
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
    expect(replaceAssistantValue).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-test="ai-label-editor"]')).not.toBeNull();
    (document.querySelector('[data-test="ai-label-revert"]') as HTMLElement).click();
    await settleAsyncParts();
    expect(wrapper.emitted("update:sqlQuery")?.at(-1)).toEqual(['SELECT * FROM "default"']);
    expect(document.querySelector('[data-test="ai-label-editor"]')).toBeNull();
  });

  it("remounts the diff for a second proposal, so Accept never applies text the user did not see", async () => {
    setupWithAssistant();
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
    const { wrapper } = setupWithAssistant();
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
    const { wrapper } = setupWithAssistant();
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
});
